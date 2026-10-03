import { describe, it, expect } from "vitest";
import { todayIST, fmtDate, fmtWhen, toNumber, fmtMoney, amountInWords, unitsFromBoxes } from "../src/lib/format.js";

describe("dates are IST, shown dd/mm/yyyy", () => {
  it("is already tomorrow in India at 20:00 UTC", () => {
    // The bug this pins: toISOString() would say 2026-10-02.
    expect(todayIST(new Date("2026-10-02T20:00:00Z"))).toBe("2026-10-03");
  });
  it("is still the same day just before midnight IST", () => {
    expect(todayIST(new Date("2026-10-03T18:29:00Z"))).toBe("2026-10-03");
  });
  it("crosses the year at midnight IST, not midnight UTC", () => {
    expect(todayIST(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
  });
  it("formats a date without letting a timezone move the day", () => {
    expect(fmtDate("2026-10-03")).toBe("03/10/2026");
    expect(fmtDate(null)).toBe("—");
  });
  it("shows a timestamp in IST", () => {
    expect(fmtWhen("2026-10-03T05:10:10Z")).toBe("03/10/2026 10:40");
  });
});

describe("the one strict number parser", () => {
  it("reads typed and Excel-style values", () => {
    expect(toNumber("1,200")).toBe(1200);
    expect(toNumber(" 1.85 ")).toBe(1.85);
    expect(toNumber("(250)")).toBe(-250);
    expect(toNumber("")).toBe(0);
    expect(toNumber(null)).toBe(0);
  });
  it("never produces NaN", () => {
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(Number.NaN)).toBe(0);
  });
  it("units = boxes × units per box", () => {
    expect(unitsFromBoxes("1200", 12)).toBe(14400);
  });
  it("groups rupees the Indian way and dollars the international way", () => {
    expect(fmtMoney(193473, "INR")).toBe("₹1,93,473.00");
    expect(fmtMoney(193473, "USD")).toBe("$193,473.00");
  });
});

describe("amount in words", () => {
  it("reads rupees in lakh and crore", () => {
    expect(amountInWords(193473, "INR")).toBe("Rupees one lakh ninety three thousand four hundred seventy three only");
    expect(amountInWords(12500000, "INR")).toBe("Rupees one crore twenty five lakh only");
  });
  it("keeps the paise and cents instead of rounding them away", () => {
    expect(amountInWords(2220.5, "USD")).toBe("US Dollars two thousand two hundred twenty and fifty cents only");
    expect(amountInWords(100.05, "INR")).toBe("Rupees one hundred and five paise only");
  });
  it("handles zero", () => {
    expect(amountInWords(0, "INR")).toBe("Rupees zero only");
  });
});
