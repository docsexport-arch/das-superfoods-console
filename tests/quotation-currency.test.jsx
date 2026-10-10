// A quotation says which currency its prices are in (db/023, decisions/028).
// Class prevented: a quotation whose file does not say dollars or rupees; the
// PDF saying one currency and the Word file another; a figure quietly
// converted when the currency is changed; rupees grouped like dollars; the
// currency wiped by a save from an older copy of the console.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import * as docx from "docx";
import JSZip from "jszip";
import { AppCtx, QuotationsPage, QuotationForm, QuotationDocument } from "../src/app.jsx";
import { emptyStore, quotationFromRow, partyFromRow } from "../src/lib/db.js";
import { quotationModel } from "../src/lib/documents.js";
import { buildQuotationDocx } from "../src/lib/word.js";
import { docMoney, docAmountInWords, quoteCurrencyOf, QUOTE_CURRENCIES } from "../src/lib/format.js";
import { QUOTATION_KEYS, RPC_CONTRACT, pick } from "../src/lib/payloads.js";
import { EXPECTED_MIGRATION } from "../src/lib/migrations.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const sql = text("db", "023_quotation_currency.sql");
const save = /create or replace function public\.save_quotation\([\s\S]*?\n\$\$;/.exec(sql)[0];
const appSource = text("src", "app.jsx");

// Made-up company and buyer; the figures are the ones on the owner's sample.
const company = { name: "Sample Foods Pvt. Ltd.", address: "1 Sample Road", gstNo: "GST-SAMPLE", iecCode: "IEC-SAMPLE" };
const row = (over = {}) => ({
  id: "q1", doc_no: "DS-QUO-2026-0007", doc_date: "2026-10-10", party_id: null, buyer_name: "Sample Importers Inc.", buyer_address: "Montreal",
  country: "Canada", shipment_term: "FOB", payment_term: "100% advance", igst: false, igst_rate: 0,
  total_value: 49999.5, igst_amount: 0, grand_total: 49999.5, currency: "USD",
  items: [{ id: "a", product: "Peanut Butter Creamy 500gm X 12 Jar", hsn: "20081100", boxQty: 4065, boxRate: 12.3 }],
  updated_at: "2026-10-10T06:00:00Z", ...over,
});
const usd = quotationFromRow(row());
const inr = quotationFromRow(row({ id: "q2", doc_no: "DS-QUO-2026-0008", country: "India", currency: "INR", igst: true, igst_rate: 5, total_value: 123456, igst_amount: 6172.8, grand_total: 129628.8,
  items: [{ id: "a", product: "Peanut Butter Creamy 500gm X 12 Jar", hsn: "20081100", boxQty: 100, boxRate: 1234.56 }] }));
const old = quotationFromRow(row({ id: "q3", doc_no: "DS-QUO-2026-0001", currency: undefined }));

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, extra = {}) => renderToString(
  <AppCtx.Provider value={{ store: { ...emptyStore(), company, quotations: [usd, inr, old], users: [admin], ...extra }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
    {node}
  </AppCtx.Provider>).replace(/<!-- -->/g, "");
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const pdfText = (q) => unescape(draw(<QuotationDocument q={q} company={company} />).replace(/<[^>]+>/g, "\n"));
const wordText = async (q) => {
  const zip = await JSZip.loadAsync(await docx.Packer.toBuffer(buildQuotationDocx(docx, quotationModel(q, company))));
  const xml = await zip.file("word/document.xml").async("string");
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((p) => unescape([...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""))).join("\n");
};
const selected = (html, label) => {
  const at = html.indexOf(`>${label}</span>`);
  const box = html.slice(at, html.indexOf("</select>", at));
  return (/<option value="([^"]*)" selected="">/.exec(box) || [])[1];
};

describe("a figure with its currency", () => {
  it("dollars: US$ in front, grouped in thousands", () => {
    expect(docMoney(12.3, "USD")).toBe("US$ 12.30");
    expect(docMoney(49999.5, "USD")).toBe("US$ 49,999.50");
    expect(docMoney(1234567.891, "USD")).toBe("US$ 1,234,567.89");
  });

  it("rupees: the rupee sign in front, grouped in lakhs and crores", () => {
    expect(docMoney(12.3, "INR")).toBe("₹ 12.30");
    expect(docMoney(123456, "INR")).toBe("₹ 1,23,456.00");
    expect(docMoney(12345678.5, "INR")).toBe("₹ 1,23,45,678.50");
  });

  it("no currency, or one the console does not know: the bare figure, never a guessed sign", () => {
    for (const c of ["", undefined, null, "EUR", "usd", "constructor"]) {
      expect(quoteCurrencyOf(c)).toBe("");
      expect(docMoney(49999.5, c)).toBe("49,999.50");
    }
  });

  it("exactly two currencies are offered", () => {
    expect(QUOTE_CURRENCIES.map((c) => c.key)).toEqual(["USD", "INR"]);
  });
});

describe("the amount in words", () => {
  it("the owner's sample, word for word", () => {
    expect(docAmountInWords(49999.5, "USD")).toBe("U.S. DOLLARS Forty-Nine Thousand Nine Hundred Ninety-Nine And Fifty Cents Only.");
  });

  it("rupees are read in lakhs and crores, with paise", () => {
    expect(docAmountInWords(123456, "INR")).toBe("INDIAN RUPEES One Lakh Twenty-Three Thousand Four Hundred Fifty-Six Only.");
    expect(docAmountInWords(25000000.75, "INR")).toBe("INDIAN RUPEES Two Crore Fifty Lakh And Seventy-Five Paise Only.");
  });

  it("whole amounts have no cents; small ones still read", () => {
    expect(docAmountInWords(21, "USD")).toBe("U.S. DOLLARS Twenty-One Only.");
    expect(docAmountInWords(1000000, "USD")).toBe("U.S. DOLLARS One Million Only.");
    expect(docAmountInWords(0.05, "USD")).toBe("U.S. DOLLARS Zero And Five Cents Only.");
    expect(docAmountInWords(113.19, "USD")).toBe("U.S. DOLLARS One Hundred Thirteen And Nineteen Cents Only.");
  });

  it("the words say the same amount as the figure, to the cent", () => {
    // three boxes at 33.10 do not multiply cleanly in floating point
    expect(3 * 33.1).not.toBe(99.3);
    expect(docMoney(3 * 33.1, "USD")).toBe("US$ 99.30");
    expect(docAmountInWords(3 * 33.1, "USD")).toBe("U.S. DOLLARS Ninety-Nine And Thirty Cents Only.");
    expect(docMoney(4065 * 12.3, "USD")).toBe("US$ 49,999.50");
  });
});

describe("what the quotation file says", () => {
  it("in dollars: the price heading, every rate and amount, the total and the words — as on the owner's sample", () => {
    const m = quotationModel(usd, company);
    expect(m.currency).toBe("USD");
    expect(m.columns[4].lines).toEqual(["Price (USD)", "(Case/Box)", "FOB"]);
    expect(m.lines[0]).toEqual(["1", "Peanut Butter Creamy 500gm X 12 Jar", "20081100", "4065", "US$ 12.30", "US$ 49,999.50"]);
    expect(m.totals).toEqual([{ label: "Total", value: "US$ 49,999.50", strong: true }, { label: "Grand total", value: "US$ 49,999.50", strong: true }]);
    expect(m.words).toBe("Amount in words: U.S. DOLLARS Forty-Nine Thousand Nine Hundred Ninety-Nine And Fifty Cents Only.");
  });

  it("in rupees: the same places, with the rupee sign, the IGST line included", () => {
    const m = quotationModel(inr, company);
    expect(m.columns[4].lines[0]).toBe("Price (INR)");
    expect(m.lines[0].slice(4)).toEqual(["₹ 1,234.56", "₹ 1,23,456.00"]);
    expect(m.totals.map((t) => t.value)).toEqual(["₹ 1,23,456.00", "₹ 6,172.80", "₹ 1,29,628.80"]);
    expect(m.words).toBe("Amount in words: INDIAN RUPEES One Lakh Twenty-Nine Thousand Six Hundred Twenty-Eight And Eighty Paise Only.");
  });

  it("a quotation made before currencies reads as it always did", () => {
    const m = quotationModel(old, company);
    expect(m.currency).toBe("");
    expect(m.columns[4]).toEqual({ label: "Rate / box", width: 100, num: true });
    expect(m.lines[0].slice(4)).toEqual(["12.30", "49,999.50"]);
    expect(m.words).toBe("Amount in words: forty nine thousand nine hundred ninety nine and 50/100 only");
  });

  it("the heading follows the shipment term, and manages without one", () => {
    expect(quotationModel({ ...usd, shipmentTerm: "CIF" }, company).columns[4].lines).toEqual(["Price (USD)", "(Case/Box)", "CIF"]);
    expect(quotationModel({ ...usd, shipmentTerm: "" }, company).columns[4].lines).toEqual(["Price (USD)", "(Case/Box)"]);
  });

  it("changing the currency changes the signs, never the figures", () => {
    const digits = (m) => [...m.lines.flat(), ...m.totals.map((t) => t.value)].map((s) => s.replace(/[^0-9.]/g, ""));
    expect(digits(quotationModel({ ...usd, currency: "INR" }, company))).toEqual(digits(quotationModel(usd, company)));
  });

  for (const [name, q, marks] of [
    ["dollars", usd, ["Price (USD)", "(Case/Box)", "FOB", "US$ 12.30", "US$ 49,999.50", "U.S. DOLLARS Forty-Nine Thousand"]],
    ["rupees", inr, ["Price (INR)", "₹ 1,234.56", "₹ 1,29,628.80", "INDIAN RUPEES One Lakh"]],
  ]) {
    it(`the PDF and the Word file both say it — ${name}`, async () => {
      const pdf = pdfText(q);
      const word = await wordText(q);
      for (const mark of marks) {
        expect(pdf, `PDF: ${mark}`).toContain(mark);
        expect(word, `Word: ${mark}`).toContain(mark);
      }
      // and neither falls back to a bare figure anywhere in the price table
      const bare = /(^|\n)\s*[0-9][0-9,]*\.[0-9]{2}\s*(\n|$)/;
      expect(pdf).not.toMatch(bare);
      expect(word).not.toMatch(bare);
    });
  }
});

describe("choosing the currency on the quotation form", () => {
  it("there is a Currency box offering dollars and rupees", () => {
    const html = draw(<QuotationForm onCancel={() => {}} onSubmit={async () => ""} />);
    const at = html.indexOf(">Currency</span>");
    const box = html.slice(at, html.indexOf("</select>", at));
    expect(at).toBeGreaterThan(-1);
    expect([...box.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(["USD", "INR"]);
  });

  it("a new quotation starts in dollars", () => {
    expect(selected(draw(<QuotationForm onCancel={() => {}} onSubmit={async () => ""} />), "Currency")).toBe("USD");
  });

  it("editing shows the currency the quotation was saved in", () => {
    expect(selected(draw(<QuotationForm initial={inr} onCancel={() => {}} onSubmit={async () => ""} />), "Currency")).toBe("INR");
    expect(selected(draw(<QuotationForm initial={usd} onCancel={() => {}} onSubmit={async () => ""} />), "Currency")).toBe("USD");
  });

  it("an older quotation with none starts from its country: rupees for India, dollars otherwise", () => {
    expect(selected(draw(<QuotationForm initial={old} onCancel={() => {}} onSubmit={async () => ""} />), "Currency")).toBe("USD");
    expect(selected(draw(<QuotationForm initial={{ ...old, country: "India" }} onCancel={() => {}} onSubmit={async () => ""} />), "Currency")).toBe("INR");
  });

  it("or from the party it is for", () => {
    const party = partyFromRow({ id: "22222222-2222-4222-8222-222222222222", type: "domestic", buyer_name: "Rupee Party", buyer_address: "", consignee_name: "", consignee_address: "",
      consignee_options: [], alt_buyers: [], country: "Nepal", currency: "INR", shipment_term: "", payment_term: "", conditions: "" }, []);
    const html = draw(<QuotationForm initial={{ ...old, partyId: party.id, country: "Nepal" }} onCancel={() => {}} onSubmit={async () => ""} />, { parties: [party] });
    expect(selected(html, "Currency")).toBe("INR");
  });

  it("a choice made by hand wins over the party and the country", () => {
    expect(appSource).toContain('const currency = currencyPick || (pickedParty && quoteCurrencyOf(pickedParty.currency)) || (isDomestic ? "INR" : "USD");');
  });

  it("the form shows its totals in the chosen currency", () => {
    const html = draw(<QuotationForm initial={usd} onCancel={() => {}} onSubmit={async () => ""} />);
    expect(html).toContain("Box rate (USD)");
    expect(html).toContain("US$ 49,999.50");
    expect(html).toContain("U.S. DOLLARS Forty-Nine Thousand Nine Hundred Ninety-Nine And Fifty Cents Only.");
  });

  it("the list shows each quotation's value in its own currency", () => {
    const html = draw(<QuotationsPage />);
    expect(html).toContain(">US$ 49,999.50</td>");
    expect(html).toContain(">₹ 1,29,628.80</td>");
    expect(html).toContain(">49,999.50</td>");                         // the older one, bare
  });
});

describe("saving the currency", () => {
  it("it is sent with the quotation and is part of the agreed contract", () => {
    expect(QUOTATION_KEYS).toContain("currency");
    expect(RPC_CONTRACT.save_quotation).toContain("currency");
    expect(pick({ buyerName: "B", currency: "INR", grandTotal: 1 }, QUOTATION_KEYS)).toEqual({ buyerName: "B", currency: "INR" });
    expect(appSource).toContain("partyId, buyerName, buyerAddress, country, shipmentTerm, paymentTerm, currency,");
  });

  it("reading: the stored currency, and none for an older quotation", () => {
    expect(usd.currency).toBe("USD");
    expect(inr.currency).toBe("INR");
    expect(old.currency).toBe("");
  });

  it("the database keeps it, and takes only dollars or rupees", () => {
    expect(sql).toMatch(/add column if not exists currency text not null default ''/);
    expect(sql).toContain("check (currency in ('', 'USD', 'INR'))");
    expect(save).toContain("v_cur     text  := upper(btrim(coalesce(p ->> 'currency', '')));");
    expect(save).toContain("if p ? 'currency' and v_cur not in ('USD', 'INR') then perform public._fail(400, 'Currency must be USD or INR.'); end if;");
  });

  it("an edit that does not carry it — an older copy of the console — leaves it alone", () => {
    expect(save).toContain("currency = case when p ? 'currency' then v_cur else currency end,");
  });

  it("nothing is converted: the totals are worked out exactly as before", () => {
    const before = /create or replace function public\.save_quotation\([\s\S]*?\n\$\$;/.exec(text("db", "009_write_rpcs.sql"))[0];
    const arithmetic = (fn) => fn.split("\n").filter((l) => /v_total|v_tax|v_rate|v_igst/.test(l) && !/insert into|values \(|currency|auth\.uid\(\)/.test(l)).join("\n");
    expect(arithmetic(save)).toBe(arithmetic(before));
    expect(save).not.toMatch(/exchange|\* *8[0-9]|v_cur *(=|<>) *'(USD|INR)'/i);    // no rate, and no branch on the currency
  });

  it("the rest of save_quotation is as it was", () => {
    expect(save).toContain("has_access('quotations')");
    expect(save).toContain("public._alloc_doc_no('quotation')");
    expect(save).toContain("Someone else changed ");
  });

  it("the console expects the migration", () => {
    expect(EXPECTED_MIGRATION).toBeGreaterThanOrEqual(23);
    expect(sql).toContain("values (23, 'quotation_currency')");
  });
});
