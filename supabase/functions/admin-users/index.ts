import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Account administration for the export console.
 *
 * Creating a user and setting someone else's password need the secret key,
 * which bypasses row-level security and must never reach a browser. It lives
 * here. Every request is authorised from the caller's own token — never from
 * anything in the request body — and only an ACTIVE admin gets through.
 *
 * There is deliberately no "delete": an account is deactivated (in the
 * console, via public.set_user_access) so the audit trail always has a name
 * behind it.
 *
 * Deployed with JWT verification off at the platform because the check is
 * done here, where a refusal can carry a readable message.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// SB_SECRET_KEY is the new-style secret key; set it as a function secret
// before the legacy JWT keys are disabled, and this keeps working.
const SECRET_KEY = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Not signed in." }, 401);

  const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

  // Who is asking? Resolved from their token, by the auth server.
  const { data: who, error: whoErr } = await admin.auth.getUser(auth.slice(7));
  if (whoErr || !who?.user) return json({ error: "Your session has expired — sign in again." }, 401);

  const { data: profile } = await admin
    .from("profiles")
    .select("role, active, email")
    .eq("id", who.user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin" || !profile.active) {
    return json({ error: "Only an administrator can manage accounts." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const action = String(body.action ?? "");

  const log = async (act: string, entityId: string, detail: string) => {
    await admin.from("audit_log").insert({
      actor: profile.email || who.user.email || "admin",
      actor_id: who.user.id,
      action: act,
      entity: "user",
      entity_id: entityId,
      detail,
    });
  };

  if (action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const role = body.role === "admin" ? "admin" : "staff";
    const ALL = ["overview", "parties", "quotations", "proforma", "shipments", "analytics", "company", "users"];
    const asked = Array.isArray(body.sections) ? body.sections.map(String) : [];
    if (asked.some((s) => !ALL.includes(s))) return json({ error: "Unknown section in the list." }, 400);
    // An admin always holds every section; staff hold exactly what was ticked.
    const sections = role === "admin" ? ALL : ALL.filter((s) => asked.includes(s));

    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (password.length < 8) return json({ error: "The password must be at least 8 characters." }, 400);
    if (!fullName) return json({ error: "Name is required." }, 400);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no confirmation mail: nothing to rate-limit, nothing to wait for
      user_metadata: { full_name: fullName },
    });
    if (createErr || !created?.user) {
      const msg = /already/i.test(createErr?.message ?? "")
        ? "That email already has an account."
        : (createErr?.message ?? "The account could not be created.");
      return json({ error: msg }, 400);
    }

    const { error: profErr } = await admin.from("profiles").update({
      full_name: fullName,
      email,
      role,
      sections,
    }).eq("id", created.user.id);
    if (profErr) {
      return json({ error: "The account was created but its access could not be set. Set it from the Users list." }, 500);
    }

    await log("User created", created.user.id, `${email} — ${role} — ${sections.join(", ") || "no sections"}`);
    return json({ ok: true, id: created.user.id, email });
  }

  if (action === "set_password") {
    const userId = String(body.user_id ?? "");
    const password = String(body.password ?? "");
    if (!userId) return json({ error: "Which account?" }, 400);
    if (password.length < 8) return json({ error: "The password must be at least 8 characters." }, 400);

    const { data: target } = await admin.from("profiles").select("email").eq("id", userId).maybeSingle();
    if (!target) return json({ error: "That account no longer exists." }, 404);

    const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password });
    if (updErr) return json({ error: updErr.message }, 400);

    await log("Password set by administrator", userId, target.email);
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
