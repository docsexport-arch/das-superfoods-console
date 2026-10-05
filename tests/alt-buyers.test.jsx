// Other buyer names on a party (db/011). Class prevented: a name the party
// orders under being stored but never offered, offered but never sent, or
// silently wiped by a save that did not carry it.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartiesPage, PartyForm, QuotationForm, ProformaForm } from "../src/app.jsx";
import { emptyStore, partyFromRow, buyerChoices } from "../src/lib/db.js";
import { PARTY_KEYS, ALT_BUYER_KEYS, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const row = {
  id: "22222222-2222-4222-8222-222222222222", type: "international",
  buyer_name: "Al Rawabi General Trading LLC", buyer_address: "Al Quoz, Dubai",
  consignee_name: "Al Rawabi FZE", consignee_address: "Jebel Ali", consignee_options: ["Al Rawabi FZE"],
  alt_buyers: [{ name: "Rawabi Foods FZCO", address: "Dubai Silicon Oasis" }, { name: "Rawabi Retail LLC", address: "" }],
  country: "United Arab Emirates", currency: "USD", shipment_term: "CIF", payment_term: "30% advance",
  conditions: "", port_of_loading: "Mundra", destination_port: "Jebel Ali",
};
const product = { id: "11111111-1111-4111-8111-111111111111", name: "Peanut Butter Creamy 340g", hsn: "20081100", rate: 1.85, mrp: 0, net_wt: 0.35, gross_wt: 0.41, packs_per_box: 12, weight_per_pack_g: 340 };
const party = partyFromRow(row, [product]);
const plain = partyFromRow({ ...row, id: "33333333-3333-4333-8333-333333333333", buyer_name: "Solo Buyer Ltd", alt_buyers: [] }, [product]);

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, parties = [party]) => renderToString(
  <AppCtx.Provider value={{ store: { ...emptyStore(), parties, users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
    {node}
  </AppCtx.Provider>);

describe("reading a party's other buyer names", () => {
  it("maps the stored list to name + address", () => {
    expect(party.altBuyers).toEqual([
      { name: "Rawabi Foods FZCO", address: "Dubai Silicon Oasis" },
      { name: "Rawabi Retail LLC", address: "" },
    ]);
  });

  it("a row with no list, a null, or junk reads as no other names — never a crash", () => {
    const { alt_buyers, ...before011 } = row;
    expect(partyFromRow(before011, []).altBuyers).toEqual([]);
    expect(partyFromRow({ ...row, alt_buyers: null }, []).altBuyers).toEqual([]);
    expect(partyFromRow({ ...row, alt_buyers: "x" }, []).altBuyers).toEqual([]);
    expect(partyFromRow({ ...row, alt_buyers: [null, {}] }, []).altBuyers).toEqual([{ name: "", address: "" }, { name: "", address: "" }]);
  });

  it("offers the main name first, then the others, skipping blank rows", () => {
    expect(buyerChoices(party).map((c) => c.name)).toEqual(["Al Rawabi General Trading LLC", "Rawabi Foods FZCO", "Rawabi Retail LLC"]);
    expect(buyerChoices(party)[1].address).toBe("Dubai Silicon Oasis");
    expect(buyerChoices({ ...party, altBuyers: [{ name: "  ", address: "x" }] })).toHaveLength(1);
    expect(buyerChoices(null)).toEqual([]);
    expect(buyerChoices(undefined)).toEqual([]);
  });
});

describe("saving a party's other buyer names", () => {
  it("the party payload carries them, with exactly the keys the function reads", () => {
    expect(PARTY_KEYS).toContain("altBuyers");
    expect(pick(party, PARTY_KEYS).altBuyers).toEqual(party.altBuyers);
    for (const b of party.altBuyers) expect(Object.keys(b).sort()).toEqual([...ALT_BUYER_KEYS].sort());
  });

  it("a save that does not carry the key leaves the stored names alone", () => {
    // Class: a browser tab still running an older copy of the console wiping
    // names it has never heard of.
    const sql = readFileSync(join(ROOT, "db", "011_party_alt_buyers.sql"), "utf8");
    expect(sql).toMatch(/alt_buyers = case when p \? 'altBuyers' then v_alt else alt_buyers end/);
  });
});

describe("the screens", () => {
  it("party form — the section is there on a new party, and prefilled on an edit", () => {
    const fresh = draw(<PartyForm tab="international" onSave={() => {}} onCancel={() => {}} />);
    expect(fresh).toContain("Other buyer names");
    expect(fresh).toContain("Add another buyer name");
    expect(fresh).not.toContain("Buyer name 2");

    const edit = draw(<PartyForm tab="international" initial={party} onSave={() => {}} onCancel={() => {}} />);
    for (const s of ["Buyer name 2", "Buyer address 2", "Rawabi Foods FZCO", "Dubai Silicon Oasis", "Buyer name 3", "Rawabi Retail LLC"]) {
      expect(edit).toContain(s);
    }
  });

  it("party list — shows the other names under the main one, only where there are any", () => {
    const html = draw(<PartiesPage />, [party, plain]);
    expect(html).toContain("Rawabi Foods FZCO · Rawabi Retail LLC");
    expect(html.match(/Also orders as/g)).toHaveLength(1);
  });

  it("proforma — offers the names when the party has more than one, and not otherwise", () => {
    const html = draw(<ProformaForm type="international" onSave={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Name on this proforma");
    expect(html).toContain("Rawabi Foods FZCO");
    expect(html).toContain("Buyer on this proforma");
    expect(draw(<ProformaForm type="international" onSave={() => {}} onCancel={() => {}} />, [plain])).not.toContain("Name on this proforma");
  });

  it("quotation — offers the names once a party with more than one is chosen", () => {
    const q = (buyerName, partyId = party.id) => ({
      id: "q1", docNo: "DS-QUO-2026-0001", date: "2026-10-03", partyId, buyerName, buyerAddress: "",
      country: "United Arab Emirates", shipmentTerm: "CIF", paymentTerm: "", igst: false, igstRate: 0, items: [],
    });
    const inOtherName = draw(<QuotationForm initial={q("Rawabi Foods FZCO")} onCancel={() => {}} onSubmit={async () => ""} />);
    expect(inOtherName).toContain("Name on this quotation");
    expect(inOtherName).not.toContain("Typed by hand");

    // A name typed by hand stays as typed; the picker says so instead of pretending.
    expect(draw(<QuotationForm initial={q("Someone Else")} onCancel={() => {}} onSubmit={async () => ""} />)).toContain("Typed by hand");

    expect(draw(<QuotationForm onCancel={() => {}} onSubmit={async () => ""} />)).not.toContain("Name on this quotation");
    expect(draw(<QuotationForm initial={q("Solo Buyer Ltd", plain.id)} onCancel={() => {}} onSubmit={async () => ""} />, [plain])).not.toContain("Name on this quotation");
  });
});
