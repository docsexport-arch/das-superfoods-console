// A product's weights can be typed in grams, kilograms or MT (db/019,
// decisions/021). Class prevented: a weight stored a thousand times too heavy
// or too light because the unit was ignored; a weight that comes back in a
// different unit from the one it was typed in; a packing list fed anything
// but kilograms; a unit wiped by a save that did not carry it.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartyForm } from "../src/app.jsx";
import { emptyStore, partyFromRow, draftFromRow } from "../src/lib/db.js";
import { WEIGHT_UNITS, weightUnitOf, kgFromWeight, weightFromKg } from "../src/lib/format.js";
import { shipmentTotals } from "../src/lib/money.js";
import { PARTY_PRODUCT_KEYS, RPC_CONTRACT, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(ROOT, "db", "019_product_weight_unit.sql"), "utf8").replace(/\r\n/g, "\n");
const saveParty = /create or replace function public\.save_party\([\s\S]*?\n\$\$;/.exec(sql)[0];
const appSource = readFileSync(join(ROOT, "src", "app.jsx"), "utf8");

const productRow = (id, name, over = {}) => ({ id, name, hsn: "20081100", rate: 17.77, mrp: 1500, net_wt: 1.36, gross_wt: 1.52, packs_per_box: 6, weight_per_pack_g: 0, ...over });
const partyOf = (type, products) => partyFromRow({
  id: "22222222-2222-4222-8222-222222222222", type, buyer_name: "Sample Buyer", buyer_address: "", consignee_name: "", consignee_address: "", consignee_options: [],
  alt_buyers: [], country: "X", currency: type === "domestic" ? "INR" : "USD", shipment_term: "", payment_term: "", conditions: "",
}, products);
// The same three ways of saying a weight, as the database holds them: always kilograms, plus the unit typed.
const three = [
  productRow("11111111-1111-4111-8111-111111111111", "Jar 340g", { net_wt: 1.36, gross_wt: 1.52, weight_unit: "g" }),
  productRow("11111111-1111-4111-8111-111111111112", "Pouch 1kg", { net_wt: 12, gross_wt: 12.85, weight_unit: "kg" }),
  productRow("11111111-1111-4111-8111-111111111113", "Bulk bag", { net_wt: 1000, gross_wt: 1020, weight_unit: "mt" }),
  productRow("11111111-1111-4111-8111-111111111114", "Old line", { net_wt: 0.5, gross_wt: 0.55 }),   // saved before the choice existed
];

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node) => renderToString(
  <AppCtx.Provider value={{ store: { ...emptyStore(), users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
    {node}
  </AppCtx.Provider>).replace(/<!-- -->/g, "");
// One card per product, so a value can be tied to the product it sits beside.
const rowsOf = (html) => html.split('role="group" aria-label="Product ').slice(1);
const weightsOf = (row) => ({
  net: (/aria-label="Net weight per box"[^>]*value="([^"]*)"/.exec(row) || [])[1],
  gross: (/aria-label="Gross weight per box"[^>]*value="([^"]*)"/.exec(row) || [])[1],
  unit: (/aria-label="Box weight unit"[\s\S]*?<option value="(g|kg|mt)" selected="">/.exec(row) || [])[1],
});

describe("grams, kilograms and MT", () => {
  it("there are exactly three units, shown as g, kg and MT", () => {
    expect(WEIGHT_UNITS).toEqual([{ key: "g", label: "g" }, { key: "kg", label: "kg" }, { key: "mt", label: "MT" }]);
  });

  it("each converts to the kilograms that are stored", () => {
    expect(kgFromWeight(1360, "g")).toBe(1.36);
    expect(kgFromWeight("12.85", "kg")).toBe(12.85);
    expect(kgFromWeight(1, "mt")).toBe(1000);
    expect(kgFromWeight(0.012, "mt")).toBe(12);
    expect(kgFromWeight("", "kg")).toBe(0);
  });

  it("and back, to the unit the line was typed in — without drift", () => {
    expect(weightFromKg(1.36, "g")).toBe(1360);
    expect(weightFromKg(12.85, "kg")).toBe(12.85);
    expect(weightFromKg(12, "mt")).toBe(0.012);
    expect(weightFromKg(1020, "mt")).toBe(1.02);
    for (const unit of ["g", "kg", "mt"]) {
      for (const typed of [1, 12.5, 340, 999, 1360, 13600, 0.75, 25]) {
        expect(weightFromKg(kgFromWeight(typed, unit), unit), `${typed} ${unit}`).toBe(typed);
      }
    }
  });

  it("an unknown or missing unit is treated as grams, the unit every existing line was typed in", () => {
    for (const u of [undefined, null, "", "lb", "KG", "tonne"]) expect(weightUnitOf(u)).toBe("g");
    expect(kgFromWeight(500, undefined)).toBe(0.5);
    expect(weightFromKg(0.5, "lb")).toBe(500);
  });

  it("the three units are a thousand apart — a slip in the unit is a slip of a thousand", () => {
    expect(kgFromWeight(5, "g") * 1000).toBeCloseTo(kgFromWeight(5, "kg"), 9);
    expect(kgFromWeight(5, "kg") * 1000).toBeCloseTo(kgFromWeight(5, "mt"), 9);
  });
});

describe("reading a product's weight", () => {
  const party = partyOf("international", three);

  it("keeps the weights in kilograms and reads the unit beside them", () => {
    expect(party.products.map((p) => [p.name, p.netWt, p.grossWt, p.weightUnit])).toEqual([
      ["Jar 340g", 1.36, 1.52, "g"], ["Pouch 1kg", 12, 12.85, "kg"], ["Bulk bag", 1000, 1020, "mt"], ["Old line", 0.5, 0.55, "g"],
    ]);
  });

  it("a packing list is fed kilograms whatever unit the line was typed in", () => {
    // The proforma line copies netWt / grossWt from the product: they must be kg.
    const lines = party.products.map((p) => ({ boxQty: 10, packsPerBox: 6, rate: 1, netWt: p.netWt, grossWt: p.grossWt }));
    const t = shipmentTotals({ items: lines, type: "international", currency: "USD", exchangeRate: 80, gstPercent: 0, roundOff: 0, freight: 0, otherAdj: 0 });
    expect(t.net).toBeCloseTo(10 * (1.36 + 12 + 1000 + 0.5), 6);
    expect(t.gross).toBeCloseTo(10 * (1.52 + 12.85 + 1020 + 0.55), 6);
    expect(appSource).not.toMatch(/weightUnit[^\n]*(shipmentTotals|proformaTotals)/);
  });
});

describe("the product rows on the party form", () => {
  for (const tab of ["international", "domestic"]) {
    it(`a ${tab === "domestic" ? "private-label / India" : "international"} party has a Weight unit choice on every line`, () => {
      const html = draw(<PartyForm tab={tab} initial={partyOf(tab, three)} onSave={() => {}} onCancel={() => {}} />);
      for (const h of ["Net wt / box", "Gross wt / box", "Box wt unit"]) expect(html).toMatch(new RegExp(`<span[^>]*>${h}</span>`));
      // The column no longer claims grams.
      expect(html).not.toContain("Net wt / box (g)");
      const rows = rowsOf(html);
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        const options = [...row.slice(row.indexOf('aria-label="Box weight unit"')).matchAll(/<option value="(g|kg|mt)"[^>]*>([^<]*)<\/option>/g)].slice(0, 3).map((m) => m[2]);
        expect(options).toEqual(["g", "kg", "MT"]);
      }
    });
  }

  it("shows each line's weights in the unit it was typed in", () => {
    const rows = rowsOf(draw(<PartyForm tab="international" initial={partyOf("international", three)} onSave={() => {}} onCancel={() => {}} />));
    expect(weightsOf(rows[0])).toEqual({ net: "1360", gross: "1520", unit: "g" });
    expect(weightsOf(rows[1])).toEqual({ net: "12", gross: "12.85", unit: "kg" });
    expect(weightsOf(rows[2])).toEqual({ net: "1", gross: "1.02", unit: "mt" });
  });

  it("a line saved before the choice existed shows in grams, as it always did", () => {
    const rows = rowsOf(draw(<PartyForm tab="international" initial={partyOf("international", three)} onSave={() => {}} onCancel={() => {}} />));
    expect(weightsOf(rows[3])).toEqual({ net: "500", gross: "550", unit: "g" });
  });

  it("a new product line starts in grams", () => {
    expect(appSource).toMatch(/const add = \(\) => setProducts\(\[\.\.\.products, \{[^}]*netWtIn: 0, grossWtIn: 0, weightUnit: "g"[^}]*\}\]\);/);
  });

  it("a draft brings each line back as it was left — the number and its unit", () => {
    const draft = (products) => draftFromRow({ id: "d", kind: "party", title: "t", saved_by: "x", updated_at: "2026-10-07T06:40:00Z", payload: { tab: "domestic", f: { buyerName: "Half Done" }, products, conditions: [""] } });
    const now = rowsOf(draw(<PartyForm tab="domestic" draft={draft([{ id: "t1", name: "Bulk", netWtIn: "0.5", grossWtIn: "0.52", weightUnit: "mt", packsPerBox: 1 }])} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />));
    expect(weightsOf(now[0])).toEqual({ net: "0.5", gross: "0.52", unit: "mt" });
    // A draft saved before units existed holds grams.
    const before = rowsOf(draw(<PartyForm tab="domestic" draft={draft([{ id: "t1", name: "Jar", netWtG: "500", grossWtG: "550", packsPerBox: 6 }])} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />));
    expect(weightsOf(before[0])).toEqual({ net: "500", gross: "550", unit: "g" });
  });
});

describe("saving a product's weight", () => {
  it("the weights go as kilograms, converted from the line's own unit, with the unit beside them", () => {
    expect(appSource).toMatch(/netWt: kgFromWeight\(netWtIn, p\.weightUnit\), grossWt: kgFromWeight\(grossWtIn, p\.weightUnit\)/);
    expect(PARTY_PRODUCT_KEYS).toContain("weightUnit");
    expect(RPC_CONTRACT.save_party).toContain("weightUnit");
    for (const k of ["netWtIn", "grossWtIn"]) expect(PARTY_PRODUCT_KEYS).not.toContain(k);
    expect(pick({ name: "PB", netWt: 12, grossWt: 12.85, weightUnit: "kg", netWtIn: "12", junk: 1 }, PARTY_PRODUCT_KEYS))
      .toEqual({ name: "PB", netWt: 12, grossWt: 12.85, weightUnit: "kg" });
  });

  it("the database stores the weights exactly as sent — it does not convert by the unit a second time", () => {
    expect(saveParty).toContain("net_wt = public._num(e ->> 'netWt', 'Net weight'), gross_wt = public._num(e ->> 'grossWt', 'Gross weight')");
    expect(saveParty).not.toMatch(/weightUnit[^\n]*\*|\*[^\n]*weightUnit|\/ ?1000|\* ?1000/);
  });

  it("the unit is read on a new line and on an edited one, and kept when an older page does not send it", () => {
    expect(saveParty).toContain("coalesce(nullif(e ->> 'weightUnit', ''), 'g')");
    expect(saveParty).toMatch(/weight_unit = case when e \? 'weightUnit' then e ->> 'weightUnit' else pp\.weight_unit end/);
  });

  it("only g, kg or mt", () => {
    expect(saveParty).toContain("not in ('g', 'kg', 'mt')");
    expect(sql).toMatch(/check \(weight_unit in \('g', 'kg', 'mt'\)\)/);
    expect(sql).toMatch(/add column if not exists weight_unit text not null default 'g'/);
  });

  it("the rest of save_party is untouched: shelf life, other names, access check", () => {
    expect(saveParty).toContain("else pp.shelf_life_unit end");
    expect(saveParty).toContain("alt_buyers = case when p ? 'altBuyers' then v_alt else alt_buyers end");
    expect(saveParty).toContain("has_access('parties')");
  });
});
