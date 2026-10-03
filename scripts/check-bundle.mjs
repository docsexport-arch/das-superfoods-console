// Inspects the BUILT client before it is deployed (Build Bible §16, §20).
// A green deploy proves the upload, not the app: this proves the bundle talks
// to the right backend and carries nothing it should not.
//
//   node scripts/check-bundle.mjs            checks ./dist
//   node scripts/check-bundle.mjs <url>      checks a live deployment
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SUPABASE_URL } from "../src/config.js";

const host = new URL(SUPABASE_URL).host;
const target = process.argv[2];
const failures = [];
let scripts = [];

if (target) {
  const page = await (await fetch(target)).text();
  const urls = [...page.matchAll(/src="([^"]+\.js)"/g)].map((m) => new URL(m[1], target).href);
  if (!urls.length) failures.push(`no script found on ${target}`);
  for (const url of urls) {
    const res = await fetch(url);
    // Say what actually happened: a script that is not being served yet is a
    // different failure from a bundle that points at the wrong backend.
    if (!res.ok) failures.push(`${url} answered HTTP ${res.status} — the deployment may still be propagating`);
    scripts.push({ name: url, text: res.ok ? await res.text() : "" });
  }
} else {
  const dir = join(process.cwd(), "dist", "assets");
  if (!existsSync(dir)) {
    console.error("check:bundle — dist/ not found. Run `npm run build` first.");
    process.exit(1);
  }
  scripts = readdirSync(dir).filter((f) => f.endsWith(".js"))
    .map((f) => ({ name: f, text: readFileSync(join(dir, f), "utf8") }));
}

const all = scripts.map((s) => s.text).join("\n");

if (!all.includes(host)) failures.push(`the bundle does not contain the backend host ${host}`);
if (all.includes("[SENSITIVE]")) failures.push("the bundle contains a [SENSITIVE] placeholder — an env var was redacted at build time");
if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(all)) failures.push("the bundle contains a Supabase SECRET key");

// Any JWT in the bundle is decoded; a service_role token is a full-access key.
for (const [token] of all.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (payload.role === "service_role") failures.push("the bundle contains a service_role JWT");
  } catch { /* not a JWT after all */ }
}

if (failures.length) {
  console.error("check:bundle FAILED\n  - " + failures.join("\n  - "));
  process.exit(1);
}
const kb = Math.round(scripts.reduce((n, s) => n + s.text.length, 0) / 1024);
console.log(`check:bundle ✓ ${scripts.length} script(s), ${kb} KB, backend ${host}, no secret key`);
