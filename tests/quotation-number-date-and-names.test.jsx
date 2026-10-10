// A quotation's number and date can be typed, and its PDF and Word file are
// named "Buyer Name_Quotation number" (db/025, decisions/030). Class
// prevented: a typed number or date that is not saved; two quotations with one
// number; a number typed by hand colliding with the automatic series later; an
// older copy of the console re-dating or re-numbering a quotation by editing
// it; a file name the computer refuses, or two downloads named differently.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, QuotationForm, QuotationDocument } from "../src/app.jsx";
import { emptyStore, quotationFromRow } from "../src/lib/db.js";
import { quotationModel, quotationFileName } from "../src/lib/documents.js";
import { quotationWordName } from "../src/lib/word.js";
import { todayIST } from "../src/lib/format.js";
import { QUOTATION_KEYS, RPC_CONTRACT, pick } from "../src/lib/payloads.js";
import { EXPECTED_MIGRATION } from "../src/lib/migrations.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const sql = text("db", "025_quotation_number_and_date.sql");
const save = /create or replace function public\.save_quotation\([\s\S]*?\n\$\$;/.exec(sql)[0];
const appSource = text("src", "app.jsx");
const page = appSource.slice(appSource.indexOf("function QuotationsPage("), appSource.indexOf("function DraftList("));

const company = { name: "Sample Foods Pvt. Ltd.", address: "1 Sample Road", gstNo: "GST-SAMPLE", iecCode: "IEC-SAMPLE" };
const saved = quotationFromRow({
  id: "q1", doc_no: "Q/26-27/014", doc_date: "2026-09-15", party_id: null, buyer_name: "Sample Importers Inc.", buyer_address: "Montreal",
  country: "Canada", shipment_term: "FOB", payment_term: "100% advance", igst: false, igst_rate: 0,
  total_value: 49999.5, igst_amount: 0, grand_total: 49999.5, currency: "USD", terms: "",
  items: [{ id: "a", product: "Peanut Butter Creamy 500gm X 12 Jar", hsn: "20081100", boxQty: 4065, boxRate: 12.3 }],
  updated_at: "2026-10-10T06:00:00Z",
});

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node) => renderToString(
  <AppCtx.Provider value={{ store: { ...emptyStore(), company, quotations: [saved], users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true }}>
    {node}
  </AppCtx.Provider>).replace(/<!-- -->/g, "");
const labels = (html) => [...html.matchAll(/<label[^>]*><span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
const box = (html, label) => {
  const at = html.indexOf(`>${label}</span>`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</label>", at));
};
const valueOf = (html, label) => (/value="([^"]*)"/.exec(box(html, label)) || [])[1];

describe("the Quotation no. and Date boxes", () => {
  it("they are the first two boxes on the form", () => {
    expect(labels(draw(<QuotationForm onCancel={() => {}} onSubmit={async () => ""} />)).slice(0, 2)).toEqual(["Quotation no.", "Date"]);
  });

  it("a new quotation: the number is empty and says it can be left so; the date is today", () => {
    const html = draw(<QuotationForm onCancel={() => {}} onSubmit={async () => ""} />);
    expect(valueOf(html, "Quotation no.")).toBe("");
    expect(box(html, "Quotation no.")).toContain("Leave empty for an automatic number");
    expect(box(html, "Date")).toContain('type="date"');
    expect(valueOf(html, "Date")).toBe(todayIST());
  });

  it("editing shows the number and the date the quotation has", () => {
    const html = draw(<QuotationForm initial={saved} onCancel={() => {}} onSubmit={async () => ""} />);
    expect(valueOf(html, "Quotation no.")).toBe("Q/26-27/014");
    expect(valueOf(html, "Date")).toBe("2026-09-15");
  });

  it("both are sent when the quotation is saved", () => {
    expect(appSource).toContain("docNo: docNo.trim(), docDate,");
    for (const k of ["docNo", "docDate"]) {
      expect(QUOTATION_KEYS).toContain(k);
      expect(RPC_CONTRACT.save_quotation).toContain(k);
    }
    expect(pick({ buyerName: "B", docNo: "Q-1", docDate: "2026-10-10", date: "x" }, QUOTATION_KEYS)).toEqual({ buyerName: "B", docNo: "Q-1", docDate: "2026-10-10" });
  });

  it("a number already used by another quotation is said at once, without a round trip — and its own number is not a repeat", () => {
    expect(page).toContain("store.quotations.some((q) => q.id !== extra.id && String(q.docNo || \"\").trim().toUpperCase() === typed.toUpperCase())");
    expect(page).toContain("is already in use. Type a different number.");
    // an empty box is never "a repeat": it means automatic
    expect(page).toContain("if (typed && store.quotations.some(");
  });

  it("the printed quotation shows them: Quotation No. and Date, dd/mm/yyyy", () => {
    const html = draw(<QuotationDocument q={saved} company={company} />);
    expect(html).toContain("<b>Quotation No.: Q/26-27/014</b>");
    expect(html).toContain("Date: 15/09/2026");
    const m = quotationModel(saved, company);
    expect([m.docNoLine, m.date]).toEqual(["Quotation No.: Q/26-27/014", "Date: 15/09/2026"]);
  });
});

describe("what the database does with a typed number and date", () => {
  it("a typed number is plain characters, at most 40, and not a live quotation's — whatever the capitals", () => {
    expect(save).toContain("v_no      text  := btrim(coalesce(p ->> 'docNo', ''));");
    expect(save).toContain("if length(v_no) > 40 or v_no !~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]*$' then");
    expect(save).toContain("upper(btrim(doc_no)) = upper(v_no) and id is distinct from v_id and deleted_at is null) then");
    expect(save).toContain("'Quotation number ' || v_no || ' is already in use. Type a different number.'");
  });

  it("no number typed: the next in the series, stepping over any typed by hand", () => {
    const at = save.indexOf("if v_no = '' then");
    const loop = save.slice(at, save.indexOf("end if;", at));
    expect(at).toBeGreaterThan(-1);
    expect(loop).toContain("v_no := public._alloc_doc_no('quotation');");
    expect(loop).toContain("exit when not exists (select 1 from public.quotations where upper(btrim(doc_no)) = upper(v_no) and deleted_at is null);");
    // the series is used nowhere else — a typed number never burns one
    expect(save.split("_alloc_doc_no(").length).toBe(2);
  });

  it("the date: the one typed, else today on a new quotation", () => {
    expect(save).toContain("v_date    date  := public._date(p ->> 'docDate', 'Quotation date');");
    expect(save).toContain("values (v_no, coalesce(v_date, public.ist_today()), v_party, v_buyer,");
    expect(save).toContain("v_date < date '2000-01-01' or v_date > date '2100-12-31'");
  });

  it("an edit that sends no number or no date — an older copy of the console, or an emptied box — changes neither", () => {
    expect(save).toContain("doc_no = case when v_no <> '' then v_no else doc_no end,");
    expect(save).toContain("doc_date = coalesce(v_date, doc_date),");
  });

  it("a deleted quotation no longer holds its number, and two live ones still cannot share one", () => {
    expect(sql).toMatch(/create unique index if not exists quotations_doc_no_live_ci\s+on public\.quotations \(upper\(btrim\(doc_no\)\)\) where deleted_at is null;/);
    expect(sql).toContain("alter table public.quotations drop constraint if exists quotations_doc_no_key;");
    expect(sql.indexOf("create unique index if not exists quotations_doc_no_live_ci")).toBeLessThan(sql.indexOf("drop constraint if exists quotations_doc_no_key"));
  });

  it("the rest of save_quotation is as db/024 left it", () => {
    const before = /create or replace function public\.save_quotation\([\s\S]*?\n\$\$;/.exec(text("db", "024_quotation_terms.sql"))[0];
    const kept = (fn) => fn.split("\n").filter((l) => /v_total|v_tax|v_rate|v_igst|v_cur|v_terms|has_access|expectedUpdatedAt|_check_lines|_audit/.test(l) && !/values \(|v_no|v_date/.test(l)).join("\n");
    expect(kept(save)).toBe(kept(before));
  });

  it("the console expects the migration", () => {
    expect(EXPECTED_MIGRATION).toBeGreaterThanOrEqual(25);
    expect(sql).toContain("values (25, 'quotation_number_and_date')");
  });
});

describe("the names of the downloaded files", () => {
  it("Buyer Name_Quotation number — as the owner wrote it", () => {
    expect(quotationFileName({ buyerName: "Sample Importers Inc.", docNo: "DS-QUO-2026-0007" })).toBe("Sample Importers Inc_DS-QUO-2026-0007");
    expect(quotationFileName({ buyerName: "MRK Foods Pvt Ltd", docNo: "14" })).toBe("MRK Foods Pvt Ltd_14");
  });

  it("the PDF and the Word file carry the same name", () => {
    expect(quotationWordName(saved)).toBe(`${quotationFileName(saved)}.docx`);
    // the PDF is named by the page title while it prints, and the title is put back after
    const print = page.slice(page.indexOf("useEffect(() => {"), page.indexOf("}, [printing]);"));
    expect(print).toContain("const title = document.title;");
    expect(print).toMatch(/document\.title = quotationFileName\(printing\);\s+window\.print\(\);\s+document\.title = title;/);
  });

  it("the name reads as typed; only what a file name cannot hold is changed", () => {
    expect(quotationFileName({ buyerName: "Tom & Jerry's (Exports) Co., Ltd", docNo: "Q-7" })).toBe("Tom & Jerry's (Exports) Co., Ltd_Q-7");
    expect(quotationFileName({ buyerName: "M/s. XYZ Traders", docNo: "Q/26-27/001" })).toBe("M-s. XYZ Traders_Q-26-27-001");
    expect(quotationFileName({ buyerName: `A "B" <C> D? E* F|G:H\\I`, docNo: "1" })).toBe("A B C D E F-G-H-I_1");
    for (const q of [saved, { buyerName: `x<>:"/\\|?*y`, docNo: "a\u0000b\tc\nd" }]) {
      // eslint-disable-next-line no-control-regex
      expect(quotationFileName(q)).not.toMatch(/[\\/:*?"<>|\u0000-\u001F]/);
    }
  });

  it("no part ends in a dot or a space, which Windows drops or refuses", () => {
    expect(quotationFileName({ buyerName: "Sample Co. ", docNo: " Q.1. " })).toBe("Sample Co_Q.1");
  });

  it("a missing buyer or number still gives a usable name", () => {
    expect(quotationFileName({ buyerName: "", docNo: "12" })).toBe("Quotation_12");
    expect(quotationFileName({ buyerName: "???", docNo: "" })).toBe("Quotation_document");
  });
});
