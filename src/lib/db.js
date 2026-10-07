// The data layer. Screens never talk to Supabase directly: they read through
// fetchStore() and write through call(), so the rules below hold everywhere.
//
//   · Writes are RPCs — one transaction each, guarded and audited server-side.
//   · Reads are paged with a stable, unique sort and end only on an empty page.
//   · A failed read THROWS. It never comes back as an empty list, because an
//     outage that renders as "0 quotations" is worse than an error screen.
//   · Every call is raced against a timeout and fails with a human sentence.
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, RPC_TIMEOUT_MS } from "../config.js";
import { toNumber as num } from "./format.js";

// No auth options on purpose: the library coordinates its own session refresh.
export const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AppError";
    this.code = code || "";
  }
}

// Turns a database error into a sentence. Our own refusals (PT4xx) are written
// as sentences already. The default branch names the code in the message, so
// an unexpected failure can be diagnosed from a screenshot.
export function humanise(error) {
  const code = (error && error.code) || "";
  const message = (error && error.message) || "";
  if (/^PT\d{3}$/.test(code)) return message;
  if (code === "42501") return "You do not have permission to do that.";
  if (code === "23505") return "That already exists.";
  if (code === "23503") return "That record is still referenced by another one.";
  if (code === "PGRST301" || /jwt/i.test(message)) return "Your session has expired — sign in again.";
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return `Something went wrong on the server (code ${code || "unknown"}). Nothing was changed.`;
}

export function withTimeout(work, ms = RPC_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AppError(
      `The server did not answer within ${Math.round(ms / 1000)} seconds. `
      + "Your change may or may not have been saved — reload before trying again.", "TIMEOUT")), ms);
  });
  // A supabase-js query builder is a thenable, not a Promise: it has no
  // .catch. Promise.resolve() adopts it, and from there it behaves.
  return Promise.race([Promise.resolve(work), timeout]).finally(() => clearTimeout(timer));
}

// One RPC, one transaction.
export async function call(fn, args = {}) {
  const { data, error } = await withTimeout(sb.rpc(fn, args));
  if (error) throw new AppError(humanise(error), error.code);
  return data;
}

// Reads a whole table in pages. `order` must end on a unique column or rows
// can repeat or vanish between pages. The walk ends on an empty page — a short
// page proves nothing if the server's row cap is lower than ours.
const PAGE = 1000;
export async function readAll(table, { order, liveOnly = false } = {}) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let query = sb.from(table).select("*");
    if (liveOnly) query = query.is("deleted_at", null);
    for (const [column, ascending] of order) query = query.order(column, { ascending });
    const { data, error } = await withTimeout(query.range(from, from + PAGE - 1));
    if (error) throw new AppError(`Could not load ${table.replace(/_/g, " ")}: ${humanise(error)}`, error.code);
    if (!data || data.length === 0) break;
    rows.push(...data);
  }
  return rows;
}

/* ------------------------------------------------------ row → screen shape */
/* The database speaks snake_case; the screens speak camelCase. Writes go the
   other way as plain camelCase JSON, read key by key inside each RPC.        */

export const partyFromRow = (r, products) => ({
  id: r.id, type: r.type,
  buyerName: r.buyer_name, buyerAddress: r.buyer_address,
  consigneeName: r.consignee_name, consigneeAddress: r.consignee_address,
  consigneeOptions: r.consignee_options || [],
  altBuyers: (Array.isArray(r.alt_buyers) ? r.alt_buyers : [])
    .map((b) => ({ name: (b && b.name) || "", address: (b && b.address) || "" })),
  country: r.country, currency: r.currency,
  shipmentTerm: r.shipment_term, paymentTerm: r.payment_term, conditions: r.conditions,
  portOfLoading: r.port_of_loading, destinationPort: r.destination_port,
  products: (products || []).map((p) => ({
    id: p.id, name: p.name, hsn: p.hsn,
    rate: num(p.rate), mrp: num(p.mrp),
    netWt: num(p.net_wt), grossWt: num(p.gross_wt),
    packsPerBox: num(p.packs_per_box), weightPerPackG: num(p.weight_per_pack_g),
    // Each product's own shelf life (db/018). "months" on a row that predates it.
    shelfLife: num(p.shelf_life), shelfLifeUnit: p.shelf_life_unit === "years" ? "years" : "months",
    // The unit this line's weights were typed in (db/019); netWt and grossWt
    // themselves are always kilograms. Grams on a row that predates the choice.
    weightUnit: ["g", "kg", "mt"].includes(p.weight_unit) ? p.weight_unit : "g",
  })),
});

/* Every name on a party as ONE list: the buyer, the other names it orders
   under, and the consignee. Sometimes the consignee is the buyer, so the
   quotation and proforma forms offer the whole list for either role
   (decisions/008). The main buyer is always first. A name + address that
   appears twice is listed once and carries both roles.                       */
export function partyNames(party) {
  if (!party) return [];
  const clean = (v) => String(v || "").trim();
  const listed = [
    { name: party.buyerName, address: party.buyerAddress, role: "buyer" },
    ...(party.altBuyers || []).map((b) => ({ name: b.name, address: b.address, role: "other name" })),
    { name: party.consigneeName, address: party.consigneeAddress, role: "consignee" },
  ];
  const out = [];
  listed.forEach((entry, i) => {
    const name = clean(entry.name), address = clean(entry.address);
    if (name === "" && i > 0) return;
    const same = out.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.address.toLowerCase() === address.toLowerCase());
    if (!same) out.push({ name, address, roles: [entry.role] });
    else if (!same.roles.includes(entry.role)) same.roles.push(entry.role);
  });
  return out.map((c) => ({
    name: c.name, address: c.address,
    role: c.roles.join(" & "), isConsignee: c.roles.includes("consignee"),
    label: `${c.name} (${c.roles.join(" & ")})`,
  }));
}

export const quotationFromRow = (r) => ({
  id: r.id, docNo: r.doc_no, date: r.doc_date, partyId: r.party_id,
  buyerName: r.buyer_name, buyerAddress: r.buyer_address, country: r.country,
  shipmentTerm: r.shipment_term, paymentTerm: r.payment_term,
  igst: r.igst, igstRate: num(r.igst_rate),
  totalValue: num(r.total_value), igstAmt: num(r.igst_amount), grandTotal: num(r.grand_total),
  items: r.items || [],
  updatedAt: r.updated_at,
});

export const proformaFromRow = (r) => ({
  id: r.id, docNo: r.doc_no, date: r.doc_date, type: r.type, partyId: r.party_id,
  quotationRef: r.quotation_ref,
  buyerName: r.buyer_name, buyerAddress: r.buyer_address,
  consigneeName: r.consignee_name, consigneeAddress: r.consignee_address,
  consigneeOptions: r.consignee_options || [],
  portOfLoading: r.port_of_loading, destinationPort: r.destination_port,
  shipmentTerm: r.shipment_term, paymentTerm: r.payment_term, conditions: r.conditions,
  currency: r.currency, buyerOrderNo: r.order_no, buyerOrderDate: r.order_date,
  additionalDetails: r.additional_details,
  totalBoxes: num(r.total_boxes), totalValue: num(r.total_value), taxableValue: num(r.taxable_value),
  taxRate: num(r.tax_rate), taxAmount: num(r.tax_amount), grandTotal: num(r.grand_total),
  items: r.items || [],
  linkedFinalInvoiceId: r.shipment_id,
  updatedAt: r.updated_at,
});

export const shipmentFromRow = (r) => ({
  id: r.id, docNo: r.doc_no, taxDocNo: r.tax_doc_no, commercialDocNo: r.commercial_doc_no,
  date: r.doc_date, piId: r.proforma_id, piNo: r.proforma_no, piDate: r.proforma_date,
  buyerName: r.buyer_name, buyerAddress: r.buyer_address,
  orderNo: r.order_no, orderDate: r.order_date,
  exchangeRate: num(r.exchange_rate), containerNo: r.container_no, vehicleNo: r.vehicle_no,
  customSeal: r.customs_seal, lineSeal: r.line_seal,
  portOfLoading: r.port_of_loading, incoterm: r.incoterm,
  gstPercent: num(r.gst_percent), roundOff: num(r.round_off), freight: num(r.freight),
  otherAdj: num(r.other_adjustment), otherReason: r.other_reason,
  taxInvoice: r.tax_invoice || {}, commercialInvoice: r.commercial_invoice || {},
  packingList: r.packing_list || {}, company: r.company_snapshot || {},
  items: r.items || [],
  updatedAt: r.updated_at,
});

export const companyFromRow = (r) => ({
  name: r.name, address: r.address, bankName: r.bank_name, accountNo: r.account_no,
  // The beneficiary name and the branch (db/015). Blank, never undefined, on a
  // row read before those columns existed.
  accountName: r.account_name || "", bankBranch: r.bank_branch || "",
  swift: r.swift, gstNo: r.gst_no, iecCode: r.iec_code,
});

export const userFromRow = (r) => ({
  id: r.id, name: r.full_name || r.email, email: r.email, role: r.role,
  sections: r.sections || [],
  active: r.active, createdAt: r.created_at, lastLogin: r.last_login,
});

export const auditFromRow = (r) => ({
  id: r.id, at: r.at, user: r.actor, action: r.action, detail: r.detail,
  entity: r.entity, entityId: r.entity_id,
});

/* ------------------------------------------------------------------ reads */
/* A saved draft is a form kept as it was left (db/012). The payload is the
   form's own state; a row whose payload is not an object reads as empty.    */
export const draftFromRow = (r) => ({
  id: r.id, kind: r.kind, title: r.title || "", refId: r.ref_id || null,
  payload: r.payload && typeof r.payload === "object" && !Array.isArray(r.payload) ? r.payload : {},
  savedBy: r.saved_by || "", updatedAt: r.updated_at,
});

export const emptyStore = () => ({
  users: [],
  company: { name: "", address: "", bankName: "", accountNo: "", accountName: "", bankBranch: "", swift: "", gstNo: "", iecCode: "" },
  parties: [], quotations: [], pis: [], finalInvoices: [], drafts: [], audit: [], migrationIds: [],
});

// One grant per toolbar section. This list is the client half of the check
// constraint profiles_sections_valid and of public.has_access() (db/010) —
// change all three in the same commit.
export const SECTION_KEYS = [
  "overview", "parties", "quotations", "proforma", "shipments", "analytics", "company", "users",
];

// The single source for "who may see what" on the client. It mirrors
// public.has_access() / public.is_admin() in the database, which is the real
// gate; this only decides what to ask for and what to draw. Like the database,
// it fails closed: a deactivated or missing profile holds nothing.
export function accessOf(profile) {
  const live = Boolean(profile) && Boolean(profile.active);
  const isAdmin = live && profile.role === "admin";
  const held = new Set(live ? profile.sections || [] : []);
  const out = { isAdmin };
  for (const key of SECTION_KEYS) out[key] = isAdmin || held.has(key);
  return out;
}

const NEWEST_FIRST = [["created_at", false], ["id", true]];

// One pass that rebuilds everything the screens expect. Rows the user is not
// granted are not requested at all; the database would refuse them anyway.
export async function fetchStore(profile) {
  const can = accessOf(profile);
  const out = emptyStore();
  const jobs = [];

  if (can.parties) {
    jobs.push((async () => {
      const [parties, products] = await Promise.all([
        readAll("parties", { order: [["created_at", true], ["id", true]], liveOnly: true }),
        readAll("party_products", { order: [["party_id", true], ["id", true]] }),
      ]);
      const byParty = {};
      for (const p of products) (byParty[p.party_id] = byParty[p.party_id] || []).push(p);
      out.parties = parties.map((r) => partyFromRow(r, byParty[r.id]));
    })());
  }

  if (can.quotations) {
    jobs.push(readAll("quotations", { order: NEWEST_FIRST, liveOnly: true })
      .then((rows) => { out.quotations = rows.map(quotationFromRow); }));
  }
  // A shipment is raised against a proforma, so the shipments grant reads them too.
  if (can.proforma || can.shipments) {
    jobs.push(readAll("proformas", { order: NEWEST_FIRST, liveOnly: true })
      .then((rows) => { out.pis = rows.map(proformaFromRow); }));
  }
  // Drafts are read by whoever holds a section that has them — parties,
  // proforma or shipments; row-level security returns only the kinds each
  // grant covers (db/012, db/017).
  if (can.parties || can.proforma || can.shipments) {
    jobs.push(readAll("drafts", { order: [["updated_at", false], ["id", true]], liveOnly: true })
      .then((rows) => { out.drafts = rows.map(draftFromRow); }));
  }
  if (can.shipments) {
    jobs.push(readAll("shipments", { order: NEWEST_FIRST, liveOnly: true })
      .then((rows) => { out.finalInvoices = rows.map(shipmentFromRow); }));
  }

  if (can.company) {
    jobs.push((async () => {
      const { data, error } = await withTimeout(sb.from("company_profile").select("*").eq("id", 1).maybeSingle());
      if (error) throw new AppError(`Could not load the company profile: ${humanise(error)}`, error.code);
      if (data) out.company = companyFromRow(data);
    })());
  }

  // Admins and the users grant see every account; everyone else only their own
  // row. The same query serves both — row-level security decides what comes back.
  jobs.push(readAll("profiles", { order: [["created_at", true], ["id", true]] })
    .then((rows) => { out.users = rows.map(userFromRow); }));

  if (can.users) {
    jobs.push((async () => {
      // Bounded on purpose: the newest 300 events. The full trail stays in the database.
      const { data, error } = await withTimeout(
        sb.from("audit_log").select("*").order("at", { ascending: false }).order("id", { ascending: false }).limit(300));
      if (error) throw new AppError(`Could not load the audit log: ${humanise(error)}`, error.code);
      out.audit = (data || []).map(auditFromRow);
    })());
  }

  // The migration ledger drives the drift banner, which only an admin is shown.
  if (can.isAdmin) {
    jobs.push(readAll("app_schema_migrations", { order: [["id", true]] })
      .then((rows) => { out.migrationIds = rows.map((r) => r.id); }));
  }

  await Promise.all(jobs);
  return out;
}

/* ------------------------------------------------- account administration */
// Creating a user or setting someone else's password needs the secret key,
// which must never reach a browser. These go to an edge function that checks
// the caller is an active admin before it does anything.
export async function adminApi(action, payload) {
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new AppError("Your session has expired — sign in again.", "PT401");
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch (e) {
    throw new AppError("Could not reach the server. Check your connection and try again.", "NETWORK");
  }
  let out = {};
  try { out = await res.json(); } catch (e) { /* a non-JSON error page */ }
  // Success is judged on the body, not just the status.
  if (!res.ok || out.error || !out.ok) {
    throw new AppError(out.error || `The account service refused the request (HTTP ${res.status}).`, String(res.status));
  }
  return out;
}
