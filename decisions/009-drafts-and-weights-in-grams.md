# 009 — Saved drafts; party weights typed in grams

**Decided:** 2026-10-05, on the owner's instruction: a "save draft" option on
proformas and shipments, and — in the party's product lines — weights in grams
per box, packs per box, and no g / pack column.

## Drafts

A draft is the **form**, kept as it was left (`public.drafts`, db/012). It is
not a document:

- it has no number — the number is allocated only when the document is raised,
  so drafts leave no gaps in the sequence;
- it moves no figure and marks no proforma as invoiced.

**Shared, not private.** Drafts live in the database, not in the browser. A
draft saved on one computer can be continued on another, by anyone who holds
that section: the proforma grant sees proforma drafts, the shipments grant sees
shipment drafts. The list shows who saved it and when.

**One shipment draft per proforma.** A second person who starts a shipment
against the same proforma is told a draft exists rather than quietly keeping a
rival copy.

**Raising from a draft is one transaction** (`raise_from_draft`): it calls the
same function that raises the document without a draft, then retires the
draft. Two people pressing the button on the same draft get one document.

**What it rules out**

- No auto-save. A draft is saved when someone presses Save draft; nothing runs
  in the background (Bible: no standing automation).
- A draft does not reserve stock, a number or the proforma. A proforma with a
  shipment draft is still open.
- The draft's contents are not validated when saved — a half-filled form is the
  point. Everything is validated when the document is raised.
- If the party a proforma draft was for is later retired, the draft opens with
  its product lines cleared and says so.

## Weights in grams

The party form takes net and gross weight **in grams per box**. They are still
**stored in kilograms per box** — the packing list, the shipment totals and the
SQL that computes them are all in kg and tonnes, and none of that changed. The
form converts on the way in and out (`gramsFromKg` / `kgFromGrams`).

The g / pack column is removed from the form. The stored value is kept and sent
back unchanged on save, so nothing already recorded is lost.
