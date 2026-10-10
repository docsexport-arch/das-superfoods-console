// A proforma's date can be typed, and a proforma can be typed by hand without
// a party from the master (db/027, decisions/035). Class prevented: a typed
// date that is not saved, or an edit that re-dates a proforma unasked; a
// hand-typed proforma that loses its buyer, terms or conditions on the way to
// the database, or that cannot be opened again to edit; a hand-typed line with
// no weights, so its shipment's packing list is empty; the choice of party
// being taken away from a proforma that does have one.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, ProformaForm } from "../src/app.jsx";
import { emptyStore, partyFromRow, proformaFromRow, draftFromRow } from "../src/lib/db.js";
import { todayIST } from "../src/lib/format.js";
import { PROFORMA_KEYS, RPC_CONTRACT, pick } from "../src/lib/payloads.js";
import { EXPECTED_MIGRATION } from "../src/lib/migrations.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const sql = text("db", "027_proforma_date.sql");
const fnIn = (source) => /create or replace function public\.save_proforma\([\s\S]*?\n\$\$;/.exec(source)[0];
const save = fnIn(sql);
const appSource = text("src", "app.jsx");
const form = appSource.slice(appSource.indexOf("function ProformaForm("), appSource.indexOf("function ProformaDocument("));

const party = partyFromRow({
  id: "22222222-2222-4222-8222-222222222222", type: "international", buyer_name: "Sample Importers Inc.", buyer_address: "Newark",
  consignee_name: "Sample Logistics", consignee_address: "Port Newark", consignee_options: [], alt_buyers: [], country: "United States",
  currency: "USD", shipment_term: "FOB", payment_term: "30% advance", conditions: "From the party",
}, [{ id: "11111111-1111-4111-8111-111111111111", name: "Peanut Butter Creamy 340g", hsn: "20081100", rate: 17.77, mrp: 0, net_wt: 1.36, gross_wt: 1.52, packs_per_box: 6, weight_per_pack_g: 0 }]);

const piRow = (over = {}) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", doc_no: "PI/26-27/020", doc_date: "2026-09-25", type: "international", party_id: null,
  quotation_ref: "", buyer_name: "Hand Typed Buyer", buyer_address: "1 Typed Road", consignee_name: "Typed Receiver", consignee_address: "2 Typed Dock",
  consignee_options: [], port_of_loading: "Mundra", destination_port: "", shipment_term: "CIF", payment_term: "50% advance",
  conditions: "First typed condition\nSecond typed condition", currency: "USD", order_no: "", order_date: null, additional_details: "",
  total_boxes: 4065, total_value: 49999.5, taxable_value: 0, tax_rate: 0, tax_amount: 0, grand_total: 49999.5,
  items: [{ id: "l1", name: "Typed product 500g", hsn: "20081100", boxQty: 4065, rate: 12.3, mrp: 0, packsPerBox: 12, netWt: 6, grossWt: 6.8 }],
  shipment_id: null, updated_at: "2026-10-10T06:00:00Z", ...over,
});
const handTyped = proformaFromRow(piRow());
const fromParty = proformaFromRow(piRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", doc_no: "PI/26-27/021", party_id: party.id, buyer_name: party.buyerName, buyer_address: party.buyerAddress,
  consignee_name: party.consigneeName, consignee_address: party.consigneeAddress, shipment_term: "FOB", payment_term: "30% advance", conditions: "From the party" }));

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, parties = [party]) => renderToString(
  <AppCtx.Provider value={{ store: { ...emptyStore(), parties, users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
    {node}
  </AppCtx.Provider>).replace(/<!-- -->/g, "");
const noop = { onSave: () => {}, onSaveDraft: () => {}, onCancel: () => {} };
const labels = (html) => [...html.matchAll(/<label[^>]*><span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
const box = (html, label) => {
  const at = html.indexOf(`>${label}</span>`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</label>", at));
};
const valueOf = (html, label) => (/value="([^"]*)"/.exec(box(html, label)) || [])[1];
const chosen = (html, label) => (/<option value="([^"]*)" selected="">([^<]*)</.exec(box(html, label)) || []).slice(1);

describe("the Date box beside the proforma number", () => {
  it("is the second box on the form, straight after Proforma no.", () => {
    expect(labels(draw(<ProformaForm type="international" {...noop} />)).slice(0, 3)).toEqual(["Proforma no.", "Date", "Party"]);
    expect(labels(draw(<ProformaForm type="domestic" {...noop} />, [])).slice(0, 2)).toEqual(["Proforma no.", "Date"]);
  });

  it("starts as today on a new proforma", () => {
    const html = draw(<ProformaForm type="international" {...noop} />);
    expect(box(html, "Date")).toContain('type="date"');
    expect(valueOf(html, "Date")).toBe(todayIST());
  });

  it("shows the proforma's own date when editing, and the draft's when continuing a draft", () => {
    expect(valueOf(draw(<ProformaForm type="international" editing={fromParty} {...noop} />), "Date")).toBe("2026-09-25");
    const draft = draftFromRow({ id: "d", kind: "proforma", title: "t", saved_by: "x", updated_at: "2026-10-09T06:40:00Z",
      payload: { docNo: "PI/1", docDate: "2026-08-15", type: "international", partyId: party.id, items: [] } });
    expect(valueOf(draw(<ProformaForm type="international" draft={draft} {...noop} />), "Date")).toBe("2026-08-15");
  });

  it("a draft saved before the Date box existed opens on today", () => {
    const draft = draftFromRow({ id: "d", kind: "proforma", title: "t", saved_by: "x", updated_at: "2026-10-05T06:40:00Z",
      payload: { docNo: "PI/1", type: "international", partyId: party.id, items: [] } });
    expect(valueOf(draw(<ProformaForm type="international" draft={draft} {...noop} />), "Date")).toBe(todayIST());
  });

  it("is sent when the proforma is saved, and kept in a draft", () => {
    expect(PROFORMA_KEYS).toContain("docDate");
    expect(RPC_CONTRACT.save_proforma).toContain("docDate");
    expect(pick({ docNo: "1", docDate: "2026-09-25", date: "2026-09-25" }, PROFORMA_KEYS)).toEqual({ docNo: "1", docDate: "2026-09-25" });
    expect(form).toContain("docNo: docNo.trim(), docDate, type, date: docDate, partyId, quotationRef,");
    expect(form).toContain("docNo, docDate, type, partyId, quotationRef, orderNo, orderDate, items, extra, taxRate,");
  });

  it("the edit note no longer says the date cannot change", () => {
    const html = draw(<ProformaForm type="international" editing={fromParty} {...noop} />);
    expect(html).toContain("Editing PI/26-27/021, dated 25/09/2026. The change is recorded in the audit log.");
    expect(html).not.toContain("does not change");
  });
});

describe("what the database does with the date", () => {
  it("a new proforma takes the date typed, or today when none is sent", () => {
    expect(save).toContain("v_date    date  := public._date(p ->> 'docDate', 'Proforma date');");
    expect(save).toMatch(/values \(\s+v_no,\s+coalesce\(v_date, public\.ist_today\(\)\), v_type, v_party,/);
  });

  it("an edit moves the date only when one is sent — an older copy of the console changes nothing", () => {
    expect(save).toContain("doc_date = coalesce(v_date, doc_date),");
  });

  it("a year that cannot be right is refused", () => {
    expect(save).toContain("v_date < date '2000-01-01' or v_date > date '2100-12-31'");
  });

  it("the rest of save_proforma is as db/022 left it", () => {
    const before = fnIn(text("db", "022_delete_proforma.sql"));
    const undo = save
      .replace("  v_date    date  := public._date(p ->> 'docDate', 'Proforma date');\n", "")
      .replace(/  -- The date can be typed \(db\/027\)[^\n]*\n  if v_date is not null and[^\n]*\n[^\n]*\n  end if;\n/, "")
      .replace("    -- Who raised it is not changed by an edit; the date changes only when one is sent.\n", "    -- The date it was raised and who raised it are not changed by an edit.\n")
      .replace("      doc_date = coalesce(v_date, doc_date),\n", "")
      .replace("    coalesce(v_date, public.ist_today()), v_type, v_party,", "    public.ist_today(), v_type, v_party,");
    expect(undo).toBe(before);
  });

  it("the console expects the migration", () => {
    expect(EXPECTED_MIGRATION).toBeGreaterThanOrEqual(27);
    expect(sql).toContain("values (27, 'proforma_date')");
  });
});

describe("Manual entry in the Party list", () => {
  it("the list offers every party of that kind, and Manual entry after them", () => {
    const options = [...box(draw(<ProformaForm type="international" {...noop} />), "Party").matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);
    expect(options).toEqual([[party.id, "Sample Importers Inc."], ["", "Manual entry — type the details"]]);
  });

  it("a party is still what a new proforma starts on — the summary and the party-master picker are as they were", () => {
    const html = draw(<ProformaForm type="international" {...noop} />);
    expect(chosen(html, "Party")).toEqual([party.id, "Sample Importers Inc."]);
    expect(html).toContain("+ Add product from the party master");
    expect(html).not.toContain("typed by hand");
    expect(labels(html)).not.toContain("Buyer name");
  });

  it("with no party of that kind on file the form opens on Manual entry instead of a dead end", () => {
    const html = draw(<ProformaForm type="domestic" {...noop} />, [party]);       // the only party is international
    expect(chosen(html, "Party")).toEqual(["", "Manual entry — type the details"]);
    expect(html).not.toContain("create one under Parties first");
    expect(labels(html)).toContain("Buyer name");
  });

  it("the buyer, the consignee, the terms and the conditions are typed in boxes", () => {
    const html = draw(<ProformaForm type="international" {...noop} />, []);
    for (const l of ["Buyer name", "Buyer address", "Consignee", "Consignee address", "Shipment term", "Payment term", "Currency", "Condition 1"]) {
      expect(labels(html), l).toContain(l);
    }
    expect(html).toContain("Add another condition");
    expect(html).toContain("Nothing is added to Parties.");
    // the pickers for a party's several names have no place here
    expect(labels(html)).not.toContain("Buyer on this proforma");
  });

  it("a private-label one says Ship to and Shipping address, and starts in rupees", () => {
    const html = draw(<ProformaForm type="domestic" {...noop} />, []);
    expect(labels(html)).toContain("Ship to");
    expect(labels(html)).toContain("Shipping address");
    expect(labels(html)).not.toContain("Consignee");
    expect(chosen(html, "Currency")).toEqual(["INR", "INR"]);
    expect(chosen(draw(<ProformaForm type="international" {...noop} />, []), "Currency")).toEqual(["USD", "USD"]);
  });

  it("the product lines are typed too, with units and weights per box for the packing list", () => {
    const html = draw(<ProformaForm type="international" {...noop} />, []);
    for (const h of ["Product", "HSN", "Units / box", "Net kg / box", "Gross kg / box", "Rate / box", "Box qty", "Amount"]) expect(html, h).toContain(`>${h}</th>`);
    expect(html).toMatch(/<\/svg>\s*Add product line<\/button>/);
    expect(html).not.toContain("+ Add product from the party master");
    expect(draw(<ProformaForm type="domestic" {...noop} />, [])).toContain(">MRP / box</th>");
  });
});

describe("a hand-typed proforma is saved from what was typed", () => {
  it("the typed details are read through the shape a party has, so the rest of the form does not care which it is", () => {
    expect(form).toContain("const isManual = partyId === MANUAL;");
    expect(form).toContain("buyerName: tidy(manual.buyerName), buyerAddress: tidy(manual.buyerAddress),");
    expect(form).toContain("conditions: conditionsToText(manual.conditions), products: [], consigneeOptions: [], altBuyers: [],");
    // and the buyer and consignee are simply what was typed — no index into a party's names
    expect(form).toContain("const buyer = isManual ? { name: party.buyerName, address: party.buyerAddress } :");
    expect(form).toContain("const consignee = isManual ? { name: party.consigneeName, address: party.consigneeAddress } :");
  });

  it("no party id is sent, and nothing is written to Parties", () => {
    expect(form).toContain('const MANUAL = "";');
    expect(form).not.toMatch(/call\("save_party"|save_party/);
  });

  it("a row left wholly empty is not a line, and typed figures are stored as numbers", () => {
    expect(form).toContain(".filter((l) => tidy(l.name) !== \"\" || toNumber(l.boxQty) !== 0 || toNumber(l.rate) !== 0 || toNumber(l.mrp) !== 0)");
    expect(form).toContain("packsPerBox: toNumber(l.packsPerBox), netWt: toNumber(l.netWt), grossWt: toNumber(l.grossWt) })));");
    expect(form).toContain("items: linesToSave(), additionalDetails: extra,");
    // a proforma from a party is saved exactly as before
    expect(form).toContain("const linesToSave = () => (!isManual ? items : items");
  });

  it("a draft keeps the typed details, and opens again as it was left", () => {
    expect(form).toContain("manual: isManual ? manual : undefined,");
    const draft = draftFromRow({ id: "d", kind: "proforma", title: "t", saved_by: "x", updated_at: "2026-10-10T06:40:00Z", payload: {
      docNo: "PI/9", docDate: "2026-09-25", type: "international", partyId: "", orderDate: "2026-09-20",
      manual: { buyerName: "Half Typed Buyer", buyerAddress: "", consigneeName: "", consigneeAddress: "", shipmentTerm: "CIF", paymentTerm: "", currency: "INR", conditions: ["One", "Two"] },
      items: [{ id: "t1", name: "Typed product", hsn: "2008", boxQty: "10", rate: "5", mrp: 0, packsPerBox: "12", netWt: "6", grossWt: "6.8" }],
    } });
    const html = draw(<ProformaForm type="international" draft={draft} {...noop} />);
    expect(chosen(html, "Party")).toEqual(["", "Manual entry — type the details"]);
    expect(valueOf(html, "Buyer name")).toBe("Half Typed Buyer");
    expect(valueOf(html, "Shipment term")).toBe("CIF");
    expect(chosen(html, "Currency")).toEqual(["INR", "INR"]);
    expect(valueOf(html, "Condition 2")).toBe("Two");
    expect(html).toMatch(/aria-label="Product 1"[^>]*value="Typed product"/);
    expect(html).toMatch(/aria-label="Net kg per box 1"[^>]*value="6"/);
    expect(html).not.toContain("no longer on file");
  });
});

describe("editing a hand-typed proforma", () => {
  const html = draw(<ProformaForm type="international" editing={handTyped} {...noop} />);

  it("opens on Manual entry with everything the proforma says, instead of 'no longer on file'", () => {
    expect(html).not.toContain("no longer on file");
    expect(chosen(html, "Party")).toEqual(["", "Manual entry — type the details"]);
    expect(valueOf(html, "Proforma no.")).toBe("PI/26-27/020");
    expect(valueOf(html, "Buyer name")).toBe("Hand Typed Buyer");
    expect(valueOf(html, "Buyer address")).toBe("1 Typed Road");
    expect(valueOf(html, "Consignee")).toBe("Typed Receiver");
    expect(valueOf(html, "Consignee address")).toBe("2 Typed Dock");
    expect(valueOf(html, "Shipment term")).toBe("CIF");
    expect(valueOf(html, "Payment term")).toBe("50% advance");
    expect(valueOf(html, "Condition 1")).toBe("First typed condition");
    expect(valueOf(html, "Condition 2")).toBe("Second typed condition");
    expect(valueOf(html, "Port of loading")).toBe("Mundra");
  });

  it("its lines come back in boxes, each figure as it was", () => {
    for (const [label, value] of [["Product 1", "Typed product 500g"], ["HSN 1", "20081100"], ["Units per box 1", "12"], ["Net kg per box 1", "6"], ["Gross kg per box 1", "6.8"], ["Rate per box 1", "12.3"], ["Box quantity 1", "4065"]]) {
      expect(html, label).toMatch(new RegExp(`aria-label="${label}"[^>]*value="${value.replace(/[.]/g, "\\.")}"`));
    }
    expect(html).toContain("Save changes");
  });

  it("a proforma whose party was since removed is still not edited from guesswork", () => {
    const orphan = proformaFromRow(piRow({ party_id: "99999999-9999-4999-8999-999999999999" }));
    expect(draw(<ProformaForm type="international" editing={orphan} {...noop} />)).toContain("no longer on file, so it cannot be edited here");
  });

  it("a proforma raised from a party still opens on that party", () => {
    const fromPartyHtml = draw(<ProformaForm type="international" editing={fromParty} {...noop} />);
    expect(chosen(fromPartyHtml, "Party")).toEqual([party.id, "Sample Importers Inc."]);
    expect(labels(fromPartyHtml)).not.toContain("Buyer name");
  });
});
