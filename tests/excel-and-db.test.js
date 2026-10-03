import { describe, it, expect } from "vitest";
import { defang, buildSheetData } from "../src/lib/excel.js";
import { humanise, accessOf, quotationFromRow } from "../src/lib/db.js";

describe("Excel export", () => {
  it("defangs text that Excel would run as a formula", () => {
    expect(defang("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(defang("+91 98765")).toBe("'+91 98765");
    expect(defang("@cmd")).toBe("'@cmd");
    expect(defang("-5")).toBe("'-5");
  });
  it("leaves real numbers alone — a negative amount is not a formula", () => {
    expect(defang(-5)).toBe(-5);
    expect(defang(2220.5)).toBe(2220.5);
  });
  it("leaves ordinary text alone", () => {
    expect(defang("Al Rawabi General Trading LLC")).toBe("Al Rawabi General Trading LLC");
  });
  it("builds a header row plus one row per record, blanks for missing values", () => {
    const cols = [{ label: "Buyer", value: (r) => r.buyer }, { label: "Boxes", value: (r) => r.boxes }];
    expect(buildSheetData(cols, [{ buyer: "=evil", boxes: 12 }, { buyer: "Ok", boxes: null }]))
      .toEqual([["Buyer", "Boxes"], ["'=evil", 12], ["Ok", ""]]);
  });
});

describe("errors are human and diagnosable", () => {
  it("passes our own refusals through as written", () => {
    expect(humanise({ code: "PT409", message: "Someone else changed DS-QUO-2026-0001." }))
      .toBe("Someone else changed DS-QUO-2026-0001.");
  });
  it("never shows a raw permission error", () => {
    expect(humanise({ code: "42501", message: "permission denied for function save_quotation" }))
      .toBe("You do not have permission to do that.");
  });
  it("names the SQLSTATE in the default branch, in the message itself", () => {
    expect(humanise({ code: "22P02", message: "invalid input syntax" })).toContain("22P02");
    expect(humanise({})).toContain("unknown");
  });
});

describe("client access mirrors public.has_access() and fails closed", () => {
  const profile = (over) => ({ role: "staff", active: true, access: { documents: true, parties: false, company: false }, ...over });
  const NOTHING = { isAdmin: false, documents: false, parties: false, company: false };
  it("grants only what is ticked", () => {
    expect(accessOf(profile())).toEqual({ isAdmin: false, documents: true, parties: false, company: false });
  });
  it("gives an admin everything", () => {
    expect(accessOf(profile({ role: "admin" }))).toEqual({ isAdmin: true, documents: true, parties: true, company: true });
  });
  it("gives a deactivated admin nothing", () => {
    expect(accessOf(profile({ role: "admin", active: false }))).toEqual(NOTHING);
  });
  it("gives a missing profile nothing", () => {
    expect(accessOf(null)).toEqual(NOTHING);
  });
});

describe("row mapping", () => {
  it("carries the version stamp the edit-conflict check needs", () => {
    const q = quotationFromRow({
      id: "1", doc_no: "DS-QUO-2026-0001", grand_total: "2220.00", updated_at: "2026-10-03T05:10:10.042639+00:00",
    });
    expect(q.updatedAt).toBe("2026-10-03T05:10:10.042639+00:00");
    expect(q.grandTotal).toBe(2220);
  });
});
