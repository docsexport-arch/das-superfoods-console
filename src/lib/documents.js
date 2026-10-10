// What a document says, as plain rows — shared by the printed page and the
// Excel download so the two can never disagree. No arithmetic beyond a line's
// own amount: the totals are the ones the database computed and stored.
import { fmtDate, fmtNum, toNumber, unitsFromBoxes, amountInWords, conditionsFromText, docMoney, docAmountInWords, quoteCurrencyOf } from "./format.js";

// An international proforma is priced by rate; a private-label one by MRP.
export const proformaLineAmount = (pi, line) =>
  Math.round(toNumber(line.boxQty) * toNumber(pi.type === "international" ? line.rate : line.mrp) * 100) / 100;

export const proformaUnits = (pi) =>
  (pi.items || []).reduce((sum, line) => sum + unitsFromBoxes(line.boxQty, line.packsPerBox), 0);

// A typed number can hold "/" or spaces; a file name cannot.
export const fileSafe = (text) => String(text || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";

// A quotation's PDF and Word file are both named "Buyer Name_Quotation number"
// (decisions/030). The name is kept as it reads; only what a file name cannot
// hold goes: \ / : | become a dash; * ? " < > and control characters are dropped.
const namePart = (text) => String(text || "")
  .replace(/[*?"<>\u0000-\u001F]+/g, " ").replace(/\s*[\\/:|]+\s*/g, "-").replace(/\s+/g, " ").trim().replace(/^[-. ]+|[-. ]+$/g, "");
export const quotationFileName = (q) =>
  `${namePart(q.buyerName) || "Quotation"}_${namePart(q.docNo) || "document"}`;

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
    ["PI No", pi.docNo, "", "PI Date", fmtDate(pi.date)],
    ["Buyer Order No", pi.buyerOrderNo || "", "", "Buyer Order Date", fmtDate(pi.buyerOrderDate)],
    [],
    ["Buyer", pi.buyerName, "", intl ? "Consignee" : "Ship to", pi.consigneeName || ""],
    ["Buyer address", pi.buyerAddress || "", "", "Address", pi.consigneeAddress || ""],
    // Ports are typed on the proforma; a proforma with neither says nothing about them.
    ...(pi.portOfLoading || pi.destinationPort
      ? [["Port of loading", pi.portOfLoading || "", "", "Destination port", pi.destinationPort || ""]] : []),
    ["Shipment term", pi.shipmentTerm || "", "", "Payment term", pi.paymentTerm || ""],
    // A rupee proforma does not announce its currency (decisions/015); the
    // grand total and the amount in words already say it.
    ...(pi.currency === "INR" ? [] : [["Currency", pi.currency]]),
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
  // One row per condition; numbered only when there is more than one.
  const conditions = conditionsFromText(pi.conditions);
  conditions.forEach((line, i) => rows.push([i === 0 ? "Conditions" : "", conditions.length > 1 ? `${i + 1}. ${line}` : line]));
  if (pi.additionalDetails) rows.push(["Additional details", pi.additionalDetails]);
  rows.push(
    [],
    // The five lines a buyer needs to send a transfer, in the order the desk
    // gives them. The account number stays text so Excel keeps every digit.
    ["BANK DETAILS FOR TRANSFER"],
    ["Account Name", company.accountName || ""],
    ["Bank", company.bankName || ""],
    ["Branch", company.bankBranch || ""],
    ["Account Number", String(company.accountNo || "")],
    ["Swift Code", company.swift || ""],
  );
  return rows;
}

// What a quotation says, piece by piece — the printed page (PDF) and the Word
// download are both drawn from this, so they carry the same words and the same
// figures. The totals are the stored ones; only a line's own amount is worked out.
export function quotationModel(q, company = {}) {
  const isDomestic = String(q.country || "").trim().toLowerCase() === "india";
  const companyName = company.name || "Das Superfoods";
  // The currency the prices are in (db/023): in the price heading, in front of
  // every figure, and in the words. None chosen — bare figures, as before.
  const currency = quoteCurrencyOf(q.currency);
  const money = (value) => docMoney(value, currency);
  const term = String(q.shipmentTerm || "").trim();
  const priceColumn = currency
    ? { label: [`Price (${currency})`, "(Case/Box)", term].filter(Boolean).join(" "), lines: [`Price (${currency})`, "(Case/Box)", term].filter(Boolean), width: 100, num: true }
    : { label: "Rate / box", width: 100, num: true };
  const totals = [{ label: "Total", value: money(q.totalValue), strong: true }];
  if (isDomestic && Number(q.igstAmt) > 0) {
    totals.push({ label: `IGST @ ${fmtNum(q.igstRate, 2)}%`, value: money(q.igstAmt), strong: false });
  }
  totals.push({ label: "Grand total", value: money(q.grandTotal), strong: true });
  return {
    currency,
    companyName,
    companyAddress: company.address || "",
    companyIds: [company.gstNo ? `GST ${company.gstNo}` : "", company.iecCode ? `IEC ${company.iecCode}` : ""].filter(Boolean).join(" · "),
    title: "Sales Quotation",
    docNo: q.docNo || "",
    docNoLine: `Quotation No.: ${q.docNo || ""}`,
    date: `Date: ${fmtDate(q.date)}`,
    toLabel: "Quotation to",
    buyerName: q.buyerName || "",
    buyerAddress: q.buyerAddress || "",
    country: q.country || "",
    termsLabel: "Terms",
    terms: [`Shipment: ${q.shipmentTerm || "—"}`, `Payment: ${q.paymentTerm || "—"}`],
    // width in px on the printed page; the column without one takes the rest
    columns: [
      { label: "#", width: 28 }, { label: "Product" }, { label: "HSN", width: 90 },
      { label: "Boxes", width: 70, num: true }, priceColumn, { label: "Amount", width: 120, num: true },
    ],
    lines: (q.items || []).map((it, i) => [
      String(i + 1), String(it.product ?? ""), String(it.hsn ?? ""), String(it.boxQty ?? ""),
      money(it.boxRate), money(Number(it.boxQty) * Number(it.boxRate)),
    ]),
    totals,
    words: `Amount in words: ${currency ? docAmountInWords(q.grandTotal, currency) : amountInWords(q.grandTotal)}`,
    // Terms typed on this quotation (db/024), numbered in the order they were typed. None typed — no heading.
    conditionsLabel: "Terms & conditions",
    conditions: conditionsFromText(q.terms).map((term, i) => `${i + 1}. ${term}`),
    signFor: companyName,
    signatory: "Authorised signatory",
  };
}

// What a proforma invoice says, piece by piece — the printed page (PDF) and
// the Word download are both drawn from this (decisions/033). The totals are
// the stored ones; only a line's own amount and its units are worked out.
export function proformaModel(pi, company = {}) {
  const isIntl = pi.type === "international";
  const companyName = company.name || "Das Superfoods";
  const conditions = conditionsFromText(pi.conditions);
  const text = (value) => (value === null || value === undefined ? "" : String(value));
  const totals = [[
    { text: "Total", span: 3, strong: true },
    { text: text(pi.totalBoxes), strong: true },
    { text: text(proformaUnits(pi)), strong: true },
    { text: "", bare: true },
    { text: fmtNum(isIntl ? pi.totalValue : pi.taxableValue), strong: true },
  ]];
  if (!isIntl) totals.push([{ text: `Tax @ ${fmtNum(pi.taxRate, 2)}%`, span: 6 }, { text: fmtNum(pi.taxAmount) }]);
  totals.push([{ text: `Grand total (${pi.currency})`, span: 6, strong: true }, { text: fmtNum(pi.grandTotal), strong: true }]);
  return {
    companyName,
    companyAddress: company.address || "",
    companyIds: [company.gstNo ? `GST ${company.gstNo}` : "", company.iecCode ? `IEC ${company.iecCode}` : ""].filter(Boolean).join(" · "),
    title: "Proforma invoice",
    docNo: pi.docNo || "",
    docNoLine: `PI No: ${pi.docNo || ""}`,
    headLines: [
      `PI Date: ${fmtDate(pi.date)}`,
      ...(pi.buyerOrderNo ? [`Buyer Order No: ${pi.buyerOrderNo}`, `Buyer Order Date: ${fmtDate(pi.buyerOrderDate)}`] : []),
    ],
    parties: [
      { label: "Buyer", name: pi.buyerName || "", address: pi.buyerAddress || "" },
      // A private-label proforma heads this party "Ship to", never "Consignee" (decisions/014).
      { label: isIntl ? "Consignee" : "Ship to", name: pi.consigneeName || "—", address: pi.consigneeAddress || "" },
    ],
    ports: pi.portOfLoading || pi.destinationPort
      ? { label: "Ports", lines: [`Loading: ${pi.portOfLoading || "—"}`, `Destination: ${pi.destinationPort || "—"}`] }
      : null,
    terms: {
      label: "Terms",
      // A rupee proforma prints no Currency line (decisions/015).
      lines: [
        `Shipment: ${pi.shipmentTerm || "—"}${pi.currency === "INR" ? "" : ` · Currency: ${pi.currency}`}`,
        `Payment: ${pi.paymentTerm || "—"}`,
      ],
    },
    // width in px on the printed page; the column without one takes the rest
    columns: [
      { label: "#", width: 28 }, { label: "Product" }, { label: "HSN", width: 80 },
      { label: "Boxes", width: 60, num: true }, { label: "Units", width: 60, num: true },
      { label: isIntl ? "Rate / box" : "MRP / box", width: 86, num: true },
      { label: isIntl ? "Amount" : "Taxable value", width: 100, num: true },
    ],
    lines: (pi.items || []).map((it, i) => [
      String(i + 1), text(it.name), text(it.hsn), text(it.boxQty), text(unitsFromBoxes(it.boxQty, it.packsPerBox)),
      fmtNum(isIntl ? it.rate : it.mrp), fmtNum(proformaLineAmount(pi, it)),
    ]),
    totals,
    words: `Amount in words: ${amountInWords(pi.grandTotal, pi.currency)}`,
    // One condition prints on one line; several print as a numbered list.
    conditions: conditions.length === 1 ? { inline: `Conditions: ${conditions[0]}` }
      : conditions.length > 1 ? { label: "Conditions", lines: conditions.map((c, i) => `${i + 1}. ${c}`) }
      : null,
    additional: pi.additionalDetails || "",
    bank: {
      title: "BANK DETAILS FOR TRANSFER",
      rows: [
        ["Account Name:", company.accountName || "—"], ["Bank:", company.bankName || "—"], ["Branch:", company.bankBranch || "—"],
        ["Account Number:", company.accountNo || "—"], ["Swift Code:", company.swift || "—"],
      ],
    },
    signFor: companyName,
    signatory: "Authorised signatory",
  };
}
