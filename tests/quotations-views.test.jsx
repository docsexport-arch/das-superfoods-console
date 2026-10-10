// The Quotations page has two views (decisions/032), as Parties has: quotation
// creation, and — behind "View or Edit quotation" at the top right — every
// quotation made. Class prevented: a created quotation that cannot be found
// again; the list creeping back onto the creation screen; a quotation with no
// way to download, edit or remove it; the two screens not being separate
// places, so Back cannot move between them.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, QuotationsPage } from "../src/app.jsx";
import { emptyStore, quotationFromRow } from "../src/lib/db.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(join(ROOT, "src", "app.jsx"), "utf8").replace(/\r\n/g, "\n");
const page = appSource.slice(appSource.indexOf("function QuotationsPage("), appSource.indexOf("function DraftList("));

const row = (id, no, buyer, over = {}) => quotationFromRow({
  id, doc_no: no, doc_date: "2026-10-10", party_id: null, buyer_name: buyer, buyer_address: "", country: "Canada",
  shipment_term: "FOB", payment_term: "100% advance", igst: false, igst_rate: 0, total_value: 50, igst_amount: 0, grand_total: 50,
  currency: "USD", terms: "", items: [{ id: "a", product: "Sample product", hsn: "", boxQty: 10, boxRate: 5 }], updated_at: "2026-10-10T06:00:00Z", ...over,
});
const q1 = row("q1", "SFPI2627EXP123", "Sample Importers Inc.");
const q2 = row("q2", "DS-QUO-2026-0003", "Another Buyer LLC", { currency: "INR", country: "India" });

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, quotations = [q1, q2], ctx = {}) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), quotations, users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true, ...ctx,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");

describe("quotation creation — what the Quotations page opens on", () => {
  const html = draw(<QuotationsPage />);

  it("has View or Edit quotation at the top right, saying how many have been made", () => {
    expect(html).toMatch(/<button[^>]*>View or Edit quotation<span[^>]*aria-label="2 made"[^>]*>2<\/span><\/button>/);
    // above the form: at the top, beside the page's title
    expect(html.indexOf("View or Edit quotation")).toBeLessThan(html.indexOf("New quotation"));
    expect(html).toContain(">Quotations</h1>");
  });

  it("shows the creation form, open, without pressing anything", () => {
    for (const s of ["New quotation", "Quotation no.", "Buyer name", "Currency", "Add product line", "Add another term", "Create quotation"]) expect(html, s).toContain(s);
  });

  it("the form is cleared, not closed — there is nothing behind it to go back to", () => {
    expect(html).toMatch(/<button[^>]*>Clear form<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>Cancel<\/button>/);
  });

  it("does not list the quotations already made", () => {
    for (const s of ["SFPI2627EXP123", "DS-QUO-2026-0003", "Sample Importers Inc.", "Another Buyer LLC"]) expect(html, s).not.toContain(s);
    expect(html).not.toContain("as PDF");
    expect(html).not.toContain("as Word");
    expect(html).not.toMatch(/Excel\s*<\/button>/);
  });

  it("with none made yet, the button still leads somewhere and says so", () => {
    expect(draw(<QuotationsPage />, [])).toMatch(/aria-label="0 made"/);
  });
});

describe("View or Edit quotation — every quotation made", () => {
  const html = draw(<QuotationsPage initialView="list" />);

  it("lists every quotation with its number, buyer and value", () => {
    for (const s of ["SFPI2627EXP123", "Sample Importers Inc.", "DS-QUO-2026-0003", "Another Buyer LLC", ">US$ 50.00</td>", ">₹ 50.00</td>"]) expect(html, s).toContain(s);
    expect(html).toContain(">View or edit quotations</h1>");
  });

  it("each can be downloaded as PDF or Word, edited, or deleted", () => {
    for (const no of ["SFPI2627EXP123", "DS-QUO-2026-0003"]) {
      for (const what of [`Download ${no} as PDF`, `Download ${no} as Word`, `Edit ${no}`, `Delete ${no}`]) {
        expect(html, what).toContain(`aria-label="${what}"`);
      }
    }
  });

  it("has the Excel list and a way back to creating one — and no creation form in the way", () => {
    expect(html).toMatch(/Excel\s*<\/button>/);
    expect(html).toMatch(/<button[^>]*>\s*<svg[\s\S]*?<\/svg>\s*New quotation<\/button>/);
    expect(html).not.toContain("Create quotation");
    expect(html).not.toContain("Clear form");
    expect(html).not.toContain("View or Edit quotation");
  });

  it("with none made yet it says what to do", () => {
    expect(draw(<QuotationsPage initialView="list" />, [])).toContain("starts the first one");
  });
});

describe("the two screens are two places", () => {
  it("inside the console the view comes from the address: #/quotations and #/quotations/list", () => {
    const at = (view) => draw(<QuotationsPage />, [q1, q2], { route: { section: "quotations", view }, navigate: () => {} });
    expect(at("")).toContain("Create quotation");
    expect(at("")).not.toContain("SFPI2627EXP123");
    expect(at("list")).toContain("SFPI2627EXP123");
    expect(at("list")).not.toContain("Create quotation");
    // an address it does not know is the creation screen, not a blank page
    expect(at("nonsense")).toContain("Create quotation");
  });

  it("moving between them goes through the address, so Back returns", () => {
    expect(page).toContain('const setView = (next) => (routed ? navigate("quotations", next === "list" ? "list" : "") : setLocalView(next));');
  });

  it("arriving at either screen starts it clean: no half-open edit, no question waiting, no old message", () => {
    expect(page).toMatch(/arrivedAt\.current = view;\s+setEditingId\(null\); setConfirmId\(null\); setPageError\(""\); setNotice\(""\);/);
  });
});

describe("after creating or changing a quotation", () => {
  it("creating says which number it was given and where it went, clears the form, and stays on creation", () => {
    expect(page).toContain("made = await call(\"save_quotation\",");
    expect(page).toContain("if (!message) done((made && made.doc_no) || typed, payload);");
    expect(page).toContain("was created. It is now under`, true);");
    expect(page).toContain("setFormKey((k) => k + 1);");
    // the message ends with the way to the list
    expect(page).toContain("{notice.toList && <React.Fragment> <button onClick={() => show(\"list\")} className=\"underline\">View or Edit quotation</button>.</React.Fragment>}");
  });

  it("editing happens on the list screen, and says so when saved", () => {
    expect(page).toContain("{view === \"list\" && editing && (");
    expect(page).toContain("setEditingId(null); setNotice(`Quotation ${docNo} was updated.`);");
  });

  it("deleting still asks first, and says so when done", () => {
    expect(page).toContain("<button onClick={() => remove(q)} className=\"text-xs text-[var(--status-danger)]\">Confirm</button>");
    expect(page).toContain("was removed from the list.");
  });

  it("a failure is shown instead of the success message", () => {
    expect(page).toContain("{notice.text && !pageError && (");
  });
});
