// Das Superfoods — Export console.
// Screens only. Data access is in lib/db.js, arithmetic in lib/money.js,
// formatting in lib/format.js, and every colour and font in tokens.css.
import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from "react";
import { createPortal } from "react-dom";
import {
  Lock, Plus, X, ChevronRight, Check, Trash2, Boxes, KeyRound, History,
  Download, TriangleAlert, Search, Sun, Moon,
} from "lucide-react";
import { BOOT_TIMEOUT_MS } from "./config.js";
import { sb, call, fetchStore, adminApi, emptyStore, accessOf, userFromRow, partyNames, withTimeout, humanise } from "./lib/db.js";
import { todayIST, fmtDate, fmtWhen, fmtNum, fmtMoney, amountInWords, tempId, toNumber, unitsFromBoxes, gramsFromKg, kgFromGrams, conditionsFromText, conditionsToText } from "./lib/format.js";
import { quotationTotals, proformaTotals, shipmentTotals } from "./lib/money.js";
import { computeMigrationDrift, describeDrift } from "./lib/migrations.js";
import { exportRows, exportBook } from "./lib/excel.js";
import {
  shipmentModel, shipmentCompany, shipmentHeader, shipmentCharges, taxInvoiceTotals, commercialInvoiceTotals, bankRows, shipmentSheets,
} from "./lib/shipment-docs.js";
import { proformaSheetRows, proformaLineAmount, proformaUnits, fileSafe, PROFORMA_SHEET_WIDTHS } from "./lib/documents.js";
import {
  pick, PARTY_KEYS, PARTY_PRODUCT_KEYS, QUOTATION_KEYS, PROFORMA_KEYS, SHIPMENT_KEYS, COMPANY_KEYS, DRAFT_KEYS,
} from "./lib/payloads.js";
import {
  card, panel, input, btn, btnGhost, th, td, tdNum, label, errText,
  Field, Chip, PageHead, ErrorPanel, ExcelButton, Dialog,
} from "./ui.jsx";

const THEME_KEY = "das-superfoods-erp/theme";

/* --------------------------------------------------------------- access */
/* Every toolbar section is its own grant. An account sees a section only if
   it is ticked for that account; an admin always holds all of them.
   The keys mirror SECTION_KEYS in lib/db.js and public.has_access() in the
   database (db/010) — the database is the gate; this decides what to draw.
   One list drives the toolbar, the tick-boxes and the Users table, so they
   cannot drift apart.                                                      */
const SECTIONS = [
  { key: "overview", label: "Overview", note: "the home page" },
  { key: "parties", label: "Parties", note: "buyer, consignee, product and pricing records" },
  { key: "quotations", label: "Quotations", note: "create, edit and print quotations" },
  { key: "proforma", label: "Proforma", note: "raise proforma invoices" },
  { key: "shipments", label: "Shipments", note: "invoice a shipment against a proforma" },
  { key: "analytics", label: "Analytics", note: "reports (phase 2)" },
  { key: "company", label: "Company", note: "registered details and bank particulars" },
  { key: "users", label: "Users", note: "see accounts and the audit log — only an admin can change them" },
];
const ALL_SECTION_KEYS = SECTIONS.map((s) => s.key);

const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

// Runs a write, reports a human sentence on failure, and reloads on success.
// Returns "" when it worked, so a form can show the message in place.
async function attempt(work) {
  try { await work(); return ""; }
  catch (e) { return e && e.message ? e.message : String(e); }
}

/* --------------------------------------------------------------- login */
function SignIn({ onSignIn, onReset }) {
  const [mode, setMode] = useState("in");           // in | forgot
  const [emailValue, setEmailValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSent(""); setBusy(true);
    if (mode === "in") {
      const message = await onSignIn(emailValue.trim(), password);
      if (message) setError(message);
    } else {
      setSent(await onReset(emailValue.trim()));
    }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-display text-2xl tracking-tight text-[var(--text)]">Das Superfoods</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Export console</p>
        </div>

        <form onSubmit={submit} className={card + " p-6"}>
          <p className="mb-5 text-sm font-medium text-[var(--text)]">
            {mode === "in" ? "Sign in" : "Reset your password"}
          </p>

          <Field label="Work email" className="mb-4">
            <input type="email" required className={input} value={emailValue} autoComplete="username"
              onChange={(e) => { setEmailValue(e.target.value); setError(""); }} />
          </Field>

          {mode === "in" && (
            <Field label="Password" className="mb-5">
              <input type="password" required className={input} value={password} autoComplete="current-password"
                onChange={(e) => { setPassword(e.target.value); setError(""); }} />
            </Field>
          )}

          <div aria-live="polite">
            {error && <p className={errText + " mb-4"}>{error}</p>}
            {sent && <p className="mb-4 text-sm text-[var(--status-ok)]">{sent}</p>}
          </div>

          <button type="submit" disabled={busy} className={btn + " w-full"}>
            {busy ? "Working…" : mode === "in" ? "Sign in" : "Send reset link"}
          </button>

          <button type="button" onClick={() => { setMode(mode === "in" ? "forgot" : "in"); setError(""); setSent(""); }}
            className="mt-3 w-full text-xs text-[var(--muted)] hover:text-[var(--text)]">
            {mode === "in" ? "Forgotten your password?" : "Back to sign in"}
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-[var(--faint)]">
          Accounts are created by an administrator. If you need access, ask them to add you under Users.
        </p>
      </div>
    </div>
  );
}

function Splash({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-center text-sm text-[var(--muted)]">
      {children}
    </div>
  );
}

/* ------------------------------------------------------- command palette */
function CommandPalette({ open, onClose, onNavigate, sections }) {
  const { store } = useApp();
  const [q, setQ] = useState("");
  const boxRef = useRef(null);

  useEffect(() => { if (open) setQ(""); }, [open]);
  if (!open) return null;

  const needle = q.trim().toLowerCase();
  const match = (s) => !needle || String(s || "").toLowerCase().includes(needle);

  const results = [];
  sections.forEach((s) => { if (match(s.label)) results.push({ kind: "Section", label: s.label, go: s.key }); });
  store.parties.forEach((p) => { if (match(p.buyerName) || match(p.country) || (p.altBuyers || []).some((b) => match(b.name))) results.push({ kind: "Party", label: p.buyerName, meta: p.country, go: "parties" }); });
  store.quotations.forEach((x) => { if (match(x.docNo) || match(x.buyerName)) results.push({ kind: "Quotation", label: x.docNo, meta: x.buyerName, go: "quotations" }); });
  store.pis.forEach((x) => { if (match(x.docNo) || match(x.buyerName)) results.push({ kind: "Proforma", label: x.docNo, meta: x.buyerName, go: "proforma" }); });
  store.finalInvoices.forEach((x) => { if (match(x.docNo) || match(x.buyerName)) results.push({ kind: "Shipment", label: x.docNo, meta: x.buyerName, go: "shipments" }); });

  const reachable = new Set(sections.map((s) => s.key));
  const shown = results.filter((r) => reachable.has(r.go));
  const pick = (r) => { onNavigate(r.go); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--scrim)] p-6 pt-24" onMouseDown={(e) => { if (e.target === boxRef.current) onClose(); }} ref={boxRef}>
      <div className={card + " w-full max-w-lg overflow-hidden"} role="dialog" aria-modal="true" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4">
          <Search className="h-4 w-4 text-[var(--muted)]" />
          <input
            autoFocus value={q} placeholder="Search sections, parties, document numbers…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && shown.length) pick(shown[0]);
            }}
            className="w-full bg-transparent py-3.5 text-sm text-[var(--text)] placeholder:text-[var(--faint)]"
          />
          <kbd className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">esc</kbd>
        </div>
        <div className="max-h-80 overflow-auto py-2">
          {shown.slice(0, 30).map((r, i) => (
            <button key={i} onClick={() => pick(r)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-[var(--field)]">
              <span className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-[var(--faint)]">{r.kind}</span>
              <span className="text-sm text-[var(--text)]">{r.label}</span>
              {r.meta && <span className="text-xs text-[var(--muted)]">{r.meta}</span>}
            </button>
          ))}
          {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">Nothing matches “{q}”.</p>}
        </div>
      </div>
    </div>
  );
}


/* ------------------------------------------------------- own password */
function ChangePasswordDialog({ onClose, onChanged }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pw1.length < 8) return setError("Use at least 8 characters.");
    if (pw1 !== pw2) return setError("The two passwords do not match.");
    setBusy(true); setError("");
    const message = await attempt(async () => {
      const { error: authError } = await withTimeout(sb.auth.updateUser({ password: pw1 }));
      if (authError) throw new Error(authError.message);
      await call("log_session_event", { p_event: "Password changed" });
    });
    setBusy(false);
    if (message) return setError(message);
    onChanged();
  };

  return (
    <Dialog title="Change your password" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="New password" className="mb-4" hint="At least 8 characters. Only you will know it.">
          <input type="password" className={input} value={pw1} autoComplete="new-password"
            onChange={(e) => { setPw1(e.target.value); setError(""); }} />
        </Field>
        <Field label="Confirm new password" className="mb-5">
          <input type="password" className={input} value={pw2} autoComplete="new-password"
            onChange={(e) => { setPw2(e.target.value); setError(""); }} />
        </Field>
        <div aria-live="polite">{error && <p className={errText + " mb-4"}>{error}</p>}</div>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={busy} className={btn}>{busy ? "Saving…" : "Save password"}</button>
        </div>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ app */
function App() {
  const [session, setSession] = useState(undefined);   // undefined = still checking
  const [profile, setProfile] = useState(undefined);   // undefined = not loaded yet
  const [profileError, setProfileError] = useState("");
  const [store, setStore] = useState(emptyStore);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState("overview");
  const [theme, setTheme] = useState(() => { try { return window.localStorage.getItem(THEME_KEY) || "dark"; } catch (e) { return "dark"; } });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [toast, setToast] = useState("");

  /* --- theme ------------------------------------------------------- */
  useEffect(() => {
    if (theme === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try { window.localStorage.setItem(THEME_KEY, theme); } catch (e) { /* not fatal */ }
  }, [theme]);

  /* --- ⌘K ---------------------------------------------------------- */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* --- session ----------------------------------------------------- */
  useEffect(() => {
    let settled = false;
    // A stale session must never leave the app on a spinner: after the
    // boot timeout we fall through to the sign-in screen, non-destructively.
    const guard = setTimeout(() => { if (!settled) setSession(null); }, BOOT_TIMEOUT_MS);
    sb.auth.getSession().then(({ data }) => { settled = true; setSession(data.session || null); });
    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => { settled = true; setSession(next); });
    return () => { clearTimeout(guard); sub.subscription.unsubscribe(); };
  }, []);

  const userId = session ? session.user.id : null;

  /* --- profile ----------------------------------------------------- */
  const loadProfile = useCallback(async () => {
    if (!userId) { setProfile(undefined); return; }
    setProfileError("");
    try {
      const { data, error } = await withTimeout(sb.from("profiles").select("*").eq("id", userId).maybeSingle());
      if (error) throw new Error(humanise(error));
      setProfile(data ? userFromRow(data) : null);
    } catch (e) {
      setProfileError(e.message || String(e));
    }
  }, [userId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  /* --- data -------------------------------------------------------- */
  const refresh = useCallback(async () => {
    if (!profile || !profile.active) return;
    setLoading(true);
    try {
      setStore(await fetchStore(profile));
      setLoadError("");
    } catch (e) {
      // Nothing degraded is kept on screen: the pages give way to an error.
      setLoadError(e.message || String(e));
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => { refresh(); }, [refresh]);

  /* --- live updates ------------------------------------------------ */
  useEffect(() => {
    if (!profile || !profile.active) return undefined;
    // Whatever anyone changes arrives here, so two people working at once stay
    // in step. A burst of events becomes one reload.
    let timer;
    const soon = (table) => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (table === "profiles") loadProfile(); else refresh(); }, 250);
    };
    const channel = sb.channel("console-changes");
    for (const table of ["parties", "party_products", "quotations", "proformas", "shipments", "drafts", "company_profile", "profiles", "audit_log"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => soon(table));
    }
    channel.subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(channel); };
  }, [profile, refresh, loadProfile]);

  /* --- auth actions ------------------------------------------------ */
  const signIn = async (email, password) => {
    let result;
    try { result = await withTimeout(sb.auth.signInWithPassword({ email, password })); }
    catch (e) { return e.message || "Could not reach the server."; }
    if (result.error) {
      const m = result.error.message || "";
      // The same sentence for a wrong password and an unknown address.
      if (/invalid login credentials/i.test(m)) return "Incorrect email or password.";
      if (/not confirmed/i.test(m)) return "This email address has not been confirmed yet.";
      if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a few minutes and try again.";
      return "Could not sign in. Try again in a moment.";
    }
    await attempt(() => call("log_session_event", { p_event: "Signed in" }));
    setActive("overview");
    return "";
  };

  const resetPassword = async (email) => {
    await attempt(() => withTimeout(sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })));
    return "If that address has an account, a reset link is on its way.";
  };

  const signOut = async () => {
    await attempt(() => call("log_session_event", { p_event: "Signed out" }));
    await sb.auth.signOut();
    setStore(emptyStore());
  };

  /* --- gates ------------------------------------------------------- */
  if (session === undefined) return <Splash>Connecting…</Splash>;
  if (!session) return <SignIn onSignIn={signIn} onReset={resetPassword} />;
  if (profileError) {
    return <Splash><div className="max-w-md"><ErrorPanel message={profileError} onRetry={loadProfile} /></div></Splash>;
  }
  if (profile === undefined) return <Splash>Loading your profile…</Splash>;

  const can = accessOf(profile);
  const holdsAny = ALL_SECTION_KEYS.some((key) => can[key]);
  if (!profile || !profile.active || !holdsAny) {
    return (
      <Splash>
        <div className={card + " w-full max-w-md p-6"}>
          <Lock className="mx-auto mb-3 h-6 w-6 text-[var(--muted)]" />
          <p className="font-display text-xl text-[var(--text)]">
            {profile && !profile.active ? "This account is deactivated" : "Waiting for access"}
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            {profile && !profile.active
              ? "An administrator has switched this account off. Nothing you created has been removed."
              : <span>Your account <span className="text-[var(--text)]">{session.user.email}</span> exists, but no sections have been granted to it yet. Ask an administrator to tick your permissions under Users.</span>}
          </p>
          <button onClick={signOut} className={btnGhost + " mt-5"}>Sign out</button>
        </div>
      </Splash>
    );
  }

  const user = profile;
  const allowed = (section) => Boolean(can[section]);
  const sections = SECTIONS.filter((s) => allowed(s.key));
  const current = sections.find((s) => s.key === active) || sections[0];
  const drift = can.isAdmin && !loadError ? computeMigrationDrift(store.migrationIds) : { inSync: true };
  const ctx = { store, refresh, user, can: allowed, isAdmin: can.isAdmin, loading };

  return (
    <AppCtx.Provider value={ctx}>
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <header className="border-b border-[var(--line)]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 pt-5">
            <div className="flex items-baseline gap-3 whitespace-nowrap">
              <span className="font-display text-xl font-semibold tracking-tight">Das Superfoods</span>
              <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Export console</span>
            </div>
            <div className="flex items-center gap-2">
              <span aria-live="polite" className="text-xs text-[var(--muted)]">{loading ? "syncing…" : toast}</span>
              <button onClick={() => setPaletteOpen(true)} className="flex items-center gap-6 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)]">
                Search <kbd className="text-xs">⌘K</kbd>
              </button>
              <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
                className="rounded-lg border border-[var(--line)] p-2 text-[var(--muted)] hover:text-[var(--text)]">
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button onClick={() => setPasswordOpen(true)} aria-label="Change your password" title="Change your password"
                className="rounded-lg border border-[var(--line)] p-2 text-[var(--muted)] hover:text-[var(--text)]">
                <KeyRound className="h-4 w-4" />
              </button>
              <span className="px-2 text-sm text-[var(--muted)]">
                {user.name.split(" ")[0]} · <span className="text-[var(--text)]">{user.role}</span>
              </span>
              <button onClick={signOut} className={btnGhost}>Sign out</button>
            </div>
          </div>
          <nav aria-label="Sections" className="mx-auto flex max-w-7xl gap-7 overflow-x-auto whitespace-nowrap px-6">
            {sections.map((s) => (
              <button key={s.key} onClick={() => setActive(s.key)}
                aria-current={current && current.key === s.key ? "page" : undefined}
                className={`border-b-2 py-4 text-sm transition-colors ${
                  current && current.key === s.key
                    ? "border-[var(--accent)] font-medium text-[var(--text)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                }`}>
                {s.label}
              </button>
            ))}
          </nav>
        </header>

        <main id="main" className="mx-auto max-w-7xl px-6 py-10">
          {!drift.inSync && (
            <div role="alert" className="mb-8 flex items-start gap-2 rounded-lg border border-[var(--status-warn)]/40 bg-[var(--status-warn)]/10 px-4 py-3 text-xs text-[var(--status-warn)]">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
              <span><span className="font-medium">Database and console are out of step.</span> {describeDrift(drift)}</span>
            </div>
          )}

          {loadError ? <ErrorPanel message={loadError} onRetry={refresh} /> : (
            <React.Fragment>
              {current && current.key === "overview" && <Overview onNavigate={setActive} />}
              {current && current.key === "parties" && <PartiesPage />}
              {current && current.key === "quotations" && <QuotationsPage />}
              {current && current.key === "proforma" && <ProformaPage />}
              {current && current.key === "shipments" && <ShipmentsPage />}
              {current && current.key === "analytics" && <AnalyticsPage />}
              {current && current.key === "company" && <CompanyPage />}
              {current && current.key === "users" && <UsersPage />}
            </React.Fragment>
          )}
        </main>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={setActive} sections={sections} />
        {passwordOpen && (
          <ChangePasswordDialog onClose={() => setPasswordOpen(false)}
            onChanged={() => { setPasswordOpen(false); setToast("Password changed"); setTimeout(() => setToast(""), 4000); }} />
        )}
      </div>
    </AppCtx.Provider>
  );
}

/* ------------------------------------------------------------- overview */
/* ------------------------------------------------------------- overview */
function Stat({ label: text, value, hint }) {
  return (
    <div className={card + " p-5"}>
      <p className="font-display text-3xl text-[var(--text)]">{value}</p>
      <p className="mt-1 text-sm text-[var(--text)]">{text}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

function Overview({ onNavigate }) {
  const { store, user, can } = useApp();
  const openPis = store.pis.filter((p) => !p.linkedFinalInvoiceId);

  return (
    <div>
      <PageHead
        title={`Good day, ${user.name.split(" ")[0]}`}
        blurb="Every shipment runs quotation → proforma → shipment, and each document inherits from the one before it. Master data is captured once and copied into a document at the moment it is created."
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* A figure appears only for a section this account holds — the
            overview never reveals a count from somewhere it cannot open. */}
        {can("parties") && <Stat label="Parties on file" value={store.parties.length} />}
        {can("quotations") && <Stat label="Quotations" value={store.quotations.length} />}
        {(can("proforma") || can("shipments")) && <Stat label="Open proforma" value={openPis.length} hint="awaiting a shipment" />}
        {can("shipments") && <Stat label="Shipments invoiced" value={store.finalInvoices.length} />}
      </div>

      {(can("proforma") || can("shipments")) && openPis.length > 0 && (
        <div className={card + " overflow-hidden"}>
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
            <p className="font-display text-lg">Awaiting shipment</p>
            {can("shipments") && (
              <button onClick={() => onNavigate("shipments")} className="flex items-center gap-1 text-sm text-[var(--accent)]">
                Go to shipments <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <table className="w-full">
            <thead className="bg-[var(--panel)]">
              <tr><th className={th}>Document</th><th className={th}>Buyer</th><th className={th}>Value</th></tr>
            </thead>
            <tbody>
              {openPis.map((pi) => (
                <tr key={pi.id} className="border-t border-[var(--line)]">
                  <td className={td + " font-num text-xs"}>{pi.docNo}</td>
                  <td className={td}>{pi.buyerName}</td>
                  <td className={td}>{fmtMoney(pi.grandTotal ?? pi.totalValue, pi.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {can("users") && store.audit.length > 0 && (
        <div className={card + " mt-6 p-5"}>
          <p className="mb-4 font-display text-lg">Recent activity</p>
          <ul className="space-y-2">
            {store.audit.slice(0, 6).map((a) => (
              <li key={a.id} className="flex gap-4 text-sm">
                <span className="w-44 shrink-0 text-xs text-[var(--muted)]">{fmtWhen(a.at)}</span>
                <span>{a.action}</span>
                <span className="text-xs text-[var(--muted)]">{a.user}{a.detail ? ` — ${a.detail}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


/* --------------------------------------------------------------- parties */
function ProductRows({ products, setProducts, mode }) {
  const update = (id, field, val) => setProducts(products.map((p) => (p.id === id ? { ...p, [field]: val } : p)));
  // Weights are typed in grams per box here (netWtG / grossWtG); the party form
  // turns them into the kilograms that are stored when it saves.
  const add = () => setProducts([...products, { id: tempId(), name: "", hsn: "", rate: 0, mrp: 0, netWtG: 0, grossWtG: 0, packsPerBox: 1, weightPerPackG: 0 }]);
  return (
    <div className={panel + " overflow-x-auto"}>
      <table className="w-full">
        <thead>
          <tr>
            <th className={th}>Product</th><th className={th}>HSN</th>
            <th className={th}>{mode === "international" ? "Rate / box" : "MRP / box"}</th>
            <th className={th}>Net wt / box (g)</th><th className={th}>Gross wt / box (g)</th>
            <th className={th}>Packs / box</th><th></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="border-t border-[var(--line)]">
              <td className="px-2 py-1.5"><input className={input} value={p.name} onChange={(e) => update(p.id, "name", e.target.value)} /></td>
              <td className="px-2 py-1.5"><input className={input} value={p.hsn} onChange={(e) => update(p.id, "hsn", e.target.value)} /></td>
              <td className="px-2 py-1.5">
                {mode === "international"
                  ? <input type="number" step="0.01" className={input} value={p.rate} onChange={(e) => update(p.id, "rate", e.target.value)} />
                  : <input type="number" step="0.01" className={input} value={p.mrp} onChange={(e) => update(p.id, "mrp", e.target.value)} />}
              </td>
              <td className="px-2 py-1.5"><input type="number" step="1" min="0" aria-label="Net weight per box in grams" className={input} value={p.netWtG} onChange={(e) => update(p.id, "netWtG", e.target.value)} /></td>
              <td className="px-2 py-1.5"><input type="number" step="1" min="0" aria-label="Gross weight per box in grams" className={input} value={p.grossWtG} onChange={(e) => update(p.id, "grossWtG", e.target.value)} /></td>
              <td className="px-2 py-1.5"><input type="number" aria-label="Packs per box" className={input} value={p.packsPerBox} onChange={(e) => update(p.id, "packsPerBox", e.target.value)} /></td>
              <td className="px-2">
                <button onClick={() => setProducts(products.filter((x) => x.id !== p.id))}><Trash2 className="h-4 w-4 text-[var(--muted)] hover:text-[var(--status-danger)]" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={add} className="flex w-full items-center justify-center gap-1 border-t border-[var(--line)] py-2.5 text-xs text-[var(--accent)]">
        <Plus className="h-3.5 w-3.5" /> Add product line
      </button>
    </div>
  );
}

function PartyForm({ tab, initial, onSave, onCancel }) {
  const isEdit = Boolean(initial);
  const [f, setF] = useState(() => initial || {
    type: tab, buyerName: "", buyerAddress: "", consigneeName: "", consigneeAddress: "",
    country: tab === "domestic" ? "India" : "", currency: tab === "domestic" ? "INR" : "USD",
    shipmentTerm: "", paymentTerm: "", conditions: "", portOfLoading: "", destinationPort: "",
    consigneeOptions: [], altBuyers: [],
  });
  const [products, setProducts] = useState(() => (initial ? initial.products : [])
    .map((p) => ({ ...p, netWtG: gramsFromKg(p.netWt), grossWtG: gramsFromKg(p.grossWt) })));
  // Conditions are edited as a list and saved as one text, a condition per
  // line. There is always at least one box to type into.
  const [conditions, setConditions] = useState(() => {
    const list = conditionsFromText(initial ? initial.conditions : "");
    return list.length ? list : [""];
  });
  const set = (k, v) => setF({ ...f, [k]: v });
  const altBuyers = f.altBuyers || [];
  const setAlt = (i, k, v) => set("altBuyers", altBuyers.map((b, j) => (j === i ? { ...b, [k]: v } : b)));

  return (
    <div className={card + " mb-6 p-6"}>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="font-display text-lg">{isEdit ? "Edit" : "New"} {tab === "international" ? "international" : "private-label"} party</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Editing later only affects future documents — anything already issued keeps the values it was created with. Changes land in the audit log.
          </p>
        </div>
        <button onClick={onCancel}><X className="h-4 w-4 text-[var(--muted)]" /></button>
      </div>
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Field label="Buyer name"><input className={input} value={f.buyerName} onChange={(e) => set("buyerName", e.target.value)} /></Field>
        <Field label="Buyer address" className="md:col-span-2"><input className={input} value={f.buyerAddress} onChange={(e) => set("buyerAddress", e.target.value)} /></Field>
        <Field label="Ship to"><input className={input} value={f.consigneeName} onChange={(e) => set("consigneeName", e.target.value)} /></Field>
        <Field label="Shipping address" className="md:col-span-2"><input className={input} value={f.consigneeAddress} onChange={(e) => set("consigneeAddress", e.target.value)} /></Field>
        <Field label="Country"><input className={input} value={f.country} onChange={(e) => set("country", e.target.value)} /></Field>
        <Field label="Currency">
          <select className={input} value={f.currency} onChange={(e) => set("currency", e.target.value)}>
            <option value="USD">USD</option><option value="INR">INR</option>
          </select>
        </Field>
        <Field label="Shipment term"><input className={input} placeholder="FOB / CIF / CNF" value={f.shipmentTerm} onChange={(e) => set("shipmentTerm", e.target.value)} /></Field>
        <Field label="Payment term" className="md:col-span-2"><input className={input} value={f.paymentTerm} onChange={(e) => set("paymentTerm", e.target.value)} /></Field>
      </div>
      <div className="mb-5">
        <p className="mb-1 text-sm font-medium">Conditions</p>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Printed on every proforma raised for this party, each on its own line.
        </p>
        {conditions.map((c, i) => (
          <div key={i} className="mb-2 grid items-end gap-3 md:grid-cols-[1fr_auto]">
            <Field label={`Condition ${i + 1}`}>
              <input className={input} value={c} onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? e.target.value : x)))} />
            </Field>
            {conditions.length > 1 && (
              <button type="button" className="mb-2.5" aria-label={`Remove condition ${i + 1}`} onClick={() => setConditions(conditions.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4 text-[var(--muted)] hover:text-[var(--status-danger)]" />
              </button>
            )}
          </div>
        ))}
        <button type="button" className={btnGhost + " flex items-center gap-1.5"} onClick={() => setConditions([...conditions, ""])}>
          <Plus className="h-4 w-4" /> Add another condition
        </button>
      </div>
      <div className="mb-5">
        <p className="mb-1 text-sm font-medium">Other buyer and ship-to names</p>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Every name on this party — the buyer, the ship-to name and any added here — can be picked as the buyer or as the consignee when a quotation or proforma is raised.
        </p>
        {altBuyers.map((b, i) => (
          <div key={i} className="mb-2 grid items-end gap-3 md:grid-cols-[1fr_2fr_auto]">
            <Field label={`Other name ${i + 1}`}><input className={input} value={b.name} onChange={(e) => setAlt(i, "name", e.target.value)} /></Field>
            <Field label={`Address ${i + 1}`}><input className={input} value={b.address} onChange={(e) => setAlt(i, "address", e.target.value)} /></Field>
            <button type="button" className="mb-2.5" aria-label={`Remove other name ${i + 1}`} onClick={() => set("altBuyers", altBuyers.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4 text-[var(--muted)] hover:text-[var(--status-danger)]" />
            </button>
          </div>
        ))}
        <button type="button" className={btnGhost + " flex items-center gap-1.5"} onClick={() => set("altBuyers", [...altBuyers, { name: "", address: "" }])}>
          <Plus className="h-4 w-4" /> Add another name
        </button>
      </div>
      <p className="mb-2 text-sm font-medium">Products</p>
      <ProductRows products={products} setProducts={setProducts} mode={tab} />
      <div className="mt-5 flex justify-end gap-3">
        <button onClick={onCancel} className={btnGhost}>Cancel</button>
        <button
          onClick={() => {
            const consigneeOptions = Array.from(new Set([...(f.consigneeOptions || []), f.consigneeName].filter(Boolean)));
            // Typed in grams per box, stored in kilograms per box.
            const lines = products.map(({ netWtG, grossWtG, ...p }) => ({ ...p, netWt: kgFromGrams(netWtG), grossWt: kgFromGrams(grossWtG) }));
            const party = { ...f, conditions: conditionsToText(conditions), products: lines, consigneeOptions };
            onSave(isEdit ? party : { id: tempId(), ...party });
          }}
          className={btn}
        >
          {isEdit ? "Save changes" : "Create party"}
        </button>
      </div>
    </div>
  );
}


function PartiesPage() {
  const { store, refresh } = useApp();
  const [tab, setTab] = useState("international");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [saveError, setSaveError] = useState("");

  const filtered = store.parties.filter((p) => p.type === tab);
  const editing = store.parties.find((p) => p.id === editingId);

  // One call: the party and its product lines are saved in a single transaction.
  const saveParty = async (p) => {
    const products = (p.products || [])
      .filter((x) => String(x.name || "").trim() !== "")
      .map((x) => pick(x, PARTY_PRODUCT_KEYS));
    const message = await attempt(async () => {
      await call("save_party", { p: { ...pick(p, PARTY_KEYS), products } });
      await refresh();
    });
    setSaveError(message);
    return message === "";
  };

  const deleteParty = async (p) => {
    const message = await attempt(async () => {
      await call("delete_party", { p_id: p.id });
      await refresh();
    });
    setSaveError(message);
    if (!message) setConfirmId(null);
  };

  // The price list, one row per product — the shape that is useful in Excel.
  const priceList = store.parties.flatMap((p) => (p.products.length ? p.products : [null]).map((prod) => ({ p, prod })));
  const excelColumns = [
    { label: "Buyer", value: (r) => r.p.buyerName, width: 32 },
    { label: "Other names", value: (r) => (r.p.altBuyers || []).map((b) => (b.address ? `${b.name} — ${b.address}` : b.name)).join("; "), width: 40 },
    { label: "Type", value: (r) => r.p.type },
    { label: "Country", value: (r) => r.p.country },
    { label: "Currency", value: (r) => r.p.currency, width: 10 },
    { label: "Shipment term", value: (r) => r.p.shipmentTerm },
    { label: "Payment term", value: (r) => r.p.paymentTerm, width: 30 },
    { label: "Product", value: (r) => (r.prod ? r.prod.name : ""), width: 30 },
    { label: "HSN", value: (r) => (r.prod ? r.prod.hsn : "") },
    { label: "Rate / box", value: (r) => (r.prod ? r.prod.rate : "") },
    { label: "MRP / box", value: (r) => (r.prod ? r.prod.mrp : "") },
    { label: "Units / box", value: (r) => (r.prod ? r.prod.packsPerBox : "") },
    { label: "Net kg / box", value: (r) => (r.prod ? r.prod.netWt : "") },
    { label: "Gross kg / box", value: (r) => (r.prod ? r.prod.grossWt : "") },
  ];

  return (
    <div>
      <PageHead title="Parties" blurb="Buyer, ship-to, terms and per-product pricing. Everything downstream reads from here." />

      <div className="mb-5 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-[var(--line)] p-1">
          {[["international", "International"], ["domestic", "Private label / India"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? "bg-[var(--field)] text-[var(--text)]" : "text-[var(--muted)]"}`}>{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <ExcelButton name="party-price-list" columns={excelColumns} rows={priceList} />
          <button onClick={() => { setEditingId(null); setShowForm(true); }} className={btn + " flex items-center gap-1.5"}>
            <Plus className="h-4 w-4" /> Add party
          </button>
        </div>
      </div>

      <div aria-live="polite">{saveError && <p className={errText + " mb-4"}>{saveError}</p>}</div>

      {showForm && <PartyForm tab={tab} onCancel={() => setShowForm(false)} onSave={async (p) => {
        if (await saveParty(p)) setShowForm(false);
      }} />}

      {editing && <PartyForm tab={editing.type} initial={editing} onCancel={() => setEditingId(null)} onSave={async (u) => {
        if (await saveParty(u)) setEditingId(null);
      }} />}

      <div className={card + " overflow-hidden"}>
        <table className="w-full">
          <thead className="bg-[var(--panel)]">
            <tr>
              <th className={th}>Buyer</th><th className={th}>Country</th><th className={th}>Currency</th>
              <th className={th}>Products</th><th className={th}>Payment term</th><th className={th + " text-right"}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-t border-[var(--line)]">
                <td className={td + " font-medium"}>
                  {p.buyerName}
                  {(p.altBuyers || []).length > 0 && (
                    <span className="block text-xs font-normal text-[var(--muted)]">Other names: {p.altBuyers.map((b) => b.name).join(" · ")}</span>
                  )}
                </td>
                <td className={td + " text-[var(--muted)]"}>{p.country}</td>
                <td className={td}>{p.currency}</td>
                <td className={td + " font-num tabular-nums"}>{p.products.length}</td>
                <td className={td + " text-[var(--muted)]"}>{p.paymentTerm}</td>
                <td className={td + " text-right"}>
                  {confirmId === p.id ? (
                    <span className="flex items-center justify-end gap-3">
                      <span className="text-xs text-[var(--status-danger)]">Retire {p.buyerName}?</span>
                      <button onClick={() => deleteParty(p)} className="text-xs text-[var(--status-danger)]">Confirm</button>
                      <button onClick={() => setConfirmId(null)} className="text-xs text-[var(--muted)]">Cancel</button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-4">
                      <button onClick={() => { setShowForm(false); setEditingId(p.id); }} className="text-xs text-[var(--accent)]">Edit</button>
                      <button onClick={() => setConfirmId(p.id)} className="text-xs text-[var(--muted)] hover:text-[var(--status-danger)]">Delete</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                No parties in this category yet — use “Add party” to create the first one.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[var(--faint)]">
        Deleting retires a party from the lists; the record and its history stay in the database, and documents already issued are unaffected.
      </p>
    </div>
  );
}

/* -------------------------------------------------------- quotations */
/* A printable document is rendered into a portal on <body>; the print rules in
   tokens.css hide the console around it, and the browser's "Save as PDF"
   destination produces the file.                                          */
function PrintDocument({ children }) {
  return createPortal(<div id="print-portal">{children}</div>, document.body);
}

function QuotationDocument({ q, company }) {
  const isDomestic = (q.country || "").trim().toLowerCase() === "india";
  return (
    <div className="doc">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: 18, fontWeight: "bold", margin: 0 }}>{company.name || "Das Superfoods"}</p>
          <p className="muted" style={{ margin: "2px 0 0", maxWidth: 320 }}>{company.address}</p>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            {company.gstNo ? `GST ${company.gstNo}` : ""}{company.gstNo && company.iecCode ? " · " : ""}
            {company.iecCode ? `IEC ${company.iecCode}` : ""}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <h1>Quotation</h1>
          <p style={{ margin: "6px 0 0" }}><b>{q.docNo}</b></p>
          <p className="muted" style={{ margin: 0 }}>Date: {fmtDate(q.date)}</p>
        </div>
      </div>
      <div className="rule" />

      <div style={{ display: "flex", gap: 32 }}>
        <div style={{ flex: 1 }}>
          <p className="muted" style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Quotation to</p>
          <p style={{ margin: "3px 0 0", fontWeight: "bold" }}>{q.buyerName}</p>
          <p className="muted" style={{ margin: 0 }}>{q.buyerAddress}</p>
          <p className="muted" style={{ margin: 0 }}>{q.country}</p>
        </div>
        <div style={{ flex: 1 }}>
          <p className="muted" style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Terms</p>
          <p style={{ margin: "3px 0 0" }}>Shipment: {q.shipmentTerm || "—"}</p>
          <p style={{ margin: 0 }}>Payment: {q.paymentTerm || "—"}</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th>Product</th>
            <th style={{ width: 90 }}>HSN</th>
            <th className="num" style={{ width: 70 }}>Boxes</th>
            <th className="num" style={{ width: 90 }}>Rate / box</th>
            <th className="num" style={{ width: 100 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(q.items || []).map((it, i) => (
            <tr key={it.id || i}>
              <td>{i + 1}</td>
              <td>{it.product}</td>
              <td>{it.hsn}</td>
              <td className="num">{it.boxQty}</td>
              <td className="num">{fmtNum(it.boxRate)}</td>
              <td className="num">{fmtNum(Number(it.boxQty) * Number(it.boxRate))}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={5} className="num"><b>Total</b></td>
            <td className="num"><b>{fmtNum(q.totalValue)}</b></td>
          </tr>
          {isDomestic && Number(q.igstAmt) > 0 && (
            <tr>
              <td colSpan={5} className="num">IGST @ {fmtNum(q.igstRate, 2)}%</td>
              <td className="num">{fmtNum(q.igstAmt)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={5} className="num"><b>Grand total</b></td>
            <td className="num"><b>{fmtNum(q.grandTotal)}</b></td>
          </tr>
        </tbody>
      </table>

      <p style={{ marginTop: 8, fontStyle: "italic" }}>Amount in words: {amountInWords(q.grandTotal)}</p>

      <p className="muted" style={{ marginTop: 18, fontSize: 11 }}>
        This quotation is valid for 30 days from the date above. Prices are quoted on {q.shipmentTerm || "the agreed"} terms and
        are subject to confirmation of availability at the time of order.
        {!isDomestic && " IGST is not applicable on export supplies."}
      </p>

      <div style={{ marginTop: 48, textAlign: "right" }}>
        <p style={{ margin: 0 }}>For <b>{company.name || "Das Superfoods"}</b></p>
        <p className="muted" style={{ margin: "44px 0 0" }}>Authorised signatory</p>
      </div>
    </div>
  );
}

function QuotationForm({ initial, onCancel, onSubmit }) {
  const { store } = useApp();
  const isEdit = Boolean(initial);
  const [partyId, setPartyId] = useState(initial ? initial.partyId || "" : "");
  const [buyerName, setBuyerName] = useState(initial ? initial.buyerName : "");
  const [buyerAddress, setBuyerAddress] = useState(initial ? initial.buyerAddress || "" : "");
  const [country, setCountry] = useState(initial ? initial.country : "");
  const [shipmentTerm, setShipmentTerm] = useState(initial ? initial.shipmentTerm || "FOB" : "FOB");
  const [paymentTerm, setPaymentTerm] = useState(initial ? initial.paymentTerm || "" : "");
  const [igst, setIgst] = useState(initial ? Boolean(initial.igst) : false);
  const [igstRate, setIgstRate] = useState(initial ? initial.igstRate : 0);
  const [items, setItems] = useState(initial && initial.items && initial.items.length
    ? initial.items.map((i) => ({ ...i, id: i.id || tempId() }))
    : [{ id: tempId(), product: "", hsn: "", boxQty: 0, boxRate: 0 }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const totals = quotationTotals({ items, country, igst, igstRate });
  const isDomestic = totals.domestic;
  const total = totals.total, igstAmt = totals.tax, grand = totals.grand;
  const updateItem = (id, k, v) => setItems(items.map((i) => (i.id === id ? { ...i, [k]: v } : i)));
  // Every name on the chosen party — buyer, other names, consignee. The picker
  // only shows when there is more than one.
  const choices = partyNames(store.parties.find((x) => x.id === partyId));
  const exact = choices.findIndex((c) => c.name === buyerName.trim() && c.address === buyerAddress.trim());
  const chosen = exact >= 0 ? exact : choices.findIndex((c) => c.name === buyerName.trim());

  const submit = async () => {
    if (!buyerName.trim()) return setError("Buyer name is required.");
    setBusy(true); setError("");
    const payload = {
      partyId, buyerName, buyerAddress, country, shipmentTerm, paymentTerm,
      items, igst, igstRate, totalValue: total, igstAmt, grandTotal: grand,
    };
    const message = await onSubmit(payload);
    if (message) setError(message);
    setBusy(false);
  };

  return (
    <div className={card + " mb-6 p-6"}>
      <p className="mb-5 font-display text-lg">{isEdit ? `Edit ${initial.docNo}` : "New quotation"}</p>
      <div className="mb-5 grid gap-4 md:grid-cols-4">
        <Field label="Party (optional autofill)">
          <select className={input} value={partyId} onChange={(e) => {
            setPartyId(e.target.value);
            const p = store.parties.find((x) => x.id === e.target.value);
            if (p) { setBuyerName(p.buyerName); setBuyerAddress(p.buyerAddress); setCountry(p.country); setPaymentTerm(p.paymentTerm); setShipmentTerm(p.shipmentTerm || "FOB"); }
          }}>
            <option value="">Manual entry</option>
            {store.parties.map((p) => <option key={p.id} value={p.id}>{p.buyerName}</option>)}
          </select>
        </Field>
        {choices.length > 1 && (
          <Field label="Buyer on this quotation" hint="Any name on this party can be the buyer">
            <select className={input} value={chosen} onChange={(e) => {
              const c = choices[Number(e.target.value)];
              if (c) { setBuyerName(c.name); setBuyerAddress(c.address); setError(""); }
            }}>
              {chosen < 0 && <option value={-1}>Typed by hand</option>}
              {choices.map((c, i) => <option key={i} value={i}>{c.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Buyer name"><input className={input} value={buyerName} onChange={(e) => { setBuyerName(e.target.value); setError(""); }} /></Field>
        <Field label="Country"><input className={input} value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
        <Field label="Shipment term">
          <select className={input} value={shipmentTerm} onChange={(e) => setShipmentTerm(e.target.value)}>
            <option>FOB</option><option>CIF</option><option>CNF</option><option>Ex-Factory</option>
          </select>
        </Field>
        <Field label="Buyer address" className="md:col-span-2"><input className={input} value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} /></Field>
        <Field label="Payment term" className="md:col-span-2"><input className={input} value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)} /></Field>
        {isDomestic && (
          <React.Fragment>
            <Field label="IGST applicable" hint="Never applies to international buyers">
              <select className={input} value={igst ? "yes" : "no"} onChange={(e) => setIgst(e.target.value === "yes")}>
                <option value="no">No</option><option value="yes">Yes</option>
              </select>
            </Field>
            {igst && <Field label="IGST rate (%)"><input type="number" className={input} value={igstRate} onChange={(e) => setIgstRate(e.target.value)} /></Field>}
          </React.Fragment>
        )}
      </div>

      <div className={panel + " mb-4 overflow-hidden"}>
        <table className="w-full">
          <thead><tr><th className={th}>Product</th><th className={th}>HSN</th><th className={th}>Box qty</th><th className={th}>Box rate</th><th className={th}>Value</th><th></th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-[var(--line)]">
                <td className="px-2 py-1.5"><input className={input} value={it.product} onChange={(e) => updateItem(it.id, "product", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input className={input} value={it.hsn} onChange={(e) => updateItem(it.id, "hsn", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input type="number" className={input} value={it.boxQty} onChange={(e) => updateItem(it.id, "boxQty", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input type="number" step="0.01" className={input} value={it.boxRate} onChange={(e) => updateItem(it.id, "boxRate", e.target.value)} /></td>
                <td className={td + " text-[var(--muted)]"}>{fmtNum(Number(it.boxQty) * Number(it.boxRate))}</td>
                <td className="px-2">
                  {items.length > 1 && (
                    <button onClick={() => setItems(items.filter((x) => x.id !== it.id))}>
                      <Trash2 className="h-4 w-4 text-[var(--muted)] hover:text-[var(--status-danger)]" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setItems([...items, { id: tempId(), product: "", hsn: "", boxQty: 0, boxRate: 0 }])}
          className="flex w-full items-center justify-center gap-1 border-t border-[var(--line)] py-2.5 text-xs text-[var(--accent)]">
          <Plus className="h-3.5 w-3.5" /> Add product line
        </button>
      </div>

      <div className="flex items-end justify-between">
        <div className="text-sm text-[var(--muted)]">
          <p>Total <span className="text-[var(--text)]">{fmtNum(total)}</span>
            {igstAmt > 0 && <span> · IGST <span className="text-[var(--text)]">{fmtNum(igstAmt)}</span></span>}
            {" "}· Grand total <span className="text-[var(--text)]">{fmtNum(grand)}</span></p>
          <p className="mt-1 text-xs italic">{amountInWords(grand)}</p>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className={errText}>{error}</span>}
          <button onClick={onCancel} className={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={busy} className={btn}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create quotation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuotationsPage() {
  const { store, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [pageError, setPageError] = useState("");

  const editing = store.quotations.find((q) => q.id === editingId);

  useEffect(() => {
    if (!printing) return undefined;
    const t = setTimeout(() => { window.print(); setPrinting(null); }, 60);
    return () => clearTimeout(t);
  }, [printing]);

  // Rows left completely blank in the form are not lines; anything else is sent
  // and the server refuses a line it cannot accept.
  const cleanItems = (items) => (items || []).filter((i) =>
    String(i.product || "").trim() !== "" || toNumber(i.boxQty) !== 0 || toNumber(i.boxRate) !== 0);

  const save = (extra, done) => async (payload) => {
    const message = await attempt(async () => {
      await call("save_quotation", { p: pick({ ...payload, ...extra, items: cleanItems(payload.items) }, QUOTATION_KEYS) });
      await refresh();
    });
    if (!message) done();
    return message;
  };

  const remove = async (q) => {
    const message = await attempt(async () => {
      await call("delete_quotation", { p_id: q.id });
      await refresh();
    });
    setPageError(message);
    if (!message) setConfirmId(null);
  };

  const boxesOf = (q) => (q.items || []).reduce((s, i) => s + toNumber(i.boxQty), 0);
  const excelColumns = [
    { label: "Document", value: (q) => q.docNo, width: 22 },
    { label: "Date", value: (q) => fmtDate(q.date), width: 12 },
    { label: "Buyer", value: (q) => q.buyerName, width: 32 },
    { label: "Country", value: (q) => q.country },
    { label: "Shipment term", value: (q) => q.shipmentTerm },
    { label: "Payment term", value: (q) => q.paymentTerm, width: 30 },
    { label: "Boxes", value: boxesOf, width: 10 },
    { label: "Total", value: (q) => q.totalValue },
    { label: "IGST", value: (q) => q.igstAmt },
    { label: "Grand total", value: (q) => q.grandTotal },
  ];

  return (
    <div>
      <PageHead title="Quotations" blurb="For first-time inquiries, before a buyer is set up as a repeat party. Box rate only — no per-jar rate, and IGST applies to Indian buyers only." />

      <div className="mb-5 flex items-center justify-end gap-3">
        <ExcelButton name="quotations" columns={excelColumns} rows={store.quotations} />
        <button onClick={() => { setEditingId(null); setOpen(!open); }} className={btn + " flex items-center gap-1.5"}>
          <Plus className="h-4 w-4" /> New quotation
        </button>
      </div>

      <div aria-live="polite">{pageError && <p className={errText + " mb-4"}>{pageError}</p>}</div>

      {open && !editing && <QuotationForm onCancel={() => setOpen(false)} onSubmit={save({}, () => setOpen(false))} />}
      {editing && (
        <QuotationForm key={editing.id} initial={editing} onCancel={() => setEditingId(null)}
          onSubmit={save({ id: editing.id, expectedUpdatedAt: editing.updatedAt }, () => setEditingId(null))} />
      )}

      <div className={card + " overflow-hidden"}>
        <table className="w-full">
          <thead className="bg-[var(--panel)]">
            <tr>
              <th className={th}>Document</th><th className={th}>Date</th><th className={th}>Buyer</th>
              <th className={th}>Country</th><th className={th}>Term</th>
              <th className={th + " text-right"}>Boxes</th><th className={th + " text-right"}>Value</th>
              <th className={th + " text-right"}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {store.quotations.map((q) => (
              <tr key={q.id} className="border-t border-[var(--line)]">
                <td className={td + " font-num text-xs"}>{q.docNo}</td>
                <td className={td + " text-[var(--muted)]"}>{fmtDate(q.date)}</td>
                <td className={td + " font-medium"}>{q.buyerName}</td>
                <td className={td}>{q.country}</td>
                <td className={td + " text-[var(--muted)]"}>{q.shipmentTerm}</td>
                <td className={tdNum}>{boxesOf(q)}</td>
                <td className={tdNum}>{fmtNum(q.grandTotal)}</td>
                <td className={td + " text-right"}>
                  {confirmId === q.id ? (
                    <span className="flex items-center justify-end gap-3">
                      <span className="text-xs text-[var(--status-danger)]">Retire {q.docNo}?</span>
                      <button onClick={() => remove(q)} className="text-xs text-[var(--status-danger)]">Confirm</button>
                      <button onClick={() => setConfirmId(null)} className="text-xs text-[var(--muted)]">Cancel</button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-4">
                      <button onClick={() => setPrinting(q)} className="flex items-center gap-1 text-xs text-[var(--accent)]">
                        <Download className="h-3 w-3" /> PDF
                      </button>
                      <button onClick={() => { setOpen(false); setEditingId(q.id); }} className="text-xs text-[var(--accent)]">Edit</button>
                      <button onClick={() => setConfirmId(q.id)} className="text-xs text-[var(--muted)] hover:text-[var(--status-danger)]">Delete</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {store.quotations.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                No quotations yet — “New quotation” starts the first one.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {printing && (
        <PrintDocument>
          <QuotationDocument q={printing} company={store.company} />
        </PrintDocument>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- drafts */
/* A draft is a form saved part-way (db/012): no number, nothing issued.
   Anyone who holds the section can continue or discard one.               */
function DraftList({ drafts, onResume, onDiscard }) {
  const [confirmId, setConfirmId] = useState(null);
  if (!drafts.length) return null;
  return (
    <div className={card + " mb-6 p-5"}>
      <p className="mb-1 text-sm font-medium">Saved drafts</p>
      <p className="mb-4 text-xs text-[var(--muted)]">
        Not issued yet — a number is only taken when the document is created. Anyone with access to this section can continue a draft.
      </p>
      <div className="space-y-2">
        {drafts.map((d) => (
          <div key={d.id} className={panel + " flex items-center justify-between gap-4 px-4 py-3"}>
            <div>
              <p className="text-sm font-medium">{d.title} <span className="ml-2"><Chip tone="warn">Draft</Chip></span></p>
              <p className="text-xs text-[var(--muted)]">Saved by {d.savedBy || "—"} · {fmtWhen(d.updatedAt)}</p>
            </div>
            {confirmId === d.id ? (
              <span className="flex items-center gap-3">
                <span className="text-xs text-[var(--status-danger)]">Discard this draft?</span>
                <button onClick={() => { setConfirmId(null); onDiscard(d); }} className="text-xs text-[var(--status-danger)]">Confirm</button>
                <button onClick={() => setConfirmId(null)} className="text-xs text-[var(--muted)]">Keep</button>
              </span>
            ) : (
              <span className="flex items-center gap-4">
                <button onClick={() => onResume(d)} className="flex items-center gap-1 text-sm text-[var(--accent)]">
                  Continue draft <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setConfirmId(d.id)} className="text-xs text-[var(--muted)] hover:text-[var(--status-danger)]">Discard</button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ proforma */
function ProformaForm({ type, draft, editing, onSave, onSaveDraft, onCancel }) {
  const { store } = useApp();
  const eligible = store.parties.filter((p) => p.type === type);
  // The form starts from one of three things: nothing, a saved draft, or — when
  // editing — the proforma itself, read back into the shape a draft has.
  // Continuing a draft whose party is no longer on file drops its product
  // lines: they cannot be trusted against a different party.
  const saved = editing ? {
    docNo: editing.docNo, partyId: editing.partyId, quotationRef: editing.quotationRef,
    orderNo: editing.buyerOrderNo, orderDate: editing.buyerOrderDate, items: editing.items,
    portOfLoading: editing.portOfLoading || "", destinationPort: editing.destinationPort || "",
    extra: editing.additionalDetails, taxRate: editing.taxRate,
    buyer: { name: editing.buyerName, address: editing.buyerAddress },
    consignee: editing.consigneeName ? { name: editing.consigneeName, address: editing.consigneeAddress } : null,
  } : (draft && draft.payload) || {};
  const savedParty = eligible.find((p) => p.id === saved.partyId);
  const partyGone = Boolean(draft) && Boolean(saved.partyId) && !savedParty;
  // Every name offered for buyer and consignee. When editing, the names already
  // on the proforma stay on offer even if the party has since been changed —
  // an edit must never swap the buyer or the consignee unasked.
  const tidy = (v) => String(v || "").trim();
  const namesFor = (p) => {
    const base = partyNames(p);
    if (!editing || !p || p.id !== editing.partyId) return base;
    const kept = [];
    for (const who of [saved.buyer, saved.consignee]) {
      if (!who || !tidy(who.name)) continue;
      const same = (c) => c.name === tidy(who.name) && c.address === tidy(who.address);
      if (!base.some(same) && !kept.some(same)) {
        kept.push({ name: tidy(who.name), address: tidy(who.address), role: "on this proforma", isConsignee: false, label: `${tidy(who.name)} (on this proforma)` });
      }
    }
    return [...base, ...kept];
  };
  // The names are found again by name and address, not by position: the party
  // may have been edited since the draft was saved or the proforma raised.
  const savedAt = (who) => (savedParty && who
    ? namesFor(savedParty).findIndex((c) => c.name === tidy(who.name) && c.address === tidy(who.address)) : -1);
  const [partyId, setPartyId] = useState(savedParty ? savedParty.id : eligible.length ? eligible[0].id : "");
  const party = store.parties.find((p) => p.id === partyId);
  // Typed by hand (db/013) — the database refuses a blank or repeated number.
  const [docNo, setDocNo] = useState(saved.docNo || "");
  // Ports belong to the proforma, not the party (decisions/014), so they are
  // typed here. A party saved before that change may still hold a pair: it is
  // offered as the starting value, in plain sight — never used unseen.
  const portsOf = (p) => ({ loading: (p && p.portOfLoading) || "", destination: (p && p.destinationPort) || "" });
  const [portOfLoading, setPortOfLoading] = useState(saved.portOfLoading ?? portsOf(party).loading);
  const [destinationPort, setDestinationPort] = useState(saved.destinationPort ?? portsOf(party).destination);
  const [quotationRef, setQuotationRef] = useState(saved.quotationRef || "");
  const [orderNo, setOrderNo] = useState(saved.orderNo || "");
  const [orderDate, setOrderDate] = useState(saved.orderDate || todayIST());
  const [items, setItems] = useState(savedParty && Array.isArray(saved.items) ? saved.items : []);
  const [extra, setExtra] = useState(saved.extra || "");
  const [taxRate, setTaxRate] = useState(saved.taxRate ?? 5);
  // Which of the party's names is the buyer on this proforma (0 is the main
  // one) and which is the consignee (null = the party's own consignee).
  const [buyerIdx, setBuyerIdx] = useState(Math.max(0, savedAt(saved.buyer)));
  // A proforma raised with no consignee stays that way when edited (-1), rather
  // than quietly picking up the party's.
  const [consigneeIdx, setConsigneeIdx] = useState(
    savedAt(saved.consignee) >= 0 ? savedAt(saved.consignee) : editing && !saved.consignee ? -1 : null);
  const isIntl = type === "international";
  const choices = namesFor(party);
  const nobody = { name: "", address: "" };
  const buyer = choices[buyerIdx] || choices[0] || nobody;
  const ownConsignee = choices.findIndex((c) => c.isConsignee);
  const consigneeAt = consigneeIdx === null ? ownConsignee : consigneeIdx;
  const consignee = choices[consigneeAt] || nobody;
  const consigneeLabel = isIntl ? "Consignee" : "Ship to";

  // Ports, terms and currency are read from the party when the form is saved.
  // Without the party the proforma was raised for there is nothing safe to read.
  if (editing && !savedParty) {
    return (
      <div className={card + " mb-6 p-6"}>
        <p className="text-sm text-[var(--muted)]">
          The party {editing.docNo} was raised for is no longer on file, so it cannot be edited here. It is unchanged.
        </p>
        <button onClick={onCancel} className={btnGhost + " mt-4"}>Close</button>
      </div>
    );
  }

  if (!party) {
    return (
      <div className={card + " mb-6 p-6"}>
        <p className="text-sm text-[var(--muted)]">No {isIntl ? "international" : "private-label"} party exists yet — create one under Parties first.</p>
        <button onClick={onCancel} className={btnGhost + " mt-4"}>Close</button>
      </div>
    );
  }

  const addLine = (productId) => {
    const p = party.products.find((x) => x.id === productId);
    if (!p) return;
    // Weights ride along so the packing list can be produced from the shipment alone.
    setItems([...items, {
      id: tempId(), productId, name: p.name, hsn: p.hsn, boxQty: 0,
      rate: Number(p.rate) || 0, mrp: Number(p.mrp) || 0,
      netWt: Number(p.netWt) || 0, grossWt: Number(p.grossWt) || 0,
      packsPerBox: Number(p.packsPerBox) || 0, weightPerPackG: Number(p.weightPerPackG) || 0,
    }]);
  };

  const totals = proformaTotals({ items, type, taxRate });
  const totalBoxes = totals.boxes, totalUnits = totals.units, totalValue = totals.total;
  const taxableValue = totals.taxable, taxAmount = totals.tax, grandTotal = totals.grand;

  return (
    <div className={card + " mb-6 p-6"}>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="font-display text-lg">
            {editing ? "Edit" : draft ? "Draft" : "New"} {isIntl ? "international" : "private-label / merchant-export"} proforma
          </p>
          {editing && <p className="mt-1 text-xs text-[var(--muted)]">Editing {editing.docNo}, raised {fmtDate(editing.date)}. The date it was raised does not change, and the change is recorded in the audit log.</p>}
          {draft && <p className="mt-1 text-xs text-[var(--muted)]">Continuing the draft saved by {draft.savedBy || "—"} · {fmtWhen(draft.updatedAt)}</p>}
          {partyGone && <p className="mt-1 text-xs text-[var(--status-warn)]">The party this draft was for is no longer on file, so its product lines were cleared. Pick a party to continue.</p>}
        </div>
        <button onClick={onCancel}><X className="h-4 w-4 text-[var(--muted)]" /></button>
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-4">
        <Field label="Proforma no." hint="Typed by hand — it must not repeat">
          <input className={input} value={docNo} maxLength={40} placeholder="e.g. DS-PI-INTL-2026-0002"
            onChange={(e) => setDocNo(e.target.value)} />
        </Field>
        <Field label="Party">
          <select className={input} value={partyId} onChange={(e) => {
            const next = store.parties.find((p) => p.id === e.target.value);
            setPartyId(e.target.value); setItems([]); setBuyerIdx(0); setConsigneeIdx(null);
            setPortOfLoading(portsOf(next).loading); setDestinationPort(portsOf(next).destination);
          }}>
            {eligible.map((p) => <option key={p.id} value={p.id}>{p.buyerName}</option>)}
          </select>
        </Field>
        {choices.length > 1 && (
          <React.Fragment>
            <Field label="Buyer on this proforma" hint="Any name on this party can be the buyer">
              <select className={input} value={buyerIdx} onChange={(e) => setBuyerIdx(Number(e.target.value))}>
                {choices.map((c, i) => <option key={i} value={i}>{c.label}</option>)}
              </select>
            </Field>
            <Field label={isIntl ? "Consignee on this proforma" : "Ship to on this proforma"} hint="Any name on this party can be the consignee">
              <select className={input} value={consigneeAt} onChange={(e) => setConsigneeIdx(Number(e.target.value))}>
                {(ownConsignee < 0 || consigneeAt < 0) && <option value={-1}>Not set</option>}
                {choices.map((c, i) => <option key={i} value={i}>{c.label}</option>)}
              </select>
            </Field>
          </React.Fragment>
        )}
        <Field label="Order no."><input className={input} value={orderNo} onChange={(e) => setOrderNo(e.target.value)} /></Field>
        <Field label="Order date"><input type="date" className={input} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></Field>
        <Field label="Linked quotation">
          <select className={input} value={quotationRef} onChange={(e) => setQuotationRef(e.target.value)}>
            <option value="">None</option>
            {store.quotations.map((q) => <option key={q.id} value={q.docNo}>{q.docNo} — {q.buyerName}</option>)}
          </select>
        </Field>
        {!isIntl && <Field label="Tax rate (%)"><input type="number" className={input} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></Field>}
        {isIntl && (
          <React.Fragment>
            <Field label="Port of loading"><input className={input} value={portOfLoading} onChange={(e) => setPortOfLoading(e.target.value)} /></Field>
            <Field label="Destination port"><input className={input} value={destinationPort} onChange={(e) => setDestinationPort(e.target.value)} /></Field>
          </React.Fragment>
        )}
      </div>

      <div className={panel + " mb-5 grid gap-4 p-4 text-xs md:grid-cols-3"}>
        <div>
          <p className="mb-1 uppercase tracking-wider text-[var(--faint)]">Buyer</p>
          <p>{buyer.name}</p><p className="text-[var(--muted)]">{buyer.address}</p>
        </div>
        <div>
          <p className="mb-1 uppercase tracking-wider text-[var(--faint)]">{consigneeLabel}</p>
          <p>{consignee.name || "—"}</p><p className="text-[var(--muted)]">{consignee.address}</p>
        </div>
        <div>
          <p className="mb-1 uppercase tracking-wider text-[var(--faint)]">Terms</p>
          <p>{party.shipmentTerm || "—"} · {party.currency}</p><p className="text-[var(--muted)]">{party.paymentTerm}</p>
        </div>
        {conditionsFromText(party.conditions).length > 0 && (
          <div className="md:col-span-3">
            <p className="mb-1 uppercase tracking-wider text-[var(--faint)]">Conditions</p>
            {conditionsFromText(party.conditions).map((c, i) => <p key={i} className="text-[var(--muted)]">{i + 1}. {c}</p>)}
          </div>
        )}
      </div>

      <div className={panel + " mb-4 overflow-hidden"}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Product</th><th className={th}>HSN</th>
              <th className={th}>{isIntl ? "Rate / box" : "MRP / box"}</th>
              <th className={th}>Box qty</th><th className={th}>{isIntl ? "Amount" : "Taxable value"}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-[var(--line)]">
                <td className={td}>{it.name}</td>
                <td className={td + " font-num text-xs text-[var(--muted)]"}>{it.hsn}</td>
                <td className={td}>{fmtNum(isIntl ? it.rate : it.mrp)}</td>
                <td className="px-2 py-1.5 w-32"><input type="number" className={input} value={it.boxQty}
                  onChange={(e) => setItems(items.map((x) => (x.id === it.id ? { ...x, boxQty: e.target.value } : x)))} /></td>
                <td className={td + " text-[var(--muted)]"}>{fmtNum(Number(it.boxQty) * Number(isIntl ? it.rate : it.mrp))}</td>
                <td className="px-2"><button onClick={() => setItems(items.filter((x) => x.id !== it.id))}><Trash2 className="h-4 w-4 text-[var(--muted)] hover:text-[var(--status-danger)]" /></button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-[var(--muted)]">No product lines yet.</td></tr>}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t border-[var(--line)] bg-[var(--field)]">
                <td className={td + " text-xs uppercase tracking-wider text-[var(--muted)]"} colSpan={3}>Subtotal</td>
                <td className={td}>{totalBoxes} boxes · {totalUnits} units</td>
                <td className={td}>{fmtNum(isIntl ? totalValue : taxableValue)}</td><td></td>
              </tr>
            </tfoot>
          )}
        </table>
        <select className="w-full border-t border-[var(--line)] bg-transparent py-2.5 text-center text-xs text-[var(--accent)]" value="" onChange={(e) => addLine(e.target.value)}>
          <option value="">+ Add product from the party master</option>
          {party.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!isIntl && <Field label="Additional details" className="mb-5"><textarea rows={2} className={input} value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>}

      <div className="flex items-end justify-between">
        <div className="text-sm text-[var(--muted)]">
          {isIntl
            ? <p>Total value <span className="text-[var(--text)]">{fmtMoney(totalValue, party.currency)}</span></p>
            : <p>Taxable <span className="text-[var(--text)]">{fmtNum(taxableValue)}</span> · Tax <span className="text-[var(--text)]">{fmtNum(taxAmount)}</span> · Grand total <span className="text-[var(--text)]">{fmtNum(grandTotal)}</span></p>}
          <p className="mt-1 text-xs italic">{amountInWords(grandTotal, party.currency)}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className={btnGhost}>Cancel</button>
          {onSaveDraft && (
            <button className={btnGhost} onClick={() => onSaveDraft({
              title: [docNo.trim(), buyer.name, orderNo ? "order " + orderNo : "", totalBoxes + " boxes"].filter(Boolean).join(" · "),
              payload: {
                docNo, type, partyId, quotationRef, orderNo, orderDate, items, extra, taxRate,
                portOfLoading, destinationPort,
                buyer: { name: buyer.name, address: buyer.address },
                consignee: consigneeIdx === null || !choices[consigneeIdx] ? null : { name: consignee.name, address: consignee.address },
              },
            })}>Save draft</button>
          )}
          <button className={btn} onClick={() => onSave({
            id: editing ? editing.id : undefined, expectedUpdatedAt: editing ? editing.updatedAt : undefined,
            docNo: docNo.trim(), type, date: todayIST(), partyId, quotationRef,
            buyerName: buyer.name, buyerAddress: buyer.address,
            consigneeName: consignee.name, consigneeAddress: consignee.address,
            // Every name on the party travels with the proforma, so the shipment
            // form can still name any of them as the consignee.
            consigneeOptions: Array.from(new Set([...choices.map((c) => c.name), ...(party.consigneeOptions || [])].filter(Boolean))),
            portOfLoading: isIntl ? portOfLoading.trim() : "", destinationPort: isIntl ? destinationPort.trim() : "",
            paymentTerm: party.paymentTerm, shipmentTerm: party.shipmentTerm, conditions: party.conditions,
            currency: party.currency, buyerOrderNo: orderNo, buyerOrderDate: orderDate, items, additionalDetails: extra,
            totalBoxes, totalValue, taxableValue, taxRate, taxAmount,
            grandTotal: isIntl ? totalValue : grandTotal, linkedFinalInvoiceId: null,
          })}>{editing ? "Save changes" : "Create proforma"}</button>
        </div>
      </div>
    </div>
  );
}

/* The proforma as a printed page. The browser's "Save as PDF" makes the file;
   the Excel download says the same thing from lib/documents.js.            */
function ProformaDocument({ pi, company }) {
  const isIntl = pi.type === "international";
  const lines = pi.items || [];
  const small = { margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" };
  return (
    <div className="doc">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: 18, fontWeight: "bold", margin: 0 }}>{company.name || "Das Superfoods"}</p>
          <p className="muted" style={{ margin: "2px 0 0", maxWidth: 320 }}>{company.address}</p>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            {company.gstNo ? `GST ${company.gstNo}` : ""}{company.gstNo && company.iecCode ? " · " : ""}
            {company.iecCode ? `IEC ${company.iecCode}` : ""}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <h1>Proforma invoice</h1>
          <p style={{ margin: "6px 0 0" }}><b>PI No: {pi.docNo}</b></p>
          <p className="muted" style={{ margin: 0 }}>PI Date: {fmtDate(pi.date)}</p>
          {pi.buyerOrderNo && (
            <React.Fragment>
              <p className="muted" style={{ margin: 0 }}>Buyer Order No: {pi.buyerOrderNo}</p>
              <p className="muted" style={{ margin: 0 }}>Buyer Order Date: {fmtDate(pi.buyerOrderDate)}</p>
            </React.Fragment>
          )}
        </div>
      </div>
      <div className="rule" />

      <div style={{ display: "flex", gap: 32 }}>
        <div style={{ flex: 1 }}>
          <p className="muted" style={small}>Buyer</p>
          <p style={{ margin: "3px 0 0", fontWeight: "bold" }}>{pi.buyerName}</p>
          <p className="muted" style={{ margin: 0 }}>{pi.buyerAddress}</p>
        </div>
        <div style={{ flex: 1 }}>
          <p className="muted" style={small}>{isIntl ? "Consignee" : "Ship to"}</p>
          <p style={{ margin: "3px 0 0", fontWeight: "bold" }}>{pi.consigneeName || "—"}</p>
          <p className="muted" style={{ margin: 0 }}>{pi.consigneeAddress}</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 32, marginTop: 12 }}>
        {(pi.portOfLoading || pi.destinationPort) && (
          <div style={{ flex: 1 }}>
            <p className="muted" style={small}>Ports</p>
            <p style={{ margin: "3px 0 0" }}>Loading: {pi.portOfLoading || "—"}</p>
            <p style={{ margin: 0 }}>Destination: {pi.destinationPort || "—"}</p>
          </div>
        )}
        <div style={{ flex: 1 }}>
          <p className="muted" style={small}>Terms</p>
          <p style={{ margin: "3px 0 0" }}>Shipment: {pi.shipmentTerm || "—"}{pi.currency === "INR" ? "" : ` · Currency: ${pi.currency}`}</p>
          <p style={{ margin: 0 }}>Payment: {pi.paymentTerm || "—"}</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th>Product</th>
            <th style={{ width: 80 }}>HSN</th>
            <th className="num" style={{ width: 60 }}>Boxes</th>
            <th className="num" style={{ width: 60 }}>Units</th>
            <th className="num" style={{ width: 86 }}>{isIntl ? "Rate / box" : "MRP / box"}</th>
            <th className="num" style={{ width: 100 }}>{isIntl ? "Amount" : "Taxable value"}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((it, i) => (
            <tr key={it.id || i}>
              <td>{i + 1}</td>
              <td>{it.name}</td>
              <td>{it.hsn}</td>
              <td className="num">{it.boxQty}</td>
              <td className="num">{unitsFromBoxes(it.boxQty, it.packsPerBox)}</td>
              <td className="num">{fmtNum(isIntl ? it.rate : it.mrp)}</td>
              <td className="num">{fmtNum(proformaLineAmount(pi, it))}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className="num"><b>Total</b></td>
            <td className="num"><b>{pi.totalBoxes}</b></td>
            <td className="num"><b>{proformaUnits(pi)}</b></td>
            <td></td>
            <td className="num"><b>{fmtNum(isIntl ? pi.totalValue : pi.taxableValue)}</b></td>
          </tr>
          {!isIntl && (
            <tr>
              <td colSpan={6} className="num">Tax @ {fmtNum(pi.taxRate, 2)}%</td>
              <td className="num">{fmtNum(pi.taxAmount)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={6} className="num"><b>Grand total ({pi.currency})</b></td>
            <td className="num"><b>{fmtNum(pi.grandTotal)}</b></td>
          </tr>
        </tbody>
      </table>

      <p style={{ marginTop: 8, fontStyle: "italic" }}>Amount in words: {amountInWords(pi.grandTotal, pi.currency)}</p>
      {conditionsFromText(pi.conditions).length === 1 && (
        <p className="muted" style={{ marginTop: 10, fontSize: 11 }}>Conditions: {conditionsFromText(pi.conditions)[0]}</p>
      )}
      {conditionsFromText(pi.conditions).length > 1 && (
        <div className="muted" style={{ marginTop: 10, fontSize: 11 }}>
          <p style={{ margin: 0 }}>Conditions</p>
          {conditionsFromText(pi.conditions).map((c, i) => <p key={i} style={{ margin: 0 }}>{i + 1}. {c}</p>)}
        </div>
      )}
      {pi.additionalDetails && <p className="muted" style={{ marginTop: 6, fontSize: 11 }}>{pi.additionalDetails}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 28 }}>
        <div>
          <p style={{ margin: 0, fontWeight: "bold" }}>BANK DETAILS FOR TRANSFER</p>
          <p style={{ margin: "3px 0 0" }}><b>Account Name:</b> {company.accountName || "—"}</p>
          <p style={{ margin: 0 }}><b>Bank:</b> {company.bankName || "—"}</p>
          <p style={{ margin: 0 }}><b>Branch:</b> {company.bankBranch || "—"}</p>
          <p style={{ margin: 0 }}><b>Account Number:</b> {company.accountNo || "—"}</p>
          <p style={{ margin: 0 }}><b>Swift Code:</b> {company.swift || "—"}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0 }}>For <b>{company.name || "Das Superfoods"}</b></p>
          <p className="muted" style={{ margin: "44px 0 0" }}>Authorised signatory</p>
        </div>
      </div>
    </div>
  );
}

function ProformaPage({ initialTab = "open" }) {
  const { store, refresh } = useApp();
  const [form, setForm] = useState(null);           // null | { type, draft, editing }
  const [tab, setTab] = useState(initialTab);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const list = tab === "open" ? store.pis.filter((p) => !p.linkedFinalInvoiceId) : store.pis;
  const drafts = store.drafts.filter((d) => d.kind === "proforma");
  const open = (type, draft = null, editing = null) => { setSaveError(""); setNotice(""); setForm({ type, draft, editing }); };

  // From a draft, the proforma and the draft's retirement are one transaction.
  const createProforma = async (pi) => {
    // Said here so it is said at once; the database checks the same things and
    // is the one that decides (db/013).
    const typed = String(pi.docNo || "").trim();
    if (!typed) { setSaveError("Enter the proforma number."); return; }
    const editingId = form && form.editing ? form.editing.id : null;
    if (store.pis.some((p) => p.id !== editingId && String(p.docNo || "").trim().toUpperCase() === typed.toUpperCase())) {
      setSaveError(`Proforma number ${typed} is already in use. Type a different number.`);
      return;
    }
    const message = await attempt(async () => {
      if (form && form.draft) await call("raise_from_draft", { p_draft: form.draft.id, p: pick(pi, PROFORMA_KEYS) });
      // One function raises and edits: an id in the payload makes it an edit.
      else await call("save_proforma", { p: pick(pi, PROFORMA_KEYS) });
      await refresh();
    });
    setSaveError(message);
    if (!message) { setForm(null); if (editingId) setNotice(`Proforma ${typed} updated.`); }
  };

  const saveDraft = async ({ title, payload }) => {
    const from = form && form.draft;
    const message = await attempt(async () => {
      await call("save_draft", { p: pick({
        kind: "proforma", title, payload,
        id: from ? from.id : undefined, expectedUpdatedAt: from ? from.updatedAt : undefined,
      }, DRAFT_KEYS) });
      await refresh();
    });
    setSaveError(message);
    if (!message) { setForm(null); setNotice("Draft saved. It is listed under Saved drafts — no proforma number has been taken."); }
  };

  const discardDraft = async (d) => {
    const message = await attempt(async () => {
      await call("delete_draft", { p_id: d.id });
      await refresh();
    });
    setSaveError(message);
    if (!message) setNotice("Draft discarded.");
  };

  // Download → PDF: the document is drawn into the print portal and the
  // browser's "Save as PDF" makes the file, named after the proforma.
  const [downloadId, setDownloadId] = useState(null);
  const [printing, setPrinting] = useState(null);
  useEffect(() => {
    if (!printing) return undefined;
    const title = document.title;
    const t = setTimeout(() => {
      document.title = `Proforma ${fileSafe(printing.docNo)}`;
      window.print();
      document.title = title;
      setPrinting(null);
    }, 60);
    return () => clearTimeout(t);
  }, [printing]);

  // Download → Excel: the same document as rows.
  const downloadExcel = async (pi) => {
    const message = await attempt(() => exportRows(
      `Proforma-${fileSafe(pi.docNo)}`, "Proforma", proformaSheetRows(pi, store.company), PROFORMA_SHEET_WIDTHS));
    setSaveError(message);
  };

  const unitsOf = (pi) => (pi.items || []).reduce((s, i) => s + unitsFromBoxes(i.boxQty, i.packsPerBox), 0);
  const excelColumns = [
    { label: "Document", value: (p) => p.docNo, width: 24 },
    { label: "Date", value: (p) => fmtDate(p.date), width: 12 },
    { label: "Buyer", value: (p) => p.buyerName, width: 32 },
    { label: "Type", value: (p) => p.type },
    { label: "Order no.", value: (p) => p.buyerOrderNo },
    { label: "Order date", value: (p) => fmtDate(p.buyerOrderDate), width: 12 },
    { label: "Boxes", value: (p) => p.totalBoxes, width: 10 },
    { label: "Units", value: unitsOf, width: 10 },
    { label: "Currency", value: (p) => p.currency, width: 10 },
    { label: "Value", value: (p) => p.grandTotal },
    { label: "Status", value: (p) => (p.linkedFinalInvoiceId ? "Invoiced" : "Open") },
  ];

  return (
    <div>
      <PageHead title="Proforma invoices" blurb="Raised against a purchase order from an existing party. Once a shipment is invoiced against a proforma it drops out of the open list, but the record is kept." />

      <div className="mb-5 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-[var(--line)] p-1">
          {[["open", "Open"], ["all", "All"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? "bg-[var(--field)] text-[var(--text)]" : "text-[var(--muted)]"}`}>{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <ExcelButton name="proforma-invoices" columns={excelColumns} rows={list} />
          <button onClick={() => open("international")} className={btn + " flex items-center gap-1.5"}><Plus className="h-4 w-4" /> International</button>
          <button onClick={() => open("domestic")} className={btnGhost + " flex items-center gap-1.5 py-2"}><Plus className="h-4 w-4" /> Private label</button>
        </div>
      </div>

      <div aria-live="polite">
        {saveError && <p className={errText + " mb-4"}>{saveError}</p>}
        {notice && !saveError && <p className="mb-4 text-sm text-[var(--status-ok)]">{notice}</p>}
      </div>
      {form && <ProformaForm key={form.type + (form.draft ? form.draft.id : "") + (form.editing ? form.editing.id : "")}
        type={form.type} draft={form.draft} editing={form.editing}
        onCancel={() => setForm(null)} onSave={createProforma} onSaveDraft={form.editing ? undefined : saveDraft} />}
      {!form && <DraftList drafts={drafts} onDiscard={discardDraft}
        onResume={(d) => open(d.payload.type === "domestic" ? "domestic" : "international", d)} />}

      <div className={card + " overflow-hidden"}>
        <table className="w-full">
          <thead className="bg-[var(--panel)]">
            <tr>
              <th className={th}>Document</th><th className={th}>Date</th><th className={th}>Buyer</th><th className={th}>Type</th>
              <th className={th + " text-right"}>Boxes</th><th className={th + " text-right"}>Units</th>
              <th className={th + " text-right"}>Value</th><th className={th}>Status</th>
              <th className={th + " text-right"}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((pi) => (
              <tr key={pi.id} className="border-t border-[var(--line)]">
                <td className={td + " font-num text-xs"}>{pi.docNo}</td>
                <td className={td + " text-[var(--muted)]"}>{fmtDate(pi.date)}</td>
                <td className={td + " font-medium"}>{pi.buyerName}</td>
                <td className={td + " capitalize text-[var(--muted)]"}>{pi.type}</td>
                <td className={tdNum}>{pi.totalBoxes}</td>
                <td className={tdNum}>{unitsOf(pi)}</td>
                <td className={tdNum}>{fmtMoney(pi.grandTotal, pi.currency)}</td>
                <td className={td}>{pi.linkedFinalInvoiceId ? <Chip tone="ok">Invoiced</Chip> : <Chip tone="warn">Open</Chip>}</td>
                <td className={td + " whitespace-nowrap text-right"}>
                  {downloadId === pi.id ? (
                    <span className="flex items-center justify-end gap-3">
                      <button onClick={() => { setDownloadId(null); setPrinting(pi); }} className="text-xs text-[var(--accent)]">PDF</button>
                      <button onClick={() => { setDownloadId(null); downloadExcel(pi); }} className="text-xs text-[var(--accent)]">Excel</button>
                      <button onClick={() => setDownloadId(null)} aria-label="Close download options"><X className="h-3.5 w-3.5 text-[var(--muted)]" /></button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-4">
                      {/* Once a shipment is invoiced against it, a proforma is a record and stays as it is. */}
                      {!pi.linkedFinalInvoiceId && (
                        <button aria-label={`Edit ${pi.docNo}`} className="text-xs text-[var(--accent)]"
                          onClick={() => { open(pi.type === "domestic" ? "domestic" : "international", null, pi); window.scrollTo(0, 0); }}>
                          Edit
                        </button>
                      )}
                      <button onClick={() => setDownloadId(pi.id)} aria-label={`Download ${pi.docNo}`}
                        className="inline-flex items-center gap-1 text-xs text-[var(--accent)]">
                        <Download className="h-3 w-3" /> Download
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                {tab === "open" ? "No open proforma invoices — every one raised so far has been invoiced." : "No proforma invoices yet."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {printing && (
        <PrintDocument>
          <ProformaDocument pi={printing} company={store.company} />
        </PrintDocument>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- shipments */
function ShipmentForm({ pi, draft, editing, onSave, onSaveDraft, onCancel, error }) {
  const needsRate = pi.currency !== "INR";
  // The form starts from one of three things: the proforma alone, a saved
  // draft, or — when editing — the shipment itself, read into a draft's shape.
  const saved = editing ? {
    exchangeRate: editing.exchangeRate, containerNo: editing.containerNo, vehicleNo: editing.vehicleNo,
    customSeal: editing.customSeal, lineSeal: editing.lineSeal, portOfLoading: editing.portOfLoading || "",
    incoterm: editing.incoterm, gstPercent: editing.gstPercent, roundOff: editing.roundOff, freight: editing.freight,
    otherAdj: editing.otherAdj, otherReason: editing.otherReason,
    taxConsignee: editing.taxInvoice.consignee, commercialCurrency: editing.commercialInvoice.currency,
    commercialConsignee: editing.commercialInvoice.consignee, items: editing.items,
  } : (draft && draft.payload) || {};
  const [exchangeRate, setExchangeRate] = useState(saved.exchangeRate ?? (needsRate ? "" : "1"));
  const [containerNo, setContainerNo] = useState(saved.containerNo || "");
  const [vehicleNo, setVehicleNo] = useState(saved.vehicleNo || "");
  const [customSeal, setCustomSeal] = useState(saved.customSeal || "");
  const [lineSeal, setLineSeal] = useState(saved.lineSeal || "");
  const [portOfLoading, setPortOfLoading] = useState(saved.portOfLoading ?? (pi.portOfLoading || ""));
  const [incoterm, setIncoterm] = useState(saved.incoterm || pi.shipmentTerm || "FOB");
  const [gstPercent, setGstPercent] = useState(saved.gstPercent ?? 0);
  const [roundOff, setRoundOff] = useState(saved.roundOff ?? 0);
  const [freight, setFreight] = useState(saved.freight ?? 0);
  const [otherAdj, setOtherAdj] = useState(saved.otherAdj ?? 0);
  const [otherReason, setOtherReason] = useState(saved.otherReason || "");
  const [taxConsignee, setTaxConsignee] = useState(saved.taxConsignee ?? "TO THE ORDER");
  const [commercialCurrency, setCommercialCurrency] = useState(saved.commercialCurrency || pi.currency);
  const [commercialConsignee, setCommercialConsignee] = useState(saved.commercialConsignee ?? pi.consigneeName);
  const [items, setItems] = useState(Array.isArray(saved.items) && saved.items.length
    ? saved.items
    : pi.items.map((i) => ({ ...i, batchNo: "", mfgDate: todayIST(), expDate: "" })));
  const [busy, setBusy] = useState(false);

  const upd = (id, k, v) => setItems(items.map((i) => (i.id === id ? { ...i, [k]: v } : i)));

  // A preview of what the server will compute — the saved figures are the server's.
  const t = shipmentTotals({
    items, type: pi.type, currency: pi.currency, exchangeRate, gstPercent, roundOff, freight, otherAdj, commercialCurrency,
  });
  const missingWeights = items.some((i) => !toNumber(i.netWt) || !toNumber(i.grossWt));

  // One description of the form, used both to raise the shipment and to save it as a draft.
  const current = () => ({
    // An id makes it an edit; the version it was opened from guards against
    // overwriting a colleague's change.
    id: editing ? editing.id : undefined, expectedUpdatedAt: editing ? editing.updatedAt : undefined,
    piId: pi.id, items, freight, otherAdj, otherReason, gstPercent, roundOff, exchangeRate,
    commercialCurrency, commercialConsignee, taxConsignee,
    containerNo, vehicleNo, customSeal, lineSeal, portOfLoading, incoterm,
  });

  const submit = async () => {
    setBusy(true);
    await onSave(current());
    setBusy(false);
  };

  const saveAsDraft = async () => {
    setBusy(true);
    await onSaveDraft({ title: `${pi.docNo} · ${pi.buyerName}`, refId: pi.id, payload: current() });
    setBusy(false);
  };

  return (
    <div className={card + " mb-6 p-6"}>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="font-display text-lg">{editing ? `Edit shipment ${editing.docNo}` : `${draft ? "Draft shipment" : "Shipment"} against ${pi.docNo}`}</p>
          {editing && <p className="mt-1 text-xs text-[var(--muted)]">Invoiced {fmtDate(editing.date)} against {pi.docNo}. The invoice numbers and date do not change; every total is worked out again, and the change is recorded in the audit log.</p>}
          {draft && <p className="mt-1 text-xs text-[var(--muted)]">Continuing the draft saved by {draft.savedBy || "—"} · {fmtWhen(draft.updatedAt)}</p>}
          <p className="mt-1 text-xs text-[var(--muted)]">
            {pi.buyerName} · order {pi.buyerOrderNo || "—"} of {fmtDate(pi.buyerOrderDate)} · one pass produces the tax invoice, commercial invoice and packing list.
          </p>
        </div>
        <button onClick={onCancel} aria-label="Close"><X className="h-4 w-4 text-[var(--muted)]" /></button>
      </div>

      <p className="mb-3 text-sm font-medium">Marks &amp; numbers</p>
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Field label={`Exchange rate (₹ per ${pi.currency})`} hint={needsRate ? "Needed: the tax invoice is in INR" : "Not needed — this proforma is already in INR"}>
          <input type="number" step="0.01" className={input} value={exchangeRate} disabled={!needsRate}
            onChange={(e) => setExchangeRate(e.target.value)} />
        </Field>
        <Field label="Container no."><input className={input} value={containerNo} onChange={(e) => setContainerNo(e.target.value)} /></Field>
        <Field label="Vehicle no."><input className={input} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} /></Field>
        <Field label="Customs seal"><input className={input} value={customSeal} onChange={(e) => setCustomSeal(e.target.value)} /></Field>
        <Field label="Line seal"><input className={input} value={lineSeal} onChange={(e) => setLineSeal(e.target.value)} /></Field>
        <Field label="Port of loading"><input className={input} value={portOfLoading} onChange={(e) => setPortOfLoading(e.target.value)} /></Field>
        <Field label="Incoterm">
          <select className={input} value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
            <option>FOB</option><option>CIF</option><option>CNF</option><option>Ex-Factory</option>
          </select>
        </Field>
        <Field label="Destination"><input className={input} value={pi.destinationPort || ""} disabled /></Field>
      </div>

      <p className="mb-3 text-sm font-medium">Stuffed quantity, batch &amp; dates</p>
      <div className={panel + " mb-3 overflow-x-auto"}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Product</th><th className={th}>Boxes</th><th className={th + " text-right"}>Units</th>
              <th className={th}>Batch</th><th className={th}>MFG</th><th className={th}>EXP</th>
              <th className={th + " text-right"}>Net / gross kg</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-[var(--line)]">
                <td className={td}>{it.name}</td>
                <td className="w-28 px-2 py-1.5"><input type="number" className={input} value={it.boxQty} onChange={(e) => upd(it.id, "boxQty", e.target.value)} /></td>
                <td className={tdNum + " text-[var(--muted)]"}>{unitsFromBoxes(it.boxQty, it.packsPerBox)}</td>
                <td className="px-2 py-1.5"><input className={input} value={it.batchNo} onChange={(e) => upd(it.id, "batchNo", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input type="date" className={input} value={it.mfgDate} onChange={(e) => upd(it.id, "mfgDate", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input type="date" className={input} value={it.expDate} onChange={(e) => upd(it.id, "expDate", e.target.value)} /></td>
                <td className={tdNum + " whitespace-nowrap text-[var(--muted)]"}>
                  {fmtNum(toNumber(it.boxQty) * toNumber(it.netWt))} / {fmtNum(toNumber(it.boxQty) * toNumber(it.grossWt))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missingWeights && (
        <p className="mb-6 flex items-start gap-2 text-xs text-[var(--status-warn)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          A line has no net or gross weight on the party master, so the packing list totals will be short. Fill the weights under Parties and raise the proforma again.
        </p>
      )}

      <p className="mb-3 mt-6 text-sm font-medium">Adjustments <span className="font-normal text-[var(--muted)]">— in {pi.currency}, except GST and round-off which apply to the INR tax invoice</span></p>
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Field label="GST % (tax invoice)"><input type="number" className={input} value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} /></Field>
        <Field label="Round off (₹)"><input type="number" step="0.01" className={input} value={roundOff} onChange={(e) => setRoundOff(e.target.value)} /></Field>
        <Field label={`Freight (${pi.currency})`} hint={incoterm === "FOB" ? "Add when Das Superfoods books the vessel" : "Already inside " + incoterm}>
          <input type="number" step="0.01" className={input} value={freight} onChange={(e) => setFreight(e.target.value)} />
        </Field>
        <Field label={`Other charge / deduction (${pi.currency})`}><input type="number" step="0.01" className={input} value={otherAdj} onChange={(e) => setOtherAdj(e.target.value)} /></Field>
        {toNumber(otherAdj) !== 0 && (
          <Field label="Reason (required)" className="md:col-span-2"><input className={input} value={otherReason} onChange={(e) => setOtherReason(e.target.value)} /></Field>
        )}
      </div>

      <p className="mb-3 text-sm font-medium">Consignee &amp; currency</p>
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Field label="Tax invoice consignee" hint="Kept as TO THE ORDER so the buyer stays off the shipping bill">
          <input className={input} value={taxConsignee} onChange={(e) => setTaxConsignee(e.target.value)} />
        </Field>
        <Field label="Commercial invoice consignee">
          <select className={input} value={commercialConsignee} onChange={(e) => setCommercialConsignee(e.target.value)}>
            {/* The name already on the shipment stays on offer even if the proforma no longer lists it. */}
            {Array.from(new Set([...(pi.consigneeOptions && pi.consigneeOptions.length ? pi.consigneeOptions : [pi.consigneeName]), commercialConsignee].filter(Boolean)))
              .map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Commercial invoice currency" hint="Set per shipment, not derived from the payment term">
          <select className={input} value={commercialCurrency} onChange={(e) => setCommercialCurrency(e.target.value)}>
            <option value="USD">USD</option><option value="INR">INR</option>
          </select>
        </Field>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className={panel + " p-4 text-sm"}>
          <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Tax invoice · INR</p>
          {t.needsExchangeRate ? (
            <p className="text-[var(--status-warn)]">Enter the exchange rate to see the INR figures.</p>
          ) : (
            <React.Fragment>
              <p className="text-[var(--muted)]">Total <span className="font-num text-[var(--text)]">{fmtMoney(t.inrTotal, "INR")}</span></p>
              <p className="text-[var(--muted)]">GST <span className="font-num text-[var(--text)]">{fmtMoney(t.gst, "INR")}</span></p>
              <p className="mt-1 font-medium">Grand total <span className="font-num">{fmtMoney(t.grandTotal, "INR")}</span></p>
              <p className="mt-1 text-xs italic text-[var(--muted)]">{amountInWords(t.grandTotal, "INR")}</p>
            </React.Fragment>
          )}
        </div>
        <div className={panel + " p-4 text-sm"}>
          <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Commercial invoice · {t.commercialCurrency}</p>
          <p className="text-[var(--muted)]">{commercialConsignee}</p>
          <p className="text-[var(--muted)]">Incoterm {incoterm}</p>
          <p className="mt-1 font-medium font-num">{fmtMoney(t.commercialTotal, t.commercialCurrency)}</p>
        </div>
        <div className={panel + " p-4 text-sm"}>
          <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Packing list</p>
          <p className="text-[var(--muted)]"><span className="font-num text-[var(--text)]">{t.boxes}</span> boxes · <span className="font-num text-[var(--text)]">{t.packs}</span> units</p>
          <p className="text-[var(--muted)]">Net <span className="font-num">{fmtNum(t.net, 3)}</span> kg · <span className="font-num">{fmtNum(t.net / 1000, 3)}</span> t</p>
          <p className="text-[var(--muted)]">Gross <span className="font-num">{fmtNum(t.gross, 3)}</span> kg · <span className="font-num">{fmtNum(t.gross / 1000, 3)}</span> t</p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <span aria-live="polite" className={errText}>{error}</span>
        <button onClick={onCancel} className={btnGhost}>Cancel</button>
        {onSaveDraft && <button onClick={saveAsDraft} disabled={busy} className={btnGhost}>Save draft</button>}
        <button onClick={submit} disabled={busy} className={btn}>{busy ? "Saving…" : editing ? "Save changes" : "Generate document set"}</button>
      </div>
    </div>
  );
}

/* The shipment's three documents as printed pages, one page each. Drawn from
   shipmentModel() — the same reading the Excel workbook uses — so the tax
   invoice, commercial invoice and packing list cannot disagree with each
   other or with the workbook. The browser's "Save as PDF" makes the file.  */
function DocHead({ company, title, rows }) {
  return (
    <React.Fragment>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: 18, fontWeight: "bold", margin: 0 }}>{company.name || "Das Superfoods"}</p>
          <p className="muted" style={{ margin: "2px 0 0", maxWidth: 320 }}>{company.address}</p>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            {[company.gstNo ? `GST ${company.gstNo}` : "", company.iecCode ? `IEC ${company.iecCode}` : ""].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <h1>{title}</h1>
          {rows.map(([label, value], i) => (
            <p key={label} className={i === 0 ? undefined : "muted"} style={{ margin: i === 0 ? "6px 0 0" : 0, fontWeight: i === 0 ? "bold" : "normal" }}>{label}: {value || "—"}</p>
          ))}
        </div>
      </div>
      <div className="rule" />
    </React.Fragment>
  );
}

function DocBlock({ title, lines }) {
  return (
    <div style={{ flex: 1 }}>
      <p className="muted" style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>{title}</p>
      {lines.map((line, i) => (
        <p key={i} className={i === 0 ? undefined : "muted"} style={{ margin: i === 0 ? "3px 0 0" : 0, fontWeight: i === 0 ? "bold" : "normal" }}>{line}</p>
      ))}
    </div>
  );
}

const transportLines = (s, withSeals) => [
  `Port of loading: ${s.portOfLoading || "—"}`, `Incoterm: ${s.incoterm || "—"}`,
  `Container No: ${s.containerNo || "—"}`, `Vehicle No: ${s.vehicleNo || "—"}`,
  ...(withSeals ? [`Customs seal: ${s.customSeal || "—"}`, `Line seal: ${s.lineSeal || "—"}`] : []),
];

function PriceTable({ m, totals }) {
  const under = [...shipmentCharges(m), ...totals];
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 28 }}>#</th><th>Product</th><th style={{ width: 80 }}>HSN</th>
          <th className="num" style={{ width: 56 }}>Boxes</th><th className="num" style={{ width: 56 }}>Units</th>
          <th className="num" style={{ width: 96 }}>{m.intl ? "Rate" : "MRP"} / box ({m.currency})</th>
          <th className="num" style={{ width: 104 }}>Amount ({m.currency})</th>
        </tr>
      </thead>
      <tbody>
        {m.lines.map((l) => (
          <tr key={l.no}>
            <td>{l.no}</td><td>{l.name}</td><td>{l.hsn}</td>
            <td className="num">{l.boxes}</td><td className="num">{l.units}</td>
            <td className="num">{fmtNum(l.price)}</td><td className="num">{fmtNum(l.amount)}</td>
          </tr>
        ))}
        <tr>
          <td colSpan={3} className="num"><b>Total</b></td>
          <td className="num"><b>{m.packing.boxes}</b></td><td className="num"><b>{m.packing.units}</b></td>
          <td></td><td className="num"><b>{fmtNum(m.subtotal)}</b></td>
        </tr>
        {under.map(([label, value], i) => (
          <tr key={label}>
            <td colSpan={6} className="num">{i === under.length - 1 ? <b>{label}</b> : label}</td>
            <td className="num">{i === under.length - 1 ? <b>{fmtNum(value)}</b> : fmtNum(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Signatory({ company }) {
  return (
    <div style={{ textAlign: "right" }}>
      <p style={{ margin: 0 }}>For <b>{company.name || "Das Superfoods"}</b></p>
      <p className="muted" style={{ margin: "44px 0 0" }}>Authorised signatory</p>
    </div>
  );
}

function ShipmentDocuments({ s, pi, company }) {
  const m = shipmentModel(s, pi);
  return (
    <React.Fragment>
      <div className="doc">
        <DocHead company={company} title="Tax invoice" rows={shipmentHeader(s, m.tax.no)} />
        <div style={{ display: "flex", gap: 32 }}>
          <DocBlock title="Consignee" lines={[m.tax.consignee || "—"]} />
          <DocBlock title="Shipment" lines={transportLines(s, false)} />
        </div>
        <PriceTable m={m} totals={taxInvoiceTotals(m)} />
        <p style={{ marginTop: 8, fontStyle: "italic" }}>Amount in words: {amountInWords(m.tax.grandTotal, "INR")}</p>
        <div style={{ marginTop: 40 }}><Signatory company={company} /></div>
      </div>

      <div className="doc">
        <DocHead company={company} title="Commercial invoice" rows={shipmentHeader(s, m.commercial.no)} />
        <div style={{ display: "flex", gap: 32 }}>
          <DocBlock title="Buyer" lines={[s.buyerName || "—", s.buyerAddress || ""]} />
          <DocBlock title="Consignee" lines={[m.commercial.consignee || "—"]} />
          <DocBlock title="Shipment" lines={transportLines(s, false)} />
        </div>
        <PriceTable m={m} totals={commercialInvoiceTotals(m)} />
        <p style={{ marginTop: 8, fontStyle: "italic" }}>Amount in words: {amountInWords(m.commercial.total, m.commercial.currency)}</p>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 28 }}>
          <div>
            <p style={{ margin: 0, fontWeight: "bold" }}>BANK DETAILS FOR TRANSFER</p>
            {bankRows(company).map(([label, value], i) => (
              <p key={label} style={{ margin: i === 0 ? "3px 0 0" : 0 }}><b>{label}:</b> {value || "—"}</p>
            ))}
          </div>
          <Signatory company={company} />
        </div>
      </div>

      <div className="doc">
        <DocHead company={company} title="Packing list" rows={shipmentHeader(s, s.docNo)} />
        <div style={{ display: "flex", gap: 32 }}>
          <DocBlock title="Consignee" lines={[m.commercial.consignee || "—"]} />
          <DocBlock title="Shipment" lines={transportLines(s, true)} />
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th><th>Product</th><th style={{ width: 80 }}>Batch</th>
              <th style={{ width: 76 }}>MFG</th><th style={{ width: 76 }}>EXP</th>
              <th className="num" style={{ width: 52 }}>Boxes</th><th className="num" style={{ width: 52 }}>Units</th>
              <th className="num" style={{ width: 72 }}>Net kg</th><th className="num" style={{ width: 72 }}>Gross kg</th>
            </tr>
          </thead>
          <tbody>
            {m.lines.map((l) => (
              <tr key={l.no}>
                <td>{l.no}</td><td>{l.name}</td><td>{l.batchNo}</td><td>{l.mfgDate ? fmtDate(l.mfgDate) : ""}</td><td>{l.expDate ? fmtDate(l.expDate) : ""}</td>
                <td className="num">{l.boxes}</td><td className="num">{l.units}</td>
                <td className="num">{fmtNum(l.net, 3)}</td><td className="num">{fmtNum(l.gross, 3)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} className="num"><b>Total</b></td>
              <td className="num"><b>{m.packing.boxes}</b></td><td className="num"><b>{m.packing.units}</b></td>
              <td className="num"><b>{fmtNum(m.packing.net, 3)}</b></td><td className="num"><b>{fmtNum(m.packing.gross, 3)}</b></td>
            </tr>
            <tr>
              <td colSpan={7} className="num">Tonnes</td>
              <td className="num">{fmtNum(m.packing.net / 1000, 3)}</td><td className="num">{fmtNum(m.packing.gross / 1000, 3)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: 40 }}><Signatory company={company} /></div>
      </div>
    </React.Fragment>
  );
}

function ShipmentsPage() {
  const { store, refresh } = useApp();
  const [formPiId, setFormPiId] = useState(null);
  const [formDraft, setFormDraft] = useState(null);   // the draft the open form was started from
  const [confirmDraftId, setConfirmDraftId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [editingId, setEditingId] = useState(null);   // the shipment being edited, if any
  const [downloadId, setDownloadId] = useState(null);
  const [printing, setPrinting] = useState(null);     // { s, pi } while the set is being printed
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");

  const openPis = store.pis.filter((p) => !p.linkedFinalInvoiceId);
  const editing = editingId ? store.finalInvoices.find((f) => f.id === editingId) || null : null;
  // If the shipment being edited has gone, the form goes with it rather than
  // turning into a new shipment against a proforma that is already invoiced.
  const pi = formPiId && !(editingId && !editing) ? store.pis.find((p) => p.id === formPiId) : null;
  // A shipment's documents and its edit both need the proforma it was raised
  // against: that is where the pricing basis and the currency live.
  const piOf = (fi) => store.pis.find((p) => p.id === fi.piId) || null;
  const noProforma = (fi) => `The proforma ${fi.piNo} this shipment was raised against could not be loaded, so this cannot be done here.`;
  const closeForm = () => { setFormPiId(null); setEditingId(null); };
  const openEdit = (fi) => {
    setNotice(""); setDownloadId(null);
    if (!piOf(fi)) { setSaveError(noProforma(fi)); return; }
    setSaveError(""); setFormDraft(null); setEditingId(fi.id); setFormPiId(fi.piId);
    window.scrollTo(0, 0);
  };

  // Download → PDF: the three documents are drawn into the print portal and
  // the browser's "Save as PDF" makes the file, named after the shipment.
  useEffect(() => {
    if (!printing) return undefined;
    const title = document.title;
    const t = setTimeout(() => {
      document.title = `Shipment ${fileSafe(printing.s.docNo)}`;
      window.print();
      document.title = title;
      setPrinting(null);
    }, 60);
    return () => clearTimeout(t);
  }, [printing]);

  // Download → Excel: the same three documents, one sheet each.
  const download = async (fi, kind) => {
    setDownloadId(null); setNotice("");
    const itsPi = piOf(fi);
    if (!itsPi) { setSaveError(noProforma(fi)); return; }
    setSaveError("");
    if (kind === "pdf") { setPrinting({ s: fi, pi: itsPi }); return; }
    setSaveError(await attempt(() => exportBook(
      `Shipment-${fileSafe(fi.docNo)}`, shipmentSheets(fi, itsPi, shipmentCompany(fi.company, store.company)))));
  };
  const detail = detailId ? store.finalInvoices.find((f) => f.id === detailId) : null;
  // At most one live shipment draft per proforma (db/012).
  const draftFor = (piId) => store.drafts.find((d) => d.kind === "shipment" && d.refId === piId) || null;
  const openForm = (p) => { setSaveError(""); setNotice(""); setEditingId(null); setFormDraft(draftFor(p.id)); setFormPiId(p.id); };

  // Invoice number, shipment row and "proforma is now invoiced" are one
  // transaction — and so is retiring the draft, when there is one.
  const createShipment = async (payload) => {
    const was = editing;
    const from = was ? null : formDraft || draftFor(payload.piId);
    const message = await attempt(async () => {
      if (from) await call("raise_from_draft", { p_draft: from.id, p: pick(payload, SHIPMENT_KEYS) });
      // One function invoices and edits: an id in the payload makes it an edit.
      else await call("save_shipment", { p: pick(payload, SHIPMENT_KEYS) });
      await refresh();
    });
    setSaveError(message);
    if (!message) { closeForm(); if (was) setNotice(`Shipment ${was.docNo} updated.`); }
  };

  const saveDraft = async ({ title, refId, payload }) => {
    const message = await attempt(async () => {
      await call("save_draft", { p: pick({
        kind: "shipment", title, refId, payload,
        id: formDraft ? formDraft.id : undefined, expectedUpdatedAt: formDraft ? formDraft.updatedAt : undefined,
      }, DRAFT_KEYS) });
      await refresh();
    });
    setSaveError(message);
    if (!message) { setFormPiId(null); setNotice("Draft saved. The proforma stays open and no invoice number has been taken."); }
  };

  const discardDraft = async (d) => {
    setConfirmDraftId(null);
    const message = await attempt(async () => {
      await call("delete_draft", { p_id: d.id });
      await refresh();
    });
    setSaveError(message);
    if (!message) setNotice("Draft discarded.");
  };

  const excelColumns = [
    { label: "Invoice", value: (f) => f.docNo, width: 22 },
    { label: "Date", value: (f) => fmtDate(f.date), width: 12 },
    { label: "Buyer", value: (f) => f.buyerName, width: 32 },
    { label: "Against proforma", value: (f) => f.piNo, width: 24 },
    { label: "Container", value: (f) => f.containerNo },
    { label: "Boxes", value: (f) => f.packingList.totalBoxes, width: 10 },
    { label: "Units", value: (f) => f.packingList.totalPacks, width: 10 },
    { label: "Net kg", value: (f) => f.packingList.netWeight },
    { label: "Gross kg", value: (f) => f.packingList.grossWeight },
    { label: "Gross tonnes", value: (f) => toNumber(f.packingList.grossWeight) / 1000 },
    { label: "Exchange rate", value: (f) => f.exchangeRate },
    { label: "Tax invoice total (INR)", value: (f) => f.taxInvoice.total, width: 22 },
    { label: "GST (INR)", value: (f) => f.taxInvoice.gst },
    { label: "Tax invoice grand total (INR)", value: (f) => f.taxInvoice.grandTotal, width: 26 },
    { label: "Commercial currency", value: (f) => f.commercialInvoice.currency },
    { label: "Commercial value", value: (f) => f.commercialInvoice.total },
  ];

  return (
    <div>
      <PageHead title="Shipments" blurb="Raised after stuffing, against the quantity actually packed. One entry produces the tax invoice, the commercial invoice and the packing list." />

      {!pi && (
        <div className={card + " mb-6 p-5"}>
          <p className="mb-4 text-sm font-medium">Pick the proforma this shipment is against</p>
          {openPis.length === 0 && <p className="text-sm text-[var(--muted)]">No open proforma invoices — raise one under Proforma first.</p>}
          <div aria-live="polite">
            {saveError && <p className={errText + " mb-3"}>{saveError}</p>}
            {notice && !saveError && <p className="mb-3 text-sm text-[var(--status-ok)]">{notice}</p>}
          </div>
          <div className="space-y-2">
            {openPis.map((p) => {
              const d = draftFor(p.id);
              return (
                <div key={p.id} className={panel + " flex items-center justify-between gap-4 px-4 py-3"}>
                  <div>
                    <p className="text-sm font-medium">
                      {p.buyerName} <span className="ml-2 font-num text-xs text-[var(--muted)]">{p.docNo}</span>
                      {d && <span className="ml-2"><Chip tone="warn">Draft</Chip></span>}
                    </p>
                    <p className="text-xs text-[var(--muted)]">{fmtMoney(p.grandTotal, p.currency)} · {p.totalBoxes} boxes · raised {fmtDate(p.date)}</p>
                    {d && <p className="text-xs text-[var(--muted)]">Draft saved by {d.savedBy || "—"} · {fmtWhen(d.updatedAt)}</p>}
                  </div>
                  {d && confirmDraftId === d.id ? (
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-[var(--status-danger)]">Discard this draft?</span>
                      <button onClick={() => discardDraft(d)} className="text-xs text-[var(--status-danger)]">Confirm</button>
                      <button onClick={() => setConfirmDraftId(null)} className="text-xs text-[var(--muted)]">Keep</button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-4">
                      <button onClick={() => openForm(p)} className="flex items-center gap-1 text-sm text-[var(--accent)]">
                        {d ? "Continue draft" : "Create shipment"} <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      {d && <button onClick={() => setConfirmDraftId(d.id)} className="text-xs text-[var(--muted)] hover:text-[var(--status-danger)]">Discard draft</button>}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pi && <ShipmentForm key={pi.id + (formDraft ? formDraft.id : "") + (editing ? editing.id : "")} pi={pi} draft={formDraft} editing={editing} error={saveError}
        onCancel={closeForm} onSave={createShipment} onSaveDraft={editing ? undefined : saveDraft} />}

      <div className="mb-3 flex justify-end">
        <ExcelButton name="shipments" columns={excelColumns} rows={store.finalInvoices} />
      </div>
      <div className={card + " overflow-hidden"}>
        <table className="w-full">
          <thead className="bg-[var(--panel)]">
            <tr>
              <th className={th}>Invoice</th><th className={th}>Date</th><th className={th}>Buyer</th><th className={th}>Against</th>
              <th className={th + " text-right"}>Boxes / units</th>
              <th className={th + " text-right"}>Grand total (INR)</th>
              <th className={th + " text-right"}>Net / gross kg</th><th className={th + " text-right"}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {store.finalInvoices.map((fi) => (
              <tr key={fi.id} className="border-t border-[var(--line)]">
                <td className={td + " font-num text-xs"}>{fi.docNo}</td>
                <td className={td + " text-[var(--muted)]"}>{fmtDate(fi.date)}</td>
                <td className={td}>{fi.buyerName}</td>
                <td className={td + " font-num text-xs text-[var(--muted)]"}>{fi.piNo}</td>
                <td className={tdNum}>{fi.packingList.totalBoxes} / {fi.packingList.totalPacks}</td>
                <td className={tdNum}>{fmtMoney(fi.taxInvoice.grandTotal, "INR")}</td>
                <td className={tdNum + " text-[var(--muted)]"}>{fmtNum(fi.packingList.netWeight)} / {fmtNum(fi.packingList.grossWeight)}</td>
                <td className={td + " whitespace-nowrap text-right"}>
                  {downloadId === fi.id ? (
                    <span className="flex items-center justify-end gap-3">
                      <button onClick={() => download(fi, "pdf")} className="text-xs text-[var(--accent)]">PDF</button>
                      <button onClick={() => download(fi, "excel")} className="text-xs text-[var(--accent)]">Excel</button>
                      <button onClick={() => setDownloadId(null)} aria-label="Close download options"><X className="h-3.5 w-3.5 text-[var(--muted)]" /></button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-4">
                      <button onClick={() => setDetailId(detailId === fi.id ? null : fi.id)} className="text-xs text-[var(--accent)]"
                        aria-expanded={detailId === fi.id}>
                        {detailId === fi.id ? "Hide" : "View set"}
                      </button>
                      <button aria-label={`Edit ${fi.docNo}`} onClick={() => openEdit(fi)} className="text-xs text-[var(--accent)]">Edit</button>
                      <button onClick={() => setDownloadId(fi.id)} aria-label={`Download ${fi.docNo}`}
                        className="inline-flex items-center gap-1 text-xs text-[var(--accent)]">
                        <Download className="h-3 w-3" /> Download
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {store.finalInvoices.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                No shipments invoiced yet — pick an open proforma above to raise the first.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className={card + " mt-6 p-6"}>
          <p className="mb-5 font-display text-lg">Document set — {detail.docNo}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className={panel + " p-4 text-sm"}>
              <p className="font-num text-xs text-[var(--accent)]">{detail.taxDocNo}</p>
              <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Tax invoice · INR</p>
              <p className="text-[var(--muted)]">Consignee {detail.taxInvoice.consignee}</p>
              <p className="text-[var(--muted)]">Total <span className="font-num">{fmtMoney(detail.taxInvoice.total, "INR")}</span> · GST <span className="font-num">{fmtMoney(detail.taxInvoice.gst, "INR")}</span></p>
              <p className="mt-1 font-medium font-num">{fmtMoney(detail.taxInvoice.grandTotal, "INR")}</p>
              <p className="mt-1 text-xs italic text-[var(--muted)]">{amountInWords(detail.taxInvoice.grandTotal, "INR")}</p>
            </div>
            <div className={panel + " p-4 text-sm"}>
              <p className="font-num text-xs text-[var(--accent)]">{detail.commercialDocNo}</p>
              <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Commercial · {detail.commercialInvoice.currency}</p>
              <p className="text-[var(--muted)]">Consignee {detail.commercialInvoice.consignee}</p>
              <p className="text-[var(--muted)]">Incoterm {detail.incoterm} · rate ₹{fmtNum(detail.exchangeRate)}</p>
              <p className="mt-1 font-medium font-num">{fmtMoney(detail.commercialInvoice.total, detail.commercialInvoice.currency)}</p>
            </div>
            <div className={panel + " p-4 text-sm"}>
              <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Packing list</p>
              <p className="text-[var(--muted)]">Container {detail.containerNo || "—"} · seal {detail.lineSeal || "—"}</p>
              <p className="text-[var(--muted)]"><span className="font-num">{detail.packingList.totalBoxes}</span> boxes · <span className="font-num">{detail.packingList.totalPacks}</span> units</p>
              <p className="text-[var(--muted)]">Net <span className="font-num">{fmtNum(detail.packingList.netWeight, 3)}</span> kg · Gross <span className="font-num">{fmtNum(detail.packingList.grossWeight, 3)}</span> kg</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-[var(--muted)]">
            Bank details as they stood when this set was generated: {detail.company && detail.company.bankName ? `${detail.company.bankName}, A/C ${detail.company.accountNo}` : "not recorded"}.
          </p>
        </div>
      )}

      {printing && (
        <PrintDocument>
          <ShipmentDocuments s={printing.s} pi={printing.pi} company={shipmentCompany(printing.s.company, store.company)} />
        </PrintDocument>
      )}
    </div>
  );
}

function AnalyticsPage() {
  return (
    <div>
      <PageHead title="Analytics" blurb="Weight, quantity and value by brand, country and product — plus packing-material inventory and container tracking." />
      <div className={card + " flex flex-col items-center justify-center py-20 text-center"}>
        <Boxes className="mb-3 h-6 w-6 text-[var(--muted)]" />
        <p className="text-sm">Scheduled for phase 2</p>
        <p className="mt-1 max-w-sm text-xs text-[var(--muted)]">The core document workflow ships first; analytics and container tracking follow once it is stable in daily use.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- company */
function CompanyPage() {
  const { store, refresh } = useApp();
  const [draft, setDraft] = useState(store.company);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = COMPANY_KEYS.some((k) => (draft[k] || "") !== (store.company[k] || ""));
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // A colleague's save arrives live; adopt it unless this screen has unsaved edits.
  useEffect(() => { if (!dirtyRef.current) setDraft(store.company); }, [store.company]);

  const set = (k, v) => { setDraft({ ...draft, [k]: v }); setSaved(false); };

  const save = async () => {
    setBusy(true);
    const message = await attempt(async () => {
      await call("save_company", { p: pick(draft, COMPANY_KEYS) });
      await refresh();
    });
    setBusy(false);
    setSaveError(message);
    if (!message) setSaved(true);
  };

  return (
    <div>
      <PageHead title="Company profile" blurb="Registered details and bank particulars. These are copied onto every shipment's invoices at the moment the shipment is created — later edits never change a document already issued." />
      <div className={card + " max-w-3xl p-6"}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Company name" className="md:col-span-2"><input className={input} value={draft.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Registered address" className="md:col-span-2"><input className={input} value={draft.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="GST no."><input className={input} value={draft.gstNo} onChange={(e) => set("gstNo", e.target.value)} /></Field>
          <Field label="IEC code"><input className={input} value={draft.iecCode} onChange={(e) => set("iecCode", e.target.value)} /></Field>
        </div>

        <p className="mb-1 mt-7 text-sm font-medium">Bank details for transfer</p>
        <p className="mb-4 text-xs text-[var(--muted)]">
          Printed on every proforma exactly as typed here, so the buyer knows where to send the payment. Check each one against the bank's own letter.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Account name" hint="The name the account is held in, as the bank has it" className="md:col-span-2">
            <input className={input} value={draft.accountName || ""} onChange={(e) => set("accountName", e.target.value)} />
          </Field>
          <Field label="Bank"><input className={input} value={draft.bankName} onChange={(e) => set("bankName", e.target.value)} /></Field>
          <Field label="Account number"><input className={input} value={draft.accountNo} onChange={(e) => set("accountNo", e.target.value)} /></Field>
          <Field label="Branch" hint="Branch name and its address" className="md:col-span-2">
            <input className={input} value={draft.bankBranch || ""} onChange={(e) => set("bankBranch", e.target.value)} />
          </Field>
          <Field label="Swift code"><input className={input} value={draft.swift} onChange={(e) => set("swift", e.target.value)} /></Field>
        </div>
        <div className="mt-6 flex items-center justify-end gap-4" aria-live="polite">
          {saveError && <span className={errText}>{saveError}</span>}
          {saved && !dirty && <span className="flex items-center gap-1 text-xs text-[var(--status-ok)]"><Check className="h-3.5 w-3.5" /> Saved</span>}
          <button disabled={!dirty || busy} className={btn} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- users */
// A password a person can read out over the phone: no look-alike characters.
function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(14);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// The eight tick-boxes. Used when adding an account and when changing one.
function SectionPicker({ value, onChange, locked }) {
  const held = new Set(value);
  const toggle = (key) => {
    const next = new Set(held);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(ALL_SECTION_KEYS.filter((k) => next.has(k)));
  };
  return (
    <fieldset>
      <legend className={label}>Section access</legend>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map((s) => (
          <label key={s.key} className="flex items-start gap-2 text-sm text-[var(--text)]">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" disabled={locked}
              checked={locked ? true : held.has(s.key)} onChange={() => toggle(s.key)} />
            <span>
              {s.label}
              <span className="block text-xs text-[var(--faint)]">{s.note}</span>
            </span>
          </label>
        ))}
      </div>
      {!locked && (
        <div className="mt-3 flex gap-4 text-xs">
          <button type="button" onClick={() => onChange(ALL_SECTION_KEYS)} className="text-[var(--accent)]">Tick all</button>
          <button type="button" onClick={() => onChange([])} className="text-[var(--muted)]">Clear</button>
        </div>
      )}
    </fieldset>
  );
}

function UsersPage() {
  const { store, refresh, user, isAdmin } = useApp();
  const blank = { name: "", email: "", password: "", role: "staff", sections: [] };
  const [form, setForm] = useState(blank);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");
  const [pageError, setPageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [passwordFor, setPasswordFor] = useState(null);     // { id, email, value }
  const [auditFilter, setAuditFilter] = useState("");
  const [showAudit, setShowAudit] = useState(false);

  const set = (k, v) => { setForm({ ...form, [k]: v }); setFormError(""); };

  const createUser = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError("Name is required.");
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setFormError("Enter a valid email address.");
    if (form.password.length < 8) return setFormError("The password must be at least 8 characters.");
    if (form.role !== "admin" && form.sections.length === 0) {
      return setFormError("Tick at least one section — an account with none cannot open anything.");
    }
    setBusy(true);
    const message = await attempt(async () => {
      await adminApi("create", {
        email: form.email.trim(), password: form.password, full_name: form.name.trim(),
        role: form.role, sections: form.sections,
      });
      await refresh();
    });
    setBusy(false);
    if (message) return setFormError(message);
    setCreated({ email: form.email.trim(), password: form.password });
    setForm(blank); setShowPassword(false);
  };

  const change = async (u, patch) => {
    const message = await attempt(async () => {
      await call("set_user_access", { p_user: u.id, p: patch });
      await refresh();
    });
    setPageError(message);
  };

  const toggleSection = (u, key) => {
    const held = new Set(u.sections || []);
    if (held.has(key)) held.delete(key); else held.add(key);
    change(u, { sections: ALL_SECTION_KEYS.filter((k) => held.has(k)) });
  };

  const savePassword = async () => {
    if (passwordFor.value.length < 8) return setPageError("The password must be at least 8 characters.");
    const message = await attempt(() => adminApi("set_password", { user_id: passwordFor.id, password: passwordFor.value }));
    setPageError(message);
    if (!message) { setCreated({ email: passwordFor.email, password: passwordFor.value, reset: true }); setPasswordFor(null); refresh(); }
  };

  const accessText = (u) => (u.role === "admin" ? "All sections"
    : SECTIONS.filter((s) => (u.sections || []).includes(s.key)).map((s) => s.label).join(", ") || "None");

  const userColumns = [
    { label: "Name", value: (u) => u.name, width: 26 },
    { label: "Email", value: (u) => u.email, width: 32 },
    { label: "Role", value: (u) => u.role, width: 10 },
    ...SECTIONS.map((s) => ({
      label: s.label, width: 12,
      value: (u) => (u.role === "admin" || (u.sections || []).includes(s.key) ? "Yes" : ""),
    })),
    { label: "Status", value: (u) => (u.active ? "Active" : "Deactivated"), width: 14 },
    { label: "Last sign-in", value: (u) => (u.lastLogin ? fmtWhen(u.lastLogin) : "never") },
  ];
  const auditColumns = [
    { label: "When (IST)", value: (a) => fmtWhen(a.at), width: 20 },
    { label: "User", value: (a) => a.user, width: 30 },
    { label: "Action", value: (a) => a.action, width: 26 },
    { label: "Detail", value: (a) => a.detail, width: 60 },
  ];

  const filteredAudit = store.audit.filter((a) =>
    !auditFilter || (a.action + " " + a.user + " " + (a.detail || "")).toLowerCase().includes(auditFilter.toLowerCase()));

  return (
    <div>
      <PageHead
        title="Users & access"
        blurb="Every toolbar section is its own grant. An account sees only the sections ticked for it; an admin holds all of them. Every change lands in the audit log."
      />

      {!isAdmin && (
        <div className={panel + " mb-6 flex items-start gap-3 p-4 text-sm text-[var(--muted)]"}>
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>You can see the accounts and the audit log. Adding an account, changing access or setting a password needs an administrator.</span>
        </div>
      )}

      {isAdmin && (
        <form onSubmit={createUser} className={card + " mb-6 p-6"}>
          <p className="mb-5 text-sm font-medium">Add a user</p>
          <div className="mb-6 grid gap-5 lg:grid-cols-4">
            <Field label="Name"><input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Email"><input type="email" className={input} value={form.email} autoComplete="off" onChange={(e) => set("email", e.target.value)} /></Field>
            <Field label="Password" hint="At least 8 characters">
              <span className="flex gap-2">
                <input type={showPassword ? "text" : "password"} className={input} value={form.password} autoComplete="new-password"
                  onChange={(e) => set("password", e.target.value)} />
                <button type="button" className={btnGhost + " shrink-0"} onClick={() => { set("password", generatePassword()); setShowPassword(true); }}>Generate</button>
              </span>
            </Field>
            <Field label="Role" hint={form.role === "admin" ? "An admin can open and change everything" : "Staff open only what is ticked below"}>
              <select className={input} value={form.role} onChange={(e) => set("role", e.target.value)}>
                <option value="staff">Staff (custom access)</option>
                <option value="admin">Admin (full access)</option>
              </select>
            </Field>
          </div>
          <SectionPicker value={form.sections} onChange={(v) => set("sections", v)} locked={form.role === "admin"} />
          <div className="mt-5 flex items-center justify-between">
            <span aria-live="polite" className={errText}>{formError}</span>
            <button type="submit" disabled={busy} className={btn}>{busy ? "Creating…" : "Create user"}</button>
          </div>
        </form>
      )}

      {created && (
        <div role="status" className={card + " mb-6 flex items-start justify-between gap-4 border-[var(--accent)]/40 p-5"}>
          <div>
            <p className="text-sm font-medium">{created.reset ? "Password updated for" : "Account created for"} {created.email}</p>
            <p className="mt-1 font-num text-lg text-[var(--accent)]">{created.password}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Shown once. Pass it on in person or by phone — not by email or chat — and ask them to change it from the key icon in the header after signing in.
            </p>
          </div>
          <button onClick={() => setCreated(null)} aria-label="Dismiss"><X className="h-4 w-4 text-[var(--muted)]" /></button>
        </div>
      )}

      <div aria-live="polite">{pageError && <p className={errText + " mb-4"}>{pageError}</p>}</div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-[var(--muted)]">
          {isAdmin ? "Click a section on someone's row to grant or revoke it. It takes effect at once — their toolbar changes without signing out." : ""}
        </p>
        <ExcelButton name="users" columns={userColumns} rows={store.users} />
      </div>
      <div className={card + " overflow-x-auto"}>
        <table className="w-full">
          <thead className="bg-[var(--panel)]">
            <tr>
              <th className={th}>Name</th><th className={th}>Email</th><th className={th}>Role</th>
              <th className={th}>Section access</th><th className={th}>Last sign-in</th>
              {isAdmin && <th className={th + " text-right"}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {store.users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--line)] align-top">
                <td className={td + " font-medium"}>{u.name}{u.id === user.id && <span className="ml-2 text-xs text-[var(--muted)]">you</span>}</td>
                <td className={td + " text-[var(--muted)]"}>{u.email}</td>
                <td className={td}>
                  {u.role === "admin" ? <Chip tone="accent">Admin</Chip> : <Chip>Staff</Chip>}
                  {!u.active && <span className="ml-2"><Chip tone="off">Deactivated</Chip></span>}
                </td>
                <td className={td}>
                  {u.role === "admin" ? <span className="text-xs text-[var(--muted)]">All sections</span> : (
                    <span className="flex max-w-md flex-wrap gap-1.5">
                      {SECTIONS.map((s) => {
                        const on = (u.sections || []).includes(s.key);
                        return isAdmin ? (
                          <button key={s.key} onClick={() => toggleSection(u, s.key)} aria-pressed={on}
                            title={(on ? "Revoke " : "Grant ") + s.label}>
                            <Chip tone={on ? "ok" : "off"}>{s.label}</Chip>
                          </button>
                        ) : (on ? <Chip key={s.key} tone="ok">{s.label}</Chip> : null);
                      })}
                      {!isAdmin && (u.sections || []).length === 0 && <span className="text-xs text-[var(--faint)]">None</span>}
                    </span>
                  )}
                </td>
                <td className={td + " text-xs text-[var(--muted)]"}>{u.lastLogin ? fmtWhen(u.lastLogin) : "never"}</td>
                {isAdmin && (
                  <td className={td + " text-right"}>
                    {passwordFor && passwordFor.id === u.id ? (
                      <span className="flex items-center justify-end gap-2">
                        <input type="text" aria-label={"New password for " + u.email} className={input + " w-44"} value={passwordFor.value}
                          onChange={(e) => setPasswordFor({ ...passwordFor, value: e.target.value })} />
                        <button onClick={() => setPasswordFor({ ...passwordFor, value: generatePassword() })} className="text-xs text-[var(--muted)]">Generate</button>
                        <button onClick={savePassword} className="text-xs text-[var(--accent)]">Save</button>
                        <button onClick={() => setPasswordFor(null)} className="text-xs text-[var(--muted)]">Cancel</button>
                      </span>
                    ) : (
                      <span className="flex items-center justify-end gap-4 whitespace-nowrap">
                        <button onClick={() => { setPageError(""); setPasswordFor({ id: u.id, email: u.email, value: "" }); }}
                          className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--text)]">
                          <KeyRound className="h-3 w-3" /> Set password
                        </button>
                        {u.id !== user.id && (
                          <React.Fragment>
                            <button onClick={() => change(u, u.role === "admin" ? { role: "staff", sections: [] } : { role: "admin" })}
                              className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
                              {u.role === "admin" ? "Make staff" : "Make admin"}
                            </button>
                            <button onClick={() => change(u, { active: !u.active })}
                              className="text-xs text-[var(--muted)] hover:text-[var(--status-danger)]">
                              {u.active ? "Deactivate" : "Reactivate"}
                            </button>
                          </React.Fragment>
                        )}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {store.users.length === 0 && (
              <tr><td colSpan={isAdmin ? 6 : 5} className="px-4 py-10 text-center text-sm text-[var(--muted)]">No accounts yet — add the first one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-4xl text-xs leading-relaxed text-[var(--muted)]">
        Note: raising a proforma picks its buyer from the party master, so a person who needs Proforma also needs Parties.
        Shipments can read proformas without the Proforma grant, because a shipment is always raised against one.
        Deactivating blocks an account at once without removing anything it created — accounts are never deleted, so the
        audit trail always has a name behind it.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <button onClick={() => setShowAudit(!showAudit)} aria-expanded={showAudit} className={btnGhost + " flex items-center gap-1.5"}>
          <History className="h-4 w-4" /> {showAudit ? "Hide" : "Show"} audit log
        </button>
        <ExcelButton name="audit-log" columns={auditColumns} rows={filteredAudit} />
      </div>

      {showAudit && (
        <div className="mt-5">
          <div className="mb-3 flex items-center gap-3">
            <input className={input + " max-w-sm"} placeholder="Filter by user, action or detail" aria-label="Filter the audit log"
              value={auditFilter} onChange={(e) => setAuditFilter(e.target.value)} />
            <span className="text-xs text-[var(--muted)]">Newest {store.audit.length} events. The log is append-only: no one can edit or remove an entry.</span>
          </div>
          <div className={card + " overflow-hidden"}>
            <table className="w-full">
              <thead className="bg-[var(--panel)]">
                <tr><th className={th}>When (IST)</th><th className={th}>User</th><th className={th}>Action</th><th className={th}>Detail</th></tr>
              </thead>
              <tbody>
                {filteredAudit.slice(0, 150).map((a) => (
                  <tr key={a.id} className="border-t border-[var(--line)] align-top">
                    <td className={td + " w-40 font-num text-xs text-[var(--muted)]"}>{fmtWhen(a.at)}</td>
                    <td className={td + " w-56 text-xs text-[var(--muted)]"}>{a.user}</td>
                    <td className={td + " w-56"}>{a.action}</td>
                    <td className={td + " text-xs text-[var(--muted)]"}>{a.detail}</td>
                  </tr>
                ))}
                {filteredAudit.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                    {auditFilter ? "Nothing matches that filter." : "Nothing has been logged yet."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

// Exported for tests/render.test.jsx, which draws every screen against sample data.
export {
  AppCtx, SignIn, Overview, PartiesPage, PartyForm, QuotationsPage, QuotationForm, QuotationDocument, ProformaDocument,
  ProformaPage, ProformaForm, ShipmentsPage, ShipmentForm, ShipmentDocuments, AnalyticsPage, CompanyPage, UsersPage,
  ChangePasswordDialog, CommandPalette,
};
