/* =====================================================================
   Das Superfoods — Export console
   Single-file build. This source is embedded in Das-Superfoods-ERP.html
   and compiled in the browser, so it can be edited in place.
   ===================================================================== */

const { useState, useMemo, useEffect, useRef, useContext, createContext } = React;

/* ---------------------------------------------------------------- icons */
const ICON_DATA = window.__LUCIDE_ICONS__ || {};
function mkIcon(key) {
  const inner = ICON_DATA[key] || '<circle cx="12" cy="12" r="9" />';
  function Icon({ className = "", size = 24, ...rest }) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className={("lucide " + className).trim()}
        dangerouslySetInnerHTML={{ __html: inner }}
        {...rest}
      />
    );
  }
  return Icon;
}

const Users = mkIcon("users");
const FileText = mkIcon("file-text");
const ClipboardList = mkIcon("clipboard-list");
const Receipt = mkIcon("receipt");
const Building2 = mkIcon("building-2");
const Ship = mkIcon("ship");
const Lock = mkIcon("lock");
const Plus = mkIcon("plus");
const X = mkIcon("x");
const ChevronRight = mkIcon("chevron-right");
const Check = mkIcon("check");
const Trash2 = mkIcon("trash-2");
const ShieldCheck = mkIcon("shield-check");
const Boxes = mkIcon("boxes");
const KeyRound = mkIcon("key-round");
const History = mkIcon("history");
const Download = mkIcon("download");
const Upload = mkIcon("upload");
const TriangleAlert = mkIcon("triangle-alert");
const Search = mkIcon("search");
const Sun = mkIcon("sun");
const Moon = mkIcon("moon");

/* ------------------------------------------------------------- styling */
const card = "rounded-xl border border-[var(--line)] bg-[var(--card)]";
const panel = "rounded-xl border border-[var(--line)] bg-[var(--panel)]";
const input = "w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--faint)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50";
const btn = "rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40";
const btnGhost = "rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--muted)]";
const th = "px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]";
const td = "px-4 py-3 text-sm";
const label = "block text-sm font-medium text-[var(--text)] mb-2";
const errText = "text-sm text-[var(--danger)]";

function Field({ label: labelText, children, className = "", hint }) {
  return (
    <label className={"block " + className}>
      <span className={label}>{labelText}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

function Chip({ children, tone = "neutral" }) {
  const tones = {
    neutral: "border-[var(--line)] text-[var(--muted)]",
    accent: "border-[var(--accent)]/40 text-[var(--accent)]",
    ok: "border-emerald-500/40 text-emerald-400",
    warn: "border-amber-500/40 text-amber-400",
    off: "border-[var(--line)] text-[var(--faint)]",
  };
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] ${tones[tone]}`}>{children}</span>;
}

function PageHead({ title, blurb }) {
  return (
    <div className="mb-8">
      <h1 className="font-serif text-3xl tracking-tight text-[var(--text)]">{title}</h1>
      {blurb && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">{blurb}</p>}
    </div>
  );
}

/* -------------------------------------------------------------- helpers */
const CURRENCY_SYMBOL = { USD: "$", INR: "₹" };

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function chunkToWords(n) {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + chunkToWords(n % 100) : "");
}

function numberToWords(value) {
  const num = Math.round(Number(value) || 0);
  if (num === 0) return "zero";
  const parts = [];
  let rem = num;
  const billions = Math.floor(rem / 1e9); rem %= 1e9;
  const millions = Math.floor(rem / 1e6); rem %= 1e6;
  const thousands = Math.floor(rem / 1e3); rem %= 1e3;
  if (billions) parts.push(chunkToWords(billions) + " billion");
  if (millions) parts.push(chunkToWords(millions) + " million");
  if (thousands) parts.push(chunkToWords(thousands) + " thousand");
  if (rem) parts.push(chunkToWords(rem));
  return parts.join(" ");
}

function fmtMoney(value, currency) {
  const n = Math.round((Number(value) || 0) * 100) / 100;
  return `${CURRENCY_SYMBOL[currency] || ""}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(value, digits = 2) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const uid = () => Math.random().toString(36).slice(2, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();
const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString(); } catch (e) { return iso; } };


/* ------------------------------------------------------ supabase client */
const SUPABASE_URL = "https://jvpziatizbaghxhyslrg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2cHppYXRpemJhZ2h4aHlzbHJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1OTMxMDQsImV4cCI6MjEwNDE2OTEwNH0.v0eTuaSb040cPFDyGLMU4v8epUSj0OUDV7KtADuxcTY";
const THEME_KEY = "das-superfoods-erp/theme";

// The anon key is meant to be public: every request it makes is still filtered
// by the row-level security policies in the database.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/* ------------------------------------------------ row to object mapping */
/* The database speaks snake_case; the screens speak camelCase. Keeping the
   translation here means no component has to know about the database.    */
const num = (v) => Number(v) || 0;

const partyFromRow = (r, products) => ({
  id: r.id, type: r.type,
  buyerName: r.buyer_name, buyerAddress: r.buyer_address,
  consigneeName: r.consignee_name, consigneeAddress: r.consignee_address,
  consigneeOptions: r.consignee_options || [],
  country: r.country, currency: r.currency,
  shipmentTerm: r.shipment_term, paymentTerm: r.payment_term, conditions: r.conditions,
  portOfLoading: r.port_of_loading, destinationPort: r.destination_port,
  products: (products || []).map((p) => ({
    id: p.id, name: p.name, hsn: p.hsn,
    rate: num(p.rate), mrp: num(p.mrp),
    netWt: num(p.net_wt), grossWt: num(p.gross_wt),
    packsPerBox: num(p.packs_per_box), weightPerPackG: num(p.weight_per_pack_g),
  })),
});

const partyToRow = (p) => ({
  type: p.type,
  buyer_name: p.buyerName, buyer_address: p.buyerAddress,
  consignee_name: p.consigneeName, consignee_address: p.consigneeAddress,
  consignee_options: p.consigneeOptions || [],
  country: p.country, currency: p.currency,
  shipment_term: p.shipmentTerm, payment_term: p.paymentTerm, conditions: p.conditions,
  port_of_loading: p.portOfLoading, destination_port: p.destinationPort,
});

const productToRow = (partyId, p) => ({
  party_id: partyId, name: p.name, hsn: p.hsn,
  rate: num(p.rate), mrp: num(p.mrp),
  net_wt: num(p.netWt), gross_wt: num(p.grossWt),
  packs_per_box: num(p.packsPerBox), weight_per_pack_g: num(p.weightPerPackG),
});

const quotationFromRow = (r) => ({
  id: r.id, docNo: r.doc_no, date: r.doc_date, partyId: r.party_id,
  buyerName: r.buyer_name, buyerAddress: r.buyer_address, country: r.country,
  shipmentTerm: r.shipment_term, paymentTerm: r.payment_term,
  igst: r.igst, igstRate: num(r.igst_rate),
  totalValue: num(r.total_value), igstAmt: num(r.igst_amount), grandTotal: num(r.grand_total),
  items: r.items || [],
});

const quotationToRow = (q) => ({
  doc_no: q.docNo, doc_date: q.date, party_id: q.partyId || null,
  buyer_name: q.buyerName, buyer_address: q.buyerAddress || "", country: q.country,
  shipment_term: q.shipmentTerm, payment_term: q.paymentTerm || "",
  igst: Boolean(q.igst), igst_rate: num(q.igstRate),
  total_value: num(q.totalValue), igst_amount: num(q.igstAmt), grand_total: num(q.grandTotal),
  items: q.items || [],
});

const proformaFromRow = (r) => ({
  id: r.id, docNo: r.doc_no, date: r.doc_date, type: r.type, partyId: r.party_id,
  quotationRef: r.quotation_ref,
  buyerName: r.buyer_name, buyerAddress: r.buyer_address,
  consigneeName: r.consignee_name, consigneeAddress: r.consignee_address,
  consigneeOptions: r.consignee_options || [],
  portOfLoading: r.port_of_loading, destinationPort: r.destination_port,
  shipmentTerm: r.shipment_term, paymentTerm: r.payment_term, conditions: r.conditions,
  currency: r.currency, buyerOrderNo: r.order_no, buyerOrderDate: r.order_date,
  additionalDetails: r.additional_details,
  totalBoxes: r.total_boxes, totalValue: num(r.total_value), taxableValue: num(r.taxable_value),
  taxRate: num(r.tax_rate), taxAmount: num(r.tax_amount), grandTotal: num(r.grand_total),
  items: r.items || [],
  linkedFinalInvoiceId: r.shipment_id,
});

const proformaToRow = (p) => ({
  doc_no: p.docNo, doc_date: p.date, type: p.type, party_id: p.partyId || null,
  quotation_ref: p.quotationRef || "",
  buyer_name: p.buyerName, buyer_address: p.buyerAddress,
  consignee_name: p.consigneeName, consignee_address: p.consigneeAddress,
  consignee_options: p.consigneeOptions || [],
  port_of_loading: p.portOfLoading, destination_port: p.destinationPort,
  shipment_term: p.shipmentTerm, payment_term: p.paymentTerm, conditions: p.conditions,
  currency: p.currency, order_no: p.buyerOrderNo || "", order_date: p.buyerOrderDate || null,
  additional_details: p.additionalDetails || "",
  total_boxes: p.totalBoxes || 0, total_value: num(p.totalValue), taxable_value: num(p.taxableValue),
  tax_rate: num(p.taxRate), tax_amount: num(p.taxAmount), grand_total: num(p.grandTotal),
  items: p.items || [],
});

const shipmentFromRow = (r) => ({
  id: r.id, docNo: r.doc_no, taxDocNo: r.tax_doc_no, commercialDocNo: r.commercial_doc_no,
  date: r.doc_date, piId: r.proforma_id, piNo: r.proforma_no, piDate: r.proforma_date,
  buyerName: r.buyer_name, buyerAddress: r.buyer_address,
  orderNo: r.order_no, orderDate: r.order_date,
  exchangeRate: r.exchange_rate, containerNo: r.container_no, vehicleNo: r.vehicle_no,
  customSeal: r.customs_seal, lineSeal: r.line_seal,
  portOfLoading: r.port_of_loading, incoterm: r.incoterm,
  gstPercent: r.gst_percent, roundOff: r.round_off, freight: r.freight,
  otherAdj: r.other_adjustment, otherReason: r.other_reason,
  taxInvoice: r.tax_invoice || {}, commercialInvoice: r.commercial_invoice || {},
  packingList: r.packing_list || {}, company: r.company_snapshot || {},
  items: r.items || [],
});

const shipmentToRow = (s) => ({
  doc_no: s.docNo, tax_doc_no: s.taxDocNo, commercial_doc_no: s.commercialDocNo,
  doc_date: s.date, proforma_id: s.piId, proforma_no: s.piNo, proforma_date: s.piDate,
  buyer_name: s.buyerName, buyer_address: s.buyerAddress || "",
  order_no: s.orderNo || "", order_date: s.orderDate || null,
  exchange_rate: num(s.exchangeRate) || 1, container_no: s.containerNo, vehicle_no: s.vehicleNo,
  customs_seal: s.customSeal, line_seal: s.lineSeal,
  port_of_loading: s.portOfLoading, incoterm: s.incoterm,
  gst_percent: num(s.gstPercent), round_off: num(s.roundOff), freight: num(s.freight),
  other_adjustment: num(s.otherAdj), other_reason: s.otherReason || "",
  tax_invoice: s.taxInvoice || {}, commercial_invoice: s.commercialInvoice || {},
  packing_list: s.packingList || {}, company_snapshot: s.company || {},
  items: s.items || [],
});

const companyFromRow = (r) => ({
  name: r.name, address: r.address, bankName: r.bank_name, accountNo: r.account_no,
  ifsc: r.ifsc, swift: r.swift, gstNo: r.gst_no, iecCode: r.iec_code,
});

const companyToRow = (c) => ({
  name: c.name, address: c.address, bank_name: c.bankName, account_no: c.accountNo,
  ifsc: c.ifsc, swift: c.swift, gst_no: c.gstNo, iec_code: c.iecCode,
  updated_at: new Date().toISOString(),
});

const userFromRow = (r) => ({
  id: r.id, name: r.full_name || r.email, email: r.email, role: r.role,
  access: { documents: r.access_documents, parties: r.access_parties, company: r.access_company },
  active: r.active, createdAt: r.created_at, lastLogin: r.last_login,
});

const auditFromRow = (r) => ({ id: r.id, at: r.at, user: r.actor, action: r.action, detail: r.detail });

/* ----------------------------------------------------------- data access */
const EMPTY_STORE = {
  users: [],
  company: { name: "", address: "", bankName: "", accountNo: "", ifsc: "", swift: "", gstNo: "", iecCode: "" },
  parties: [], quotations: [], pis: [], finalInvoices: [], audit: [],
};

// One pass that rebuilds everything the screens expect. Anything this user is
// not allowed to see comes back empty because the database filters it — the
// interface is not what is keeping them out.
async function fetchStore(profile) {
  const out = JSON.parse(JSON.stringify(EMPTY_STORE));
  const isAdmin = profile.role === "admin";
  const canParties = isAdmin || profile.access.parties;
  const canDocs = isAdmin || profile.access.documents;
  const canCompany = isAdmin || profile.access.company;
  const jobs = [];

  if (canParties) {
    jobs.push((async () => {
      const [parties, products] = await Promise.all([
        sb.from("parties").select("*").order("created_at", { ascending: true }),
        sb.from("party_products").select("*"),
      ]);
      const byParty = {};
      (products.data || []).forEach((p) => { (byParty[p.party_id] = byParty[p.party_id] || []).push(p); });
      out.parties = (parties.data || []).map((r) => partyFromRow(r, byParty[r.id]));
    })());
  }

  if (canDocs) {
    jobs.push((async () => {
      const { data } = await sb.from("quotations").select("*").order("created_at", { ascending: false });
      out.quotations = (data || []).map(quotationFromRow);
    })());
    jobs.push((async () => {
      const { data } = await sb.from("proformas").select("*").order("created_at", { ascending: false });
      out.pis = (data || []).map(proformaFromRow);
    })());
    jobs.push((async () => {
      const { data } = await sb.from("shipments").select("*").order("created_at", { ascending: false });
      out.finalInvoices = (data || []).map(shipmentFromRow);
    })());
  }

  if (canCompany) {
    jobs.push((async () => {
      const { data } = await sb.from("company_profile").select("*").eq("id", 1).maybeSingle();
      if (data) out.company = companyFromRow(data);
    })());
  }

  jobs.push((async () => {
    const q = isAdmin
      ? sb.from("profiles").select("*").order("created_at", { ascending: true })
      : sb.from("profiles").select("*").eq("id", profile.id);
    const { data } = await q;
    out.users = (data || []).map(userFromRow);
  })());

  if (isAdmin) {
    jobs.push((async () => {
      const { data } = await sb.from("audit_log").select("*").order("at", { ascending: false }).limit(200);
      out.audit = (data || []).map(auditFromRow);
    })());
  }

  await Promise.all(jobs);
  return out;
}

async function writeAudit(actor, action, detail) {
  // The log must never block the work it is recording.
  try { await sb.from("audit_log").insert({ actor, action, detail: detail || "" }); } catch (e) { /* ignore */ }
}

async function nextDocNo(seriesKey) {
  const { data, error } = await sb.rpc("next_doc_no", { series_key: seriesKey });
  if (error) throw new Error("Could not allocate a document number: " + error.message);
  return data;
}

/* --------------------------------------------------------------- access */
/* One core Admin role, plus staff accounts granted individual sections.   */
const ACCESS_KEYS = [
  { key: "documents", label: "Documents", note: "quotations, proforma invoices and shipments" },
  { key: "parties", label: "Party master", note: "buyer, consignee, product and pricing records" },
  { key: "company", label: "Company profile", note: "registered details and bank particulars" },
];

const NAV = [
  { key: "overview", label: "Overview" },
  { key: "parties", label: "Parties", needs: "parties" },
  { key: "quotations", label: "Quotations", needs: "documents" },
  { key: "proforma", label: "Proforma", needs: "documents" },
  { key: "shipments", label: "Shipments", needs: "documents" },
  { key: "analytics", label: "Analytics", needs: "documents" },
  { key: "company", label: "Company", needs: "company" },
  { key: "users", label: "Users", adminOnly: true },
];

/* ------------------------------------------------------------- app ctx */
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

function diffObject(before, after, keys) {
  const out = [];
  keys.forEach((k) => {
    const a = before[k] === undefined || before[k] === null ? "" : String(before[k]);
    const b = after[k] === undefined || after[k] === null ? "" : String(after[k]);
    if (a !== b) out.push(`${k}: "${a}" → "${b}"`);
  });
  return out;
}

const PARTY_KEYS = ["buyerName", "buyerAddress", "consigneeName", "consigneeAddress", "country",
  "currency", "shipmentTerm", "paymentTerm", "conditions", "portOfLoading", "destinationPort"];
const PRODUCT_KEYS = ["name", "hsn", "rate", "mrp", "netWt", "grossWt", "packsPerBox", "weightPerPackG"];
const COMPANY_KEYS = ["name", "address", "bankName", "accountNo", "ifsc", "swift", "gstNo", "iecCode"];

function diffParty(before, after) {
  const out = diffObject(before, after, PARTY_KEYS);
  const oldById = {};
  (before.products || []).forEach((p) => { oldById[p.id] = p; });
  (after.products || []).forEach((p) => {
    const prev = oldById[p.id];
    if (!prev) { out.push(`product added: ${p.name || "(unnamed)"}`); return; }
    PRODUCT_KEYS.forEach((k) => {
      if (String(prev[k] ?? "") !== String(p[k] ?? "")) out.push(`${p.name} — ${k}: ${prev[k] ?? ""} → ${p[k] ?? ""}`);
    });
  });
  const kept = new Set((after.products || []).map((p) => p.id));
  (before.products || []).forEach((p) => { if (!kept.has(p.id)) out.push(`product removed: ${p.name}`); });
  return out;
}

/* --------------------------------------------------------------- login */
function SignIn({ onSignIn, onSignUp, onReset, notice }) {
  const [mode, setMode] = useState("in");           // in | up | forgot
  const [fullName, setFullName] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSent(""); setBusy(true);
    try {
      if (mode === "in") {
        const msg = await onSignIn(emailValue.trim(), password);
        if (msg) setError(msg);
      } else if (mode === "up") {
        const msg = await onSignUp(emailValue.trim(), password, fullName.trim());
        if (msg && msg.error) setError(msg.error);
        else if (msg && msg.info) setSent(msg.info);
      } else {
        const msg = await onReset(emailValue.trim());
        setSent(msg || "If that address has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    }
    setBusy(false);
  };

  const tab = (key, label) => (
    <button type="button" onClick={() => { setMode(key); setError(""); setSent(""); }}
      className={`pb-2 text-sm ${mode === key ? "border-b-2 border-[var(--accent)] text-[var(--text)]" : "text-[var(--muted)]"}`}>
      {label}
    </button>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-serif text-2xl tracking-tight text-[var(--text)]">Das Superfoods</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Export console</p>
        </div>

        <form onSubmit={submit} className={card + " p-6"}>
          <div className="mb-5 flex gap-5 border-b border-[var(--line)]">
            {tab("in", "Sign in")}
            {tab("up", "Create account")}
          </div>

          {mode === "up" && (
            <Field label="Full name" className="mb-4">
              <input className={input} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
          )}

          <Field label="Work email" className="mb-4">
            <input type="email" className={input} value={emailValue} autoComplete="username"
              onChange={(e) => { setEmailValue(e.target.value); setError(""); }} />
          </Field>

          {mode !== "forgot" && (
            <Field label="Password" className="mb-5" hint={mode === "up" ? "At least 8 characters" : null}>
              <input type="password" className={input} value={password}
                autoComplete={mode === "up" ? "new-password" : "current-password"}
                onChange={(e) => { setPassword(e.target.value); setError(""); }} />
            </Field>
          )}

          {error && <p className={errText + " mb-4"}>{error}</p>}
          {sent && <p className="mb-4 text-sm text-emerald-400">{sent}</p>}
          {notice && !error && !sent && <p className="mb-4 text-xs text-[var(--muted)]">{notice}</p>}

          <button type="submit" disabled={busy} className={btn + " w-full"}>
            {busy ? "Working…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}
          </button>

          <button type="button" onClick={() => { setMode(mode === "forgot" ? "in" : "forgot"); setError(""); setSent(""); }}
            className="mt-3 w-full text-xs text-[var(--muted)] hover:text-[var(--text)]">
            {mode === "forgot" ? "Back to sign in" : "Forgotten your password?"}
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-[var(--faint)]">
          New accounts start with no access to any section. An administrator grants them under Users &amp; access.
        </p>
      </div>
    </div>
  );
}

function NoAccess({ profile, onSignOut }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6">
      <div className={card + " w-full max-w-md p-6 text-center"}>
        <Lock className="mx-auto mb-3 h-6 w-6 text-[var(--muted)]" />
        <p className="font-serif text-xl">Waiting for access</p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          Your account <span className="text-[var(--text)]">{profile.email}</span> is created, but no sections have been
          granted to it yet. An administrator needs to tick your permissions under Users &amp; access.
        </p>
        <button onClick={onSignOut} className={btnGhost + " mt-5"}>Sign out</button>
      </div>
    </div>
  );
}
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
  store.parties.forEach((p) => { if (match(p.buyerName) || match(p.country)) results.push({ kind: "Party", label: p.buyerName, meta: p.country, go: "parties" }); });
  store.quotations.forEach((x) => { if (match(x.docNo) || match(x.buyerName)) results.push({ kind: "Quotation", label: x.docNo, meta: x.buyerName, go: "quotations" }); });
  store.pis.forEach((x) => { if (match(x.docNo) || match(x.buyerName)) results.push({ kind: "Proforma", label: x.docNo, meta: x.buyerName, go: "proforma" }); });
  store.finalInvoices.forEach((x) => { if (match(x.docNo) || match(x.buyerName)) results.push({ kind: "Shipment", label: x.docNo, meta: x.buyerName, go: "shipments" }); });

  const pick = (r) => { onNavigate(r.go); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-24" onMouseDown={(e) => { if (e.target === boxRef.current) onClose(); }} ref={boxRef}>
      <div className={card + " w-full max-w-lg overflow-hidden"} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4">
          <Search className="h-4 w-4 text-[var(--muted)]" />
          <input
            autoFocus value={q} placeholder="Search sections, parties, document numbers…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && results.length) pick(results[0]);
            }}
            className="w-full bg-transparent py-3.5 text-sm text-[var(--text)] placeholder:text-[var(--faint)] focus:outline-none"
          />
          <kbd className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">esc</kbd>
        </div>
        <div className="max-h-80 overflow-auto py-2">
          {results.slice(0, 30).map((r, i) => (
            <button key={i} onClick={() => pick(r)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-[var(--field)]">
              <span className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-[var(--faint)]">{r.kind}</span>
              <span className="text-sm text-[var(--text)]">{r.label}</span>
              {r.meta && <span className="text-xs text-[var(--muted)]">{r.meta}</span>}
            </button>
          ))}
          {results.length === 0 && <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">Nothing matches “{q}”.</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ app */
function App() {
  const [session, setSession] = useState(undefined);   // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [store, setStore] = useState(EMPTY_STORE);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState("overview");
  const [theme, setTheme] = useState(() => { try { return window.localStorage.getItem(THEME_KEY) || "dark"; } catch (e) { return "dark"; } });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notice, setNotice] = useState("");

  /* --- theme ------------------------------------------------------- */
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    try { window.localStorage.setItem(THEME_KEY, theme); } catch (e) { /* not fatal */ }
  }, [theme]);

  /* --- auth session ------------------------------------------------ */
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  /* --- profile for the signed-in user ------------------------------ */
  useEffect(() => {
    if (!session) { setProfile(null); setStore(EMPTY_STORE); return; }
    let cancelled = false;
    (async () => {
      const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (cancelled) return;
      setProfile(data ? userFromRow(data) : null);
    })();
    return () => { cancelled = true; };
  }, [session]);

  /* --- the data itself, plus live updates -------------------------- */
  const refresh = React.useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try { setStore(await fetchStore(profile)); }
    catch (e) { setNotice("Could not load data: " + (e.message || e)); }
    setLoading(false);
  }, [profile]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!profile) return;
    // Anything anyone changes lands here, so two people working at once stay
    // in step without reloading. RLS still applies to what each client gets.
    const channel = sb.channel("console-changes");
    ["parties", "party_products", "quotations", "proformas", "shipments", "company_profile", "profiles", "audit_log"]
      .forEach((table) => channel.on("postgres_changes", { event: "*", schema: "public", table }, () => refresh()));
    channel.subscribe();
    return () => { sb.removeChannel(channel); };
  }, [profile, refresh]);

  /* --- auth actions ------------------------------------------------ */
  const signIn = async (email, password) => {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      writeAudit(email, "Sign-in failed", error.message);
      return error.message === "Invalid login credentials"
        ? "That email and password do not match an account."
        : error.message;
    }
    writeAudit(email, "Signed in", "");
    await sb.from("profiles").update({ last_login: new Date().toISOString() }).eq("email", email);
    setActive("overview");
    return "";
  };

  const signUp = async (email, password, fullName) => {
    if (password.length < 8) return { error: "Use at least 8 characters." };
    const { data, error } = await sb.auth.signUp({
      email, password, options: { data: { full_name: fullName || email } },
    });
    if (error) return { error: error.message };
    if (data.session) { writeAudit(email, "Account created", fullName); return {}; }
    return { info: "Account created. Check your email for the confirmation link, then sign in." };
  };

  const resetPassword = async (email) => {
    await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    return "If that address has an account, a reset link is on its way.";
  };

  const signOut = async () => {
    if (profile) writeAudit(profile.email, "Signed out", "");
    await sb.auth.signOut();
  };

  const audit = (action, detail) => {
    writeAudit(profile ? profile.email : "—", action, detail);
  };

  const can = (needs) => {
    if (!profile) return false;
    if (profile.role === "admin") return true;
    if (!needs) return true;
    return Boolean((profile.access || {})[needs]);
  };

  /* --- gates ------------------------------------------------------- */
  if (session === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-sm text-[var(--muted)]">Connecting…</div>;
  }
  if (!session) {
    return <SignIn onSignIn={signIn} onSignUp={signUp} onReset={resetPassword} notice={notice} />;
  }
  if (!profile) {
    return <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-sm text-[var(--muted)]">Loading your profile…</div>;
  }
  if (!profile.active) {
    return <NoAccess profile={{ email: profile.email + " (deactivated)" }} onSignOut={signOut} />;
  }
  if (profile.role !== "admin" && !profile.access.documents && !profile.access.parties && !profile.access.company) {
    return <NoAccess profile={profile} onSignOut={signOut} />;
  }

  const user = profile;
  const sections = NAV.filter((n) => (n.adminOnly ? user.role === "admin" : can(n.needs)));
  const current = sections.find((s) => s.key === active) || sections[0];
  const ctx = { store, refresh, user, can, audit, loading };

  return (
    <AppCtx.Provider value={ctx}>
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <header className="border-b border-[var(--line)]">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 pt-5">
            <div className="flex items-baseline gap-3">
              <span className="font-serif text-xl font-semibold tracking-tight">Das Superfoods</span>
              <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Export console</span>
            </div>
            <div className="flex items-center gap-2">
              {loading && <span className="text-xs text-[var(--muted)]">syncing…</span>}
              <button onClick={() => setPaletteOpen(true)} className="flex items-center gap-6 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)]">
                Search <kbd className="text-xs">⌘K</kbd>
              </button>
              <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Switch theme"
                className="rounded-lg border border-[var(--line)] p-2 text-[var(--muted)] hover:text-[var(--text)]">
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <span className="px-2 text-sm text-[var(--muted)]">
                {user.name.split(" ")[0]} · <span className="text-[var(--text)]">{user.role}</span>
              </span>
              <button onClick={signOut} className={btnGhost}>Sign out</button>
            </div>
          </div>
          <nav className="mx-auto flex max-w-7xl gap-7 px-6">
            {sections.map((s) => (
              <button key={s.key} onClick={() => setActive(s.key)}
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

        <main className="mx-auto max-w-7xl px-6 py-10">
          {notice && (
            <div className="mb-8 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}
          {current && current.key === "overview" && <Overview onNavigate={setActive} />}
          {current && current.key === "parties" && <PartiesPage />}
          {current && current.key === "quotations" && <QuotationsPage />}
          {current && current.key === "proforma" && <ProformaPage />}
          {current && current.key === "shipments" && <ShipmentsPage />}
          {current && current.key === "analytics" && <AnalyticsPage />}
          {current && current.key === "company" && <CompanyPage />}
          {current && current.key === "users" && <UsersPage />}
        </main>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={setActive} sections={sections} />
      </div>
    </AppCtx.Provider>
  );
}
/* ------------------------------------------------------------- overview */
function Stat({ label: text, value, hint }) {
  return (
    <div className={card + " p-5"}>
      <p className="font-serif text-3xl text-[var(--text)]">{value}</p>
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
        {can("parties") && <Stat label="Parties on file" value={store.parties.length} />}
        {can("documents") && <Stat label="Quotations" value={store.quotations.length} />}
        {can("documents") && <Stat label="Open proforma" value={openPis.length} hint="awaiting a shipment" />}
        {can("documents") && <Stat label="Shipments invoiced" value={store.finalInvoices.length} />}
      </div>

      {can("documents") && openPis.length > 0 && (
        <div className={card + " overflow-hidden"}>
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
            <p className="font-serif text-lg">Awaiting shipment</p>
            <button onClick={() => onNavigate("shipments")} className="flex items-center gap-1 text-sm text-[var(--accent)]">
              Go to shipments <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <table className="w-full">
            <thead className="bg-[var(--panel)]">
              <tr><th className={th}>Document</th><th className={th}>Buyer</th><th className={th}>Value</th></tr>
            </thead>
            <tbody>
              {openPis.map((pi) => (
                <tr key={pi.id} className="border-t border-[var(--line)]">
                  <td className={td + " font-mono text-xs"}>{pi.docNo}</td>
                  <td className={td}>{pi.buyerName}</td>
                  <td className={td}>{fmtMoney(pi.grandTotal ?? pi.totalValue, pi.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {user.role === "admin" && store.audit.length > 0 && (
        <div className={card + " mt-6 p-5"}>
          <p className="mb-4 font-serif text-lg">Recent activity</p>
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
  const add = () => setProducts([...products, { id: uid(), name: "", hsn: "", rate: 0, mrp: 0, netWt: 0, grossWt: 0, packsPerBox: 1, weightPerPackG: 0 }]);
  return (
    <div className={panel + " overflow-x-auto"}>
      <table className="w-full">
        <thead>
          <tr>
            <th className={th}>Product</th><th className={th}>HSN</th>
            <th className={th}>{mode === "international" ? "Rate / box" : "MRP / box"}</th>
            <th className={th}>Net wt</th><th className={th}>Gross wt</th>
            <th className={th}>Packs / box</th><th className={th}>g / pack</th><th></th>
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
              <td className="px-2 py-1.5"><input type="number" step="0.001" className={input} value={p.netWt} onChange={(e) => update(p.id, "netWt", e.target.value)} /></td>
              <td className="px-2 py-1.5"><input type="number" step="0.001" className={input} value={p.grossWt} onChange={(e) => update(p.id, "grossWt", e.target.value)} /></td>
              <td className="px-2 py-1.5"><input type="number" className={input} value={p.packsPerBox} onChange={(e) => update(p.id, "packsPerBox", e.target.value)} /></td>
              <td className="px-2 py-1.5"><input type="number" className={input} value={p.weightPerPackG} onChange={(e) => update(p.id, "weightPerPackG", e.target.value)} /></td>
              <td className="px-2">
                <button onClick={() => setProducts(products.filter((x) => x.id !== p.id))}><Trash2 className="h-4 w-4 text-[var(--muted)] hover:text-[var(--danger)]" /></button>
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
    consigneeOptions: [],
  });
  const [products, setProducts] = useState(initial ? initial.products : []);
  const set = (k, v) => setF({ ...f, [k]: v });

  return (
    <div className={card + " mb-6 p-6"}>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="font-serif text-lg">{isEdit ? "Edit" : "New"} {tab === "international" ? "international" : "private-label"} party</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Editing later only affects future documents — anything already issued keeps the values it was created with. Changes land in the audit log.
          </p>
        </div>
        <button onClick={onCancel}><X className="h-4 w-4 text-[var(--muted)]" /></button>
      </div>
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Field label="Buyer name"><input className={input} value={f.buyerName} onChange={(e) => set("buyerName", e.target.value)} /></Field>
        <Field label="Buyer address" className="md:col-span-2"><input className={input} value={f.buyerAddress} onChange={(e) => set("buyerAddress", e.target.value)} /></Field>
        <Field label="Consignee name"><input className={input} value={f.consigneeName} onChange={(e) => set("consigneeName", e.target.value)} /></Field>
        <Field label="Consignee address" className="md:col-span-2"><input className={input} value={f.consigneeAddress} onChange={(e) => set("consigneeAddress", e.target.value)} /></Field>
        <Field label="Country"><input className={input} value={f.country} onChange={(e) => set("country", e.target.value)} /></Field>
        <Field label="Currency">
          <select className={input} value={f.currency} onChange={(e) => set("currency", e.target.value)}>
            <option value="USD">USD</option><option value="INR">INR</option>
          </select>
        </Field>
        <Field label="Shipment term"><input className={input} placeholder="FOB / CIF / CNF" value={f.shipmentTerm} onChange={(e) => set("shipmentTerm", e.target.value)} /></Field>
        <Field label="Payment term" className="md:col-span-2"><input className={input} value={f.paymentTerm} onChange={(e) => set("paymentTerm", e.target.value)} /></Field>
        <Field label="Conditions"><input className={input} value={f.conditions} onChange={(e) => set("conditions", e.target.value)} /></Field>
        {tab === "international" && (
          <React.Fragment>
            <Field label="Port of loading"><input className={input} value={f.portOfLoading} onChange={(e) => set("portOfLoading", e.target.value)} /></Field>
            <Field label="Destination port"><input className={input} value={f.destinationPort} onChange={(e) => set("destinationPort", e.target.value)} /></Field>
          </React.Fragment>
        )}
      </div>
      <p className="mb-2 text-sm font-medium">Products</p>
      <ProductRows products={products} setProducts={setProducts} mode={tab} />
      <div className="mt-5 flex justify-end gap-3">
        <button onClick={onCancel} className={btnGhost}>Cancel</button>
        <button
          onClick={() => {
            const consigneeOptions = Array.from(new Set([...(f.consigneeOptions || []), f.consigneeName].filter(Boolean)));
            onSave(isEdit ? { ...f, products, consigneeOptions } : { id: uid(), ...f, products, consigneeOptions });
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
  const { store, refresh, audit } = useApp();
  const [tab, setTab] = useState("international");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [saveError, setSaveError] = useState("");

  const filtered = store.parties.filter((p) => p.type === tab);
  const editing = store.parties.find((p) => p.id === editingId);

  // A party and its product lines are saved together: write the party, then
  // replace its product rows outright. Simpler than diffing, and the list is
  // always short.
  const saveParty = async (p, isEdit) => {
    setSaveError("");
    try {
      let partyId = p.id;
      if (isEdit) {
        const { error } = await sb.from("parties").update(partyToRow(p)).eq("id", partyId);
        if (error) throw error;
        const del = await sb.from("party_products").delete().eq("party_id", partyId);
        if (del.error) throw del.error;
      } else {
        const { data, error } = await sb.from("parties").insert(partyToRow(p)).select("id").single();
        if (error) throw error;
        partyId = data.id;
      }
      const rows = (p.products || []).filter((x) => x.name).map((x) => productToRow(partyId, x));
      if (rows.length) {
        const { error } = await sb.from("party_products").insert(rows);
        if (error) throw error;
      }
      await refresh();
      return true;
    } catch (e) {
      setSaveError(e.message || String(e));
      return false;
    }
  };

  const deleteParty = async (p) => {
    setSaveError("");
    const { error } = await sb.from("parties").delete().eq("id", p.id);
    if (error) { setSaveError(error.message); return; }
    audit("Party deleted", p.buyerName);
    setConfirmId(null);
    await refresh();
  };

  return (
    <div>
      <PageHead title="Parties" blurb="Buyer, consignee, terms, ports and per-product pricing. Everything downstream reads from here." />

      <div className="mb-5 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-[var(--line)] p-1">
          {[["international", "International"], ["domestic", "Private label / India"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? "bg-[var(--field)] text-[var(--text)]" : "text-[var(--muted)]"}`}>{l}</button>
          ))}
        </div>
        <button onClick={() => { setEditingId(null); setShowForm(true); }} className={btn + " flex items-center gap-1.5"}>
          <Plus className="h-4 w-4" /> Add party
        </button>
      </div>

      {saveError && <p className={errText + " mb-4"}>{saveError}</p>}

      {showForm && <PartyForm tab={tab} onCancel={() => setShowForm(false)} onSave={async (p) => {
        if (await saveParty(p, false)) {
          audit("Party created", `${p.buyerName} (${p.type})`);
          setShowForm(false);
        }
      }} />}

      {editing && <PartyForm tab={editing.type} initial={editing} onCancel={() => setEditingId(null)} onSave={async (u) => {
        const changes = diffParty(editing, u);
        if (await saveParty(u, true)) {
          audit("Party edited", `${u.buyerName} — ${changes.length ? changes.join("; ") : "no field changes"}`);
          setEditingId(null);
        }
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
                <td className={td + " font-medium"}>{p.buyerName}</td>
                <td className={td + " text-[var(--muted)]"}>{p.country}</td>
                <td className={td}>{p.currency}</td>
                <td className={td}>{p.products.length}</td>
                <td className={td + " text-[var(--muted)]"}>{p.paymentTerm}</td>
                <td className={td + " text-right"}>
                  {confirmId === p.id ? (
                    <span className="flex items-center justify-end gap-3">
                      <span className="text-xs text-[var(--danger)]">Delete?</span>
                      <button onClick={() => deleteParty(p)} className="text-xs text-[var(--danger)]">Confirm</button>
                      <button onClick={() => setConfirmId(null)} className="text-xs text-[var(--muted)]">Cancel</button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-4">
                      <button onClick={() => { setShowForm(false); setEditingId(p.id); }} className="text-xs text-[var(--accent)]">Edit</button>
                      <button onClick={() => setConfirmId(p.id)} className="text-xs text-[var(--muted)] hover:text-[var(--danger)]">Delete</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-[var(--muted)]">No parties in this category yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- quotations */
function QuotationsPage() {
  const { store, refresh, audit } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [partyId, setPartyId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [country, setCountry] = useState("");
  const [shipmentTerm, setShipmentTerm] = useState("FOB");
  const [paymentTerm, setPaymentTerm] = useState("");
  const [igst, setIgst] = useState(false);
  const [igstRate, setIgstRate] = useState(0);
  const [items, setItems] = useState([{ id: uid(), product: "", hsn: "", boxQty: 0, boxRate: 0 }]);
  const [error, setError] = useState("");

  const isDomestic = country.trim().toLowerCase() === "india";
  const total = items.reduce((s, i) => s + Number(i.boxQty) * Number(i.boxRate), 0);
  const igstAmt = isDomestic && igst ? (total * Number(igstRate)) / 100 : 0;
  const grand = total + igstAmt;
  const updateItem = (id, k, v) => setItems(items.map((i) => (i.id === id ? { ...i, [k]: v } : i)));

  const reset = () => {
    setPartyId(""); setBuyerName(""); setCountry(""); setShipmentTerm("FOB"); setPaymentTerm("");
    setIgst(false); setIgstRate(0); setItems([{ id: uid(), product: "", hsn: "", boxQty: 0, boxRate: 0 }]); setError("");
  };

  const create = async () => {
    if (!buyerName.trim()) return setError("Buyer name is required.");
    setBusy(true); setError("");
    try {
      // The number comes from the database so two people cannot take the same one.
      const docNo = await nextDocNo("quotation");
      const rec = {
        docNo, date: todayISO(), partyId, buyerName, country, shipmentTerm, paymentTerm,
        items, igst, igstRate, totalValue: total, igstAmt, grandTotal: grand,
      };
      const { error } = await sb.from("quotations").insert(quotationToRow(rec));
      if (error) throw error;
      audit("Quotation created", `${docNo} — ${buyerName}`);
      await refresh();
      reset(); setOpen(false);
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };

  return (
    <div>
      <PageHead title="Quotations" blurb="For first-time inquiries, before a buyer is set up as a repeat party. Box rate only — no per-jar rate, and IGST applies to Indian buyers only." />

      <div className="mb-5 flex justify-end">
        <button onClick={() => setOpen(!open)} className={btn + " flex items-center gap-1.5"}>
          <Plus className="h-4 w-4" /> New quotation
        </button>
      </div>

      {open && (
        <div className={card + " mb-6 p-6"}>
          <p className="mb-5 font-serif text-lg">New quotation</p>
          <div className="mb-5 grid gap-4 md:grid-cols-4">
            <Field label="Party (optional autofill)">
              <select className={input} value={partyId} onChange={(e) => {
                setPartyId(e.target.value);
                const p = store.parties.find((x) => x.id === e.target.value);
                if (p) { setBuyerName(p.buyerName); setCountry(p.country); setPaymentTerm(p.paymentTerm); setShipmentTerm(p.shipmentTerm || "FOB"); }
              }}>
                <option value="">Manual entry</option>
                {store.parties.map((p) => <option key={p.id} value={p.id}>{p.buyerName}</option>)}
              </select>
            </Field>
            <Field label="Buyer name"><input className={input} value={buyerName} onChange={(e) => { setBuyerName(e.target.value); setError(""); }} /></Field>
            <Field label="Country"><input className={input} value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
            <Field label="Shipment term">
              <select className={input} value={shipmentTerm} onChange={(e) => setShipmentTerm(e.target.value)}>
                <option>FOB</option><option>CIF</option><option>CNF</option><option>Ex-Factory</option>
              </select>
            </Field>
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
              <thead><tr><th className={th}>Product</th><th className={th}>HSN</th><th className={th}>Box qty</th><th className={th}>Box rate</th><th className={th}>Value</th></tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-[var(--line)]">
                    <td className="px-2 py-1.5"><input className={input} value={it.product} onChange={(e) => updateItem(it.id, "product", e.target.value)} /></td>
                    <td className="px-2 py-1.5"><input className={input} value={it.hsn} onChange={(e) => updateItem(it.id, "hsn", e.target.value)} /></td>
                    <td className="px-2 py-1.5"><input type="number" className={input} value={it.boxQty} onChange={(e) => updateItem(it.id, "boxQty", e.target.value)} /></td>
                    <td className="px-2 py-1.5"><input type="number" step="0.01" className={input} value={it.boxRate} onChange={(e) => updateItem(it.id, "boxRate", e.target.value)} /></td>
                    <td className={td + " text-[var(--muted)]"}>{fmtNum(Number(it.boxQty) * Number(it.boxRate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => setItems([...items, { id: uid(), product: "", hsn: "", boxQty: 0, boxRate: 0 }])}
              className="flex w-full items-center justify-center gap-1 border-t border-[var(--line)] py-2.5 text-xs text-[var(--accent)]">
              <Plus className="h-3.5 w-3.5" /> Add product line
            </button>
          </div>

          <div className="flex items-end justify-between">
            <div className="text-sm text-[var(--muted)]">
              <p>Total <span className="text-[var(--text)]">{fmtNum(total)}</span>
                {igstAmt > 0 && <span> · IGST <span className="text-[var(--text)]">{fmtNum(igstAmt)}</span></span>}
                {" "}· Grand total <span className="text-[var(--text)]">{fmtNum(grand)}</span></p>
              <p className="mt-1 text-xs italic">{numberToWords(grand)} only</p>
            </div>
            <div className="flex items-center gap-3">
              {error && <span className={errText}>{error}</span>}
              <button onClick={() => { reset(); setOpen(false); }} className={btnGhost}>Cancel</button>
              <button onClick={create} className={btn}>Create quotation</button>
            </div>
          </div>
        </div>
      )}

      <div className={card + " overflow-hidden"}>
        <table className="w-full">
          <thead className="bg-[var(--panel)]">
            <tr><th className={th}>Document</th><th className={th}>Date</th><th className={th}>Buyer</th><th className={th}>Country</th><th className={th}>Term</th><th className={th}>Value</th></tr>
          </thead>
          <tbody>
            {store.quotations.map((q) => (
              <tr key={q.id} className="border-t border-[var(--line)]">
                <td className={td + " font-mono text-xs"}>{q.docNo}</td>
                <td className={td + " text-[var(--muted)]"}>{q.date}</td>
                <td className={td + " font-medium"}>{q.buyerName}</td>
                <td className={td}>{q.country}</td>
                <td className={td + " text-[var(--muted)]"}>{q.shipmentTerm}</td>
                <td className={td}>{fmtNum(q.grandTotal)}</td>
              </tr>
            ))}
            {store.quotations.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-[var(--muted)]">No quotations yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ proforma */
function ProformaForm({ type, onSave, onCancel }) {
  const { store } = useApp();
  const eligible = store.parties.filter((p) => p.type === type);
  const [partyId, setPartyId] = useState(eligible.length ? eligible[0].id : "");
  const party = store.parties.find((p) => p.id === partyId);
  const [quotationRef, setQuotationRef] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [orderDate, setOrderDate] = useState(todayISO());
  const [items, setItems] = useState([]);
  const [extra, setExtra] = useState("");
  const [taxRate, setTaxRate] = useState(5);
  const isIntl = type === "international";

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
      id: uid(), productId, name: p.name, hsn: p.hsn, boxQty: 0,
      rate: Number(p.rate) || 0, mrp: Number(p.mrp) || 0,
      netWt: Number(p.netWt) || 0, grossWt: Number(p.grossWt) || 0,
      packsPerBox: Number(p.packsPerBox) || 0, weightPerPackG: Number(p.weightPerPackG) || 0,
    }]);
  };

  const totalBoxes = items.reduce((s, i) => s + Number(i.boxQty), 0);
  const totalValue = items.reduce((s, i) => s + Number(i.boxQty) * Number(i.rate), 0);
  const taxableValue = items.reduce((s, i) => s + Number(i.boxQty) * Number(i.mrp), 0);
  const taxAmount = !isIntl ? (taxableValue * Number(taxRate)) / 100 : 0;
  const grandTotal = isIntl ? totalValue : taxableValue + taxAmount;

  return (
    <div className={card + " mb-6 p-6"}>
      <div className="mb-5 flex items-start justify-between">
        <p className="font-serif text-lg">New {isIntl ? "international" : "private-label / merchant-export"} proforma</p>
        <button onClick={onCancel}><X className="h-4 w-4 text-[var(--muted)]" /></button>
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-4">
        <Field label="Buyer">
          <select className={input} value={partyId} onChange={(e) => { setPartyId(e.target.value); setItems([]); }}>
            {eligible.map((p) => <option key={p.id} value={p.id}>{p.buyerName}</option>)}
          </select>
        </Field>
        <Field label="Order no."><input className={input} value={orderNo} onChange={(e) => setOrderNo(e.target.value)} /></Field>
        <Field label="Order date"><input type="date" className={input} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></Field>
        <Field label="Linked quotation">
          <select className={input} value={quotationRef} onChange={(e) => setQuotationRef(e.target.value)}>
            <option value="">None</option>
            {store.quotations.map((q) => <option key={q.id} value={q.docNo}>{q.docNo} — {q.buyerName}</option>)}
          </select>
        </Field>
        {!isIntl && <Field label="Tax rate (%)"><input type="number" className={input} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></Field>}
      </div>

      <div className={panel + " mb-5 grid gap-4 p-4 text-xs md:grid-cols-3"}>
        <div>
          <p className="mb-1 uppercase tracking-wider text-[var(--faint)]">{isIntl ? "Consignee" : "Manufactured by / ship to"}</p>
          <p>{party.consigneeName}</p><p className="text-[var(--muted)]">{party.consigneeAddress}</p>
        </div>
        <div>
          <p className="mb-1 uppercase tracking-wider text-[var(--faint)]">Ports</p>
          <p>Loading: {party.portOfLoading || "—"}</p><p>Destination: {party.destinationPort || "—"}</p>
        </div>
        <div>
          <p className="mb-1 uppercase tracking-wider text-[var(--faint)]">Terms</p>
          <p>{party.shipmentTerm || "—"} · {party.currency}</p><p className="text-[var(--muted)]">{party.paymentTerm}</p>
        </div>
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
                <td className={td + " font-mono text-xs text-[var(--muted)]"}>{it.hsn}</td>
                <td className={td}>{fmtNum(isIntl ? it.rate : it.mrp)}</td>
                <td className="px-2 py-1.5 w-32"><input type="number" className={input} value={it.boxQty}
                  onChange={(e) => setItems(items.map((x) => (x.id === it.id ? { ...x, boxQty: e.target.value } : x)))} /></td>
                <td className={td + " text-[var(--muted)]"}>{fmtNum(Number(it.boxQty) * Number(isIntl ? it.rate : it.mrp))}</td>
                <td className="px-2"><button onClick={() => setItems(items.filter((x) => x.id !== it.id))}><Trash2 className="h-4 w-4 text-[var(--muted)] hover:text-[var(--danger)]" /></button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-[var(--muted)]">No product lines yet.</td></tr>}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t border-[var(--line)] bg-[var(--field)]">
                <td className={td + " text-xs uppercase tracking-wider text-[var(--muted)]"} colSpan={3}>Subtotal</td>
                <td className={td}>{totalBoxes} boxes</td>
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
          <p className="mt-1 text-xs italic">{numberToWords(grandTotal)} only</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className={btnGhost}>Cancel</button>
          <button className={btn} onClick={() => onSave({
            id: uid(), type, date: todayISO(), partyId, quotationRef,
            buyerName: party.buyerName, buyerAddress: party.buyerAddress,
            consigneeName: party.consigneeName, consigneeAddress: party.consigneeAddress,
            consigneeOptions: party.consigneeOptions || [party.consigneeName],
            portOfLoading: party.portOfLoading, destinationPort: party.destinationPort,
            paymentTerm: party.paymentTerm, shipmentTerm: party.shipmentTerm, conditions: party.conditions,
            currency: party.currency, buyerOrderNo: orderNo, buyerOrderDate: orderDate, items, additionalDetails: extra,
            totalBoxes, totalValue, taxableValue, taxRate, taxAmount,
            grandTotal: isIntl ? totalValue : grandTotal, linkedFinalInvoiceId: null,
          })}>Create proforma</button>
        </div>
      </div>
    </div>
  );
}

function ProformaPage() {
  const { store, refresh, audit } = useApp();
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState("open");
  const [saveError, setSaveError] = useState("");
  const list = tab === "open" ? store.pis.filter((p) => !p.linkedFinalInvoiceId) : store.pis;

  const createProforma = async (pi) => {
    setSaveError("");
    try {
      const docNo = await nextDocNo(pi.type === "international" ? "pi_international" : "pi_domestic");
      const { error } = await sb.from("proformas").insert(proformaToRow({ ...pi, docNo }));
      if (error) throw error;
      audit("Proforma created", `${docNo} — ${pi.buyerName}`);
      await refresh();
      setForm(null);
    } catch (e) {
      setSaveError(e.message || String(e));
    }
  };

  return (
    <div>
      <PageHead title="Proforma invoices" blurb="Raised against a purchase order from an existing party. Once a shipment is invoiced against a proforma it drops out of the open list, but the record is kept." />

      <div className="mb-5 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-[var(--line)] p-1">
          {[["open", "Open"], ["all", "All"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? "bg-[var(--field)] text-[var(--text)]" : "text-[var(--muted)]"}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={() => setForm("international")} className={btn + " flex items-center gap-1.5"}><Plus className="h-4 w-4" /> International</button>
          <button onClick={() => setForm("domestic")} className={btnGhost + " flex items-center gap-1.5 py-2"}><Plus className="h-4 w-4" /> Private label</button>
        </div>
      </div>

      {saveError && <p className={errText + " mb-4"}>{saveError}</p>}
      {form && <ProformaForm type={form} onCancel={() => setForm(null)} onSave={createProforma} />}

      <div className={card + " overflow-hidden"}>
        <table className="w-full">
          <thead className="bg-[var(--panel)]">
            <tr><th className={th}>Document</th><th className={th}>Date</th><th className={th}>Buyer</th><th className={th}>Type</th><th className={th}>Boxes</th><th className={th}>Value</th><th className={th}>Status</th></tr>
          </thead>
          <tbody>
            {list.map((pi) => (
              <tr key={pi.id} className="border-t border-[var(--line)]">
                <td className={td + " font-mono text-xs"}>{pi.docNo}</td>
                <td className={td + " text-[var(--muted)]"}>{pi.date}</td>
                <td className={td + " font-medium"}>{pi.buyerName}</td>
                <td className={td + " capitalize text-[var(--muted)]"}>{pi.type}</td>
                <td className={td}>{pi.totalBoxes ?? "—"}</td>
                <td className={td}>{fmtMoney(pi.grandTotal ?? pi.totalValue, pi.currency)}</td>
                <td className={td}>{pi.linkedFinalInvoiceId ? <Chip tone="ok">Invoiced</Chip> : <Chip tone="warn">Open</Chip>}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-[var(--muted)]">Nothing in this view.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- shipments */
function ShipmentForm({ pi, onSave, onCancel }) {
  const { store } = useApp();
  const [exchangeRate, setExchangeRate] = useState(1);
  const [containerNo, setContainerNo] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [customSeal, setCustomSeal] = useState("");
  const [lineSeal, setLineSeal] = useState("");
  const [portOfLoading, setPortOfLoading] = useState(pi.portOfLoading || "");
  const [incoterm, setIncoterm] = useState(pi.shipmentTerm || "FOB");
  const [gstPercent, setGstPercent] = useState(0);
  const [roundOff, setRoundOff] = useState(0);
  const [freight, setFreight] = useState(0);
  const [otherAdj, setOtherAdj] = useState(0);
  const [otherReason, setOtherReason] = useState("");
  const [taxConsignee, setTaxConsignee] = useState("TO THE ORDER");
  const [commercialCurrency, setCommercialCurrency] = useState(pi.currency);
  const [commercialConsignee, setCommercialConsignee] = useState(pi.consigneeName);
  const [items, setItems] = useState(pi.items.map((i) => ({ ...i, batchNo: "", mfgDate: todayISO(), expDate: "" })));

  const upd = (id, k, v) => setItems(items.map((i) => (i.id === id ? { ...i, [k]: v } : i)));
  const isIntl = pi.type === "international";
  const lineRate = (i) => Number(isIntl ? i.rate : i.mrp) || 0;

  const baseTotal = items.reduce((s, i) => s + Number(i.boxQty) * lineRate(i), 0);
  const adjustedTotal = baseTotal + Number(freight) + Number(otherAdj);
  const gstAmt = (adjustedTotal * Number(gstPercent)) / 100;
  const grandTotal = adjustedTotal + gstAmt + Number(roundOff);

  const totalBoxes = items.reduce((s, i) => s + Number(i.boxQty), 0);
  const totalPacks = items.reduce((s, i) => s + Number(i.boxQty) * (Number(i.packsPerBox) || 0), 0);
  const netWeight = items.reduce((s, i) => s + Number(i.boxQty) * (Number(i.netWt) || 0), 0);
  const grossWeight = items.reduce((s, i) => s + Number(i.boxQty) * (Number(i.grossWt) || 0), 0);
  const missingWeights = items.some((i) => !Number(i.netWt) || !Number(i.grossWt));

  return (
    <div className={card + " mb-6 p-6"}>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="font-serif text-lg">Shipment against {pi.docNo}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {pi.buyerName} · order {pi.buyerOrderNo || "—"} of {pi.buyerOrderDate || "—"} · one pass produces the tax invoice, commercial invoice and packing list.
          </p>
        </div>
        <button onClick={onCancel}><X className="h-4 w-4 text-[var(--muted)]" /></button>
      </div>

      <p className="mb-3 text-sm font-medium">Marks &amp; numbers</p>
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Field label="Exchange rate"><input type="number" step="0.01" className={input} value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} /></Field>
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
            <tr><th className={th}>Product</th><th className={th}>Box qty</th><th className={th}>Qty (nos)</th><th className={th}>Batch</th><th className={th}>MFG</th><th className={th}>EXP</th><th className={th}>Net / gross kg</th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-[var(--line)]">
                <td className={td}>{it.name}</td>
                <td className="px-2 py-1.5 w-28"><input type="number" className={input} value={it.boxQty} onChange={(e) => upd(it.id, "boxQty", e.target.value)} /></td>
                <td className={td + " text-[var(--muted)]"}>{Number(it.boxQty) * (Number(it.packsPerBox) || 0)}</td>
                <td className="px-2 py-1.5"><input className={input} value={it.batchNo} onChange={(e) => upd(it.id, "batchNo", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input type="date" className={input} value={it.mfgDate} onChange={(e) => upd(it.id, "mfgDate", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input type="date" className={input} value={it.expDate} onChange={(e) => upd(it.id, "expDate", e.target.value)} /></td>
                <td className={td + " whitespace-nowrap text-[var(--muted)]"}>
                  {fmtNum(Number(it.boxQty) * (Number(it.netWt) || 0))} / {fmtNum(Number(it.boxQty) * (Number(it.grossWt) || 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missingWeights && (
        <p className="mb-6 flex items-start gap-2 text-xs text-amber-400">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          A line has no net/gross weight on the party master, so packing list totals will be short. Fill the weights under Parties and raise the proforma again.
        </p>
      )}

      <p className="mb-3 mt-6 text-sm font-medium">Adjustments</p>
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Field label="GST % (tax invoice)"><input type="number" className={input} value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} /></Field>
        <Field label="Round off"><input type="number" step="0.01" className={input} value={roundOff} onChange={(e) => setRoundOff(e.target.value)} /></Field>
        <Field label="Freight" hint={incoterm === "FOB" ? "Add when Das Superfoods books the vessel" : "Already inside " + incoterm}>
          <input type="number" step="0.01" className={input} value={freight} onChange={(e) => setFreight(e.target.value)} />
        </Field>
        <Field label="Other charge / deduction"><input type="number" step="0.01" className={input} value={otherAdj} onChange={(e) => setOtherAdj(e.target.value)} /></Field>
        {Number(otherAdj) !== 0 && <Field label="Reason" className="md:col-span-2"><input className={input} value={otherReason} onChange={(e) => setOtherReason(e.target.value)} /></Field>}
      </div>

      <p className="mb-3 text-sm font-medium">Consignee &amp; currency</p>
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Field label="Tax invoice consignee" hint="Kept as TO THE ORDER so the buyer stays off the shipping bill">
          <input className={input} value={taxConsignee} onChange={(e) => setTaxConsignee(e.target.value)} />
        </Field>
        <Field label="Commercial invoice consignee">
          <select className={input} value={commercialConsignee} onChange={(e) => setCommercialConsignee(e.target.value)}>
            {(pi.consigneeOptions && pi.consigneeOptions.length ? pi.consigneeOptions : [pi.consigneeName]).map((c) => <option key={c} value={c}>{c}</option>)}
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
          <p className="text-[var(--muted)]">Total <span className="text-[var(--text)]">{fmtNum(adjustedTotal)}</span></p>
          <p className="text-[var(--muted)]">GST <span className="text-[var(--text)]">{fmtNum(gstAmt)}</span></p>
          <p className="mt-1 font-medium">Grand total {fmtNum(grandTotal)}</p>
          <p className="mt-1 text-xs italic text-[var(--muted)]">{numberToWords(grandTotal)} only</p>
        </div>
        <div className={panel + " p-4 text-sm"}>
          <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Commercial invoice · {commercialCurrency}</p>
          <p className="text-[var(--muted)]">{commercialConsignee}</p>
          <p className="text-[var(--muted)]">Incoterm {incoterm}</p>
          <p className="mt-1 font-medium">{fmtMoney(adjustedTotal, commercialCurrency)}</p>
        </div>
        <div className={panel + " p-4 text-sm"}>
          <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Packing list</p>
          <p className="text-[var(--muted)]">{totalBoxes} boxes · {totalPacks} nos</p>
          <p className="text-[var(--muted)]">Net {fmtNum(netWeight, 3)} kg</p>
          <p className="text-[var(--muted)]">Gross {fmtNum(grossWeight, 3)} kg</p>
          <p className="mt-1 font-medium">Total {fmtNum(netWeight + grossWeight, 3)} kg</p>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className={btnGhost}>Cancel</button>
        <button className={btn} onClick={() => onSave({
          id: uid(), piId: pi.id, piNo: pi.docNo, piDate: pi.date, date: todayISO(),
          buyerName: pi.buyerName, buyerAddress: pi.buyerAddress,
          orderNo: pi.buyerOrderNo, orderDate: pi.buyerOrderDate,
          exchangeRate, containerNo, vehicleNo, customSeal, lineSeal, portOfLoading, incoterm, items,
          gstPercent, roundOff, freight, otherAdj, otherReason, company: store.company,
          taxInvoice: { consignee: taxConsignee, currency: "INR", total: adjustedTotal, gst: gstAmt, roundOff: Number(roundOff), grandTotal, amountInWords: numberToWords(grandTotal) },
          commercialInvoice: { consignee: commercialConsignee, currency: commercialCurrency, total: adjustedTotal, amountInWords: numberToWords(adjustedTotal) },
          packingList: { totalBoxes, totalPacks, netWeight, grossWeight, grandTotal: netWeight + grossWeight },
        })}>Generate document set</button>
      </div>
    </div>
  );
}

function ShipmentsPage() {
  const { store, refresh, audit } = useApp();
  const [formPiId, setFormPiId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [saveError, setSaveError] = useState("");

  // Writing the shipment and closing its proforma are two statements; if the
  // second fails the proforma stays open rather than silently vanishing from
  // the list, which is the safer way round.
  const createShipment = async (fi) => {
    setSaveError("");
    try {
      const docNo = await nextDocNo("final");
      const rec = { ...fi, docNo, taxDocNo: docNo + "-TAX", commercialDocNo: docNo + "-COM" };
      const { data, error } = await sb.from("shipments").insert(shipmentToRow(rec)).select("id").single();
      if (error) throw error;
      const link = await sb.from("proformas").update({ shipment_id: data.id }).eq("id", rec.piId);
      if (link.error) throw link.error;
      audit("Shipment invoiced", `${docNo} against ${rec.piNo} — ${rec.buyerName}`);
      await refresh();
      setFormPiId(null);
    } catch (e) {
      setSaveError(e.message || String(e));
    }
  };

  const openPis = store.pis.filter((p) => !p.linkedFinalInvoiceId);
  const pi = formPiId ? store.pis.find((p) => p.id === formPiId) : null;
  const detail = detailId ? store.finalInvoices.find((f) => f.id === detailId) : null;

  return (
    <div>
      <PageHead title="Shipments" blurb="Raised after stuffing, against the quantity actually packed. One entry produces the tax invoice, the commercial invoice and the packing list." />

      {!pi && (
        <div className={card + " mb-6 p-5"}>
          <p className="mb-4 text-sm font-medium">Pick the proforma this shipment is against</p>
          {openPis.length === 0 && <p className="text-sm text-[var(--muted)]">No open proforma invoices — create one first.</p>}
          <div className="space-y-2">
            {openPis.map((p) => (
              <div key={p.id} className={panel + " flex items-center justify-between px-4 py-3"}>
                <div>
                  <p className="text-sm font-medium">{p.buyerName} <span className="ml-2 font-mono text-xs text-[var(--muted)]">{p.docNo}</span></p>
                  <p className="text-xs text-[var(--muted)]">{fmtMoney(p.grandTotal ?? p.totalValue, p.currency)} · {p.totalBoxes ?? 0} boxes</p>
                </div>
                <button onClick={() => setFormPiId(p.id)} className="flex items-center gap-1 text-sm text-[var(--accent)]">
                  Create shipment <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {saveError && <p className={errText + " mb-4"}>{saveError}</p>}
      {pi && <ShipmentForm pi={pi} onCancel={() => setFormPiId(null)} onSave={createShipment} />}

      <div className={card + " overflow-hidden"}>
        <table className="w-full">
          <thead className="bg-[var(--panel)]">
            <tr><th className={th}>Invoice</th><th className={th}>Date</th><th className={th}>Buyer</th><th className={th}>Against</th><th className={th}>Grand total</th><th className={th}>Net / gross</th><th></th></tr>
          </thead>
          <tbody>
            {store.finalInvoices.map((fi) => (
              <tr key={fi.id} className="border-t border-[var(--line)]">
                <td className={td + " font-mono text-xs"}>{fi.docNo}</td>
                <td className={td + " text-[var(--muted)]"}>{fi.date}</td>
                <td className={td}>{fi.buyerName}</td>
                <td className={td + " font-mono text-xs text-[var(--muted)]"}>{fi.piNo}</td>
                <td className={td}>{fmtNum(fi.taxInvoice.grandTotal)}</td>
                <td className={td + " text-[var(--muted)]"}>{fmtNum(fi.packingList.netWeight)} / {fmtNum(fi.packingList.grossWeight)} kg</td>
                <td className={td + " text-right"}>
                  <button onClick={() => setDetailId(detailId === fi.id ? null : fi.id)} className="text-xs text-[var(--accent)]">
                    {detailId === fi.id ? "Hide" : "View set"}
                  </button>
                </td>
              </tr>
            ))}
            {store.finalInvoices.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-[var(--muted)]">No shipments invoiced yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className={card + " mt-6 p-6"}>
          <p className="mb-5 font-serif text-lg">Document set — {detail.docNo}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className={panel + " p-4 text-sm"}>
              <p className="font-mono text-xs text-[var(--accent)]">{detail.taxDocNo}</p>
              <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Tax invoice · INR</p>
              <p className="text-[var(--muted)]">Consignee {detail.taxInvoice.consignee}</p>
              <p className="text-[var(--muted)]">Total {fmtNum(detail.taxInvoice.total)} · GST {fmtNum(detail.taxInvoice.gst)}</p>
              <p className="mt-1 font-medium">{fmtNum(detail.taxInvoice.grandTotal)}</p>
              <p className="mt-1 text-xs italic text-[var(--muted)]">{detail.taxInvoice.amountInWords} only</p>
            </div>
            <div className={panel + " p-4 text-sm"}>
              <p className="font-mono text-xs text-[var(--accent)]">{detail.commercialDocNo}</p>
              <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Commercial · {detail.commercialInvoice.currency}</p>
              <p className="text-[var(--muted)]">Consignee {detail.commercialInvoice.consignee}</p>
              <p className="text-[var(--muted)]">Incoterm {detail.incoterm}</p>
              <p className="mt-1 font-medium">{fmtMoney(detail.commercialInvoice.total, detail.commercialInvoice.currency)}</p>
            </div>
            <div className={panel + " p-4 text-sm"}>
              <p className="mb-2 text-xs uppercase tracking-wider text-[var(--faint)]">Packing list</p>
              <p className="text-[var(--muted)]">Container {detail.containerNo || "—"} · seal {detail.lineSeal || "—"}</p>
              <p className="text-[var(--muted)]">{detail.packingList.totalBoxes} boxes · {detail.packingList.totalPacks} nos</p>
              <p className="text-[var(--muted)]">Net {fmtNum(detail.packingList.netWeight, 3)} kg · Gross {fmtNum(detail.packingList.grossWeight, 3)} kg</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-[var(--muted)]">
            Bank details as they stood when this set was generated: {detail.company ? `${detail.company.bankName}, A/C ${detail.company.accountNo}` : "—"}.
          </p>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- analytics */
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
  const { store, refresh, audit } = useApp();
  const [draft, setDraft] = useState(store.company);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const dirty = COMPANY_KEYS.some((k) => (draft[k] || "") !== (store.company[k] || ""));
  const set = (k, v) => { setDraft({ ...draft, [k]: v }); setSaved(false); };

  const save = async () => {
    setSaveError("");
    const changes = diffObject(store.company, draft, COMPANY_KEYS);
    const { error } = await sb.from("company_profile").update(companyToRow(draft)).eq("id", 1);
    if (error) { setSaveError(error.message); return; }
    audit("Company profile edited", changes.length ? changes.join("; ") : "no field changes");
    await refresh();
    setSaved(true);
  };

  return (
    <div>
      <PageHead title="Company profile" blurb="Registered details and bank particulars. These feed the header and bank block on every proforma and invoice at the moment it is created." />
      <div className={card + " max-w-3xl p-6"}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Company name" className="md:col-span-2"><input className={input} value={draft.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Registered address" className="md:col-span-2"><input className={input} value={draft.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Bank name"><input className={input} value={draft.bankName} onChange={(e) => set("bankName", e.target.value)} /></Field>
          <Field label="Account no."><input className={input} value={draft.accountNo} onChange={(e) => set("accountNo", e.target.value)} /></Field>
          <Field label="IFSC"><input className={input} value={draft.ifsc} onChange={(e) => set("ifsc", e.target.value)} /></Field>
          <Field label="SWIFT"><input className={input} value={draft.swift} onChange={(e) => set("swift", e.target.value)} /></Field>
          <Field label="GST no."><input className={input} value={draft.gstNo} onChange={(e) => set("gstNo", e.target.value)} /></Field>
          <Field label="IEC code"><input className={input} value={draft.iecCode} onChange={(e) => set("iecCode", e.target.value)} /></Field>
        </div>
        <div className="mt-6 flex items-center justify-end gap-4">
          {saveError && <span className={errText}>{saveError}</span>}
          {saved && !dirty && <span className="flex items-center gap-1 text-xs text-emerald-400"><Check className="h-3.5 w-3.5" /> Saved</span>}
          <button disabled={!dirty} className={btn} onClick={save}>Save changes</button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- users */
function UsersPage() {
  const { store, refresh, user, audit } = useApp();
  const [error, setError] = useState("");
  const [auditFilter, setAuditFilter] = useState("");
  const [showAudit, setShowAudit] = useState(false);

  // Accounts are created by the person themselves at the sign-in screen.
  // Admins never handle anyone's password — they grant sections afterwards.
  const patchProfile = async (u, patch, action, detail) => {
    setError("");
    const { error: err } = await sb.from("profiles").update(patch).eq("id", u.id);
    if (err) { setError(err.message); return; }
    if (action) audit(action, detail);
    await refresh();
  };

  const toggleAccess = (u, key) => {
    if (u.role === "admin") return;
    const column = { documents: "access_documents", parties: "access_parties", company: "access_company" }[key];
    const next = !(u.access || {})[key];
    patchProfile(u, { [column]: next }, "Access changed", `${u.email} — ${key} ${next ? "granted" : "revoked"}`);
  };

  const setRole = (u, role) => {
    const grantAll = role === "admin";
    patchProfile(
      u,
      grantAll
        ? { role, access_documents: true, access_parties: true, access_company: true }
        : { role },
      "Role changed",
      `${u.email} — now ${role}`
    );
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `das-superfoods-export-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    audit("Data exported", "");
  };

  const filteredAudit = store.audit.filter((a) =>
    !auditFilter || (a.action + " " + a.user + " " + (a.detail || "")).toLowerCase().includes(auditFilter.toLowerCase()));

  return (
    <div>
      <PageHead
        title="Users & access"
        blurb="One core Admin role plus per-section grants. Staff register themselves and arrive with no access at all — you decide what each of them can reach. Party master and Company profile stay hidden without a grant, and every change lands in the audit log."
      />

      <div className={card + " mb-6 p-5"}>
        <p className="text-sm font-medium">How people join</p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
          Send them this address and ask them to pick <span className="text-[var(--text)]">Create account</span> with their own
          work email and a password only they know. They will appear in the table below with nothing ticked. Nobody shares a
          login, and nobody — including you — can see anyone else's password.
        </p>
      </div>

      {error && <p className={errText + " mb-4"}>{error}</p>}

      <div className={card + " overflow-hidden"}>
        <table className="w-full">
          <thead className="bg-[var(--panel)]">
            <tr>
              <th className={th}>Name</th><th className={th}>Email</th><th className={th}>Role</th>
              <th className={th}>Section access</th><th className={th}>Last sign-in</th><th className={th + " text-right"}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {store.users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--line)]">
                <td className={td + " font-medium"}>{u.name}{u.id === user.id && <span className="ml-2 text-xs text-[var(--muted)]">you</span>}</td>
                <td className={td + " text-[var(--muted)]"}>{u.email}</td>
                <td className={td}>{u.role === "admin" ? <Chip tone="accent">Admin</Chip> : <Chip>Staff</Chip>}</td>
                <td className={td}>
                  {u.role === "admin" ? <span className="text-xs text-[var(--muted)]">All sections</span> : (
                    <span className="flex flex-wrap gap-1.5">
                      {ACCESS_KEYS.map((a) => (
                        <button key={a.key} onClick={() => toggleAccess(u, a.key)} title={"Toggle " + a.label}>
                          <Chip tone={(u.access || {})[a.key] ? "ok" : "off"}>{a.label}</Chip>
                        </button>
                      ))}
                    </span>
                  )}
                </td>
                <td className={td + " text-xs text-[var(--muted)]"}>{u.lastLogin ? fmtWhen(u.lastLogin) : "never"}</td>
                <td className={td + " text-right"}>
                  <span className="flex items-center justify-end gap-4">
                    {u.id !== user.id && (
                      <React.Fragment>
                        <button onClick={() => setRole(u, u.role === "admin" ? "staff" : "admin")}
                          className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
                          {u.role === "admin" ? "Make staff" : "Make admin"}
                        </button>
                        <button onClick={() => patchProfile(u, { active: !u.active }, u.active ? "User deactivated" : "User reactivated", u.email)}
                          className="text-xs text-[var(--muted)] hover:text-[var(--danger)]">
                          {u.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </React.Fragment>
                    )}
                    {!u.active && <Chip tone="off">Inactive</Chip>}
                  </span>
                </td>
              </tr>
            ))}
            {store.users.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-[var(--muted)]">Nobody has registered yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-4xl text-xs leading-relaxed text-[var(--muted)]">
        Note: staff need the Documents grant to work with quotations, proforma invoices and shipments. Deactivating someone
        blocks their sign-in immediately without deleting anything they created. Forgotten passwords are handled by the
        person themselves through <span className="text-[var(--text)]">Forgotten your password?</span> on the sign-in screen.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <button onClick={() => setShowAudit(!showAudit)} className={btnGhost + " flex items-center gap-1.5"}>
          <History className="h-4 w-4" /> {showAudit ? "Hide" : "Show"} audit log ({store.audit.length})
        </button>
        <button onClick={exportBackup} className={btnGhost + " flex items-center gap-1.5"}>
          <Download className="h-4 w-4" /> Export a snapshot
        </button>
      </div>

      {showAudit && (
        <div className="mt-5">
          <input className={input + " mb-3 max-w-sm"} placeholder="Filter by user, action or detail"
            value={auditFilter} onChange={(e) => setAuditFilter(e.target.value)} />
          <div className={card + " overflow-hidden"}>
            <table className="w-full">
              <thead className="bg-[var(--panel)]">
                <tr><th className={th}>When</th><th className={th}>User</th><th className={th}>Action</th><th className={th}>Detail</th></tr>
              </thead>
              <tbody>
                {filteredAudit.slice(0, 100).map((a) => (
                  <tr key={a.id} className="border-t border-[var(--line)] align-top">
                    <td className={td + " w-44 text-xs text-[var(--muted)]"}>{fmtWhen(a.at)}</td>
                    <td className={td + " w-56 font-mono text-xs text-[var(--muted)]"}>{a.user}</td>
                    <td className={td + " w-56"}>{a.action}</td>
                    <td className={td + " text-xs text-[var(--muted)]"}>{a.detail}</td>
                  </tr>
                ))}
                {filteredAudit.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-[var(--muted)]">Nothing logged yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ boot */
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
