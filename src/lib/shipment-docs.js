// A shipment's three documents — tax invoice, commercial invoice, packing list
// — as plain data. The printed pages and the Excel workbook are both drawn
// from ONE reading of the shipment (shipmentModel), so they cannot disagree.
//
// Totals are the ones the database computed and stored. The only arithmetic
// here is a line's own amount and weight, and the document-currency total,
// which follows the same rule as public.save_shipment: round(lines + freight +
// other, 2). Nothing is re-derived in rupees line by line: the tax invoice
// shows the lines in the currency they were priced in, then the exchange rate,
// then the stored rupee figures — which is exactly how they were worked out.
import { fmtDate, toNumber, unitsFromBoxes, amountInWords } from "./format.js";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/* The company block a shipment prints is the one stored on it when the set was
   generated. A shipment invoiced before the profile carried the account name
   and branch (db/015–016) has no such keys at all; for those two only, the
   current profile fills the gap. A stored value — even a blank one — wins.   */
export function shipmentCompany(snapshot, current) {
  const stored = snapshot || {};
  const now = current || {};
  const fill = (key) => (Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : now[key]) || "";
  return { ...stored, accountName: fill("accountName"), bankBranch: fill("bankBranch") };
}

export function shipmentModel(s, pi) {
  if (!pi) throw new Error(`The proforma ${s.piNo || ""} this shipment was raised against could not be loaded, so its documents cannot be drawn.`);
  const intl = pi.type === "international";
  let base = 0;
  const lines = (s.items || []).map((it, i) => {
    const boxes = toNumber(it.boxQty);
    const price = toNumber(intl ? it.rate : it.mrp);
    base += boxes * price;
    return {
      no: i + 1, name: it.name || "", hsn: it.hsn || "",
      batchNo: it.batchNo || "", mfgDate: it.mfgDate || "", expDate: it.expDate || "",
      boxes, units: unitsFromBoxes(it.boxQty, it.packsPerBox), price, amount: round2(boxes * price),
      net: round3(boxes * toNumber(it.netWt)), gross: round3(boxes * toNumber(it.grossWt)),
    };
  });
  const freight = toNumber(s.freight), other = toNumber(s.otherAdj);
  const tax = s.taxInvoice || {}, com = s.commercialInvoice || {}, pack = s.packingList || {};
  const comCurrency = com.currency || pi.currency;
  return {
    intl, currency: pi.currency, lines,
    subtotal: round2(base), freight, other, otherReason: s.otherReason || "",
    docTotal: round2(base + freight + other),
    exchangeRate: toNumber(s.exchangeRate), converted: pi.currency !== "INR",
    tax: { no: s.taxDocNo, consignee: tax.consignee || "", total: toNumber(tax.total), gstPercent: toNumber(s.gstPercent),
      gst: toNumber(tax.gst), roundOff: toNumber(tax.roundOff), grandTotal: toNumber(tax.grandTotal) },
    commercial: { no: s.commercialDocNo, consignee: com.consignee || "", currency: comCurrency,
      total: toNumber(com.total), converted: comCurrency !== pi.currency },
    packing: { boxes: toNumber(pack.totalBoxes), units: toNumber(pack.totalPacks),
      net: toNumber(pack.netWeight), gross: toNumber(pack.grossWeight) },
  };
}

// The right-hand header block: every number and date labelled.
export function shipmentHeader(s, invoiceNo) {
  const rows = [["Invoice No", invoiceNo], ["Invoice Date", fmtDate(s.date)], ["PI No", s.piNo || ""], ["PI Date", fmtDate(s.piDate)]];
  if (s.orderNo) rows.push(["Buyer Order No", s.orderNo], ["Buyer Order Date", fmtDate(s.orderDate)]);
  return rows;
}

// Charges under the lines, down to the document-currency total.
export function shipmentCharges(m) {
  const rows = [];
  if (m.freight) rows.push(["Freight", m.freight]);
  if (m.other) rows.push([m.otherReason ? `Other — ${m.otherReason}` : "Other charge / deduction", m.other]);
  rows.push([`Total (${m.currency})`, m.docTotal]);
  return rows;
}

// From the document-currency total to the rupee grand total of the tax invoice.
export function taxInvoiceTotals(m) {
  const rows = [];
  if (m.converted) rows.push([`Exchange rate (INR per ${m.currency})`, m.exchangeRate]);
  rows.push(["Taxable value (INR)", m.tax.total], [`GST @ ${m.tax.gstPercent}%`, m.tax.gst]);
  if (m.tax.roundOff) rows.push(["Round off", m.tax.roundOff]);
  rows.push(["Grand total (INR)", m.tax.grandTotal]);
  return rows;
}

// The commercial invoice only needs a conversion when it is issued in a
// currency other than the one the lines are priced in.
export function commercialInvoiceTotals(m) {
  if (!m.commercial.converted) return [];
  return [[`Exchange rate (INR per ${m.currency === "INR" ? m.commercial.currency : m.currency})`, m.exchangeRate],
    [`Total (${m.commercial.currency})`, m.commercial.total]];
}

export const bankRows = (company) => [
  ["Account Name", company.accountName || ""], ["Bank", company.bankName || ""], ["Branch", company.bankBranch || ""],
  ["Account Number", String(company.accountNo || "")], ["Swift Code", company.swift || ""],
];

/* ------------------------------------------------------------ Excel sheets */
const letterhead = (company) => [
  [company.name || "Das Superfoods"], [company.address || ""],
  [[company.gstNo ? `GST ${company.gstNo}` : "", company.iecCode ? `IEC ${company.iecCode}` : ""].filter(Boolean).join("   ")], [],
];
const pairs = (rows) => {      // [[label, value], …] laid out two to a row, as the proforma sheet does
  const out = [];
  for (let i = 0; i < rows.length; i += 2) out.push([rows[i][0], rows[i][1], "", rows[i + 1] ? rows[i + 1][0] : "", rows[i + 1] ? rows[i + 1][1] : ""]);
  return out;
};
const right = (rows) => rows.map(([label, value]) => ["", "", "", "", "", label, value]);
const priceRows = (m) => [
  ["#", "Product", "HSN", "Boxes", "Units", m.intl ? `Rate / box (${m.currency})` : `MRP / box (${m.currency})`, `Amount (${m.currency})`],
  ...m.lines.map((l) => [l.no, l.name, l.hsn, l.boxes, l.units, l.price, l.amount]),
  ["", "", "Total", m.packing.boxes, m.packing.units, "", m.subtotal],
  ...right(shipmentCharges(m)),
];
const transport = (s) => pairs([
  ["Port of loading", s.portOfLoading || ""], ["Incoterm", s.incoterm || ""],
  ["Container No", s.containerNo || ""], ["Vehicle No", s.vehicleNo || ""],
]);

export const SHIPMENT_PRICE_WIDTHS = [18, 38, 14, 18, 14, 30, 18];
export const SHIPMENT_PACKING_WIDTHS = [18, 38, 16, 18, 14, 10, 10, 12, 12];

export function taxInvoiceRows(s, pi, company) {
  const m = shipmentModel(s, pi);
  return [
    ...letterhead(company), ["TAX INVOICE"], ...pairs(shipmentHeader(s, m.tax.no)), [],
    ["Consignee", m.tax.consignee], ...transport(s), [],
    ...priceRows(m), ...right(taxInvoiceTotals(m)), [],
    ["Amount in words", amountInWords(m.tax.grandTotal, "INR")],
  ];
}

export function commercialInvoiceRows(s, pi, company) {
  const m = shipmentModel(s, pi);
  return [
    ...letterhead(company), ["COMMERCIAL INVOICE"], ...pairs(shipmentHeader(s, m.commercial.no)), [],
    ["Buyer", s.buyerName || "", "", "Consignee", m.commercial.consignee], ["Buyer address", s.buyerAddress || ""],
    ...transport(s), [],
    ...priceRows(m), ...right(commercialInvoiceTotals(m)), [],
    ["Amount in words", amountInWords(m.commercial.total, m.commercial.currency)], [],
    ["BANK DETAILS FOR TRANSFER"], ...bankRows(company),
  ];
}

export function packingListRows(s, pi, company) {
  const m = shipmentModel(s, pi);
  return [
    ...letterhead(company), ["PACKING LIST"], ...pairs(shipmentHeader(s, s.docNo)), [],
    ["Consignee", m.commercial.consignee], ...transport(s),
    ...pairs([["Customs seal", s.customSeal || ""], ["Line seal", s.lineSeal || ""]]), [],
    ["#", "Product", "Batch", "MFG", "EXP", "Boxes", "Units", "Net kg", "Gross kg"],
    ...m.lines.map((l) => [l.no, l.name, l.batchNo, fmtDate(l.mfgDate), fmtDate(l.expDate), l.boxes, l.units, l.net, l.gross]),
    ["", "", "", "", "Total", m.packing.boxes, m.packing.units, m.packing.net, m.packing.gross],
    ["", "", "", "", "Tonnes", "", "", round3(m.packing.net / 1000), round3(m.packing.gross / 1000)],
  ];
}

// The workbook: one sheet per document.
export const shipmentSheets = (s, pi, company) => [
  { name: "Tax invoice", rows: taxInvoiceRows(s, pi, company), widths: SHIPMENT_PRICE_WIDTHS },
  { name: "Commercial invoice", rows: commercialInvoiceRows(s, pi, company), widths: SHIPMENT_PRICE_WIDTHS },
  { name: "Packing list", rows: packingListRows(s, pi, company), widths: SHIPMENT_PACKING_WIDTHS },
];
