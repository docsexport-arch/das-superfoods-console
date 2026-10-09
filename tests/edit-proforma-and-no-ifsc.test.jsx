// Editing a proforma, and IFSC gone from the company profile and every
// document (db/014, decisions/011). Class prevented: an edit that silently
// changes something nobody touched (the buyer, the consignee, the raise date);
// an edit reaching a proforma that has already been invoiced; a create-only
// entry point being turned into an edit; a removed field still leaking out.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, ProformaPage, ProformaForm, ProformaDocument, CompanyPage } from "../src/app.jsx";
import { emptyStore, partyFromRow, proformaFromRow, companyFromRow } from "../src/lib/db.js";
import { proformaSheetRows } from "../src/lib/documents.js";
import { PROFORMA_KEYS, COMPANY_KEYS, RPC_CONTRACT, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql014 = readFileSync(join(ROOT, "db", "014_edit_proforma_and_no_ifsc.sql"), "utf8").replace(/\r\n/g, "\n");
const fn = (name) => new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(sql014)[0];

const product = { id: "11111111-1111-4111-8111-111111111111", name: "Peanut Butter Creamy 340g", hsn: "20081100", rate: 17.77, mrp: 0, net_wt: 1.36, gross_wt: 1.52, packs_per_box: 6, weight_per_pack_g: 0 };
const party = partyFromRow({
  id: "22222222-2222-4222-8222-222222222222", type: "international",
  buyer_name: "Crosschannel Imports Inc.", buyer_address: "Newark, NJ", consignee_name: "Crosschannel Logistics", consignee_address: "Port Newark",
  consignee_options: [], alt_buyers: [{ name: "Crosschannel Foods LLC", address: "Jersey City" }], country: "United States", currency: "USD",
  shipment_term: "FOB", payment_term: "30% advance", conditions: "", port_of_loading: "Mundra", destination_port: "New York",
}, [product]);

const row = (over = {}) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", doc_no: "PI/25-26/014", doc_date: "2026-10-05", type: "international", party_id: party.id,
  quotation_ref: "", buyer_name: "Crosschannel Foods LLC", buyer_address: "Jersey City",
  consignee_name: "Crosschannel Imports Inc.", consignee_address: "Newark, NJ", consignee_options: [],
  port_of_loading: "Mundra", destination_port: "New York", shipment_term: "FOB", payment_term: "30% advance", conditions: "",
  currency: "USD", order_no: "PO-77", order_date: "2026-10-01", additional_details: "",
  total_boxes: 3200, total_value: 56864, taxable_value: 0, tax_rate: 0, tax_amount: 0, grand_total: 56864,
  items: [{ id: "l1", productId: product.id, name: product.name, hsn: product.hsn, boxQty: 3200, rate: 17.77, mrp: 0, netWt: 1.36, grossWt: 1.52, packsPerBox: 6 }],
  shipment_id: null, updated_at: "2026-10-05T11:53:08.262805+00:00", ...over,
});
const open = proformaFromRow(row());
const invoiced = proformaFromRow(row({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", doc_no: "PI/25-26/013", shipment_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }));

const company = { name: "Das Superfoods Pvt. Ltd.", address: "Ahmedabad", bankName: "HDFC Bank", accountNo: "50200012345678", ifsc: "HDFC0000123", swift: "HDFCINBB", gstNo: "24AAAAA0000A1Z5", iecCode: "0312345678" };
const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, extra = {}) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), company, parties: [party], pis: [open, invoiced], users: [admin], ...extra },
    user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");
const picker = (html, labelText) => {
  const at = html.indexOf(labelText);
  return at < 0 ? "" : html.slice(at, html.indexOf("</select>", at));
};
const editForm = (pi, parties) => draw(
  <ProformaForm type="international" editing={pi} onSave={() => {}} onCancel={() => {}} />, parties ? { parties } : {});

describe("editing a proforma — on screen", () => {
  it("an open proforma offers Edit; an invoiced one does not", () => {
    // The "All" tab: the default "Open" tab does not list invoiced proformas at all.
    const html = draw(<ProformaPage initialTab="all" />);
    expect(html).toMatch(/aria-label="Edit PI\/25-26\/014"/);
    expect(html).not.toMatch(/aria-label="Edit PI\/25-26\/013"/);
    // Download stays on both.
    expect(html).toMatch(/aria-label="Download PI\/25-26\/014"/);
    expect(html).toMatch(/aria-label="Download PI\/25-26\/013"/);
  });

  it("the form opens with everything the proforma says, and saves rather than creates", () => {
    const html = editForm(open);
    expect(html).toContain("Edit international proforma");
    expect(html).toContain("Editing PI/25-26/014, raised 05/10/2026");
    for (const v of ["PI/25-26/014", "PO-77", "2026-10-01", "3200"]) expect(html, v).toMatch(new RegExp(`value="${v}"`));
    expect(html).toContain("Save changes");
    expect(html).not.toContain("Create proforma");
    // An edit is not a draft: the proforma already exists.
    expect(html).not.toContain("Save draft");
  });

  it("keeps the buyer and consignee the proforma was raised with", () => {
    const html = editForm(open);
    expect(picker(html, "Buyer on this proforma")).toMatch(/<option[^>]*selected=""[^>]*>Crosschannel Foods LLC \(other name\)/);
    expect(picker(html, "Consignee on this proforma")).toMatch(/<option[^>]*selected=""[^>]*>Crosschannel Imports Inc\. \(buyer\)/);
  });

  it("a name the party no longer lists stays on offer — an edit never swaps the buyer unasked", () => {
    // The party master was changed after the proforma was raised: the other name is gone.
    const changed = { ...party, altBuyers: [] };
    const html = editForm(open, [changed]);
    expect(picker(html, "Buyer on this proforma")).toMatch(/<option[^>]*selected=""[^>]*>Crosschannel Foods LLC \(on this proforma\)/);
  });

  it("a proforma raised with no consignee stays 'Not set' instead of picking up the party's", () => {
    const html = editForm(proformaFromRow(row({ consignee_name: "", consignee_address: "" })));
    expect(picker(html, "Consignee on this proforma")).toMatch(/<option[^>]*selected=""[^>]*>Not set/);
  });

  it("if the party it was raised for is gone, it says so and offers nothing to save", () => {
    const html = editForm(open, []);
    expect(html).toContain("no longer on file, so it cannot be edited here");
    expect(html).not.toContain("Save changes");
  });
});

describe("editing a proforma — what is sent, and what the database does with it", () => {
  it("an edit carries the id and the version it was opened from; a new proforma carries neither", () => {
    for (const k of ["id", "expectedUpdatedAt", "docNo"]) expect(PROFORMA_KEYS).toContain(k);
    expect(open.updatedAt).toBe("2026-10-05T11:53:08.262805+00:00");
    const fresh = pick({ id: undefined, expectedUpdatedAt: undefined, docNo: "X-1", type: "international" }, PROFORMA_KEYS);
    expect(Object.keys(fresh).sort()).toEqual(["docNo", "type"]);
    // The form's own scratch id must never reach the database as an identity.
    expect(readFileSync(join(ROOT, "src", "app.jsx"), "utf8")).not.toMatch(/id: tempId\(\), docNo/);
  });

  it("the client sends proformas to the one function that raises and edits", () => {
    expect(RPC_CONTRACT.save_proforma).toBe(PROFORMA_KEYS);
    expect(RPC_CONTRACT.create_proforma).toBeUndefined();
    const app = readFileSync(join(ROOT, "src", "app.jsx"), "utf8");
    expect(app).toContain('call("save_proforma"');
    expect(app).not.toContain('call("create_proforma"');
  });

  it("only an open proforma, from the version that was opened, with no shipment draft against it", () => {
    const body = fn("save_proforma");
    expect(body).toMatch(/if v_old\.shipment_id is not null then\s+perform public\._fail\(409/);
    expect(body).toMatch(/v_old\.updated_at <> \(p ->> 'expectedUpdatedAt'\)::timestamptz/);
    expect(body).toMatch(/from public\.drafts\s+where kind = 'shipment' and ref_id = v_id and deleted_at is null/);
    expect(body).toContain("for update");
  });

  it("the number rule still applies, and a proforma does not collide with itself", () => {
    const body = fn("save_proforma");
    expect(body).toContain("v_no !~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]*$'");
    expect(body).toContain("upper(btrim(doc_no)) = upper(v_no) and id is distinct from v_id");
    expect(body).not.toContain("_alloc_doc_no");
  });

  it("an edit does not move the raise date or the author, and is audited with before and after", () => {
    const update = /update public\.proformas set([\s\S]*?)returning \* into v_row;/.exec(fn("save_proforma"))[1];
    expect(update).not.toMatch(/doc_date|created_by|created_at|shipment_id/);
    expect(fn("save_proforma")).toContain("'Proforma edited', 'proforma', v_row.id::text,\n      v_row.doc_no || ' — ' || v_buyer, to_jsonb(v_old), to_jsonb(v_row)");
  });

  it("the totals are worked out once, for raising and editing alike", () => {
    // Class: a second copy of the arithmetic that drifts from the first.
    const body = fn("save_proforma");
    expect(body.match(/into v_boxes, v_total, v_taxable/g)).toHaveLength(1);
    expect(body.match(/round\(v_taxable \* v_rate \/ 100, 2\)/g)).toHaveLength(1);
    const defined = readdirSync(join(ROOT, "db")).filter((f) => f.endsWith(".sql"))
      .filter((f) => /^create or replace function public\.save_proforma\(/m.test(readFileSync(join(ROOT, "db", f), "utf8")));
    // db/022 redefines it with one change (a deleted proforma's number is free); still one copy of the arithmetic.
    expect(defined).toEqual(["014_edit_proforma_and_no_ifsc.sql", "022_delete_proforma.sql"]);
    const sql022 = readFileSync(join(ROOT, "db", "022_delete_proforma.sql"), "utf8").replace(/\r\n/g, "\n");
    const latest = new RegExp("create or replace function public\\.save_proforma\\([\\s\\S]*?\\n\\$\\$;").exec(sql022)[0];
    expect(latest.match(/into v_boxes, v_total, v_taxable/g)).toHaveLength(1);
    expect(latest.match(/round\(v_taxable \* v_rate \/ 100, 2\)/g)).toHaveLength(1);
  });

  it("the two entry points that only create cannot be turned into an edit", () => {
    for (const name of ["create_proforma", "raise_from_draft"]) {
      expect(fn(name), name).toContain("public.save_proforma(p - 'id' - 'expectedUpdatedAt')");
      expect(fn(name), name).toMatch(/has_access\(/);
    }
    expect(fn("create_proforma")).not.toMatch(/insert into|update public/);
  });
});

describe("IFSC is gone", () => {
  it("from the company screen and what it saves", () => {
    const html = draw(<CompanyPage />);
    expect(html).not.toMatch(/IFSC/i);
    expect(html).not.toContain("HDFC0000123");
    expect(html).toContain("Swift code");
    expect(COMPANY_KEYS).not.toContain("ifsc");
    expect(emptyStore().company).not.toHaveProperty("ifsc");
  });

  it("from the data the screens are given, even while the column still exists", () => {
    const mapped = companyFromRow({ id: 1, name: "Das", address: "A", bank_name: "HDFC Bank", account_no: "1", ifsc: "HDFC0000123", swift: "HDFCINBB", gst_no: "G", iec_code: "I" });
    expect(mapped).not.toHaveProperty("ifsc");
    expect(JSON.stringify(mapped)).not.toContain("HDFC0000123");
    expect(mapped.swift).toBe("HDFCINBB");
  });

  it("from every document — printed and Excel", () => {
    expect(draw(<ProformaDocument pi={open} company={company} />)).not.toMatch(/IFSC|HDFC0000123/i);
    const sheet = JSON.stringify(proformaSheetRows(open, company));
    expect(sheet).not.toMatch(/IFSC|HDFC0000123/i);
    expect(sheet).toContain("HDFCINBB");
  });

  it("from the client source altogether", () => {
    const files = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
    for (const f of files("src")) expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/ifsc/i);
  });

  it("the save function neither reads nor wipes it; the column waits for the old client to retire", () => {
    expect(fn("save_company")).not.toMatch(/ifsc/i);
    expect(fn("save_company")).toContain("swift = coalesce(p ->> 'swift', '')");
    expect(sql014).not.toMatch(/drop column/i);
  });
});
