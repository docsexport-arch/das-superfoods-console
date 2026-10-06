// Bank details for transfer (db/015, decisions/013). Class prevented: a bank
// detail the Company page collects but never saves; one that is saved but
// missing from the proforma; a PDF and an Excel that give the buyer different
// instructions; an older copy of the console blanking a detail it never knew.
//
// Every bank value in this file is made up. Real ones are typed by the owner
// on the Company page and never belong in the repository.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, CompanyPage, ProformaDocument } from "../src/app.jsx";
import { emptyStore, companyFromRow } from "../src/lib/db.js";
import { proformaSheetRows } from "../src/lib/documents.js";
import { defangRows } from "../src/lib/excel.js";
import { COMPANY_KEYS, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql015 = readFileSync(join(ROOT, "db", "015_company_bank_transfer_details.sql"), "utf8").replace(/\r\n/g, "\n");

const row = {
  id: 1, name: "Example Foods Pvt. Ltd.", address: "1 Sample Road, Testville", gst_no: "24AAAAA0000A1Z5", iec_code: "0312345678",
  account_name: "EXAMPLE FOODS PRIVATE LIMITED", bank_name: "Sample Bank", bank_branch: "Sample Bank Main Branch, Testville, Gujarat, India",
  account_no: "00123456789012", swift: "SAMPINBBXXX", ifsc: "SAMP0000001",
};
const company = companyFromRow(row);
const pi = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", docNo: "PI/25-26/014", date: "2026-10-05", type: "international",
  buyerName: "Crosschannel Imports Inc.", buyerAddress: "Newark, NJ", consigneeName: "", consigneeAddress: "", currency: "USD",
  shipmentTerm: "FOB", paymentTerm: "30% advance", conditions: "", totalBoxes: 10, totalValue: 177.7, grandTotal: 177.7,
  items: [{ id: "l1", name: "Peanut Butter Creamy 340g", hsn: "20081100", boxQty: 10, rate: 17.77, packsPerBox: 6 }],
};

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, co = company) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), company: co, users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");

// The five lines, in the order the desk gives them to a buyer.
const FIVE = [
  ["Account Name", "EXAMPLE FOODS PRIVATE LIMITED"],
  ["Bank", "Sample Bank"],
  ["Branch", "Sample Bank Main Branch, Testville, Gujarat, India"],
  ["Account Number", "00123456789012"],
  ["Swift Code", "SAMPINBBXXX"],
];

describe("the company profile holds everything a transfer needs", () => {
  it("reads the two new fields, and reads blank — not undefined — from a row that predates them", () => {
    expect(company).toMatchObject({ accountName: "EXAMPLE FOODS PRIVATE LIMITED", bankBranch: "Sample Bank Main Branch, Testville, Gujarat, India" });
    const { account_name, bank_branch, ...older } = row;
    expect(companyFromRow(older)).toMatchObject({ accountName: "", bankBranch: "" });
    expect(emptyStore().company).toMatchObject({ accountName: "", bankBranch: "" });
  });

  it("the Company page has a box for each of the five, filled from the profile", () => {
    const html = draw(<CompanyPage />);
    expect(html).toContain("Bank details for transfer");
    for (const label of ["Account name", "Bank", "Branch", "Account number", "Swift code"]) {
      expect(html, label).toMatch(new RegExp(`<span[^>]*>${label}</span>`));
    }
    for (const [, value] of FIVE) expect(html, value).toContain(`value="${value}"`);
  });

  it("an empty profile still draws every box, ready to be filled in", () => {
    const html = draw(<CompanyPage />, emptyStore().company);
    for (const label of ["Account name", "Branch", "Account number", "Swift code"]) expect(html).toContain(label);
  });

  it("what the page saves includes both new fields — and what it sends, the function reads", () => {
    for (const k of ["accountName", "bankBranch", "bankName", "accountNo", "swift"]) expect(COMPANY_KEYS, k).toContain(k);
    expect(pick(company, COMPANY_KEYS)).toMatchObject({ accountName: "EXAMPLE FOODS PRIVATE LIMITED", bankBranch: "Sample Bank Main Branch, Testville, Gujarat, India" });
    const fn = /create or replace function public\.save_company\([\s\S]*?\n\$\$;/.exec(sql015)[0];
    expect(fn).toContain("p ->> 'accountName'");
    expect(fn).toContain("p ->> 'bankBranch'");
  });

  it("a save from an older copy of the console, which sends neither, leaves them as they are", () => {
    const fn = /create or replace function public\.save_company\([\s\S]*?\n\$\$;/.exec(sql015)[0];
    expect(fn).toMatch(/account_name = case when p \? 'accountName' then .* else account_name end/);
    expect(fn).toMatch(/bank_branch\s+= case when p \? 'bankBranch'\s+then .* else bank_branch end/);
    expect(fn).toContain("has_access('company')");
    expect(fn).not.toMatch(/ifsc/i);
  });
});

describe("the proforma tells the buyer where to send the money", () => {
  it("the printed page carries the heading and the five lines, in order", () => {
    const html = draw(<ProformaDocument pi={pi} company={company} />);
    expect(html).toContain("BANK DETAILS FOR TRANSFER");
    let from = html.indexOf("BANK DETAILS FOR TRANSFER");
    for (const [label, value] of FIVE) {
      const at = html.indexOf(`<b>${label}:</b> ${value}`, from);
      expect(at, `${label} should follow the previous line`).toBeGreaterThan(from);
      from = at;
    }
  });

  it("the Excel sheet carries the same heading and the same five lines, in the same order", () => {
    const rows = proformaSheetRows(pi, company);
    const at = rows.findIndex((r) => r[0] === "BANK DETAILS FOR TRANSFER");
    expect(at).toBeGreaterThan(0);
    expect(rows.slice(at + 1, at + 6)).toEqual(FIVE);
    expect(rows).toHaveLength(at + 6);
  });

  it("the account number survives Excel as text, leading zeros and all", () => {
    const rows = defangRows(proformaSheetRows(pi, company));
    const account = rows.find((r) => r[0] === "Account Number")[1];
    expect(account).toBe("00123456789012");
    expect(typeof account).toBe("string");
  });

  it("a detail that has not been filled in shows as missing, rather than being guessed", () => {
    const partial = { ...company, accountName: "", bankBranch: "" };
    const html = draw(<ProformaDocument pi={pi} company={partial} />);
    expect(html).toContain("<b>Account Name:</b> —");
    expect(html).toContain("<b>Branch:</b> —");
    // The beneficiary name is never filled in from the company name: for a
    // transfer the two must match the bank's record, and only the owner knows it.
    expect(html).not.toContain("<b>Account Name:</b> Example Foods");
    expect(proformaSheetRows(pi, partial).find((r) => r[0] === "Account Name")).toEqual(["Account Name", ""]);
  });

  it("IFSC stays off the proforma even though the row still carries one", () => {
    expect(draw(<ProformaDocument pi={pi} company={company} />)).not.toMatch(/IFSC|SAMP0000001/i);
    expect(JSON.stringify(proformaSheetRows(pi, company))).not.toMatch(/IFSC|SAMP0000001/i);
  });
});

describe("no real bank detail lives in the repository", () => {
  it("source, migrations and decisions carry no account number", () => {
    // Class: a real account number pasted into code, a migration or a note in a
    // public repository. Bank details are data, typed on the Company page.
    const files = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
    for (const f of [...files("src"), ...files("db"), ...files("decisions")]) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/\b\d{11,18}\b/);
    }
  });
});
