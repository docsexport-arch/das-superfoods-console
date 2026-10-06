// The proforma number is typed by hand (db/013) and a proforma can be
// downloaded as PDF or Excel. Class prevented: a number the form collects but
// never sends; a number the database silently replaces with its own; a
// download that says something different from the screen, or carries a cell
// Excel would run as a formula.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, ProformaPage, ProformaForm, ProformaDocument } from "../src/app.jsx";
import { emptyStore, partyFromRow, draftFromRow } from "../src/lib/db.js";
import { proformaSheetRows, proformaLineAmount, proformaUnits, fileSafe, PROFORMA_SHEET_WIDTHS } from "../src/lib/documents.js";
import { defangRows } from "../src/lib/excel.js";
import { PROFORMA_KEYS, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const company = { name: "Das Superfoods Pvt. Ltd.", address: "Ahmedabad, Gujarat", bankName: "HDFC Bank", accountNo: "50200012345678", ifsc: "HDFC0000123", swift: "HDFCINBB", gstNo: "24AAAAA0000A1Z5", iecCode: "0312345678" };
const party = partyFromRow({
  id: "22222222-2222-4222-8222-222222222222", type: "international",
  buyer_name: "Crosschannel Imports Inc.", buyer_address: "Newark, NJ", consignee_name: "Crosschannel Logistics", consignee_address: "Port Newark",
  consignee_options: [], alt_buyers: [], country: "United States", currency: "USD", shipment_term: "FOB", payment_term: "30% advance",
  conditions: "", port_of_loading: "Mundra", destination_port: "New York",
}, [{ id: "11111111-1111-4111-8111-111111111111", name: "Peanut Butter Creamy 340g", hsn: "20081100", rate: 17.77, mrp: 0, net_wt: 1.36, gross_wt: 1.52, packs_per_box: 6, weight_per_pack_g: 0 }]);

const line = (name, boxQty, rate, mrp = 0) => ({ id: name, name, hsn: "20081100", boxQty, rate, mrp, netWt: 1.36, grossWt: 1.52, packsPerBox: 6 });
const intl = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", docNo: "PI/25-26/014", date: "2026-10-05", type: "international", partyId: party.id,
  buyerName: "Crosschannel Imports Inc.", buyerAddress: "Newark, NJ", consigneeName: "Crosschannel Logistics", consigneeAddress: "Port Newark",
  consigneeOptions: [], portOfLoading: "Mundra", destinationPort: "New York", shipmentTerm: "FOB", paymentTerm: "30% advance",
  conditions: "Subject to Ahmedabad jurisdiction", currency: "USD", buyerOrderNo: "PO-77", buyerOrderDate: "2026-10-01", additionalDetails: "",
  totalBoxes: 3200, totalValue: 56864, taxableValue: 0, taxRate: 0, taxAmount: 0, grandTotal: 56864,
  items: [line("Peanut Butter Creamy 340g", 2000, 17.77), line("Peanut Butter Crunchy 340g", 1200, 17.77)], linkedFinalInvoiceId: null,
};
const domestic = {
  ...intl, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", docNo: "PL-0009", type: "domestic", currency: "INR",
  totalBoxes: 100, totalValue: 0, taxableValue: 150000, taxRate: 5, taxAmount: 7500, grandTotal: 157500,
  items: [line("Private Label PB 1kg", 100, 0, 1500)], additionalDetails: "Buyer's label supplied",
};

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, extra = {}) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), company, parties: [party], pis: [intl], users: [admin], ...extra },
    user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");

describe("the proforma number is typed, not allocated", () => {
  it("the form asks for it, and it is part of what is sent", () => {
    const html = draw(<ProformaForm type="international" onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Proforma no.");
    expect(html).toContain("it must not repeat");
    expect(PROFORMA_KEYS).toContain("docNo");
    expect(pick({ docNo: "PI/25-26/014", type: "international", junk: 1 }, PROFORMA_KEYS)).toEqual({ docNo: "PI/25-26/014", type: "international" });
  });

  it("a draft keeps the number that was typed", () => {
    const draft = draftFromRow({ id: "d1", kind: "proforma", title: "t", saved_by: "x", updated_at: "2026-10-05T06:40:00Z",
      payload: { docNo: "PI/25-26/015", type: "international", partyId: party.id, items: [] } });
    const html = draw(<ProformaForm type="international" draft={draft} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />);
    expect(html).toMatch(/value="PI\/25-26\/015"/);
  });

  it("the database function uses the typed number and has stopped allocating one", () => {
    const sql = readFileSync(join(ROOT, "db", "013_manual_proforma_number.sql"), "utf8");
    const fn = /create or replace function public\.create_proforma\(p jsonb\)[\s\S]*?\n\$\$;/.exec(sql)[0];
    expect(fn).toContain("p ->> 'docNo'");
    expect(fn).not.toContain("_alloc_doc_no");
    // present, plain characters, and not a repeat — whatever the capitals or spaces
    expect(fn).toMatch(/if v_no = '' then/);
    expect(fn).toContain("v_no !~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]*$'");
    expect(fn).toContain("upper(btrim(doc_no)) = upper(v_no)");
    expect(sql).toMatch(/create unique index if not exists proformas_doc_no_ci\s+on public\.proformas \(upper\(btrim\(doc_no\)\)\)/);
  });

  it("the number rule the database applies accepts ordinary numbers and refuses the rest", () => {
    const rule = /^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/;
    for (const ok of ["DS-PI-INTL-2026-0002", "PI/25-26/014", "PL 0009", "14", "A.1_b"]) expect(rule.test(ok), ok).toBe(true);
    for (const bad of ["", "-14", " 14", "PI#14", "=14", "PI\\14", "PI,14"]) expect(rule.test(bad), bad).toBe(false);
  });
});

describe("the proforma as rows — what the Excel download contains", () => {
  const rows = proformaSheetRows(intl, company);
  const find = (label) => rows.find((r) => r[0] === label);

  it("carries the letterhead, the number as typed, both parties and the terms", () => {
    expect(rows[0]).toEqual(["Das Superfoods Pvt. Ltd."]);
    expect(rows[2][0]).toBe("GST 24AAAAA0000A1Z5   IEC 0312345678");
    expect(find("Proforma no.")).toEqual(["Proforma no.", "PI/25-26/014", "", "Date", "05/10/2026"]);
    expect(find("Buyer order no.")).toEqual(["Buyer order no.", "PO-77", "", "Order date", "01/10/2026"]);
    expect(find("Buyer")).toEqual(["Buyer", "Crosschannel Imports Inc.", "", "Consignee", "Crosschannel Logistics"]);
    expect(find("Port of loading")).toEqual(["Port of loading", "Mundra", "", "Destination port", "New York"]);
    expect(find("Shipment term")).toEqual(["Shipment term", "FOB", "", "Payment term", "30% advance"]);
  });

  it("lists every line with boxes AND units, as numbers", () => {
    const head = rows.findIndex((r) => r[0] === "#");
    expect(rows[head]).toEqual(["#", "Product", "HSN", "Boxes", "Units", "Rate / box", "Amount"]);
    expect(rows[head + 1]).toEqual([1, "Peanut Butter Creamy 340g", "20081100", 2000, 12000, 17.77, 35540]);
    expect(rows[head + 2]).toEqual([2, "Peanut Butter Crunchy 340g", "20081100", 1200, 7200, 17.77, 21324]);
    expect(rows[head + 3]).toEqual(["", "", "Total", 3200, 19200, "", 56864]);
  });

  it("the lines add up to the stored total — the sheet never disagrees with the proforma", () => {
    const sum = intl.items.reduce((s, l) => s + proformaLineAmount(intl, l), 0);
    expect(Math.round(sum * 100) / 100).toBe(intl.totalValue);
    expect(proformaUnits(intl)).toBe(19200);
  });

  it("ends with the amount in words and the bank; the account number stays text", () => {
    expect(find("Amount in words")[1]).toBe("US Dollars fifty six thousand eight hundred sixty four only");
    expect(find("Conditions")).toEqual(["Conditions", "Subject to Ahmedabad jurisdiction"]);
    expect(find("Bank")).toEqual(["Bank", "HDFC Bank"]);
    expect(find("Account Number")[1]).toBe("50200012345678");
    expect(typeof find("Account Number")[1]).toBe("string");
    expect(find("Swift Code")).toEqual(["Swift Code", "HDFCINBB"]);
  });

  it("a private-label proforma is priced by MRP and shows tax and grand total", () => {
    const d = proformaSheetRows(domestic, company);
    const head = d.findIndex((r) => r[0] === "#");
    expect(d[head].slice(5)).toEqual(["MRP / box", "Taxable value"]);
    expect(d[head + 1]).toEqual([1, "Private Label PB 1kg", "20081100", 100, 600, 1500, 150000]);
    expect(d).toContainEqual(["", "", "", "", "", "Tax @ 5%", 7500]);
    expect(d).toContainEqual(["", "", "", "", "", "Grand total", 157500]);
    expect(d.find((r) => r[0] === "Buyer")[3]).toBe("Manufactured by / ship to");
    expect(d.find((r) => r[0] === "Additional details")).toEqual(["Additional details", "Buyer's label supplied"]);
    expect(d.find((r) => r[0] === "Amount in words")[1]).toMatch(/^Rupees one lakh fifty seven thousand five hundred/);
  });

  it("no company profile on hand still produces a sheet", () => {
    const bare = proformaSheetRows(intl, undefined);
    expect(bare[0]).toEqual(["Das Superfoods"]);
    expect(bare.find((r) => r[0] === "Bank")).toEqual(["Bank", ""]);
  });

  it("every row fits the seven columns the sheet is given", () => {
    expect(PROFORMA_SHEET_WIDTHS).toHaveLength(7);
    for (const r of [...rows, ...proformaSheetRows(domestic, company)]) expect(r.length).toBeLessThanOrEqual(7);
  });

  it("text that Excel would run as a formula is neutralised on the way out; numbers are not touched", () => {
    const hostile = proformaSheetRows({ ...intl, buyerName: "=HYPERLINK(\"http://x\")", items: [line("+cmd", 1, 2)] }, company);
    const safe = defangRows(hostile);
    expect(safe.find((r) => r[0] === "Buyer")[1]).toBe("'=HYPERLINK(\"http://x\")");
    expect(safe[safe.findIndex((r) => r[0] === "#") + 1].slice(0, 2)).toEqual([1, "'+cmd"]);
    expect(defangRows([[-5, null, undefined, "ok"]])).toEqual([[-5, "", "", "ok"]]);
  });

  it("a typed number becomes a usable file name", () => {
    expect(fileSafe("PI/25-26/014")).toBe("PI-25-26-014");
    expect(fileSafe("  DS-PI-INTL-2026-0001 ")).toBe("DS-PI-INTL-2026-0001");
    expect(fileSafe("///")).toBe("document");
    expect(fileSafe(null)).toBe("document");
  });
});

describe("the proforma on screen and on paper", () => {
  it("each proforma in the list has a Download control named after it", () => {
    const html = draw(<ProformaPage />);
    expect(html).toContain("PI/25-26/014");
    expect(html).toMatch(/aria-label="Download PI\/25-26\/014"/);
    expect(html).toMatch(/<th[^>]*>Actions<\/th>/);
  });

  it("the printed page says the same as the sheet: number, parties, lines, totals, words, bank", () => {
    const html = draw(<ProformaDocument pi={intl} company={company} />);
    for (const s of [
      "Proforma invoice", "PI/25-26/014", "Date: 05/10/2026", "Buyer order: PO-77 of 01/10/2026",
      "Das Superfoods Pvt. Ltd.", "GST 24AAAAA0000A1Z5", "Crosschannel Imports Inc.", "Crosschannel Logistics",
      "Loading: Mundra", "Destination: New York", "Shipment: FOB", "Payment: 30% advance",
      "Peanut Butter Crunchy 340g", "12000", "35,540.00", "19200", "56,864.00",
      "US Dollars fifty six thousand eight hundred sixty four only",
      "<b>Bank:</b> HDFC Bank", "<b>Account Number:</b> 50200012345678", "<b>Swift Code:</b> HDFCINBB", "Authorised signatory",
    ]) expect(html, s).toContain(s);
    // No IFSC on any document, even though this company fixture still carries one.
    expect(html).not.toMatch(/IFSC/i);
    expect(html).not.toContain("HDFC0000123");
    expect(html).not.toContain("Tax @");
  });

  it("a private-label proforma prints MRP, tax and the rupee grand total", () => {
    const html = draw(<ProformaDocument pi={domestic} company={company} />);
    for (const s of ["PL-0009", "MRP / box", "Taxable value", "Tax @ 5.00%", "7,500.00", "Grand total (INR)", "1,57,500.00", "Manufactured by / ship to"]) {
      expect(html, s).toContain(s);
    }
  });
});
