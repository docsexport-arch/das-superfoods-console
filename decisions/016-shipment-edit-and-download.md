# 016 — A shipment can be edited, and downloads as PDF or Excel

**Decided:** 2026-10-07, on the owner's instruction: in Shipments, an Edit
option and a Download option with PDF and Excel under it.

## Download

Each shipment in the list has **Download → PDF / Excel**. A shipment is three
documents, so each download holds all three:

- *PDF* — three pages: tax invoice, commercial invoice, packing list. The
  browser's "Save as PDF" makes the file, named after the shipment.
- *Excel* — one workbook with three sheets, the same three documents.

Both are drawn from one reading of the shipment (`lib/shipment-docs.js`), so
they cannot disagree with each other.

**How the money is shown.** Lines are in the currency the proforma was priced
in. The tax invoice then shows the exchange rate and the rupee figures — the
taxable value, GST, round-off and grand total — exactly as the database stored
them. Nothing is converted to rupees line by line, because that is not how the
totals were worked out and the lines would not add up to them. (The rule itself
— the tax invoice value is the document total at the exchange rate — is
decisions/002, still awaiting the owner's sign-off.)

**What each document carries**

| | Tax invoice | Commercial invoice | Packing list |
|---|---|---|---|
| Number | …-TAX | …-COM | the shipment number |
| Parties | consignee only ("TO THE ORDER") | buyer and consignee | consignee |
| Lines | priced | priced | batch, MFG, EXP, weights — no prices |
| Totals | to the rupee grand total | in its own currency | boxes, units, kg, tonnes |
| Bank details | — | BANK DETAILS FOR TRANSFER | — |

The tax invoice names only its consignee on purpose: the form already keeps the
buyer off it so the buyer stays off the shipping bill.

Every number and date is labelled (Invoice No, Invoice Date, PI No, PI Date,
Buyer Order No, Buyer Order Date), as on the proforma. No IFSC.

**The company block** printed is the one stored on the shipment when it was
invoiced. New shipments store the account name and branch too (db/016). A
shipment invoiced before that has no such fields; for those two only, the
current profile fills the gap. A stored value, even a blank one, is not
overwritten.

## Edit

Any shipment can be edited from the list: marks and numbers, stuffed
quantities, batches and dates, charges, GST, round-off, exchange rate,
consignees and currency. One function, `save_shipment`, invoices and edits, so
every total is worked out again by the same code.

**An edit does not change** the invoice numbers, the invoice date, the proforma
it is against, the buyer copied from that proforma, who raised it, or the
company block as it stood. It takes no new number. It must come from the
version that was opened — if a colleague changed it meanwhile, the save is
refused. It is recorded in the audit log with the shipment as it was and as it
is.

**What the owner should know.** Unlike a proforma, a shipment is an issued tax
invoice. The system now lets its figures be changed after issue, because that
was asked for and corrections do happen before filing — but once an invoice has
been reported for GST or handed to customs, changing it here does not change
what was filed. The audit log shows every edit; nothing stops one. If edits
should be closed after a point (a "filed" tick, or a time limit), that is a
rule to add.

## What it rules out

- No separate download per document. One PDF, one workbook, three documents each.
- The proforma a shipment is against cannot be edited (decisions/011), so an
  edit recalculates against a proforma that has not moved.
- Without that proforma (it carries the pricing basis and the currency) the
  shipment can be neither downloaded nor edited here; it says so rather than
  guessing.
