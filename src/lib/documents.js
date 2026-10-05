// What a document says, as plain rows — shared by the printed page and the
// Excel download so the two can never disagree. No arithmetic beyond a line's
// own amount: the totals are the ones the database computed and stored.
import { fmtDate, toNumber, unitsFromBoxes, amountInWords } from "./format.js";

// An international proforma is priced by rate; a private-label one by MRP.
export const proformaLineAmount = (pi, line) =>
  Math.round(toNumber(line.boxQty) * toNumber(pi.type === "international" ? line.rate : line.mrp) * 100) / 100;

export const proformaUnits = (pi) =>
  (pi.items || []).reduce((sum, line) => sum + unitsFromBoxes(line.boxQty, line.packsPerBox), 0);

// A typed number can hold "/" or spaces; a file name cannot.
export const fileSafe = (text) => String(text || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";

export const PROFORMA_SHEET_WIDTHS = [18, 38, 14, 18, 14, 16, 18];

/* The proforma as a sheet: letterhead, the parties, the terms, the lines, the
   totals, the bank. Seven columns wide; every row is an array of cells.     */
export function proformaSheetRows(pi, company = {}) {
  const intl = pi.type === "international";
  const lines = pi.items || [];
  const rows = [
    [company.name || "Das Superfoods"],
    [company.address || ""],
    [[company.gstNo ? `GST ${company.gstNo}` : "", company.iecCode ? `IEC ${company.iecCode}` : ""].filter(Boolean).join("   ")],
    [],
    ["PROFORMA INVOICE"],
    ["Proforma no.", pi.docNo, "", "Date", fmtDate(pi.date)],
    ["Buyer order no.", pi.buyerOrderNo || "", "", "Order date", fmtDate(pi.buyerOrderDate)],
    [],
    ["Buyer", pi.buyerName, "", intl ? "Consignee" : "Manufactured by / ship to", pi.consigneeName || ""],
    ["Buyer address", pi.buyerAddress || "", "", "Address", pi.consigneeAddress || ""],
    ["Port of loading", pi.portOfLoading || "", "", "Destination port", pi.destinationPort || ""],
    ["Shipment term", pi.shipmentTerm || "", "", "Payment term", pi.paymentTerm || ""],
    ["Currency", pi.currency],
    [],
    ["#", "Product", "HSN", "Boxes", "Units", intl ? "Rate / box" : "MRP / box", intl ? "Amount" : "Taxable value"],
    ...lines.map((line, i) => [
      i + 1, line.name, line.hsn || "", toNumber(line.boxQty), unitsFromBoxes(line.boxQty, line.packsPerBox),
      toNumber(intl ? line.rate : line.mrp), proformaLineAmount(pi, line),
    ]),
    ["", "", "Total", toNumber(pi.totalBoxes), proformaUnits(pi), "", toNumber(intl ? pi.totalValue : pi.taxableValue)],
  ];
  if (!intl) {
    rows.push(["", "", "", "", "", `Tax @ ${toNumber(pi.taxRate)}%`, toNumber(pi.taxAmount)]);
    rows.push(["", "", "", "", "", "Grand total", toNumber(pi.grandTotal)]);
  }
  rows.push([], ["Amount in words", amountInWords(pi.grandTotal, pi.currency)]);
  if (pi.conditions) rows.push(["Conditions", pi.conditions]);
  if (pi.additionalDetails) rows.push(["Additional details", pi.additionalDetails]);
  rows.push(
    [],
    ["Bank", company.bankName || ""],
    ["Account no.", String(company.accountNo || "")],
    ["IFSC", company.ifsc || ""],
    ["SWIFT", company.swift || ""],
  );
  return rows;
}
