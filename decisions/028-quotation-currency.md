# 028 — A quotation says which currency its prices are in

**Decided:** 2026-10-10, on the owner's instruction, with a marked-up sample
quotation: add a currency option to the quotation, and have the quotation file
state it directly — the price heading "Price (USD) (Case/Box) FOB …", "US$" in
front of each rate, amount and total, and the amount in words beginning
"U.S. DOLLARS …". A second message asked for the same in rupees, with the
rupee symbol.

## On the form

A **Currency** box: USD — US Dollar (US$), or INR — Indian Rupee (₹). Until it
is chosen by hand it follows the party picked (its currency), otherwise the
country: rupees for India, dollars for anywhere else. The form's own totals and
amount in words show in the chosen currency as they are typed.

## On the quotation file — PDF and Word alike

| | In dollars | In rupees |
|---|---|---|
| Price heading | Price (USD) / (Case/Box) / FOB | Price (INR) / (Case/Box) / Ex-Factory |
| Each rate and amount | US$ 12.30 · US$ 49,999.50 | ₹ 1,234.56 · ₹ 1,23,456.00 |
| Total, IGST, Grand total | US$ 49,999.50 | ₹ 1,29,628.80 |
| Amount in words | U.S. DOLLARS Forty-Nine Thousand Nine Hundred Ninety-Nine And Fifty Cents Only. | INDIAN RUPEES One Lakh Twenty-Nine Thousand Six Hundred Twenty-Eight And Eighty Paise Only. |

The third line of the price heading is the quotation's shipment term (FOB,
CIF, CNF, Ex-Factory). The sample read "FOB Mundra"; a quotation has no port
box, so the port is not printed.

Two small differences from the sample, both deliberate: figures keep their
thousands separators ("US$ 49,999.50", where the sample had "US$ 49999.50"),
as every other document from the console does; and the words are spelled
"Ninety-Nine", where the sample had a slip ("Nighty Nine"). Rupees are grouped
and read the Indian way — lakhs and crores.

Both were opened in Microsoft Word from invented figures: the rupee sign
prints, and the three-line heading fits.

## Nothing is converted

The currency names what the typed figures are in. Changing it from USD to INR
changes the signs and the words, never a number: there is no exchange rate
anywhere in the console.

## Stored

`quotations.currency` (db/023): USD, INR, or empty for a quotation made before
this. `save_quotation` refuses anything else, and an edit that does not carry
the currency — from an older copy of the console — leaves it alone. A quotation
with no currency prints as it always did, bare figures; opening it in Edit and
saving gives it one.

## Also

The quotations list shows each value with its sign, and the Excel list has a
Currency column. Only USD and INR are offered, as on a party and a proforma;
another currency (EUR, AED, GBP …) would need its name and its coin added.

## Not changed

Proformas and shipments print their currency as before.
