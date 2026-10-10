// A quotation carries terms typed by hand (db/024, decisions/029). Class
// prevented: a term typed on the form that never reaches the file; the PDF and
// the Word file listing different terms; an empty "Terms & conditions" heading
// on a quotation with none; terms wiped by a save from an older copy of the
// console; a blank box printed as an empty numbered line.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import * as docx from "docx";
import JSZip from "jszip";
import { AppCtx, QuotationForm, QuotationDocument } from "../src/app.jsx";
import { emptyStore, quotationFromRow } from "../src/lib/db.js";
import { quotationModel } from "../src/lib/documents.js";
import { buildQuotationDocx } from "../src/lib/word.js";
import { conditionsToText } from "../src/lib/format.js";
import { QUOTATION_KEYS, RPC_CONTRACT, pick } from "../src/lib/payloads.js";
import { EXPECTED_MIGRATION } from "../src/lib/migrations.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const sql = text("db", "024_quotation_terms.sql");
const save = /create or replace function public\.save_quotation\([\s\S]*?\n\$\$;/.exec(sql)[0];
const appSource = text("src", "app.jsx");

const company = { name: "Sample Foods Pvt. Ltd.", address: "1 Sample Road", gstNo: "GST-SAMPLE", iecCode: "IEC-SAMPLE" };
const row = (over = {}) => ({
  id: "q1", doc_no: "DS-QUO-2026-0007", doc_date: "2026-10-10", party_id: null, buyer_name: "Sample Importers Inc.", buyer_address: "Montreal",
  country: "Canada", shipment_term: "FOB", payment_term: "100% advance", igst: false, igst_rate: 0,
  total_value: 49999.5, igst_amount: 0, grand_total: 49999.5, currency: "USD", terms: "",
  items: [{ id: "a", product: "Peanut Butter Creamy 500gm X 12 Jar", hsn: "20081100", boxQty: 4065, boxRate: 12.3 }],
  updated_at: "2026-10-10T06:00:00Z", ...over,
});
const TERMS = ["Delivery within 30 days of receipt of advance.", "Documents: Commercial Invoice, Packing List & Bill of Lading.", "Any additional documents will be at the buyer's cost."];
const withTerms = quotationFromRow(row({ terms: TERMS.join("\n") }));
const without = quotationFromRow(row());
const before024 = quotationFromRow(row({ terms: undefined }));

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node) => renderToString(
  <AppCtx.Provider value={{ store: { ...emptyStore(), company, users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
    {node}
  </AppCtx.Provider>).replace(/<!-- -->/g, "");
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const pdfLines = (q) => unescape(draw(<QuotationDocument q={q} company={company} />).replace(/<[^>]+>/g, "\n")).split("\n").map((l) => l.trim()).filter(Boolean);
const wordLines = async (q) => {
  const zip = await JSZip.loadAsync(await docx.Packer.toBuffer(buildQuotationDocx(docx, quotationModel(q, company))));
  const xml = await zip.file("word/document.xml").async("string");
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((p) => unescape([...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")).trim()).filter(Boolean);
};
const termBoxes = (html) => [...html.matchAll(/>Term (\d+)<\/span>[\s\S]*?value="([^"]*)"/g)].map((m) => unescape(m[2]));

describe("what the quotation file says about terms", () => {
  const NUMBERED = TERMS.map((t, i) => `${i + 1}. ${t}`);

  it("typed terms are numbered in the order they were typed", () => {
    const m = quotationModel(withTerms, company);
    expect(m.conditionsLabel).toBe("Terms & conditions");
    expect(m.conditions).toEqual(NUMBERED);
  });

  it("the PDF and the Word file list the same terms, under the same heading, in the same place", async () => {
    for (const lines of [pdfLines(withTerms), await wordLines(withTerms)]) {
      const at = lines.indexOf("Terms & conditions");
      expect(at).toBeGreaterThan(-1);
      expect(lines.slice(at + 1, at + 1 + NUMBERED.length)).toEqual(NUMBERED);
      // after the amount in words, and straight before the signature
      expect(lines.findIndex((l) => l.startsWith("Amount in words:"))).toBe(at - 1);
      expect(lines[at + 1 + NUMBERED.length]).toMatch(/^For\b/);
      expect(lines.indexOf("Authorised signatory")).toBeGreaterThan(at);
    }
  });

  it("a quotation with no terms has no heading and no empty lines — it reads as before", async () => {
    for (const q of [without, before024]) {
      expect(quotationModel(q, company).conditions).toEqual([]);
      for (const lines of [pdfLines(q), await wordLines(q)]) {
        expect(lines).not.toContain("Terms & conditions");
        expect(lines.some((l) => /^\d+\.\s*$/.test(l))).toBe(false);
      }
    }
  });

  it("the typed terms are the only terms below the table; the shipment and payment terms stay at the top", async () => {
    for (const lines of [pdfLines(withTerms), await wordLines(withTerms)]) {
      expect(lines).toContain("Shipment: FOB");
      expect(lines).toContain("Payment: 100% advance");
      // the standing validity line was removed on the owner's instruction (decisions/030)
      expect(lines.some((l) => /valid for 30 days/i.test(l))).toBe(false);
    }
  });

  it("blank lines between terms are not printed or numbered", () => {
    const q = quotationFromRow(row({ terms: "First term\n\n   \nSecond term\n" }));
    expect(quotationModel(q, company).conditions).toEqual(["1. First term", "2. Second term"]);
  });

  it("a term with & < > or quotes is kept exactly in both files", async () => {
    const q = quotationFromRow(row({ terms: `Packing: 12 jars/box & "export" cartons <5 ply>` }));
    const want = `1. Packing: 12 jars/box & "export" cartons <5 ply>`;
    expect(pdfLines(q)).toContain(want);
    expect(await wordLines(q)).toContain(want);
  });
});

describe("typing terms on the quotation form", () => {
  it("a new quotation has a Terms list with one empty box and Add another term", () => {
    const html = draw(<QuotationForm onCancel={() => {}} onSubmit={async () => ""} />);
    expect(html).toContain(">Terms</p>");
    expect(termBoxes(html)).toEqual([""]);
    expect(html).toMatch(/<\/svg>\s*Add another term<\/button>/);
    expect(html).not.toContain('aria-label="Remove term 1"');          // the only box cannot be removed
  });

  it("editing shows each term in its own box, each removable", () => {
    const html = draw(<QuotationForm initial={withTerms} onCancel={() => {}} onSubmit={async () => ""} />);
    expect(termBoxes(html)).toEqual(TERMS);
    for (const n of [1, 2, 3]) expect(html).toContain(`aria-label="Remove term ${n}"`);
  });

  it("a quotation made before terms existed opens with one empty box", () => {
    expect(termBoxes(draw(<QuotationForm initial={before024} onCancel={() => {}} onSubmit={async () => ""} />))).toEqual([""]);
  });

  it("the list is sent as one text, a term per line, with empty boxes dropped", () => {
    expect(appSource).toContain("terms: conditionsToText(terms),");
    expect(conditionsToText(["  First term ", "", "Second term", "   "])).toBe("First term\nSecond term");
    expect(conditionsToText([""])).toBe("");
  });

  it("Add another term adds a box; removing takes out that one only", () => {
    expect(appSource).toContain("onClick={() => setTerms([...terms, \"\"])}");
    expect(appSource).toContain("onClick={() => setTerms(terms.filter((_, j) => j !== i))}");
    expect(appSource).toContain("onChange={(e) => setTerms(terms.map((x, j) => (j === i ? e.target.value : x)))}");
  });
});

describe("saving the terms", () => {
  it("they are sent with the quotation and are part of the agreed contract", () => {
    expect(QUOTATION_KEYS).toContain("terms");
    expect(RPC_CONTRACT.save_quotation).toContain("terms");
    expect(pick({ buyerName: "B", terms: "A\nB", junk: 1 }, QUOTATION_KEYS)).toEqual({ buyerName: "B", terms: "A\nB" });
  });

  it("reading: the stored terms, and none for an older quotation", () => {
    expect(withTerms.terms).toBe(TERMS.join("\n"));
    expect(before024.terms).toBe("");
  });

  it("the database keeps them, never null", () => {
    expect(sql).toMatch(/add column if not exists terms text not null default ''/);
    expect(save).toContain("v_terms   text  := btrim(coalesce(p ->> 'terms', ''));");
    expect(save).toContain("grand_total, items, created_by, currency, terms)");
    expect(save).toContain("auth.uid(), v_cur, v_terms)");
  });

  it("an edit that does not carry them — an older copy of the console — leaves them alone", () => {
    expect(save).toContain("terms = case when p ? 'terms' then v_terms else terms end,");
  });

  it("terms that could not fit on a quotation are refused, not cut short", () => {
    expect(save).toContain("if length(v_terms) > 6000 then perform public._fail(400,");
    expect(save).not.toMatch(/left\(v_terms|substr\w*\(v_terms/);
  });

  it("the rest of save_quotation is as db/023 left it", () => {
    const before = /create or replace function public\.save_quotation\([\s\S]*?\n\$\$;/.exec(text("db", "023_quotation_currency.sql"))[0];
    const undo = save
      .replace("  v_terms   text  := btrim(coalesce(p ->> 'terms', ''));\n", "")
      .replace(/  -- Terms typed on the quotation[^\n]*\n  if length\(v_terms\) > 6000[^\n]*\n/, "")
      .replace("created_by, currency, terms)", "created_by, currency)")
      .replace("auth.uid(), v_cur, v_terms)", "auth.uid(), v_cur)")
      .replace("      terms = case when p ? 'terms' then v_terms else terms end,\n", "");
    expect(undo).toBe(before);
  });

  it("the console expects the migration", () => {
    expect(EXPECTED_MIGRATION).toBeGreaterThanOrEqual(24);
    expect(sql).toContain("values (24, 'quotation_terms')");
  });
});
