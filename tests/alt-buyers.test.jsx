// Names on a party (db/011, decisions/007 and 008). Class prevented: a name
// stored but never offered, offered but never sent, offered for one role only,
// or silently wiped by a save that did not carry it.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartiesPage, PartyForm, QuotationForm, ProformaForm } from "../src/app.jsx";
import { emptyStore, partyFromRow, partyNames } from "../src/lib/db.js";
import { PARTY_KEYS, ALT_BUYER_KEYS, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const row = {
  id: "22222222-2222-4222-8222-222222222222", type: "international",
  buyer_name: "Al Rawabi General Trading LLC", buyer_address: "Al Quoz, Dubai",
  consignee_name: "Al Rawabi FZE", consignee_address: "Jebel Ali", consignee_options: ["Al Rawabi FZE", "Old Consignee Co"],
  alt_buyers: [{ name: "Rawabi Foods FZCO", address: "Dubai Silicon Oasis" }, { name: "Rawabi Retail LLC", address: "" }],
  country: "United Arab Emirates", currency: "USD", shipment_term: "CIF", payment_term: "30% advance",
  conditions: "", port_of_loading: "Mundra", destination_port: "Jebel Ali",
};
const product = { id: "11111111-1111-4111-8111-111111111111", name: "Peanut Butter Creamy 340g", hsn: "20081100", rate: 1.85, mrp: 0, net_wt: 0.35, gross_wt: 0.41, packs_per_box: 12, weight_per_pack_g: 340 };
const party = partyFromRow(row, [product]);
// One name only: the consignee is the buyer, at the same address, and nothing else is listed.
const single = partyFromRow({
  ...row, id: "33333333-3333-4333-8333-333333333333", buyer_name: "Solo Buyer Ltd", buyer_address: "1 High St",
  consignee_name: "solo buyer ltd", consignee_address: "1 High St", alt_buyers: [],
}, [product]);
// No consignee on file at all.
const noConsignee = partyFromRow({ ...row, id: "44444444-4444-4444-8444-444444444444", consignee_name: "", consignee_address: "" }, [product]);

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, parties = [party]) => renderToString(
  <AppCtx.Provider value={{ store: { ...emptyStore(), parties, users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
    {node}
  </AppCtx.Provider>);
// The <select> a label wraps, so an option can be tied to the picker it belongs to.
const picker = (html, labelText) => {
  const at = html.indexOf(labelText);
  return at < 0 ? "" : html.slice(at, html.indexOf("</select>", at));
};

describe("reading the other names stored on a party", () => {
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
});

describe("one list of names for both roles", () => {
  it("lists the buyer first, then the other names, then the consignee", () => {
    expect(partyNames(party).map((c) => [c.name, c.role])).toEqual([
      ["Al Rawabi General Trading LLC", "buyer"],
      ["Rawabi Foods FZCO", "other name"],
      ["Rawabi Retail LLC", "other name"],
      ["Al Rawabi FZE", "consignee"],
    ]);
    expect(partyNames(party)[1].address).toBe("Dubai Silicon Oasis");
    expect(partyNames(party)[3]).toMatchObject({ address: "Jebel Ali", isConsignee: true, label: "Al Rawabi FZE (consignee)" });
    expect(partyNames(party).filter((c) => c.isConsignee)).toHaveLength(1);
  });

  it("a name and address that is both buyer and consignee is listed once, with both roles", () => {
    expect(partyNames(single)).toEqual([
      { name: "Solo Buyer Ltd", address: "1 High St", role: "buyer & consignee", isConsignee: true, label: "Solo Buyer Ltd (buyer & consignee)" },
    ]);
  });

  it("the same name at a different address stays a separate choice", () => {
    const names = partyNames({ ...single, consigneeAddress: "Warehouse 9" });
    expect(names.map((c) => c.address)).toEqual(["1 High St", "Warehouse 9"]);
  });

  it("skips blank rows and a blank consignee; no party means no names", () => {
    expect(partyNames({ ...party, altBuyers: [{ name: "  ", address: "x" }] }).map((c) => c.role)).toEqual(["buyer", "consignee"]);
    expect(partyNames(noConsignee).some((c) => c.isConsignee)).toBe(false);
    expect(partyNames(null)).toEqual([]);
    expect(partyNames(undefined)).toEqual([]);
  });
});

describe("saving the other names", () => {
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
    expect(fresh).toContain("Other buyer or consignee");
    expect(fresh).toContain("Add another name");
    expect(fresh).not.toContain("Other name 1");

    const edit = draw(<PartyForm tab="international" initial={party} onSave={() => {}} onCancel={() => {}} />);
    for (const s of ["Other name 1", "Address 1", "Rawabi Foods FZCO", "Dubai Silicon Oasis", "Other name 2", "Rawabi Retail LLC"]) {
      expect(edit).toContain(s);
    }
  });

  it("party list — shows the other names under the main one, only where there are any", () => {
    const html = draw(<PartiesPage />, [party, single]);
    expect(html).toContain("Rawabi Foods FZCO · Rawabi Retail LLC");
    expect(html.match(/Other names:/g)).toHaveLength(1);
  });

  it("proforma — every name on the party is offered as the buyer AND as the consignee", () => {
    const html = draw(<ProformaForm type="international" onSave={() => {}} onCancel={() => {}} />);
    const everyName = ["Al Rawabi General Trading LLC (buyer)", "Rawabi Foods FZCO (other name)", "Rawabi Retail LLC (other name)", "Al Rawabi FZE (consignee)"];
    const asBuyer = picker(html, "Buyer on this proforma");
    const asConsignee = picker(html, "Consignee on this proforma");
    for (const name of everyName) {
      expect(asBuyer, `${name} as buyer`).toContain(name);
      expect(asConsignee, `${name} as consignee`).toContain(name);
    }
    // Nothing changes until someone picks: the buyer is the main name and the
    // consignee is the party's own consignee.
    expect(asBuyer).toMatch(/<option[^>]*selected=""[^>]*>Al Rawabi General Trading LLC \(buyer\)/);
    expect(asConsignee).toMatch(/<option[^>]*selected=""[^>]*>Al Rawabi FZE \(consignee\)/);
    expect(asConsignee).not.toContain("Not set");
  });

  it("proforma — a party with no consignee on file says so instead of quietly picking one", () => {
    const html = draw(<ProformaForm type="international" onSave={() => {}} onCancel={() => {}} />, [noConsignee]);
    expect(picker(html, "Consignee on this proforma")).toMatch(/<option[^>]*selected=""[^>]*>Not set/);
  });

  it("proforma and quotation — a party with one name shows no picker at all", () => {
    expect(draw(<ProformaForm type="international" onSave={() => {}} onCancel={() => {}} />, [single])).not.toContain("on this proforma");
    const q = { id: "q1", docNo: "DS-QUO-2026-0001", date: "2026-10-03", partyId: single.id, buyerName: "Solo Buyer Ltd", buyerAddress: "1 High St", country: "India", shipmentTerm: "CIF", paymentTerm: "", igst: false, igstRate: 0, items: [] };
    expect(draw(<QuotationForm initial={q} onCancel={() => {}} onSubmit={async () => ""} />, [single])).not.toContain("Buyer on this quotation");
    expect(draw(<QuotationForm onCancel={() => {}} onSubmit={async () => ""} />)).not.toContain("Buyer on this quotation");
  });

  it("quotation — the consignee can be the buyer, and a hand-typed name is left as typed", () => {
    const q = (buyerName, buyerAddress = "") => ({
      id: "q1", docNo: "DS-QUO-2026-0001", date: "2026-10-03", partyId: party.id, buyerName, buyerAddress,
      country: "United Arab Emirates", shipmentTerm: "CIF", paymentTerm: "", igst: false, igstRate: 0, items: [],
    });
    const asConsignee = picker(draw(<QuotationForm initial={q("Al Rawabi FZE", "Jebel Ali")} onCancel={() => {}} onSubmit={async () => ""} />), "Buyer on this quotation");
    expect(asConsignee).toMatch(/<option[^>]*selected=""[^>]*>Al Rawabi FZE \(consignee\)/);
    expect(asConsignee).toContain("Rawabi Foods FZCO (other name)");
    expect(asConsignee).not.toContain("Typed by hand");

    const byHand = picker(draw(<QuotationForm initial={q("Someone Else")} onCancel={() => {}} onSubmit={async () => ""} />), "Buyer on this quotation");
    expect(byHand).toMatch(/<option[^>]*selected=""[^>]*>Typed by hand/);
  });
});
