// Each product on a party has its own shelf life, in months or years (db/018,
// decisions/020). Class prevented: a shelf life typed but never saved; "2
// years" coming back as 24 months, or as 2 months; one product's shelf life
// leaking onto another; a shelf life wiped by a save that did not carry it.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartyForm } from "../src/app.jsx";
import { emptyStore, partyFromRow, draftFromRow } from "../src/lib/db.js";
import { shelfLifeText, SHELF_LIFE_UNITS } from "../src/lib/format.js";
import { PARTY_PRODUCT_KEYS, RPC_CONTRACT, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(ROOT, "db", "018_product_shelf_life.sql"), "utf8").replace(/\r\n/g, "\n");
const saveParty = /create or replace function public\.save_party\([\s\S]*?\n\$\$;/.exec(sql)[0];
const appSource = readFileSync(join(ROOT, "src", "app.jsx"), "utf8");

const productRow = (id, name, over = {}) => ({ id, name, hsn: "20081100", rate: 17.77, mrp: 1500, net_wt: 1.36, gross_wt: 1.52, packs_per_box: 6, weight_per_pack_g: 0, ...over });
const partyOf = (type, products) => partyFromRow({
  id: "22222222-2222-4222-8222-222222222222", type, buyer_name: "Sample Buyer", buyer_address: "", consignee_name: "", consignee_address: "", consignee_options: [],
  alt_buyers: [], country: type === "domestic" ? "India" : "Philippines", currency: type === "domestic" ? "INR" : "USD", shipment_term: "", payment_term: "", conditions: "",
}, products);
const three = [
  productRow("11111111-1111-4111-8111-111111111111", "Peanut Butter Creamy 340g", { shelf_life: 18, shelf_life_unit: "months" }),
  productRow("11111111-1111-4111-8111-111111111112", "Roasted Peanuts 1kg", { shelf_life: 2, shelf_life_unit: "years" }),
  productRow("11111111-1111-4111-8111-111111111113", "Peanut Oil 1L"),            // saved before shelf life existed
];

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node) => renderToString(
  <AppCtx.Provider value={{ store: { ...emptyStore(), users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
    {node}
  </AppCtx.Provider>).replace(/<!-- -->/g, "");
// One table row per product, so a value can be tied to the product it sits beside.
const rowsOf = (html) => {
  const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  return body.split("<tr").slice(1);
};
const lifeOf = (row) => ({
  length: (/aria-label="Shelf life"[^>]*value="([^"]*)"/.exec(row) || [])[1],
  unit: (/aria-label="Shelf life in months or years"[\s\S]*?<option value="(months|years)" selected="">/.exec(row) || [])[1],
});

describe("a shelf life in words", () => {
  it("keeps the unit that was chosen, singular or plural", () => {
    expect(shelfLifeText(18, "months")).toBe("18 months");
    expect(shelfLifeText(2, "years")).toBe("2 years");
    expect(shelfLifeText(1, "years")).toBe("1 year");
    expect(shelfLifeText("1", "months")).toBe("1 month");
    expect(shelfLifeText(1.5, "years")).toBe("1.5 years");
  });

  it("nothing given says nothing — not '0 months'", () => {
    for (const v of [0, "", null, undefined, "0", -3]) expect(shelfLifeText(v, "months")).toBe("");
  });

  it("there are exactly two units", () => {
    expect(SHELF_LIFE_UNITS).toEqual(["months", "years"]);
  });
});

describe("reading a product's shelf life", () => {
  const party = partyOf("international", three);

  it("each product carries its own", () => {
    expect(party.products.map((p) => [p.name, p.shelfLife, p.shelfLifeUnit])).toEqual([
      ["Peanut Butter Creamy 340g", 18, "months"], ["Roasted Peanuts 1kg", 2, "years"], ["Peanut Oil 1L", 0, "months"],
    ]);
  });

  it("a product saved before shelf life existed, or with a strange unit, reads as none in months", () => {
    const odd = partyOf("international", [productRow("1", "A", { shelf_life: null, shelf_life_unit: null }), productRow("2", "B", { shelf_life: 5, shelf_life_unit: "weeks" })]);
    expect(odd.products.map((p) => [p.shelfLife, p.shelfLifeUnit])).toEqual([[0, "months"], [5, "months"]]);
  });
});

describe("the product rows on the party form", () => {
  for (const [tab, label] of [["international", "international"], ["domestic", "private-label / India"]]) {
    it(`a ${label} party has a Shelf life column, with months or years to choose`, () => {
      const html = draw(<PartyForm tab={tab} initial={partyOf(tab, three)} onSave={() => {}} onCancel={() => {}} />);
      expect(html).toMatch(/<th[^>]*>Shelf life<\/th>/);
      const rows = rowsOf(html);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row).toContain('<option value="months"');
        expect(row).toContain('<option value="years"');
        expect(row).toMatch(/>Months<\/option>/);
        expect(row).toMatch(/>Years<\/option>/);
      }
    });
  }

  it("shows each product's own shelf life beside that product", () => {
    const rows = rowsOf(draw(<PartyForm tab="international" initial={partyOf("international", three)} onSave={() => {}} onCancel={() => {}} />));
    expect(rows[0]).toContain('value="Peanut Butter Creamy 340g"');
    expect(lifeOf(rows[0])).toEqual({ length: "18", unit: "months" });
    expect(rows[1]).toContain('value="Roasted Peanuts 1kg"');
    expect(lifeOf(rows[1])).toEqual({ length: "2", unit: "years" });
  });

  it("a product with none shows an empty box, not a zero, and starts on months", () => {
    const rows = rowsOf(draw(<PartyForm tab="international" initial={partyOf("international", three)} onSave={() => {}} onCancel={() => {}} />));
    expect(rows[2]).toContain('value="Peanut Oil 1L"');
    expect(lifeOf(rows[2])).toEqual({ length: "", unit: "months" });
  });

  it("a new product line starts with no shelf life, in months", () => {
    expect(appSource).toMatch(/const add = \(\) => setProducts\(\[\.\.\.products, \{[^}]*shelfLife: "", shelfLifeUnit: "months" \}\]\);/);
  });

  it("a draft party brings each line's shelf life back as it was left", () => {
    const draft = draftFromRow({ id: "d", kind: "party", title: "t", saved_by: "x", updated_at: "2026-10-07T06:40:00Z", payload: { tab: "domestic", f: { buyerName: "Half Done" },
      products: [{ id: "t1", name: "Private Label PB", mrp: 100, netWtG: "500", grossWtG: "550", packsPerBox: 6, shelfLife: "3", shelfLifeUnit: "years" }], conditions: [""] } });
    const rows = rowsOf(draw(<PartyForm tab="domestic" draft={draft} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />));
    expect(lifeOf(rows[0])).toEqual({ length: "3", unit: "years" });
  });
});

describe("saving a product's shelf life", () => {
  it("both parts are sent on every product line, and nothing else is added", () => {
    for (const k of ["shelfLife", "shelfLifeUnit"]) {
      expect(PARTY_PRODUCT_KEYS).toContain(k);
      expect(RPC_CONTRACT.save_party).toContain(k);
    }
    const line = pick({ id: "t1", name: "PB", netWtG: "500", shelfLife: "18", shelfLifeUnit: "months", junk: 1 }, PARTY_PRODUCT_KEYS);
    expect(line).toEqual({ id: "t1", name: "PB", shelfLife: "18", shelfLifeUnit: "months" });
  });

  it("the database reads both on a new line and on a line being edited", () => {
    expect(saveParty).toContain("public._num(e ->> 'shelfLife', 'Shelf life'), coalesce(nullif(e ->> 'shelfLifeUnit', ''), 'months')");
    expect(saveParty).toMatch(/shelf_life = case when e \? 'shelfLife' then public\._num\(e ->> 'shelfLife', 'Shelf life'\) else pp\.shelf_life end/);
    expect(saveParty).toMatch(/shelf_life_unit = case when e \? 'shelfLifeUnit' then e ->> 'shelfLifeUnit' else pp\.shelf_life_unit end/);
  });

  it("a line saved without them — an older copy of the console — keeps the shelf life it has", () => {
    expect(saveParty).toContain("else pp.shelf_life end");
    expect(saveParty).toContain("else pp.shelf_life_unit end");
  });

  it("only months or years, and never a negative length", () => {
    expect(saveParty).toContain("not in ('months', 'years')");
    expect(saveParty).toContain("'A shelf life cannot be negative.'");
    expect(sql).toMatch(/check \(shelf_life_unit in \('months', 'years'\)\)/);
    expect(sql).toMatch(/check \(shelf_life >= 0\)/);
  });

  it("the unit is stored as typed — nothing converts years to months", () => {
    expect(saveParty).not.toMatch(/\* ?12|\/ ?12/);
    expect(appSource).not.toMatch(/shelfLife[^\n]{0,40}\* ?12/);
  });

  it("the rest of save_party is untouched: other names, access check", () => {
    expect(saveParty).toContain("alt_buyers = case when p ? 'altBuyers' then v_alt else alt_buyers end");
    expect(saveParty).toContain("has_access('parties')");
  });
});
