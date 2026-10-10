// A proforma downloads as a Word file as well as PDF and Excel, and the
// International / Private label buttons show which form is open
// (decisions/033). Class prevented: the Word file and the PDF saying different
// things; a private-label proforma headed "Consignee" in Word but "Ship to" on
// paper; bank details in one file and not the other; the wrong button lit, so
// the page says International while a private-label proforma is being typed.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import * as docx from "docx";
import JSZip from "jszip";
import { AppCtx, ProformaPage, ProformaDocument } from "../src/app.jsx";
import { emptyStore, proformaFromRow } from "../src/lib/db.js";
import { proformaModel } from "../src/lib/documents.js";
import { buildProformaDocx, proformaWordName } from "../src/lib/word.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const appSource = text("src", "app.jsx");
const wordSource = text("src", "lib", "word.js");
const page = appSource.slice(appSource.indexOf("function ProformaPage("), appSource.indexOf("function ShipmentForm("));

// Made-up company, bank and buyers.
const company = { name: "Sample Foods Pvt. Ltd.", address: "1 Sample Road, Sample City", gstNo: "GST-SAMPLE", iecCode: "IEC-SAMPLE",
  accountName: "SAMPLE FOODS PRIVATE LIMITED", bankName: "Sample Bank", bankBranch: "Sample Branch, Sample Town", accountNo: "ACC-SAMPLE-01", swift: "SAMPLEINBB" };
const row = (over = {}) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", doc_no: "PI/26-27/014", doc_date: "2026-10-09", type: "international", party_id: null,
  quotation_ref: "", buyer_name: "Buyer & Sons <Trading>", buyer_address: "9 Dock Street, Manila",
  consignee_name: "Receiver Goods Trading", consignee_address: "2 Harbour Road, Manila", consignee_options: [],
  port_of_loading: "Mundra", destination_port: "Manila South", shipment_term: "FOB", payment_term: "100% Advance",
  conditions: "Goods as per NON-EU Regulations\nFOB contract: empty container at Mundra port", currency: "USD",
  order_no: "PO-77", order_date: "2026-10-01", additional_details: "Shipment within 30 days of advance.",
  total_boxes: 3450, total_value: 67489, taxable_value: 0, tax_rate: 0, tax_amount: 0, grand_total: 67489,
  items: [
    { id: "l1", name: "Peanut Butter Creamy 340g", hsn: "20081100", boxQty: 3200, rate: 17.77, mrp: 0, packsPerBox: 6 },
    { id: "l2", name: "Roasted Peanuts 1kg", hsn: "12024200", boxQty: 250, rate: 42.5, mrp: 0, packsPerBox: 12 },
  ],
  shipment_id: null, updated_at: "2026-10-09T11:53:08.262805+00:00", ...over,
});
const intl = proformaFromRow(row());
const dom = proformaFromRow(row({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", doc_no: "PL/26-27/003", type: "domestic", currency: "INR", buyer_name: "Sample Retail Pvt Ltd",
  consignee_name: "Sample Retail Warehouse", port_of_loading: "", destination_port: "", order_no: "", order_date: null, additional_details: "",
  conditions: "Ex-factory", total_boxes: 1600, total_value: 0, taxable_value: 1708800, tax_rate: 5, tax_amount: 85440, grand_total: 1794240,
  items: [{ id: "l1", name: "Private Label PB 1kg", hsn: "20081100", boxQty: 1600, rate: 0, mrp: 1068, packsPerBox: 12 }],
}));

// Every piece of wording in a model, in reading order.
const said = (m) => [
  m.companyName, m.companyAddress, m.companyIds, m.title, m.docNoLine, ...m.headLines,
  ...m.parties.flatMap((p) => [p.label, p.name, p.address]),
  ...(m.ports ? [m.ports.label, ...m.ports.lines] : []), m.terms.label, ...m.terms.lines,
  ...m.columns.map((c) => c.label), ...m.lines.flat(), ...m.totals.flatMap((r) => r.map((c) => c.text)),
  m.words,
  ...(m.conditions ? (m.conditions.inline ? [m.conditions.inline] : [m.conditions.label, ...m.conditions.lines]) : []),
  m.additional, m.bank.title, ...m.bank.rows.map(([name, value]) => `${name} ${value}`), m.signFor, m.signatory,
].filter((s) => String(s).trim() !== "");

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;|&#x27;/g, "'").replace(/&amp;/g, "&");
const opened = async (pi, c = company) => {
  const buffer = await docx.Packer.toBuffer(buildProformaDocx(docx, proformaModel(pi, c)));
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((p) => unescape([...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")));
  return { buffer, zip, xml, paragraphs, all: paragraphs.join("\n") };
};
// The printed page as text: a paragraph or a table cell per line, as Word has it.
const pdfText = (pi, c = company) => unescape(renderToString(<ProformaDocument pi={pi} company={c} />)
  .replace(/<!-- -->/g, "").replace(/<\/?(?:b|i)>/g, "").replace(/<[^>]+>/g, "\n"));

describe("what a proforma says", () => {
  it("international: consignee, ports, rate and amount, no tax line, the currency in the terms", () => {
    const m = proformaModel(intl, company);
    expect(m.parties.map((p) => p.label)).toEqual(["Buyer", "Consignee"]);
    expect(m.ports.lines).toEqual(["Loading: Mundra", "Destination: Manila South"]);
    expect(m.terms.lines).toEqual(["Shipment: FOB · Currency: USD", "Payment: 100% Advance"]);
    expect(m.columns.slice(5).map((c) => c.label)).toEqual(["Rate / box", "Amount"]);
    expect(m.totals.map((r) => r[0].text)).toEqual(["Total", "Grand total (USD)"]);
    expect(m.lines[0]).toEqual(["1", "Peanut Butter Creamy 340g", "20081100", "3200", "19200", "17.77", "56,864.00"]);
    expect(m.headLines).toEqual(["PI Date: 09/10/2026", "Buyer Order No: PO-77", "Buyer Order Date: 01/10/2026"]);
  });

  it("private label: Ship to (never Consignee), no ports, MRP and taxable value, the tax line, no Currency: INR", () => {
    const m = proformaModel(dom, company);
    expect(m.parties.map((p) => p.label)).toEqual(["Buyer", "Ship to"]);
    expect(m.ports).toBeNull();
    expect(m.terms.lines[0]).toBe("Shipment: FOB");
    expect(m.columns.slice(5).map((c) => c.label)).toEqual(["MRP / box", "Taxable value"]);
    expect(m.totals.map((r) => r[0].text)).toEqual(["Total", "Tax @ 5.00%", "Grand total (INR)"]);
    expect(m.headLines).toEqual(["PI Date: 09/10/2026"]);
  });

  it("one condition prints on one line; several print numbered", () => {
    expect(proformaModel(dom, company).conditions).toEqual({ inline: "Conditions: Ex-factory" });
    expect(proformaModel(intl, company).conditions).toEqual({ label: "Conditions", lines: ["1. Goods as per NON-EU Regulations", "2. FOB contract: empty container at Mundra port"] });
    expect(proformaModel({ ...intl, conditions: "" }, company).conditions).toBeNull();
  });

  it("the totals are the stored ones, not re-added", () => {
    const m = proformaModel({ ...intl, totalBoxes: 7, totalValue: 1, grandTotal: 2 }, company);
    // boxes and value are the stored figures; units are 3200 × 6 + 250 × 12, from the lines
    expect(m.totals[0].map((c) => c.text)).toEqual(["Total", "7", "22200", "", "1.00"]);
    expect(m.totals[1][1].text).toBe("2.00");
  });
});

describe("the Word file says what the PDF says", () => {
  for (const [name, pi] of [["international", intl], ["private label", dom]]) {
    it(`${name}: every piece of wording and every figure is in both, in the same order`, async () => {
      const pieces = said(proformaModel(pi, company));
      const word = (await opened(pi)).all;
      const pdf = pdfText(pi);
      let w = 0;
      let p = 0;
      for (const piece of pieces) {
        const wi = word.indexOf(piece, w);
        const at = pdf.indexOf(piece, p);
        expect(wi, `Word is missing or misplaces: ${piece}`).toBeGreaterThan(-1);
        expect(at, `PDF is missing or misplaces: ${piece}`).toBeGreaterThan(-1);
        w = wi + piece.length;
        p = at + piece.length;
      }
    });

    it(`${name}: Word adds nothing of its own`, async () => {
      const pieces = said(proformaModel(pi, company));
      const extra = (await opened(pi)).paragraphs.filter((t) => t.trim() !== "")
        .filter((t) => !pieces.includes(t) && t !== `For ${company.name}`);
      expect(extra).toEqual([]);
    });
  }

  it("one description feeds both: the page and the Word file are drawn from proformaModel", () => {
    const pdf = appSource.slice(appSource.indexOf("function ProformaDocument("), appSource.indexOf("function ProformaPage("));
    expect(pdf).toContain("const m = proformaModel(pi, company);");
    expect(pdf).not.toMatch(/fmtNum|amountInWords|taxAmount|isIntl|company\.(bankName|accountNo|swift)/);   // no second copy
    expect(wordSource).toContain("buildProformaDocx(docx, proformaModel(pi, company))");
  });

  it("the bank details for transfer are in the Word file exactly as in the company profile", async () => {
    const { paragraphs } = await opened(intl);
    for (const line of ["BANK DETAILS FOR TRANSFER", "Account Name: SAMPLE FOODS PRIVATE LIMITED", "Bank: Sample Bank", "Branch: Sample Branch, Sample Town", "Account Number: ACC-SAMPLE-01", "Swift Code: SAMPLEINBB"]) {
      expect(paragraphs, line).toContain(line);
    }
    // a profile with no bank details prints dashes, not "undefined"
    const bare = (await opened(intl, { name: "X" })).all;
    expect(bare).toContain("Account Number: —");
    expect(bare).not.toMatch(/undefined|null/);
  });
});

describe("the Word file itself", () => {
  it("is a real .docx, A4 with the PDF's margins and typeface", async () => {
    const { buffer, zip, xml } = await opened(intl);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"]) expect(zip.file(part), part).not.toBeNull();
    expect(xml).toMatch(/<w:pgSz [^>]*w:w="11906"[^>]*w:h="16838"/);
    expect(xml).toMatch(/<w:pgMar [^>]*w:top="794"[^>]*w:right="794"[^>]*w:bottom="794"[^>]*w:left="794"/);
    expect(await zip.file("word/styles.xml").async("string")).toContain("Georgia");
  });

  it("one price table with a line per product and the totals; tables never touch", async () => {
    for (const [pi, totals] of [[intl, 2], [dom, 3]]) {
      const { xml } = await opened(pi);
      const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((t) => t[0]);
      const price = tables.find((t) => t.includes("<w:tblHeader/>"));
      expect(price.match(/<w:tr[ >]/g)).toHaveLength(1 + pi.items.length + totals);
      expect(price).toMatch(/<w:gridSpan w:val="3"\/>/);                  // "Total" spans to the Boxes column
      expect(price).toMatch(/<w:gridSpan w:val="6"\/>/);                  // "Grand total" spans to the last column
      expect(xml).not.toMatch(/<\/w:tbl>\s*<w:tbl>/);
    }
  });

  it("everything in it is ordinary text, so all of it can be edited", async () => {
    const { xml, zip } = await opened(dom);
    expect(xml).not.toMatch(/<w:drawing|<w:pict|<w:object|w:documentProtection/);
    expect(Object.keys(zip.files).filter((f) => /media\//.test(f))).toEqual([]);
  });

  it("a name with & < > is kept exactly, and the file is still sound", async () => {
    const { xml, all } = await opened(intl);
    expect(all).toContain("Buyer & Sons <Trading>");
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)/);
  });

  it("is named like the PDF and the Excel file: Proforma-<number>", () => {
    expect(proformaWordName(intl)).toBe("Proforma-PI-26-27-014.docx");
  });
});

describe("the proforma list", () => {
  const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
  const html = renderToString(
    <AppCtx.Provider value={{ store: { ...emptyStore(), company, pis: [intl, dom], users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
      <ProformaPage />
    </AppCtx.Provider>).replace(/<!-- -->/g, "");

  it("an open proforma has Edit, Delete and Download", () => {
    for (const no of ["PI/26-27/014", "PL/26-27/003"]) {
      for (const what of ["Edit", "Delete", "Download"]) expect(html, `${what} ${no}`).toContain(`aria-label="${what} ${no}"`);
    }
  });

  it("Download offers PDF, Word and Excel, in that order", () => {
    const at = page.indexOf("{downloadId === pi.id ? (");
    const choices = page.slice(at, page.indexOf('aria-label="Close download options"', at));
    const order = ["setPrinting(pi); }} className=\"text-xs text-[var(--accent)]\">PDF</button>", "downloadWord(pi); }} className=\"text-xs text-[var(--accent)]\">Word</button>", "downloadExcel(pi); }} className=\"text-xs text-[var(--accent)]\">Excel</button>"]
      .map((s) => choices.indexOf(s));
    expect(order.every((i) => i > -1), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("Word makes the file from that row's proforma and the company profile, and shows a failure instead of swallowing it", () => {
    expect(page).toContain("const downloadWord = async (pi) => { setSaveError(\"\"); setSaveError(await attempt(() => downloadProformaWord(pi, store.company))); };");
  });

  it("the Word library is still loaded only when a Word file is asked for", () => {
    expect(wordSource).toContain('const docx = await import("docx");');
    expect(wordSource).not.toMatch(/^import .* from "docx";/m);
    expect(appSource).not.toMatch(/from "docx"/);
  });
});

describe("the International and Private label buttons", () => {
  it("with no form open, neither is lit and neither is marked as chosen", () => {
    const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
    const html = renderToString(
      <AppCtx.Provider value={{ store: { ...emptyStore(), users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
        <ProformaPage />
      </AppCtx.Provider>).replace(/<!-- -->/g, "");
    const buttons = [...html.matchAll(/<button aria-pressed="(true|false)" class="([^"]*)"><svg[\s\S]*?<\/svg>\s*(International|Private label)<\/button>/g)];
    expect(buttons.map((b) => [b[3], b[1]])).toEqual([["International", "false"], ["Private label", "false"]]);
    expect(buttons[0][2]).toBe(buttons[1][2]);                           // drawn the same
    expect(buttons[0][2]).not.toContain("bg-[var(--accent)]");          // and that is the quiet style, not the orange one
  });

  it("the lit button is the kind of proforma whose form is open — never both, never always International", () => {
    expect(page).toContain("const lit = Boolean(form) && (form.type === \"domestic\" ? \"domestic\" : \"international\") === kind;");
    expect(page).toContain("aria-pressed={lit}");
    expect(page).toContain("className={(lit ? btn : btnGhost + \" py-2\") + \" flex items-center gap-1.5\"}");
    // neither button is hard-wired to the lit style any more
    expect(page).not.toMatch(/onClick=\{\(\) => open\("international"\)\} className=\{btn \+/);
    expect(page).not.toMatch(/onClick=\{\(\) => open\("domestic"\)\} className=\{btnGhost \+/);
  });

  it("each still opens its own kind of form", () => {
    expect(page).toContain('{[["international", "International"], ["domestic", "Private label"]].map(([kind, name]) => {');
    expect(page).toContain("<button key={kind} onClick={() => open(kind)}");
  });
});
