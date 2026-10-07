// Editing a shipment and downloading its three documents (db/016,
// decisions/016). Class prevented: the PDF and the Excel giving different
// figures; a document re-doing the arithmetic and drifting from the stored
// totals; an edit moving an invoice number, date or the company block; a
// create-only entry point being turned into an edit; a bank detail guessed.
//
// Every bank value in this file is made up.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, ShipmentsPage, ShipmentForm, ShipmentDocuments } from "../src/app.jsx";
import { emptyStore, shipmentFromRow } from "../src/lib/db.js";
import {
  shipmentModel, shipmentCompany, taxInvoiceRows, commercialInvoiceRows, packingListRows, shipmentSheets,
  SHIPMENT_PRICE_WIDTHS, SHIPMENT_PACKING_WIDTHS,
} from "../src/lib/shipment-docs.js";
import { defangRows } from "../src/lib/excel.js";
import { SHIPMENT_KEYS, RPC_CONTRACT, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql016 = readFileSync(join(ROOT, "db", "016_edit_shipment.sql"), "utf8").replace(/\r\n/g, "\n");
const fn = (name) => new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(sql016)[0];
const appSource = readFileSync(join(ROOT, "src", "app.jsx"), "utf8");

const line = (over = {}) => ({ id: "l1", name: "Peanut Butter Creamy 340g", hsn: "20081100", boxQty: 240, rate: 17.77, mrp: 0, netWt: 1.36, grossWt: 1.52, packsPerBox: 4,
  batchNo: "B-2291", mfgDate: "2026-10-01", expDate: "2027-09-30", ...over });
const pi = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", docNo: "PI/25-26/014", date: "2026-10-03", type: "international", currency: "USD",
  buyerName: "Crosschannel Imports Inc.", buyerAddress: "Newark, NJ", consigneeName: "Crosschannel Logistics", consigneeAddress: "Port Newark",
  consigneeOptions: ["Crosschannel Logistics", "Crosschannel Imports Inc."], portOfLoading: "Mundra", destinationPort: "New York", shipmentTerm: "CIF",
  buyerOrderNo: "PO-77", buyerOrderDate: "2026-10-01", items: [line({ boxQty: 250, batchNo: undefined })], linkedFinalInvoiceId: "ssssssss",
};
// 240 × 17.77 = 4,264.80; + 120 freight = 4,384.80 USD; × 83.25 = 3,65,034.60 INR; 5% GST = 18,251.73.
const shipmentRow = (over = {}) => ({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", doc_no: "DS-INV-2026-0007", tax_doc_no: "DS-INV-2026-0007-TAX", commercial_doc_no: "DS-INV-2026-0007-COM",
  doc_date: "2026-10-06", proforma_id: pi.id, proforma_no: pi.docNo, proforma_date: "2026-10-03",
  buyer_name: pi.buyerName, buyer_address: pi.buyerAddress, order_no: "PO-77", order_date: "2026-10-01",
  exchange_rate: 83.25, container_no: "MSKU7654321", vehicle_no: "GJ01AB1234", customs_seal: "CS-1", line_seal: "LS-2",
  port_of_loading: "Mundra", incoterm: "CIF", gst_percent: 5, round_off: 0, freight: 120, other_adjustment: 0, other_reason: "",
  tax_invoice: { consignee: "TO THE ORDER", currency: "INR", total: 365034.6, gst: 18251.73, roundOff: 0, grandTotal: 383286.33 },
  commercial_invoice: { consignee: "Crosschannel Logistics", currency: "USD", total: 4384.8 },
  packing_list: { totalBoxes: 240, totalPacks: 960, netWeight: 326.4, grossWeight: 364.8, grandTotal: 691.2 },
  company_snapshot: { name: "Example Foods Pvt. Ltd.", address: "1 Sample Road, Testville", gstNo: "24AAAAA0000A1Z5", iecCode: "0312345678",
    accountName: "EXAMPLE FOODS PRIVATE LIMITED", bankName: "Sample Bank", bankBranch: "Sample Bank Main Branch, Testville", accountNo: "00123456789012", swift: "SAMPINBBXXX" },
  items: [line()], updated_at: "2026-10-06T09:30:00+00:00", ...over,
});
const s = shipmentFromRow(shipmentRow());
const company = shipmentCompany(s.company, {});

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, extra = {}) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), pis: [pi], finalInvoices: [s], users: [admin], ...extra },
    user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");
const find = (rows, label) => rows.find((r) => r.includes(label));

describe("one reading of the shipment", () => {
  const m = shipmentModel(s, pi);

  it("prices the lines in the currency of the proforma, by rate for an international one", () => {
    expect(m).toMatchObject({ intl: true, currency: "USD", subtotal: 4264.8, freight: 120, docTotal: 4384.8, exchangeRate: 83.25, converted: true });
    expect(m.lines[0]).toMatchObject({ no: 1, boxes: 240, units: 960, price: 17.77, amount: 4264.8, net: 326.4, gross: 364.8, batchNo: "B-2291" });
  });

  it("takes every total from what the database stored, not from its own sums", () => {
    const odd = shipmentModel(shipmentFromRow(shipmentRow({ tax_invoice: { consignee: "X", total: 1, gst: 2, roundOff: 3, grandTotal: 6 },
      commercial_invoice: { consignee: "Y", currency: "USD", total: 9 }, packing_list: { totalBoxes: 7, totalPacks: 8, netWeight: 1.5, grossWeight: 2.5 } })), pi);
    expect(odd.tax).toMatchObject({ total: 1, gst: 2, roundOff: 3, grandTotal: 6 });
    expect(odd.commercial.total).toBe(9);
    expect(odd.packing).toEqual({ boxes: 7, units: 8, net: 1.5, gross: 2.5 });
  });

  it("its document total follows the same rule as the database, so the stored rupee total is that total at the rate", () => {
    expect(Math.round(m.docTotal * m.exchangeRate * 100) / 100).toBe(m.tax.total);
    expect(Math.round(m.tax.total * m.tax.gstPercent) / 100).toBe(m.tax.gst);
    expect(Math.round((m.tax.total + m.tax.gst + m.tax.roundOff) * 100) / 100).toBe(m.tax.grandTotal);
  });

  it("a private-label shipment is priced by MRP, in rupees, with no conversion", () => {
    const inrPi = { ...pi, type: "domestic", currency: "INR" };
    const d = shipmentModel(shipmentFromRow(shipmentRow({ exchange_rate: 1, freight: 0, items: [line({ boxQty: 10, rate: 0, mrp: 1500 })],
      tax_invoice: { consignee: "TO THE ORDER", total: 15000, gst: 750, roundOff: 0, grandTotal: 15750 }, commercial_invoice: { consignee: "X", currency: "INR", total: 15000 } })), inrPi);
    expect(d).toMatchObject({ intl: false, currency: "INR", subtotal: 15000, docTotal: 15000, converted: false });
    expect(d.commercial.converted).toBe(false);
  });

  it("without the proforma it refuses, rather than guessing the pricing basis or the currency", () => {
    expect(() => shipmentModel(s, null)).toThrow(/PI\/25-26\/014.*could not be loaded/);
  });
});

describe("the company block on a shipment's documents", () => {
  it("is the one stored on the shipment", () => {
    expect(company).toMatchObject({ accountName: "EXAMPLE FOODS PRIVATE LIMITED", bankBranch: "Sample Bank Main Branch, Testville", swift: "SAMPINBBXXX" });
  });

  it("a shipment invoiced before the profile had account name and branch takes just those two from the profile", () => {
    const old = shipmentCompany({ name: "Old Name Ltd", bankName: "Sample Bank", accountNo: "001" }, { name: "New Name Ltd", bankName: "Other Bank", accountName: "EXAMPLE BENEFICIARY", bankBranch: "Main Branch" });
    expect(old).toMatchObject({ name: "Old Name Ltd", bankName: "Sample Bank", accountNo: "001", accountName: "EXAMPLE BENEFICIARY", bankBranch: "Main Branch" });
  });

  it("a value stored on the shipment wins, even a blank one — nothing is back-filled over it", () => {
    expect(shipmentCompany({ accountName: "", bankBranch: "" }, { accountName: "LATER NAME", bankBranch: "Later Branch" })).toMatchObject({ accountName: "", bankBranch: "" });
    expect(shipmentCompany(null, null)).toMatchObject({ accountName: "", bankBranch: "" });
  });
});

describe("the Excel workbook — one sheet per document", () => {
  const tax = taxInvoiceRows(s, pi, company), com = commercialInvoiceRows(s, pi, company), pack = packingListRows(s, pi, company);

  it("has the three sheets, in the order they are used", () => {
    expect(shipmentSheets(s, pi, company).map((x) => x.name)).toEqual(["Tax invoice", "Commercial invoice", "Packing list"]);
    for (const r of [...tax, ...com]) expect(r.length).toBeLessThanOrEqual(SHIPMENT_PRICE_WIDTHS.length);
    for (const r of pack) expect(r.length).toBeLessThanOrEqual(SHIPMENT_PACKING_WIDTHS.length);
  });

  it("each sheet is headed with its own number, and every number and date is labelled", () => {
    expect(tax).toContainEqual(["TAX INVOICE"]);
    expect(tax).toContainEqual(["Invoice No", "DS-INV-2026-0007-TAX", "", "Invoice Date", "06/10/2026"]);
    expect(com).toContainEqual(["Invoice No", "DS-INV-2026-0007-COM", "", "Invoice Date", "06/10/2026"]);
    expect(pack).toContainEqual(["Invoice No", "DS-INV-2026-0007", "", "Invoice Date", "06/10/2026"]);
    for (const sheet of [tax, com, pack]) {
      expect(sheet).toContainEqual(["PI No", "PI/25-26/014", "", "PI Date", "03/10/2026"]);
      expect(sheet).toContainEqual(["Buyer Order No", "PO-77", "", "Buyer Order Date", "01/10/2026"]);
      expect(sheet).toContainEqual(["Container No", "MSKU7654321", "", "Vehicle No", "GJ01AB1234"]);
    }
  });

  it("the tax invoice names only its consignee — the buyer stays off it", () => {
    expect(tax).toContainEqual(["Consignee", "TO THE ORDER"]);
    expect(JSON.stringify(tax)).not.toContain("Crosschannel");
  });

  it("the tax invoice runs from the lines to the rupee grand total", () => {
    const head = tax.findIndex((r) => r[0] === "#");
    expect(tax[head]).toEqual(["#", "Product", "HSN", "Boxes", "Units", "Rate / box (USD)", "Amount (USD)"]);
    expect(tax[head + 1]).toEqual([1, "Peanut Butter Creamy 340g", "20081100", 240, 960, 17.77, 4264.8]);
    expect(tax.slice(head + 2, head + 9)).toEqual([
      ["", "", "Total", 240, 960, "", 4264.8],
      ["", "", "", "", "", "Freight", 120],
      ["", "", "", "", "", "Total (USD)", 4384.8],
      ["", "", "", "", "", "Exchange rate (INR per USD)", 83.25],
      ["", "", "", "", "", "Taxable value (INR)", 365034.6],
      ["", "", "", "", "", "GST @ 5%", 18251.73],
      ["", "", "", "", "", "Grand total (INR)", 383286.33],
    ]);
    expect(find(tax, "Amount in words")[1]).toMatch(/^Rupees three lakh eighty three thousand two hundred eighty six and thirty three paise only$/);
  });

  it("the commercial invoice names buyer and consignee, totals in its own currency, and ends with the bank details", () => {
    expect(com).toContainEqual(["Buyer", "Crosschannel Imports Inc.", "", "Consignee", "Crosschannel Logistics"]);
    expect(com).toContainEqual(["", "", "", "", "", "Total (USD)", 4384.8]);
    expect(com.some((r) => String(r[5] || "").startsWith("Exchange rate"))).toBe(false);
    expect(find(com, "Amount in words")[1]).toBe("US Dollars four thousand three hundred eighty four and eighty cents only");
    const at = com.findIndex((r) => r[0] === "BANK DETAILS FOR TRANSFER");
    expect(com.slice(at + 1)).toEqual([
      ["Account Name", "EXAMPLE FOODS PRIVATE LIMITED"], ["Bank", "Sample Bank"], ["Branch", "Sample Bank Main Branch, Testville"],
      ["Account Number", "00123456789012"], ["Swift Code", "SAMPINBBXXX"],
    ]);
    expect(typeof defangRows(com).find((r) => r[0] === "Account Number")[1]).toBe("string");
  });

  it("a commercial invoice issued in rupees for a dollar proforma shows the rate and the rupee total", () => {
    const inr = shipmentFromRow(shipmentRow({ commercial_invoice: { consignee: "Crosschannel Logistics", currency: "INR", total: 365034.6 } }));
    const rows = commercialInvoiceRows(inr, pi, company);
    expect(rows).toContainEqual(["", "", "", "", "", "Exchange rate (INR per USD)", 83.25]);
    expect(rows).toContainEqual(["", "", "", "", "", "Total (INR)", 365034.6]);
    expect(find(rows, "Amount in words")[1]).toMatch(/^Rupees three lakh sixty five thousand thirty four/);
  });

  it("the packing list gives batch and dates, boxes AND units, weights and the tonnes", () => {
    const head = pack.findIndex((r) => r[0] === "#");
    expect(pack[head]).toEqual(["#", "Product", "Batch", "MFG", "EXP", "Boxes", "Units", "Net kg", "Gross kg"]);
    expect(pack[head + 1]).toEqual([1, "Peanut Butter Creamy 340g", "B-2291", "01/10/2026", "30/09/2027", 240, 960, 326.4, 364.8]);
    expect(pack[head + 2]).toEqual(["", "", "", "", "Total", 240, 960, 326.4, 364.8]);
    expect(pack[head + 3]).toEqual(["", "", "", "", "Tonnes", "", "", 0.326, 0.365]);
    expect(pack).toContainEqual(["Customs seal", "CS-1", "", "Line seal", "LS-2"]);
    // A packing list carries no prices.
    expect(JSON.stringify(pack)).not.toMatch(/17\.77|4264\.8|Rate|Amount/);
  });

  it("no sheet mentions IFSC", () => {
    const withIfsc = shipmentCompany({ ...s.company, ifsc: "SAMP0000001" }, {});
    expect(JSON.stringify(shipmentSheets(s, pi, withIfsc).map((x) => x.rows))).not.toMatch(/IFSC|SAMP0000001/i);
  });
});

describe("the printed set — three pages", () => {
  const html = draw(<ShipmentDocuments s={s} pi={pi} company={company} />);
  const pages = html.split('<div class="doc">').slice(1);

  it("is three documents, each its own page, in order", () => {
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("<h1>Tax invoice</h1>");
    expect(pages[1]).toContain("<h1>Commercial invoice</h1>");
    expect(pages[2]).toContain("<h1>Packing list</h1>");
    expect(readFileSync(join(ROOT, "src", "tokens.css"), "utf8")).toMatch(/#print-portal \.doc \+ \.doc \{ break-before: page;/);
  });

  it("says what the workbook says", () => {
    for (const x of ["Invoice No: DS-INV-2026-0007-TAX", "Invoice Date: 06/10/2026", "PI No: PI/25-26/014", "PI Date: 03/10/2026", "Buyer Order No: PO-77",
      "TO THE ORDER", "Rate / box (USD)", "4,264.80", "Freight", "Total (USD)", "4,384.80", "Exchange rate (INR per USD)", "83.25",
      "Taxable value (INR)", "3,65,034.60", "GST @ 5%", "18,251.73", "Grand total (INR)", "3,83,286.33"]) expect(pages[0], x).toContain(x);
    expect(pages[0]).not.toContain("Crosschannel");
    for (const x of ["Invoice No: DS-INV-2026-0007-COM", "Crosschannel Imports Inc.", "Crosschannel Logistics", "US Dollars four thousand three hundred eighty four and eighty cents only",
      "BANK DETAILS FOR TRANSFER", "<b>Account Name:</b> EXAMPLE FOODS PRIVATE LIMITED", "<b>Branch:</b> Sample Bank Main Branch, Testville", "<b>Swift Code:</b> SAMPINBBXXX"]) {
      expect(pages[1], x).toContain(x);
    }
    for (const x of ["Invoice No: DS-INV-2026-0007", "B-2291", "01/10/2026", "30/09/2027", "326.400", "364.800", "Tonnes", "0.326", "Customs seal: CS-1", "Line seal: LS-2", "Container No: MSKU7654321"]) {
      expect(pages[2], x).toContain(x);
    }
    expect(pages[2]).not.toMatch(/17\.77|4,264\.80/);
    expect(html).not.toMatch(/IFSC/i);
  });

  it("a bank detail that is not on file prints as missing", () => {
    const bare = draw(<ShipmentDocuments s={s} pi={pi} company={shipmentCompany({ name: "Example Foods" }, {})} />);
    expect(bare).toContain("<b>Account Name:</b> —");
    expect(bare).toContain("<b>Account Number:</b> —");
  });
});

describe("the shipments list and the edit form", () => {
  it("every shipment offers View set, Edit and Download", () => {
    const html = draw(<ShipmentsPage />);
    expect(html).toMatch(/<th[^>]*>Actions<\/th>/);
    expect(html).toContain("View set");
    expect(html).toMatch(/aria-label="Edit DS-INV-2026-0007"/);
    expect(html).toMatch(/aria-label="Download DS-INV-2026-0007"/);
  });

  it("the edit form opens with the shipment as it stands, and saves rather than generates", () => {
    const html = draw(<ShipmentForm pi={pi} editing={s} onSave={async () => {}} onCancel={() => {}} error="" />);
    expect(html).toContain("Edit shipment DS-INV-2026-0007");
    expect(html).toContain("The invoice numbers and date do not change");
    for (const v of ["83.25", "MSKU7654321", "GJ01AB1234", "CS-1", "LS-2", "B-2291", "2027-09-30", "240", "120", "TO THE ORDER"]) {
      expect(html, v).toMatch(new RegExp(`value="${v}"`));
    }
    expect(html).toMatch(/<option value="Crosschannel Logistics" selected="">/);
    expect(html).toContain("Save changes");
    expect(html).not.toContain("Generate document set");
    expect(html).not.toContain("Save draft");
  });

  it("the consignee already on the shipment stays on offer even if the proforma no longer lists it", () => {
    const other = shipmentFromRow(shipmentRow({ commercial_invoice: { consignee: "Somebody Else FZE", currency: "USD", total: 4384.8 } }));
    const html = draw(<ShipmentForm pi={pi} editing={other} onSave={async () => {}} onCancel={() => {}} error="" />);
    expect(html).toMatch(/<option value="Somebody Else FZE" selected="">/);
  });

  it("an edit carries the id and the version it was opened from; a new shipment carries neither", () => {
    expect(s.updatedAt).toBe("2026-10-06T09:30:00+00:00");
    for (const k of ["id", "expectedUpdatedAt", "piId", "items"]) expect(SHIPMENT_KEYS).toContain(k);
    expect(Object.keys(pick({ id: undefined, expectedUpdatedAt: undefined, piId: "p", items: [] }, SHIPMENT_KEYS)).sort()).toEqual(["items", "piId"]);
    expect(RPC_CONTRACT.save_shipment).toBe(SHIPMENT_KEYS);
    expect(RPC_CONTRACT.create_shipment).toBeUndefined();
    expect(appSource).toContain('call("save_shipment"');
    expect(appSource).not.toContain('call("create_shipment"');
  });
});

describe("what the database does with an edit", () => {
  const body = fn("save_shipment");
  const update = /update public\.shipments set([\s\S]*?)returning \* into v_row;/.exec(body)[1];

  it("only from the version that was opened, with the row locked", () => {
    expect(body).toMatch(/from public\.shipments where id = v_id and deleted_at is null for update;/);
    expect(body).toMatch(/v_old\.updated_at <> \(p ->> 'expectedUpdatedAt'\)::timestamptz/);
    expect(body).toContain("has_access('shipments')");
  });

  it("does not move the invoice numbers, the date, the proforma, the buyer, the author or the company block", () => {
    expect(update).not.toMatch(/\b(doc_no|tax_doc_no|commercial_doc_no|doc_date|proforma_id|proforma_no|proforma_date|buyer_name|buyer_address|order_no|order_date|company_snapshot|created_by|created_at)\s*=/);
    expect(body).toContain("'Shipment edited', 'shipment', v_row.id::text");
    expect(body).toContain("to_jsonb(v_old), to_jsonb(v_row)");
  });

  it("works every total out once, for invoicing and editing alike, and takes no new number on an edit", () => {
    for (const once of ["into v_boxes, v_packs, v_net, v_gross, v_base", "v_inr_total := round(v_doc_total * v_exch, 2);",
      "'grandTotal', v_inr_total + v_gst + v_round", "'currency', v_com_cur, 'total', v_com_total", "'grandTotal', v_net + v_gross"]) {
      expect(body.split(once), once).toHaveLength(2);
    }
    expect(update).toContain("tax_invoice = v_tax_doc, commercial_invoice = v_com_doc, packing_list = v_pack");
    // The edit returns before the number is allocated.
    expect(body.indexOf("return jsonb_build_object('id', v_row.id, 'doc_no', v_row.doc_no);")).toBeLessThan(body.indexOf("v_no := public._alloc_doc_no('final');"));
    const defined = readdirSync(join(ROOT, "db")).filter((f) => f.endsWith(".sql"))
      .filter((f) => /^create or replace function public\.save_shipment\(/m.test(readFileSync(join(ROOT, "db", f), "utf8")));
    expect(defined).toEqual(["016_edit_shipment.sql"]);
  });

  it("the company block on a new shipment has account name and branch, and no IFSC", () => {
    expect(body).toContain("'accountName', c.account_name, 'bankBranch', c.bank_branch,");
    expect(body).not.toMatch(/ifsc/i);
  });

  it("the two entry points that only create cannot be turned into an edit", () => {
    for (const name of ["create_shipment", "raise_from_draft"]) {
      expect(fn(name), name).toContain("public.save_shipment(p - 'id' - 'expectedUpdatedAt')");
      expect(fn(name), name).toMatch(/has_access\(/);
    }
    expect(fn("create_shipment")).not.toMatch(/insert into|update public/);
    expect(fn("raise_from_draft")).toContain("public.save_proforma(p - 'id' - 'expectedUpdatedAt')");
  });
});
