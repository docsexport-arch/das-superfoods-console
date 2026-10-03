# 002 — The tax invoice is in INR, converted at the shipment's exchange rate

**Decided:** 2026-10-03 by Claude while moving the arithmetic into
`public.create_shipment`. **Needs the owner's sign-off** — it changes figures.

- Line amounts, freight and other charges are in the proforma's currency.
- The tax invoice is always INR. A USD proforma is converted at the exchange
  rate entered for that shipment; GST and round-off apply to the INR figure.
- The commercial invoice is in the currency chosen for the shipment, converted
  the same way if that differs from the proforma's.
- A USD shipment with no exchange rate is refused, not guessed.

**Why:** before this, the "Tax invoice (INR)" panel showed the USD number
unchanged — $2,220 appeared as ₹2,220. The original spec lists a manual
exchange rate on the tax invoice and describes it as "INR + GST, for shipping
bill filing", which only makes sense if the rate is applied.

**Check it against:** USD 2,220 at ₹83 with 5% GST → ₹184,260 + ₹9,213 =
₹193,473 (pinned in `tests/money.test.js`, produced by the database itself).

**If this is wrong:** one function (`create_shipment`) and one mirror
(`src/lib/money.js`) change together; the test pins both.
