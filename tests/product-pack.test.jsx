// A product line describes its pack (db/020, decisions/023): the product name
// on its own, then the weight of one piece with its unit, pieces per box, and
// a secondary name. Class prevented: two packs of one product that cannot be
// told apart; "1 kg" coming back as 1000 g, or as 1 g; the weight of a piece
// confused with the weight of a box; a secondary name typed but never saved.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartyForm, ProformaForm } from "../src/app.jsx";
import { emptyStore, partyFromRow, draftFromRow } from "../src/lib/db.js";
import { gramsFromWeight, weightFromGrams, packWeightText, packLabel } from "../src/lib/format.js";
import { PARTY_PRODUCT_KEYS, RPC_CONTRACT, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(ROOT, "db", "020_product_pack_and_secondary_name.sql"), "utf8").replace(/\r\n/g, "\n");
const saveParty = /create or replace function public\.save_party\([\s\S]*?\n\$\$;/.exec(sql)[0];
const appSource = readFileSync(join(ROOT, "src", "app.jsx"), "utf8");

// The owner's own example: one product, two packs.
const productRow = (id, over = {}) => ({ id, name: "High Protein Oats Dark Chocolate", hsn: "19041090", rate: 24, mrp: 3000, net_wt: 8, gross_wt: 8.6,
  packs_per_box: 20, weight_per_pack_g: 400, pack_weight_unit: "g", secondary_name: "High protein oats 400gm*20 pcs", weight_unit: "kg", ...over });
const rows = [
  productRow("11111111-1111-4111-8111-111111111111"),
  productRow("11111111-1111-4111-8111-111111111112", { packs_per_box: 10, weight_per_pack_g: 1000, pack_weight_unit: "kg", secondary_name: "High protein oats 1kg*10 pcs", net_wt: 10, gross_wt: 10.7 }),
  productRow("11111111-1111-4111-8111-111111111113", { name: "Old Line", packs_per_box: 6, weight_per_pack_g: 0, pack_weight_unit: undefined, secondary_name: undefined }),
];
const partyOf = (type) => partyFromRow({
  id: "22222222-2222-4222-8222-222222222222", type, buyer_name: "Sample Buyer", buyer_address: "", consignee_name: "", consignee_address: "", consignee_options: [],
  alt_buyers: [], country: "X", currency: type === "domestic" ? "INR" : "USD", shipment_term: "", payment_term: "", conditions: "",
}, rows);

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, parties = []) => renderToString(
  <AppCtx.Provider value={{ store: { ...emptyStore(), parties, users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
    {node}
  </AppCtx.Provider>).replace(/<!-- -->/g, "");
const productTable = (html) => html.slice(html.lastIndexOf("<table", html.indexOf('aria-label="Product name"')), html.indexOf("</table>", html.indexOf('aria-label="Product name"')));
const rowsOf = (html) => { const t = productTable(html); return t.slice(t.indexOf("<tbody>"), t.indexOf("</tbody>")).split("<tr").slice(1); };
const packOf = (row) => ({
  name: (/aria-label="Product name"[^>]*value="([^"]*)"/.exec(row) || [])[1],
  weight: (/aria-label="Weight of one piece"[^>]*value="([^"]*)"/.exec(row) || [])[1],
  unit: (/aria-label="Unit for the weight of one piece"[\s\S]*?<option value="(g|kg|mt)" selected="">/.exec(row) || [])[1],
  pieces: (/aria-label="Pieces per box"[^>]*value="([^"]*)"/.exec(row) || [])[1],
  secondary: (/aria-label="Secondary name"[^>]*value="([^"]*)"/.exec(row) || [])[1],
});

describe("the weight of one piece", () => {
  it("is kept in grams whatever unit it was typed in", () => {
    expect(gramsFromWeight(400, "g")).toBe(400);
    expect(gramsFromWeight(1, "kg")).toBe(1000);
    expect(gramsFromWeight("0.5", "kg")).toBe(500);
    expect(gramsFromWeight(1, "mt")).toBe(1000000);
    expect(gramsFromWeight("", "kg")).toBe(0);
  });

  it("and reads back in the unit it was typed in — 1 kg is 1 kg, not 1000 g", () => {
    expect(weightFromGrams(1000, "kg")).toBe(1);
    expect(weightFromGrams(400, "g")).toBe(400);
    expect(weightFromGrams(500, "kg")).toBe(0.5);
    for (const unit of ["g", "kg", "mt"]) {
      for (const typed of [1, 2.5, 20, 340, 400, 750, 1000]) expect(weightFromGrams(gramsFromWeight(typed, unit), unit), `${typed} ${unit}`).toBe(typed);
    }
  });

  it("in words: 400 g, 1 kg — and nothing when none is given", () => {
    expect(packWeightText(400, "g")).toBe("400 g");
    expect(packWeightText(1000, "kg")).toBe("1 kg");
    expect(packWeightText(1000000, "mt")).toBe("1 MT");
    for (const none of [0, "", null, undefined]) expect(packWeightText(none, "g")).toBe("");
  });
});

describe("telling two packs of one product apart", () => {
  const party = partyOf("international");

  it("the product name is the same on both lines; the pack is held beside it", () => {
    expect(party.products.slice(0, 2).map((p) => [p.name, p.weightPerPackG, p.packWeightUnit, p.packsPerBox, p.secondaryName])).toEqual([
      ["High Protein Oats Dark Chocolate", 400, "g", 20, "High protein oats 400gm*20 pcs"],
      ["High Protein Oats Dark Chocolate", 1000, "kg", 10, "High protein oats 1kg*10 pcs"],
    ]);
  });

  it("a line saved before any of this reads as no pack weight, in grams, with no secondary name", () => {
    expect(party.products[2]).toMatchObject({ name: "Old Line", weightPerPackG: 0, packWeightUnit: "g", secondaryName: "" });
  });

  it("the label for a line is its secondary name, or failing that its pack in words", () => {
    expect(packLabel(party.products[0])).toBe("High protein oats 400gm*20 pcs");
    expect(packLabel({ weightPerPackG: 1000, packWeightUnit: "kg", packsPerBox: 10 })).toBe("1 kg × 10");
    expect(packLabel({ secondaryName: "   ", weightPerPackG: 400, packWeightUnit: "g", packsPerBox: 20 })).toBe("400 g × 20");
    expect(packLabel(party.products[2])).toBe("");
    expect(packLabel(null)).toBe("");
  });
});

describe("the product rows on the party form", () => {
  for (const tab of ["international", "domestic"]) {
    it(`a ${tab === "domestic" ? "private-label / India" : "international"} party lists Product, Weight, Unit, Pieces per box, Secondary name — in that order`, () => {
      const table = productTable(draw(<PartyForm tab={tab} initial={partyOf(tab)} onSave={() => {}} onCancel={() => {}} />));
      const heads = [...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
      expect(heads.slice(0, 5)).toEqual(["Product", "Weight", "Unit", "Pieces per box", "Secondary name"]);
      // Everything that was there before is still there, after them.
      expect(heads.slice(5)).toEqual(["HSN", tab === "international" ? "Rate / box" : "MRP / box", "Net wt / box", "Gross wt / box", "Box wt unit", "Shelf life", ""]);
      expect(heads).not.toContain("Packs / box");
    });
  }

  it("shows the owner's example exactly as it would be typed", () => {
    const r = rowsOf(draw(<PartyForm tab="international" initial={partyOf("international")} onSave={() => {}} onCancel={() => {}} />));
    expect(packOf(r[0])).toEqual({ name: "High Protein Oats Dark Chocolate", weight: "400", unit: "g", pieces: "20", secondary: "High protein oats 400gm*20 pcs" });
    expect(packOf(r[1])).toEqual({ name: "High Protein Oats Dark Chocolate", weight: "1", unit: "kg", pieces: "10", secondary: "High protein oats 1kg*10 pcs" });
  });

  it("a line with no pack weight shows an empty box, not a zero", () => {
    const r = rowsOf(draw(<PartyForm tab="international" initial={partyOf("international")} onSave={() => {}} onCancel={() => {}} />));
    expect(packOf(r[2])).toEqual({ name: "Old Line", weight: "", unit: "g", pieces: "6", secondary: "" });
  });

  it("the unit of a piece offers g, kg and MT, and is separate from the unit of the box weights", () => {
    const r = rowsOf(draw(<PartyForm tab="international" initial={partyOf("international")} onSave={() => {}} onCancel={() => {}} />));
    const piece = r[1].slice(r[1].indexOf('aria-label="Unit for the weight of one piece"'), r[1].indexOf('aria-label="Pieces per box"'));
    expect([...piece.matchAll(/<option value="(g|kg|mt)"[^>]*>([^<]*)<\/option>/g)].map((m) => m[2])).toEqual(["g", "kg", "MT"]);
    // This line's pieces are in kg AND its box weights are in kg — each from its own choice.
    expect(/aria-label="Box weight unit"[\s\S]*?<option value="(g|kg|mt)" selected="">/.exec(r[0])[1]).toBe("kg");
    expect(packOf(r[0]).unit).toBe("g");
  });

  it("a new product line starts with an empty pack: no weight, grams, no secondary name", () => {
    expect(appSource).toMatch(/const add = \(\) => setProducts\(\[\.\.\.products, \{ id: tempId\(\), name: "", secondaryName: "", packWtIn: "", packWeightUnit: "g",/);
  });

  it("a draft brings the pack back as it was left; one saved before packs existed opens with an empty one", () => {
    const draft = (products) => draftFromRow({ id: "d", kind: "party", title: "t", saved_by: "x", updated_at: "2026-10-08T06:40:00Z", payload: { tab: "international", f: { buyerName: "Half Done" }, products, conditions: [""] } });
    const now = rowsOf(draw(<PartyForm tab="international" draft={draft([{ id: "t1", name: "Oats", packWtIn: "0.75", packWeightUnit: "kg", packsPerBox: 12, secondaryName: "Oats 750g*12", netWtIn: "9", grossWtIn: "9.6", weightUnit: "kg" }])} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />));
    expect(packOf(now[0])).toEqual({ name: "Oats", weight: "0.75", unit: "kg", pieces: "12", secondary: "Oats 750g*12" });
    const before = rowsOf(draw(<PartyForm tab="international" draft={draft([{ id: "t1", name: "Oats", netWtIn: "9", grossWtIn: "9.6", weightUnit: "kg", packsPerBox: 12 }])} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />));
    expect(packOf(before[0])).toEqual({ name: "Oats", weight: "", unit: "g", pieces: "12", secondary: "" });
  });
});

describe("saving the pack", () => {
  it("the weight of a piece goes as grams, converted from its own unit, with the unit and the secondary name beside it", () => {
    expect(appSource).toMatch(/packWeightUnit: weightUnitOf\(p\.packWeightUnit\), weightPerPackG: gramsFromWeight\(packWtIn, p\.packWeightUnit\),/);
    expect(appSource).toMatch(/secondaryName: String\(p\.secondaryName \|\| ""\)\.trim\(\),/);
    for (const k of ["secondaryName", "packWeightUnit", "weightPerPackG", "packsPerBox"]) {
      expect(PARTY_PRODUCT_KEYS).toContain(k);
      expect(RPC_CONTRACT.save_party).toContain(k);
    }
    // The as-typed box is the form's own and is never sent.
    expect(PARTY_PRODUCT_KEYS).not.toContain("packWtIn");
    expect(pick({ name: "Oats", weightPerPackG: 1000, packWeightUnit: "kg", packsPerBox: 10, secondaryName: "Oats 1kg*10", packWtIn: "1" }, PARTY_PRODUCT_KEYS))
      .toEqual({ name: "Oats", weightPerPackG: 1000, packWeightUnit: "kg", packsPerBox: 10, secondaryName: "Oats 1kg*10" });
  });

  it("the weight of a piece is converted by the piece's unit, never by the box's", () => {
    // Class: 1 kg pieces in a box weighed in grams being stored as 1 g.
    expect(appSource).not.toMatch(/gramsFromWeight\(packWtIn, p\.weightUnit\)/);
    expect(appSource).not.toMatch(/kgFromWeight\((netWtIn|grossWtIn), p\.packWeightUnit\)/);
  });

  it("the database reads both new fields on a new line and on an edited one, and keeps them when an older page does not send them", () => {
    expect(saveParty).toContain("btrim(coalesce(e ->> 'secondaryName', '')), coalesce(nullif(e ->> 'packWeightUnit', ''), 'g')");
    expect(saveParty).toMatch(/secondary_name = case when e \? 'secondaryName' then btrim\(coalesce\(e ->> 'secondaryName', ''\)\) else pp\.secondary_name end/);
    expect(saveParty).toMatch(/pack_weight_unit = case when e \? 'packWeightUnit' then e ->> 'packWeightUnit' else pp\.pack_weight_unit end/);
  });

  it("the database stores the grams it is sent, and allows the same product name on more than one line", () => {
    expect(saveParty).toContain("weight_per_pack_g = public._num(e ->> 'weightPerPackG', 'Weight per pack')");
    expect(saveParty).not.toMatch(/packWeightUnit[^\n]*\*|\* ?1000|\/ ?1000/);
    expect(sql).not.toMatch(/unique[^;]*\(party_id, name\)/i);
    expect(sql).toMatch(/check \(pack_weight_unit in \('g', 'kg', 'mt'\)\)/);
  });

  it("the rest of save_party is untouched: box-weight unit, shelf life, other names, access check", () => {
    expect(saveParty).toContain("else pp.weight_unit end");
    expect(saveParty).toContain("else pp.shelf_life_unit end");
    expect(saveParty).toContain("alt_buyers = case when p ? 'altBuyers' then v_alt else alt_buyers end");
    expect(saveParty).toContain("has_access('parties')");
  });
});

describe("raising a proforma for a party with two packs of one product", () => {
  const html = draw(<ProformaForm type="international" onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />, [partyOf("international")]);
  const picker = html.slice(html.indexOf("+ Add product from the party master"));

  it("the product picker tells the two packs apart", () => {
    expect(picker).toContain("High Protein Oats Dark Chocolate — High protein oats 400gm*20 pcs</option>");
    expect(picker).toContain("High Protein Oats Dark Chocolate — High protein oats 1kg*10 pcs</option>");
    // A product with no pack described is listed by its name alone.
    expect(picker).toContain(">Old Line</option>");
  });

  it("a line carries its pack along, so the proforma knows which one it is", () => {
    expect(appSource).toMatch(/secondaryName: p\.secondaryName \|\| "", packWeightUnit: weightUnitOf\(p\.packWeightUnit\),/);
  });
});
