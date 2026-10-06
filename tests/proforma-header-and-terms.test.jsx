// The proforma's header block and Terms line (decisions/015). Class prevented:
// a number or date printed with no label saying what it is; an order number
// and its date run together; a rupee proforma announcing a currency nobody
// asked it to; the PDF and the Excel disagreeing about any of it.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { ProformaDocument } from "../src/app.jsx";
import { proformaSheetRows } from "../src/lib/documents.js";

const pi = (over = {}) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", docNo: "1", date: "2026-10-06", type: "domestic",
  buyerName: "Sample Buyer Ltd", buyerAddress: "Mumbai", consigneeName: "Sample Foods Pvt Ltd", consigneeAddress: "Bhandup, Mumbai",
  currency: "INR", shipmentTerm: "Ex- Factory", paymentTerm: "50% advance and rest 50% against goods received.",
  buyerOrderNo: "-", buyerOrderDate: "2026-10-05", conditions: "", additionalDetails: "",
  totalBoxes: 10, totalValue: 0, taxableValue: 15000, taxRate: 5, taxAmount: 750, grandTotal: 15750,
  items: [{ id: "l1", name: "Private Label PB 1kg", hsn: "20081100", boxQty: 10, rate: 0, mrp: 1500, packsPerBox: 6 }], ...over,
});
const usd = (over = {}) => pi({ type: "international", currency: "USD", shipmentTerm: "FOB", totalValue: 177.7, grandTotal: 177.7,
  items: [{ id: "l1", name: "Peanut Butter Creamy 340g", hsn: "20081100", boxQty: 10, rate: 17.77, mrp: 0, packsPerBox: 6 }], ...over });
const print = (p) => renderToString(<ProformaDocument pi={p} company={{}} />).replace(/<!-- -->/g, "");
const lines = (html) => [...html.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

describe("the header block says what each thing is", () => {
  it("the number is labelled PI No, the date PI Date", () => {
    const html = print(pi());
    expect(html).toContain("<b>PI No: 1</b>");
    expect(lines(html)).toContain("PI Date: 06/10/2026");
    // Neither appears bare, as it did before.
    expect(lines(html)).not.toContain("1");
    expect(lines(html)).not.toContain("Date: 06/10/2026");
  });

  it("the buyer's order number and its date are two labelled lines, in that order", () => {
    const all = lines(print(pi()));
    const at = all.indexOf("Buyer Order No: -");
    expect(at).toBeGreaterThan(-1);
    expect(all[at + 1]).toBe("Buyer Order Date: 05/10/2026");
    expect(all.some((l) => l.startsWith("Buyer order:"))).toBe(false);
    expect(all.some((l) => / of \d\d\/\d\d\/\d{4}/.test(l))).toBe(false);
  });

  it("the four lines come in the order: PI No, PI Date, Buyer Order No, Buyer Order Date", () => {
    const all = lines(print(pi({ docNo: "PI/25-26/014", buyerOrderNo: "PO-77" })));
    const at = all.indexOf("PI No: PI/25-26/014");
    expect(all.slice(at, at + 4)).toEqual(["PI No: PI/25-26/014", "PI Date: 06/10/2026", "Buyer Order No: PO-77", "Buyer Order Date: 05/10/2026"]);
  });

  it("a proforma with no buyer order prints neither order line", () => {
    const all = lines(print(pi({ buyerOrderNo: "" })));
    expect(all.some((l) => l.startsWith("Buyer Order"))).toBe(false);
    expect(all).toContain("PI Date: 06/10/2026");
  });

  it("the Excel sheet uses the same four labels", () => {
    const rows = proformaSheetRows(pi({ docNo: "PI/25-26/014", buyerOrderNo: "PO-77" }), {});
    expect(rows).toContainEqual(["PI No", "PI/25-26/014", "", "PI Date", "06/10/2026"]);
    expect(rows).toContainEqual(["Buyer Order No", "PO-77", "", "Buyer Order Date", "05/10/2026"]);
    expect(rows.some((r) => r[0] === "Proforma no." || r[0] === "Buyer order no." || r[3] === "Date" || r[3] === "Order date")).toBe(false);
  });
});

describe("the Terms line", () => {
  it("a rupee proforma does not say 'Currency: INR'", () => {
    const html = print(pi());
    expect(lines(html)).toContain("Shipment: Ex- Factory");
    expect(html).not.toContain("Currency: INR");
    expect(html).not.toMatch(/Shipment: Ex- Factory ·/);
    expect(lines(html)).toContain("Payment: 50% advance and rest 50% against goods received.");
  });

  it("the currency is still plain from the grand total and the amount in words", () => {
    const html = print(pi());
    expect(html).toContain("Grand total (INR)");
    expect(html).toMatch(/Amount in words: Rupees fifteen thousand seven hundred fifty/);
  });

  it("a dollar proforma still states its currency — an export buyer needs it", () => {
    expect(lines(print(usd()))).toContain("Shipment: FOB · Currency: USD");
  });

  it("the Excel sheet follows the same rule", () => {
    expect(proformaSheetRows(pi(), {}).some((r) => r[0] === "Currency")).toBe(false);
    expect(proformaSheetRows(usd(), {})).toContainEqual(["Currency", "USD"]);
    // The row before and after it are untouched.
    expect(proformaSheetRows(pi(), {})).toContainEqual(["Shipment term", "Ex- Factory", "", "Payment term", "50% advance and rest 50% against goods received."]);
  });
});
