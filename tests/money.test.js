import { describe, it, expect } from "vitest";
import { shipmentTotals, quotationTotals, proformaTotals } from "../src/lib/money.js";

// These expectations are the figures public.create_shipment() and
// public.save_quotation() produced when exercised against the live database
// on 2026-10-03. If this mirror and the SQL ever disagree, the preview lies.
describe("shipment money rule (decisions/002)", () => {
  const line = { boxQty: "1200", rate: "1.85", mrp: "0", packsPerBox: "12", netWt: "0.35", grossWt: "0.41" };
  const base = { items: [line], type: "international", currency: "USD", gstPercent: "5", roundOff: 0, freight: 0, otherAdj: 0 };

  it("converts a USD proforma to INR at the entered rate, then applies GST", () => {
    const t = shipmentTotals({ ...base, exchangeRate: "83" });
    expect(t.docTotal).toBe(2220);
    expect(t.inrTotal).toBe(184260);
    expect(t.gst).toBe(9213);
    expect(t.grandTotal).toBe(193473);
    expect(t.commercialTotal).toBe(2220);
    expect(t.commercialCurrency).toBe("USD");
  });
  it("packs the list in boxes, units and kilograms", () => {
    const t = shipmentTotals({ ...base, exchangeRate: "83" });
    expect(t.boxes).toBe(1200);
    expect(t.packs).toBe(14400);
    expect(t.net).toBeCloseTo(420, 6);
    expect(t.gross).toBeCloseTo(492, 6);
  });
  it("says so when a USD shipment has no exchange rate, instead of showing a figure", () => {
    expect(shipmentTotals({ ...base, exchangeRate: "" }).needsExchangeRate).toBe(true);
  });
  it("ignores the exchange rate for an INR proforma", () => {
    const t = shipmentTotals({
      ...base, type: "domestic", currency: "INR", exchangeRate: "83",
      items: [{ boxQty: "10", mrp: "210", rate: "0" }],
    });
    expect(t.inrTotal).toBe(2100);
    expect(t.needsExchangeRate).toBe(false);
  });
  it("adds freight and other charges in the document currency before converting", () => {
    const t = shipmentTotals({ ...base, exchangeRate: "83", freight: "100", otherAdj: "-20" });
    expect(t.docTotal).toBe(2300);
    expect(t.inrTotal).toBe(190900);
  });
  it("prices the commercial invoice in the currency chosen for it", () => {
    expect(shipmentTotals({ ...base, exchangeRate: "83", commercialCurrency: "INR" }).commercialTotal).toBe(184260);
  });
});

describe("quotation IGST", () => {
  const items = [{ boxQty: "10", boxRate: "100" }];
  it("applies to an Indian buyer", () => {
    expect(quotationTotals({ items, country: "India", igst: true, igstRate: "18" })).toMatchObject({ total: 1000, tax: 180, grand: 1180 });
  });
  it("never applies to an export buyer, even if switched on", () => {
    expect(quotationTotals({ items, country: "UAE", igst: true, igstRate: "18" })).toMatchObject({ total: 1000, tax: 0, grand: 1000 });
  });
});

describe("proforma totals", () => {
  it("counts boxes and units, and values an export proforma on the box rate", () => {
    const t = proformaTotals({ type: "international", items: [{ boxQty: "1200", rate: "1.85", mrp: "0", packsPerBox: "12" }] });
    expect(t).toMatchObject({ boxes: 1200, units: 14400, total: 2220, tax: 0, grand: 2220 });
  });
  it("taxes a private-label proforma on MRP", () => {
    const t = proformaTotals({ type: "domestic", taxRate: "5", items: [{ boxQty: "10", rate: "0", mrp: "210", packsPerBox: "10" }] });
    expect(t).toMatchObject({ taxable: 2100, tax: 105, grand: 2205, units: 100 });
  });
});
