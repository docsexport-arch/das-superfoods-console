# 033 — A proforma downloads as Word too; the lit button is the form that is open

**Decided:** 2026-10-10, on two instructions from the owner.

## 1. Word download for the proforma

"As added in quotation — edit, download in Word, PDF, Excel, delete — add in
proforma invoice." A proforma already had Edit (decisions/011), Delete
(decisions/026) and Download → PDF · Excel (decisions/010). The piece missing
was Word, so **Download now offers PDF · Word · Excel**.

The Word file is made the way the quotation's is (decisions/027): the printed
page and the .docx are both drawn from one description, `proformaModel`, so
they carry the same wording and figures — letterhead, PROFORMA INVOICE with PI
No / PI Date / Buyer Order No and Date, Buyer and Consignee (or Ship to on a
private-label proforma), Ports and Terms, the price table with its totals (and
the tax line for private label), the amount in words, the conditions, the bank
details for transfer, the signatory. Moving the printed page onto the model
left its HTML identical, compared before and after over seven proformas.

Opened in Microsoft Word from invented figures, international and private
label: one page each, no repair, matching the PDF. Word holds a column to its
width, so a column is never narrower than its own heading — "TAXABLE VALUE"
stays on one line.

The Word file is a copy: editing it does not change the proforma in the
console, and Word will not re-add a total. It is named like the other two
files, `Proforma-<number>`.

**Not done, because not asked:** the two-screen arrangement Quotations and
Parties have (decisions/032, 018). The proforma page keeps its one screen with
Open / All, its drafts and its two creation buttons.

## 2. The lit button

The owner's screenshots showed the International button lit in orange while a
private-label proforma was being typed: "whether we click Private label or
International, the orange mark shows on International only."

The cause: International was always drawn as the page's main button and
Private label always as the quiet one, whatever was open. Now the lit button
is the kind of proforma whose form is open — new, a draft, or one being
edited — and the other goes quiet. With no form open both are lit: they are
two equal ways to start a proforma, and neither is "chosen".
