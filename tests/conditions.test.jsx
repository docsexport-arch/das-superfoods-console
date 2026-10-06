// A party can carry several conditions (decisions/012). They are edited as a
// list and kept as one text, a condition per line. Class prevented: a second
// condition that is typed but never saved; a list that comes back merged into
// one line or with blank entries; a proforma that prints them run together.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartyForm, ProformaForm, ProformaDocument } from "../src/app.jsx";
import { emptyStore, partyFromRow } from "../src/lib/db.js";
import { conditionsFromText, conditionsToText } from "../src/lib/format.js";
import { proformaSheetRows } from "../src/lib/documents.js";
import { PARTY_KEYS, PROFORMA_KEYS } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const three = "Goods once sold will not be taken back\nSubject to Ahmedabad jurisdiction\nInspection at buyer's cost";
const partyWith = (conditions) => partyFromRow({
  id: "22222222-2222-4222-8222-222222222222", type: "international",
  buyer_name: "Crosschannel Imports Inc.", buyer_address: "Newark, NJ", consignee_name: "", consignee_address: "",
  consignee_options: [], alt_buyers: [], country: "United States", currency: "USD", shipment_term: "FOB",
  payment_term: "30% advance", conditions, port_of_loading: "Mundra", destination_port: "New York",
}, [{ id: "11111111-1111-4111-8111-111111111111", name: "Peanut Butter Creamy 340g", hsn: "20081100", rate: 17.77, mrp: 0, net_wt: 1.36, gross_wt: 1.52, packs_per_box: 6, weight_per_pack_g: 0 }]);
const proformaWith = (conditions) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", docNo: "PI/25-26/014", date: "2026-10-05", type: "international",
  buyerName: "Crosschannel Imports Inc.", buyerAddress: "Newark, NJ", consigneeName: "", consigneeAddress: "", currency: "USD",
  shipmentTerm: "FOB", paymentTerm: "30% advance", conditions, totalBoxes: 10, totalValue: 177.7, grandTotal: 177.7,
  items: [{ id: "l1", name: "Peanut Butter Creamy 340g", hsn: "20081100", boxQty: 10, rate: 17.77, packsPerBox: 6 }],
});

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, parties = []) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), parties, users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");

describe("conditions as a list and as one text", () => {
  it("one condition per line, in order", () => {
    expect(conditionsFromText(three)).toEqual([
      "Goods once sold will not be taken back", "Subject to Ahmedabad jurisdiction", "Inspection at buyer's cost",
    ]);
    expect(conditionsToText(conditionsFromText(three))).toBe(three);
  });

  it("a single condition written before this change reads exactly as it did", () => {
    expect(conditionsFromText("Subject to Ahmedabad jurisdiction")).toEqual(["Subject to Ahmedabad jurisdiction"]);
    expect(conditionsToText(["Subject to Ahmedabad jurisdiction"])).toBe("Subject to Ahmedabad jurisdiction");
  });

  it("blank boxes are not conditions; nothing typed saves as nothing", () => {
    expect(conditionsToText(["", "  ", "Keep this", ""])).toBe("Keep this");
    expect(conditionsToText([""])).toBe("");
    expect(conditionsToText(undefined)).toBe("");
    expect(conditionsFromText("")).toEqual([]);
    expect(conditionsFromText(null)).toEqual([]);
    expect(conditionsFromText("A\n\n\n  \nB\r\nC")).toEqual(["A", "B", "C"]);
  });

  it("a line break pasted inside one box does not split it into two conditions", () => {
    expect(conditionsToText(["Pay within\n30 days", "Second"])).toBe("Pay within 30 days\nSecond");
  });

  it("it is still the one field the party and the proforma already send — no new key, no schema change", () => {
    expect(PARTY_KEYS).toContain("conditions");
    expect(PROFORMA_KEYS).toContain("conditions");
    expect(PARTY_KEYS.filter((k) => /condition/i.test(k))).toEqual(["conditions"]);
  });
});

describe("the party form", () => {
  it("a new party has one empty condition box and a way to add another", () => {
    const html = draw(<PartyForm tab="international" onSave={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Condition 1");
    expect(html).not.toContain("Condition 2");
    expect(html).toContain("Add another condition");
    // With a single box there is nothing to remove.
    expect(html).not.toContain("Remove condition 1");
  });

  it("an existing party shows each condition in its own box, each removable", () => {
    const html = draw(<PartyForm tab="international" initial={partyWith(three)} onSave={() => {}} onCancel={() => {}} />);
    for (const s of ["Condition 1", "Condition 2", "Condition 3", "Remove condition 2",
      "Goods once sold will not be taken back", "Subject to Ahmedabad jurisdiction", "Inspection at buyer&#x27;s cost"]) {
      expect(html, s).toContain(s);
    }
    expect(html).not.toContain("Condition 4");
  });

  it("what is saved is the list joined back into the one field", () => {
    const src = readFileSync(join(ROOT, "src", "app.jsx"), "utf8");
    expect(src).toMatch(/conditions: conditionsToText\(conditions\)/);
  });
});

describe("where the conditions are shown", () => {
  it("the proforma form lists what will be printed", () => {
    const html = draw(<ProformaForm type="international" onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />, [partyWith(three)]);
    expect(html).toContain("1. Goods once sold will not be taken back");
    expect(html).toContain("3. Inspection at buyer&#x27;s cost");
  });

  it("the proforma form says nothing about conditions when the party has none", () => {
    const html = draw(<ProformaForm type="international" onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />, [partyWith("")]);
    expect(html).not.toContain("Conditions");
  });

  it("the printed proforma numbers several conditions, one per line", () => {
    const html = draw(<ProformaDocument pi={proformaWith(three)} company={{}} />);
    expect(html).toContain("<p style=\"margin:0\">1. Goods once sold will not be taken back</p>");
    expect(html).toContain("<p style=\"margin:0\">2. Subject to Ahmedabad jurisdiction</p>");
    expect(html).toContain("3. Inspection at buyer&#x27;s cost");
  });

  it("a single condition prints as it always did, and none prints nothing", () => {
    expect(draw(<ProformaDocument pi={proformaWith("Subject to Ahmedabad jurisdiction")} company={{}} />))
      .toContain("Conditions: Subject to Ahmedabad jurisdiction");
    expect(draw(<ProformaDocument pi={proformaWith("")} company={{}} />)).not.toContain("Conditions");
  });

  it("the Excel sheet gives each condition its own row", () => {
    const rows = proformaSheetRows(proformaWith(three), {});
    const at = rows.findIndex((r) => r[0] === "Conditions");
    expect(rows.slice(at, at + 3)).toEqual([
      ["Conditions", "1. Goods once sold will not be taken back"],
      ["", "2. Subject to Ahmedabad jurisdiction"],
      ["", "3. Inspection at buyer's cost"],
    ]);
    expect(proformaSheetRows(proformaWith("Only one"), {}).find((r) => r[0] === "Conditions")).toEqual(["Conditions", "Only one"]);
    expect(proformaSheetRows(proformaWith(""), {}).some((r) => r[0] === "Conditions")).toBe(false);
  });
});
