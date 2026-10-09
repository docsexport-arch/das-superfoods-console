// A party carries a mobile contact number, a mail id and a tax id for its buyer
// and for its consignee / ship-to (db/021, decisions/025). Class prevented: a
// box that is typed into but never saved; the buyer's number landing on the
// consignee; details wiped by a save from an older copy of the console that
// does not know them; a box on one kind of party and missing on the other.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartyForm } from "../src/app.jsx";
import { emptyStore, partyFromRow, draftFromRow } from "../src/lib/db.js";
import { PARTY_KEYS, RPC_CONTRACT, pick } from "../src/lib/payloads.js";
import { EXPECTED_MIGRATION } from "../src/lib/migrations.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const sql = text("db", "021_party_contact_details.sql");
const saveParty = /create or replace function public\.save_party\([\s\S]*?\n\$\$;/.exec(sql)[0];
const appSource = text("src", "app.jsx");

const KEYS = ["buyerMobile", "buyerEmail", "buyerTaxId", "consigneeMobile", "consigneeEmail", "consigneeTaxId"];
const COLUMNS = ["buyer_mobile", "buyer_email", "buyer_tax_id", "consignee_mobile", "consignee_email", "consignee_tax_id"];
// Made-up details — nobody's real number, address or registration.
const contacts = {
  buyer_mobile: "+00 900 000 0001", buyer_email: "buyer@example.test", buyer_tax_id: "TAX-BUYER-01",
  consignee_mobile: "+00 900 000 0002", consignee_email: "consignee@example.test", consignee_tax_id: "TAX-CONS-02",
};
const partyRow = (type, over = {}) => ({
  id: "22222222-2222-4222-8222-222222222222", type, buyer_name: "Sample Buyer", buyer_address: "1 Sample Street",
  consignee_name: "Sample Receiver", consignee_address: "2 Sample Dock", consignee_options: [], alt_buyers: [],
  country: type === "domestic" ? "India" : "Philippines", currency: type === "domestic" ? "INR" : "USD",
  shipment_term: "", payment_term: "", conditions: "", ...over,
});

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node) => renderToString(
  <AppCtx.Provider value={{ store: { ...emptyStore(), users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
    {node}
  </AppCtx.Provider>).replace(/<!-- -->/g, "");
const labels = (html) => [...html.matchAll(/<label[^>]*><span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
const valueOf = (html, label) => {
  const at = html.indexOf(`>${label}</span>`);
  if (at < 0) return undefined;
  return (/value="([^"]*)"/.exec(html.slice(at, html.indexOf("</label>", at))) || [])[1];
};
const form = (tab, props = {}) => draw(<PartyForm tab={tab} onSave={() => {}} onCancel={() => {}} {...props} />);

describe("reading a party's contact details", () => {
  it("all six come back as typed, each under its own name", () => {
    const p = partyFromRow(partyRow("international", contacts), []);
    expect(KEYS.map((k) => p[k])).toEqual(["+00 900 000 0001", "buyer@example.test", "TAX-BUYER-01", "+00 900 000 0002", "consignee@example.test", "TAX-CONS-02"]);
  });

  it("a party saved before they existed reads as blank, not as 'undefined' or 'null'", () => {
    const p = partyFromRow(partyRow("international", { buyer_mobile: null }), []);
    for (const k of KEYS) expect(p[k]).toBe("");
  });
});

describe("the boxes on the party form", () => {
  it("an international party has them under the buyer address and under the consignee address", () => {
    const seen = labels(form("international"));
    expect(seen.slice(0, 11)).toEqual([
      "Buyer name", "Buyer address", "Buyer mobile contact no.", "Buyer mail id", "Buyer tax id",
      "Consignee", "Consignee address", "Consignee mobile contact no.", "Consignee mail id", "Consignee tax id",
      "Country",
    ]);
  });

  it("a private-label / India party has them under the buyer address and under the shipping address", () => {
    const seen = labels(form("domestic"));
    expect(seen.slice(0, 11)).toEqual([
      "Buyer name", "Buyer address", "Buyer mobile contact no.", "Buyer mail id", "Buyer tax id",
      "Ship to", "Shipping address", "Ship-to mobile contact no.", "Ship-to mail id", "Ship-to tax id",
      "Country",
    ]);
    expect(seen.join("|")).not.toContain("Consignee");
  });

  it("a new party starts with all six empty", () => {
    for (const tab of ["international", "domestic"]) {
      const html = form(tab);
      const who = tab === "international" ? "Consignee" : "Ship-to";
      for (const l of ["Buyer mobile contact no.", "Buyer mail id", "Buyer tax id", `${who} mobile contact no.`, `${who} mail id`, `${who} tax id`]) {
        expect(valueOf(html, l)).toBe("");
      }
    }
  });

  it("editing a party shows each detail in its own box — the buyer's are not the consignee's", () => {
    const html = form("international", { initial: partyFromRow(partyRow("international", contacts), []) });
    expect(valueOf(html, "Buyer mobile contact no.")).toBe("+00 900 000 0001");
    expect(valueOf(html, "Buyer mail id")).toBe("buyer@example.test");
    expect(valueOf(html, "Buyer tax id")).toBe("TAX-BUYER-01");
    expect(valueOf(html, "Consignee mobile contact no.")).toBe("+00 900 000 0002");
    expect(valueOf(html, "Consignee mail id")).toBe("consignee@example.test");
    expect(valueOf(html, "Consignee tax id")).toBe("TAX-CONS-02");
  });

  it("the same on a private-label party, under Ship-to", () => {
    const html = form("domestic", { initial: partyFromRow(partyRow("domestic", contacts), []) });
    expect(valueOf(html, "Buyer tax id")).toBe("TAX-BUYER-01");
    expect(valueOf(html, "Ship-to mobile contact no.")).toBe("+00 900 000 0002");
    expect(valueOf(html, "Ship-to mail id")).toBe("consignee@example.test");
    expect(valueOf(html, "Ship-to tax id")).toBe("TAX-CONS-02");
  });

  it("a draft party brings them back as they were left", () => {
    const draft = draftFromRow({ id: "d", kind: "party", title: "t", saved_by: "x", updated_at: "2026-10-09T06:40:00Z",
      payload: { tab: "domestic", f: { buyerName: "Half Done", buyerMobile: "+00 900 000 0003", consigneeTaxId: "TAX-HALF" }, products: [], conditions: [""] } });
    const html = form("domestic", { draft, onSaveDraft: () => {} });
    expect(valueOf(html, "Buyer mobile contact no.")).toBe("+00 900 000 0003");
    expect(valueOf(html, "Ship-to tax id")).toBe("TAX-HALF");
    expect(valueOf(html, "Buyer mail id")).toBe("");
  });

  it("a draft saved before the boxes existed still opens, with them empty", () => {
    const draft = draftFromRow({ id: "d", kind: "party", title: "t", saved_by: "x", updated_at: "2026-10-07T06:40:00Z",
      payload: { tab: "international", f: { buyerName: "Older Draft" }, products: [], conditions: [""] } });
    const html = form("international", { draft, onSaveDraft: () => {} });
    expect(valueOf(html, "Buyer name")).toBe("Older Draft");
    expect(valueOf(html, "Consignee mail id")).toBe("");
  });
});

describe("saving a party's contact details", () => {
  it("all six are sent with the party, and are part of the agreed contract", () => {
    for (const k of KEYS) {
      expect(PARTY_KEYS).toContain(k);
      expect(RPC_CONTRACT.save_party).toContain(k);
    }
    const sent = pick({ buyerName: "B", buyerMobile: "1", buyerEmail: "2", buyerTaxId: "3", consigneeMobile: "4", consigneeEmail: "5", consigneeTaxId: "6", junk: 1 }, PARTY_KEYS);
    expect(sent).toEqual({ buyerName: "B", buyerMobile: "1", buyerEmail: "2", buyerTaxId: "3", consigneeMobile: "4", consigneeEmail: "5", consigneeTaxId: "6" });
  });

  it("the database has a column for each, never null", () => {
    for (const c of COLUMNS) expect(sql).toMatch(new RegExp(`add column if not exists ${c}\\s+text not null default ''`));
  });

  it("a new party stores all six, trimmed", () => {
    expect(saveParty).toContain("buyer_mobile, buyer_email, buyer_tax_id, consignee_mobile, consignee_email, consignee_tax_id)");
    for (const k of KEYS) expect(saveParty.split(`btrim(coalesce(p ->> '${k}', ''))`).length).toBe(3);   // once on create, once on edit
  });

  it("an edit that does not carry a detail — an older copy of the console — leaves it alone", () => {
    KEYS.forEach((k, i) => {
      expect(saveParty).toContain(`${COLUMNS[i]} = case when p ? '${k}' then btrim(coalesce(p ->> '${k}', '')) else ${COLUMNS[i]} end`);
    });
  });

  it("they are kept as typed: no format is forced on a number, a mail id or a tax id", () => {
    expect(saveParty).not.toMatch(/Mobile[^\n]*_fail|Email[^\n]*_fail|TaxId[^\n]*_fail/);
    expect(saveParty).not.toMatch(/~\*? *'[^']*@/);
  });

  it("the rest of save_party is untouched: other names, product details, access check", () => {
    expect(saveParty).toContain("alt_buyers = case when p ? 'altBuyers' then v_alt else alt_buyers end");
    expect(saveParty).toContain("else pp.shelf_life end");
    expect(saveParty).toContain("else pp.weight_unit end");
    expect(saveParty).toContain("else pp.secondary_name end");
    expect(saveParty).toContain("has_access('parties')");
  });

  it("the console expects the migration that added them", () => {
    expect(EXPECTED_MIGRATION).toBeGreaterThanOrEqual(21);
    expect(sql).toContain("values (21, 'party_contact_details')");
  });
});

describe("where the details go, and where they do not", () => {
  it("the party price list in Excel carries all six", () => {
    for (const l of ["Buyer mobile", "Buyer mail id", "Buyer tax id", "Consignee / ship-to mobile", "Consignee / ship-to mail id", "Consignee / ship-to tax id"]) {
      expect(appSource).toContain(`{ label: "${l}", value:`);
    }
  });

  it("no document prints them yet — a proforma or shipment is unchanged", () => {
    for (const f of ["documents.js", "shipment-docs.js"]) {
      const src = text("src", "lib", f);
      for (const k of KEYS) expect(src).not.toContain(k);
    }
  });
});
