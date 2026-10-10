// A quotation downloads as a Word file as well as a PDF (decisions/027). Class
// prevented: the Word file and the PDF saying different things; a figure
// re-worked for Word that drifts from the stored one; a buyer name with an
// ampersand or a stray control character producing a file Word cannot open;
// the Word library loaded on every page instead of only when it is asked for.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import * as docx from "docx";
import JSZip from "jszip";
import { AppCtx, QuotationsPage, QuotationDocument } from "../src/app.jsx";
import { emptyStore } from "../src/lib/db.js";
import { quotationModel } from "../src/lib/documents.js";
import { buildQuotationDocx, quotationWordName, wordText } from "../src/lib/word.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const appSource = text("src", "app.jsx");
const wordSource = text("src", "lib", "word.js");

// Made-up company and buyer.
const company = { name: "Sample Foods Pvt. Ltd.", address: "1 Sample Road, Sample City", gstNo: "GST-SAMPLE", iecCode: "IEC-SAMPLE" };
const exportQ = {
  id: "q1", docNo: "Q/26-27/001", date: "2026-10-09", buyerName: "Buyer & Sons <Trading>", buyerAddress: "9 Dock Street", country: "Philippines",
  shipmentTerm: "FOB", paymentTerm: "100% advance", igstRate: 0, totalValue: 12402, igstAmt: 0, grandTotal: 12402,
  items: [
    { id: "a", product: "Peanut Butter Creamy 340g", hsn: "20081100", boxQty: 100, boxRate: 17.77 },
    { id: "b", product: "Roasted Peanuts 1kg", hsn: "12024200", boxQty: 250, boxRate: 42.5 },
  ],
};
const indiaQ = { ...exportQ, id: "q2", docNo: "Q/26-27/002", country: "India", igstRate: 5, igstAmt: 620.1, grandTotal: 13022.1 };

// Every piece of wording in a model, in reading order.
const said = (m) => [
  m.companyName, m.companyAddress, m.companyIds, m.title, m.docNo, m.date,
  m.toLabel, m.buyerName, m.buyerAddress, m.country, m.termsLabel, ...m.terms,
  ...m.columns.flatMap((c) => c.lines || [c.label]), ...m.lines.flat(), ...m.totals.flatMap((t) => [t.label, t.value]),
  m.words, m.note, m.signFor, m.signatory,
].filter((s) => String(s).trim() !== "");

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;|&#x27;/g, "'").replace(/&amp;/g, "&");
// Opens the .docx the way Word does: unzip it, read the main part.
const opened = async (q, c = company) => {
  const buffer = await docx.Packer.toBuffer(buildQuotationDocx(docx, quotationModel(q, c)));
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((p) => unescape([...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")));
  return { buffer, zip, xml, paragraphs, all: paragraphs.join("\n") };
};
const pdfText = (q, c = company) => unescape(renderToString(<QuotationDocument q={q} company={c} />)
  .replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "\n"));

describe("what a quotation says", () => {
  it("an export quotation: no tax line, and the export note", () => {
    const m = quotationModel(exportQ, company);
    expect(m.totals.map((t) => t.label)).toEqual(["Total", "Grand total"]);
    expect(m.note).toMatch(/quoted on FOB terms and are subject to confirmation of availability at the time of order\. IGST is not applicable on export supplies\.$/);
    expect(m.lines[0]).toEqual(["1", "Peanut Butter Creamy 340g", "20081100", "100", "17.77", "1,777.00"]);
  });

  it("an Indian quotation: the IGST line, and no export note", () => {
    const m = quotationModel(indiaQ, company);
    expect(m.totals.map((t) => t.label)).toEqual(["Total", "IGST @ 5.00%", "Grand total"]);
    expect(m.note).not.toContain("IGST is not applicable");
  });

  it("the totals are the stored ones, not re-added", () => {
    const m = quotationModel({ ...exportQ, totalValue: 1, grandTotal: 2 }, company);
    expect(m.totals.map((t) => t.value)).toEqual(["1.00", "2.00"]);
  });
});

describe("the Word file says what the PDF says", () => {
  for (const [name, q] of [["export", exportQ], ["India", indiaQ]]) {
    it(`${name}: every piece of wording and every figure is in both, in the same order`, async () => {
      const pieces = said(quotationModel(q, company));
      const word = (await opened(q)).all;
      const pdf = pdfText(q);
      let w = 0;
      let p = 0;
      for (const piece of pieces) {
        const wi = word.indexOf(piece, w);
        const pi = pdf.indexOf(piece, p);
        expect(wi, `Word is missing or misplaces: ${piece}`).toBeGreaterThan(-1);
        expect(pi, `PDF is missing or misplaces: ${piece}`).toBeGreaterThan(-1);
        w = wi + piece.length;
        p = pi + piece.length;
      }
    });

    it(`${name}: Word adds nothing of its own`, async () => {
      const pieces = said(quotationModel(q, company));
      const extra = (await opened(q)).paragraphs.filter((t) => t.trim() !== "")
        .filter((t) => !pieces.includes(t) && t !== `For ${company.name}`);
      expect(extra).toEqual([]);
    });
  }

  it("one description feeds both: the page and the Word file are drawn from quotationModel", () => {
    const pdf = appSource.slice(appSource.indexOf("function QuotationDocument("), appSource.indexOf("function QuotationForm("));
    expect(pdf).toContain("const m = quotationModel(q, company);");
    expect(pdf).not.toMatch(/fmtNum|amountInWords|igstAmt/);            // no second copy of the figures
    expect(wordSource).toContain("buildQuotationDocx(docx, quotationModel(q, company))");
    expect(wordSource).not.toMatch(/fmtNum|amountInWords|igstAmt|grandTotal/);
  });
});

describe("the Word file itself", () => {
  it("is a real .docx: a zip with the parts Word looks for", async () => {
    const { buffer, zip } = await opened(exportQ);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"]) {
      expect(zip.file(part), part).not.toBeNull();
    }
  });

  it("is A4 with the PDF's margins, in the PDF's typeface", async () => {
    const { xml, zip } = await opened(exportQ);
    expect(xml).toMatch(/<w:pgSz [^>]*w:w="11906"[^>]*w:h="16838"/);
    expect(xml).toMatch(/<w:pgMar [^>]*w:top="794"[^>]*w:right="794"[^>]*w:bottom="794"[^>]*w:left="794"/);
    expect(await zip.file("word/styles.xml").async("string")).toContain("Georgia");
  });

  it("is laid out as the PDF is: letterhead, buyer and terms, then one price table with a line per product", async () => {
    const { xml } = await opened(exportQ);
    const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((t) => t[0]);
    expect(tables).toHaveLength(3);
    const rows = tables[2].match(/<w:tr[ >]/g);
    expect(rows).toHaveLength(1 + exportQ.items.length + 2);            // heading, two products, Total, Grand total
    expect(tables[2]).toContain("<w:tblHeader/>");                      // the heading repeats on a second page
    expect(tables[2]).toMatch(/<w:gridSpan w:val="5"\/>/);              // the totals labels span to the Amount column
    // tables never touch: Word would join them into one
    expect(xml).not.toMatch(/<\/w:tbl>\s*<w:tbl>/);
  });

  it("everything in it is ordinary text — nothing is a picture, so all of it can be edited", async () => {
    const { xml, zip } = await opened(indiaQ);
    expect(xml).not.toMatch(/<w:drawing|<w:pict|<w:object/);
    expect(Object.keys(zip.files).filter((f) => /media\//.test(f))).toEqual([]);
    expect(xml).not.toMatch(/w:documentProtection|w:permStart/);
  });

  it("a name with & < > or quotes is kept exactly, and the file is still sound", async () => {
    const q = { ...exportQ, buyerName: `Tom & Jerry's "Best" <Imports>` };
    const { xml, all } = await opened(q);
    expect(all).toContain(`Tom & Jerry's "Best" <Imports>`);
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)/);
    expect(xml).not.toContain("<Imports>");
  });

  it("a stray control character or a line break in a box cannot break the file", async () => {
    expect(wordText("A\u0000B\u000bC\u001fD")).toBe("ABCD");
    expect(wordText("Line one \n  line two\r\nline three")).toBe("Line one line two line three");
    expect(wordText(null)).toBe("");
    const { xml, all } = await opened({ ...exportQ, buyerAddress: "9 Dock\u0007 Street\nManila" });
    // eslint-disable-next-line no-control-regex
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(all).toContain("9 Dock Street Manila");
  });

  it("a quotation with no lines and a bare company profile still makes a file", async () => {
    const { all } = await opened({ ...exportQ, items: [], buyerAddress: "", shipmentTerm: "", paymentTerm: "" }, {});
    expect(all).toContain("Das Superfoods");
    expect(all).toContain("Shipment: —");
    expect(all).toContain("Grand total");
  });

  it("is named after the quotation", () => {
    expect(quotationWordName(exportQ)).toBe("Quotation-Q-26-27-001.docx");
    expect(quotationWordName({ docNo: "" })).toBe("Quotation-document.docx");
  });
});

describe("the Word button on the quotations list", () => {
  const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
  const html = renderToString(
    <AppCtx.Provider value={{ store: { ...emptyStore(), company, quotations: [exportQ, indiaQ], users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
      <QuotationsPage />
    </AppCtx.Provider>).replace(/<!-- -->/g, "");

  it("every quotation has Word beside PDF, then Edit and Delete", () => {
    for (const q of [exportQ, indiaQ]) {
      const at = html.indexOf(`aria-label="Download ${q.docNo} as PDF"`);
      const row = html.slice(at, html.indexOf("</tr>", at));
      expect(at).toBeGreaterThan(-1);
      const order = ["PDF", "Word", "Edit", "Delete"].map((l) => row.search(new RegExp(`>\\s*(<svg[\\s\\S]*?</svg>)?\\s*${l}</button>`)));
      expect(order.every((i) => i > -1), JSON.stringify(order)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(row).toContain(`aria-label="Download ${q.docNo} as Word"`);
    }
  });

  it("it makes the file from that row's quotation and the company profile, and shows a failure instead of swallowing it", () => {
    expect(appSource).toContain("const downloadWord = async (q) => { setPageError(\"\"); setPageError(await attempt(() => downloadQuotationWord(q, store.company))); };");
    expect(appSource).toContain("<button onClick={() => downloadWord(q)}");
  });

  it("the Word library is loaded only when a Word file is asked for", () => {
    expect(wordSource).toContain('const docx = await import("docx");');
    expect(wordSource).not.toMatch(/^import .* from "docx";/m);
    expect(appSource).not.toMatch(/from "docx"/);
  });
});
