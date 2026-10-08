// Saved drafts (db/012, decisions/009) and the party form's weights in grams.
// Class prevented: a draft that cannot be found again, that comes back with
// fields missing, that is offered to the wrong section — or a weight typed in
// grams being stored as if it were kilograms.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartyForm, ProformaPage, ProformaForm, ShipmentsPage, ShipmentForm } from "../src/app.jsx";
import { emptyStore, partyFromRow, draftFromRow } from "../src/lib/db.js";
import { gramsFromKg, kgFromGrams } from "../src/lib/format.js";
import { DRAFT_KEYS, PARTY_PRODUCT_KEYS, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const product = { id: "11111111-1111-4111-8111-111111111111", name: "Peanut Butter Creamy 340g", hsn: "20081100", rate: 17.77, mrp: 0, net_wt: 1.36, gross_wt: 1.52, packs_per_box: 4, weight_per_pack_g: 340 };
const party = partyFromRow({
  id: "22222222-2222-4222-8222-222222222222", type: "international",
  buyer_name: "Al Rawabi General Trading LLC", buyer_address: "Al Quoz, Dubai",
  consignee_name: "Al Rawabi FZE", consignee_address: "Jebel Ali", consignee_options: ["Al Rawabi FZE"],
  alt_buyers: [{ name: "Rawabi Foods FZCO", address: "Dubai Silicon Oasis" }],
  country: "United Arab Emirates", currency: "USD", shipment_term: "CIF", payment_term: "30% advance",
  conditions: "", port_of_loading: "Mundra", destination_port: "Jebel Ali",
}, [product]);
const line = { id: "l1", productId: product.id, name: product.name, hsn: product.hsn, boxQty: 250, rate: 17.77, mrp: 0, netWt: 1.36, grossWt: 1.52, packsPerBox: 4 };
const proforma = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", docNo: "DS-PI-INTL-2026-0007", date: "2026-10-03", type: "international", partyId: party.id,
  buyerName: party.buyerName, buyerAddress: "Dubai", consigneeName: "Al Rawabi FZE", consigneeAddress: "Jebel Ali",
  consigneeOptions: ["Al Rawabi FZE"], portOfLoading: "Mundra", destinationPort: "Jebel Ali", shipmentTerm: "CIF",
  paymentTerm: "30% advance", conditions: "", currency: "USD", buyerOrderNo: "PO-77", buyerOrderDate: "2026-10-01",
  totalBoxes: 250, totalValue: 4442.5, taxableValue: 0, taxRate: 0, taxAmount: 0, grandTotal: 4442.5,
  items: [line], linkedFinalInvoiceId: null,
};

const proformaDraft = draftFromRow({
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", kind: "proforma", title: "Rawabi Foods FZCO · order PO-91 · 250 boxes", ref_id: null,
  saved_by: "ecom02@pintola.in", updated_at: "2026-10-05T06:40:00Z",
  payload: {
    type: "international", partyId: party.id, quotationRef: "", orderNo: "PO-91", orderDate: "2026-10-04",
    items: [line], extra: "", taxRate: 5,
    buyer: { name: "Rawabi Foods FZCO", address: "Dubai Silicon Oasis" },
    consignee: { name: "Al Rawabi General Trading LLC", address: "Al Quoz, Dubai" },
  },
});
const shipmentDraft = draftFromRow({
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", kind: "shipment", title: "DS-PI-INTL-2026-0007 · Al Rawabi General Trading LLC", ref_id: proforma.id,
  saved_by: "docs.export@dasfoodindia.com", updated_at: "2026-10-05T07:15:00Z",
  payload: {
    piId: proforma.id, exchangeRate: "83.25", containerNo: "MSKU7654321", vehicleNo: "GJ01AB1234", customSeal: "CS-1", lineSeal: "LS-2",
    portOfLoading: "Mundra", incoterm: "CIF", gstPercent: 5, roundOff: 0, freight: 120, otherAdj: 0, otherReason: "",
    taxConsignee: "TO THE ORDER", commercialCurrency: "USD", commercialConsignee: "Al Rawabi FZE",
    items: [{ ...line, boxQty: 240, batchNo: "B-2291", mfgDate: "2026-10-01", expDate: "2027-09-30" }],
  },
});

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, extra = {}) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), parties: [party], pis: [proforma], users: [admin], ...extra },
    user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");   // React's text separators; drop them so text reads as on screen
const picker = (html, labelText) => {
  const at = html.indexOf(labelText);
  return at < 0 ? "" : html.slice(at, html.indexOf("</select>", at));
};

describe("weights on the party form are in grams per box", () => {
  it("converts both ways without drift", () => {
    expect(gramsFromKg(1.36)).toBe(1360);
    expect(kgFromGrams(1360)).toBe(1.36);
    expect(gramsFromKg(0.41)).toBe(410);
    expect(kgFromGrams("410")).toBe(0.41);
    expect(kgFromGrams(gramsFromKg(1.005))).toBe(1.005);
    expect(gramsFromKg(0)).toBe(0);
    expect(kgFromGrams("")).toBe(0);
    for (const g of [1, 12.5, 340, 999, 13600, 25000]) expect(gramsFromKg(kgFromGrams(g))).toBe(g);
  });

  it("a product typed in grams still shows in grams, and there is no g / pack column", () => {
    // The unit is now a choice per line (db/019, tests/weight-unit.test.jsx);
    // a line saved before that choice existed was typed in grams and stays so.
    const html = draw(<PartyForm tab="international" initial={party} onSave={() => {}} onCancel={() => {}} />);
    for (const s of ["Net wt / box", "Gross wt / box", "Box wt unit", "Pieces per box"]) expect(html).toContain(s);
    expect(html).toMatch(/aria-label="Net weight per box"[^>]*value="1360"/);
    expect(html).toMatch(/aria-label="Gross weight per box"[^>]*value="1520"/);
    expect(html).toMatch(/aria-label="Box weight unit"[^>]*>[\s\S]*?<option value="g" selected="">g<\/option>/);
    expect(html.toLowerCase()).not.toContain("g / pack");
  });

  it("what is saved is kilograms — the unit every packing list total is in", () => {
    // Class: the form's own gram fields leaking into the payload, or a weight
    // going to the database a thousand times too heavy.
    const src = readFileSync(join(ROOT, "src", "app.jsx"), "utf8");
    expect(src).toMatch(/netWt: kgFromWeight\(netWtIn, p\.weightUnit\), grossWt: kgFromWeight\(grossWtIn, p\.weightUnit\)/);
    // The as-typed fields are the form's own; pick() sends only the listed keys.
    for (const k of ["netWtG", "grossWtG", "netWtIn", "grossWtIn"]) expect(PARTY_PRODUCT_KEYS).not.toContain(k);
    expect(PARTY_PRODUCT_KEYS).toEqual(expect.arrayContaining(["netWt", "grossWt", "packsPerBox"]));
  });
});

describe("a draft row", () => {
  it("maps to the screen shape", () => {
    expect(proformaDraft).toMatchObject({ kind: "proforma", refId: null, savedBy: "ecom02@pintola.in", updatedAt: "2026-10-05T06:40:00Z" });
    expect(shipmentDraft.refId).toBe(proforma.id);
    expect(shipmentDraft.payload.containerNo).toBe("MSKU7654321");
  });

  it("a payload that is not a form reads as an empty one — never a crash", () => {
    for (const payload of [null, undefined, "x", 7, ["a"]]) {
      expect(draftFromRow({ id: "d", kind: "proforma", payload }).payload).toEqual({});
    }
  });

  it("the save payload carries exactly the keys the function reads, and no id for a new draft", () => {
    const fresh = pick({ kind: "proforma", title: "t", payload: {}, id: undefined, expectedUpdatedAt: undefined }, DRAFT_KEYS);
    expect(Object.keys(fresh).sort()).toEqual(["kind", "payload", "title"]);
    const again = pick({ kind: "shipment", title: "t", refId: "r", payload: {}, id: "d", expectedUpdatedAt: "2026-10-05T07:15:00Z", junk: 1 }, DRAFT_KEYS);
    expect(Object.keys(again).sort()).toEqual([...DRAFT_KEYS].sort());
  });
});

describe("drafts in the database are read-only to the client", () => {
  const sql = readFileSync(join(ROOT, "db", "012_drafts.sql"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("signed-in users are granted SELECT and nothing else, and there is no write policy", () => {
    expect(sql).toMatch(/revoke all on public\.drafts from anon, authenticated, public;/);
    expect(sql).toMatch(/grant select on public\.drafts to authenticated;/);
    expect(sql).not.toMatch(/grant\s+(all|insert|update|delete)[^;]*public\.drafts/i);
    expect(sql).not.toMatch(/create policy[^;]*on public\.drafts for (all|insert|update|delete)/i);
  });

  it("raising from a draft goes through the same functions that raise without one", () => {
    // Class: a second copy of the money arithmetic that drifts from the first.
    expect(sql).toMatch(/v_out := public\.create_proforma\(p\);/);
    expect(sql).toMatch(/v_out := public\.create_shipment\(p\);/);
  });
});

describe("proforma drafts on screen", () => {
  it("the form offers Save draft beside Create", () => {
    const html = draw(<ProformaForm type="international" onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Save draft");
    expect(html).toContain("Create proforma");
  });

  it("the page lists drafts with who saved them and when, and offers Continue and Discard", () => {
    const html = draw(<ProformaPage />, { drafts: [proformaDraft, shipmentDraft] });
    for (const s of ["Saved drafts", "Rawabi Foods FZCO · order PO-91 · 250 boxes", "ecom02@pintola.in", "05/10/2026", "Continue draft", "Discard"]) {
      expect(html).toContain(s);
    }
    // A shipment draft belongs on the Shipments page, not here.
    expect(html).not.toContain("DS-PI-INTL-2026-0007 · Al Rawabi General Trading LLC");
  });

  it("no drafts, no drafts panel", () => {
    expect(draw(<ProformaPage />)).not.toContain("Saved drafts");
  });

  it("continuing a draft brings back the order, the lines, and the names chosen for buyer and consignee", () => {
    const html = draw(<ProformaForm type="international" draft={proformaDraft} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Draft international proforma");
    expect(html).toContain("Continuing the draft saved by ecom02@pintola.in");
    expect(html).toMatch(/value="PO-91"/);
    expect(html).toMatch(/value="2026-10-04"/);
    expect(html).toMatch(/value="250"/);
    expect(picker(html, "Buyer on this proforma")).toMatch(/<option[^>]*selected=""[^>]*>Rawabi Foods FZCO \(other name\)/);
    expect(picker(html, "Consignee on this proforma")).toMatch(/<option[^>]*selected=""[^>]*>Al Rawabi General Trading LLC \(buyer\)/);
  });

  it("a draft whose party is gone says so and drops its lines instead of raising them against nobody", () => {
    const orphan = { ...proformaDraft, payload: { ...proformaDraft.payload, partyId: "99999999-9999-4999-8999-999999999999" } };
    const html = draw(<ProformaForm type="international" draft={orphan} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />);
    expect(html).toContain("no longer on file");
    expect(html).toContain("No product lines yet.");
  });
});

describe("shipment drafts on screen", () => {
  it("the form offers Save draft beside Generate", () => {
    const html = draw(<ShipmentForm pi={proforma} onSave={async () => {}} onSaveDraft={async () => {}} onCancel={() => {}} error="" />);
    expect(html).toContain("Save draft");
    expect(html).toContain("Generate document set");
  });

  it("an open proforma with a draft says so and offers to continue or discard it", () => {
    const html = draw(<ShipmentsPage />, { drafts: [shipmentDraft, proformaDraft] });
    for (const s of ["Continue draft", "Discard draft", "Draft saved by docs.export@dasfoodindia.com", "05/10/2026"]) expect(html).toContain(s);
    expect(html).not.toContain("Create shipment");
  });

  it("an open proforma without a draft is unchanged", () => {
    const html = draw(<ShipmentsPage />);
    expect(html).toContain("Create shipment");
    expect(html).not.toContain("Continue draft");
  });

  it("continuing a draft brings back every field as it was left", () => {
    const html = draw(<ShipmentForm pi={proforma} draft={shipmentDraft} onSave={async () => {}} onSaveDraft={async () => {}} onCancel={() => {}} error="" />);
    expect(html).toContain("Draft shipment against DS-PI-INTL-2026-0007");
    for (const v of ["83.25", "MSKU7654321", "GJ01AB1234", "CS-1", "LS-2", "B-2291", "2027-09-30", "240", "120"]) {
      expect(html, `field value ${v}`).toMatch(new RegExp(`value="${v}"`));
    }
  });
});
