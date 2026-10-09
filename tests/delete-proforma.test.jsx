// A proforma can be deleted (db/022, decisions/026). Class prevented: a Delete
// that reaches a proforma a shipment was invoiced against; a delete that
// removes the row and its history; a shipment draft left pointing at a
// proforma that is gone; a deleted proforma still holding its number, so the
// corrected one cannot be raised; a delete with one click and no way back.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, ProformaPage } from "../src/app.jsx";
import { emptyStore, proformaFromRow } from "../src/lib/db.js";
import { EXPECTED_MIGRATION } from "../src/lib/migrations.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const sql = text("db", "022_delete_proforma.sql");
const fn = (name) => new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(sql)[0];
const del = fn("delete_proforma");
const save = fn("save_proforma");
const appSource = text("src", "app.jsx");
const page = appSource.slice(appSource.indexOf("function ProformaPage("), appSource.indexOf("function ShipmentForm("));

const row = (over = {}) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", doc_no: "PI/25-26/014", doc_date: "2026-10-06", type: "domestic", party_id: null,
  quotation_ref: "", buyer_name: "Sample Foods Pvt Ltd", buyer_address: "", consignee_name: "", consignee_address: "", consignee_options: [],
  port_of_loading: "", destination_port: "", shipment_term: "", payment_term: "", conditions: "",
  currency: "INR", order_no: "", order_date: null, additional_details: "",
  total_boxes: 1600, total_value: 0, taxable_value: 1000, tax_rate: 5, tax_amount: 50, grand_total: 1050,
  items: [{ id: "l1", name: "Sample product", boxQty: 1600, rate: 0, mrp: 100, packsPerBox: 12 }],
  shipment_id: null, updated_at: "2026-10-06T11:53:08.262805+00:00", ...over,
});
const open = proformaFromRow(row());
const invoiced = proformaFromRow(row({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", doc_no: "PI/25-26/013", shipment_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }));

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), pis: [open, invoiced], users: [admin] },
    user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");
const tableRow = (html, docNo) => {
  const at = html.indexOf(`>${docNo}</td>`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</tr>", at));
};

describe("Delete on the proforma list", () => {
  it("an open proforma has Delete, between Edit and Download", () => {
    const r = tableRow(draw(<ProformaPage />), "PI/25-26/014");
    const at = (label) => r.indexOf(`aria-label="${label} PI/25-26/014"`);
    expect(at("Edit")).toBeGreaterThan(-1);
    expect(at("Delete")).toBeGreaterThan(at("Edit"));
    expect(at("Download")).toBeGreaterThan(at("Delete"));
    expect(r).toMatch(/aria-label="Delete PI\/25-26\/014"[^>]*>\s*Delete\s*<\/button>/);
  });

  it("an invoiced proforma has no Delete, and no Edit — only Download", () => {
    const r = tableRow(draw(<ProformaPage initialTab="all" />), "PI/25-26/013");
    expect(r).toContain('aria-label="Download PI/25-26/013"');
    expect(r).not.toContain("Delete");
    expect(r).not.toContain("Edit");
  });

  it("nothing is deleted by the first click: Delete only asks, Confirm deletes, Cancel backs out", () => {
    // The Delete button opens the question; it does not call the database.
    expect(page).toMatch(/aria-label=\{`Delete \$\{pi\.docNo\}`\}[\s\S]{0,160}onClick=\{\(\) => \{ setSaveError\(""\); setNotice\(""\); setConfirmId\(pi\.id\); \}\}/);
    expect(page).toContain("<span className=\"text-xs text-[var(--status-danger)]\">Delete {pi.docNo}?</span>");
    expect(page).toContain("<button onClick={() => remove(pi)} className=\"text-xs text-[var(--status-danger)]\">Confirm</button>");
    expect(page).toContain("<button onClick={() => setConfirmId(null)} className=\"text-xs text-[var(--muted)]\">Cancel</button>");
    // Exactly one place calls the delete, and it is behind Confirm.
    expect(page.split('call("delete_proforma"').length).toBe(2);
    expect(page.split("remove(pi)").length).toBe(2);
  });

  it("the question is not showing until Delete is pressed", () => {
    const html = draw(<ProformaPage />);
    expect(html).not.toContain("Delete PI/25-26/014?");
    expect(html).not.toMatch(/>Confirm<\/button>/);
  });

  it("after a delete the list is re-read, the form for that proforma closes, and the page says what happened", () => {
    const remove = page.slice(page.indexOf("const remove = async (pi) =>"), page.indexOf("// Download → PDF"));
    expect(remove).toContain('await call("delete_proforma", { p_id: pi.id });');
    expect(remove).toContain("await refresh();");
    expect(remove).toContain("if (form && form.editing && form.editing.id === pi.id) setForm(null);");
    expect(remove).toContain("was deleted. Its number can be used again.");
    // A refusal from the database is shown, not swallowed.
    expect(remove).toContain("setSaveError(message);");
  });
});

describe("delete_proforma in the database", () => {
  it("only someone with the proforma grant, and only a proforma that still exists", () => {
    expect(del).toContain("if not public.has_access('proforma') then perform public._fail(403,");
    expect(del).toContain("where id = p_id and deleted_at is null for update");
    expect(del).toContain("perform public._fail(404, 'That proforma no longer exists.')");
  });

  it("never one that has been invoiced", () => {
    expect(del).toMatch(/if v_row\.shipment_id is not null then\s+perform public\._fail\(409, v_row\.doc_no \|\| ' has already been invoiced, so it can no longer be deleted\.'\);/);
  });

  it("never one with a shipment draft against it — the draft is discarded first", () => {
    expect(del).toContain("where kind = 'shipment' and ref_id = p_id and deleted_at is null");
    expect(del).toContain("Discard that draft before deleting the proforma.");
  });

  it("the checks come before the write", () => {
    const write = del.indexOf("update public.proformas set deleted_at");
    for (const check of ["has_access('proforma')", "v_row.shipment_id is not null", "kind = 'shipment'"]) {
      expect(del.indexOf(check)).toBeGreaterThan(-1);
      expect(del.indexOf(check)).toBeLessThan(write);
    }
  });

  it("the row is retired, not removed, and the audit log keeps the whole proforma", () => {
    expect(del).toContain("update public.proformas set deleted_at = now(), deleted_by = auth.uid(), updated_at = now() where id = p_id;");
    expect(del).not.toMatch(/delete\s+from/i);
    expect(del).toMatch(/_audit\('Proforma deleted', 'proforma', p_id::text,\s+v_row\.doc_no \|\| ' — ' \|\| v_row\.buyer_name, to_jsonb\(v_row\), null\)/);
  });

  it("signed-in users only", () => {
    expect(sql).toContain("revoke all on function public.delete_proforma(uuid) from anon, public");
    expect(sql).toContain("grant execute on function public.delete_proforma(uuid) to authenticated, service_role");
  });
});

describe("the number of a deleted proforma", () => {
  it("is free: the check in save_proforma counts live proformas only", () => {
    expect(save).toContain("upper(btrim(doc_no)) = upper(v_no) and id is distinct from v_id and deleted_at is null)");
  });

  it("the backstop behind the check follows the same rule, and the older rules that did not are gone", () => {
    expect(sql).toMatch(/create unique index if not exists proformas_doc_no_live_ci\s+on public\.proformas \(upper\(btrim\(doc_no\)\)\) where deleted_at is null;/);
    expect(sql).toContain("drop index if exists public.proformas_doc_no_ci;");
    expect(sql).toContain("alter table public.proformas drop constraint if exists proformas_doc_no_key;");
    // the new index exists before either old rule is dropped
    const made = sql.indexOf("create unique index if not exists proformas_doc_no_live_ci");
    expect(made).toBeLessThan(sql.indexOf("drop index if exists public.proformas_doc_no_ci"));
    expect(made).toBeLessThan(sql.indexOf("drop constraint if exists proformas_doc_no_key"));
  });

  it("two live proformas still cannot share a number", () => {
    expect(save).toContain("'Proforma number ' || v_no || ' is already in use. Type a different number.'");
    expect(page).toContain("is already in use. Type a different number.");
  });

  it("the rest of save_proforma is as it was: access, the invoiced rule, the typed number", () => {
    const before = new RegExp("create or replace function public\\.save_proforma\\([\\s\\S]*?\\n\\$\\$;").exec(text("db", "014_edit_proforma_and_no_ifsc.sql"))[0];
    const undo = save
      .replace("  -- A deleted proforma no longer holds its number (db/022).\n", "")
      .replace("id is distinct from v_id and deleted_at is null) then", "id is distinct from v_id) then");
    expect(undo).toBe(before);
  });

  it("the console expects the migration", () => {
    expect(EXPECTED_MIGRATION).toBeGreaterThanOrEqual(22);
    expect(sql).toContain("values (22, 'delete_proforma')");
  });
});
