# 027 — A quotation downloads as a Word file, the same as the PDF but editable

**Decided:** 2026-10-10, on the owner's instruction: add a download of the
quotation as a Word file — the same format as the PDF, in Word, so it can be
edited.

## On screen

Each quotation's row reads **PDF · Word · Edit · Delete**. Word saves
`Quotation-<number>.docx` straight to the computer.

## Same as the PDF

The printed page and the Word file are both drawn from one description of the
quotation (`quotationModel` in `lib/documents.js`): the same wording, the same
figures, in the same order — letterhead, QUOTATION with its number and date,
Quotation to / Terms, the price table with its totals (and the IGST line for
an Indian buyer), the amount in words, the validity note, the signatory. A
change to one is a change to both; a test opens the Word file and checks it
piece by piece against the PDF.

The layout follows the PDF: A4, the same margins, Georgia, the same column
order and shading. It is a real Word document (.docx), not a picture of one:
every line is ordinary text and the price table is an ordinary Word table.

**Checked in Word itself.** A sample made from invented figures was opened in
Microsoft Word on the desk's computer (hidden, read-only, with "repair" turned
off so a damaged file would fail): it opened, one page, three tables, no
protection, and Word's own print of it matched the PDF. The first try showed
"RATE / BOX" wrapping onto two lines, because Word holds a column to its width
where the browser lets a heading push it out; the fixed columns are 10% wider
in Word for that reason.

## What editing the Word file does — and does not

The Word file is a copy. Editing it changes that file only: the quotation in
the console, its PDF, and its totals stay as they were. Figures typed over in
Word are not re-added — Word will not correct a total. To change the quotation
itself, use Edit.

## How it is made

In the browser, by the `docx` library (MIT), pinned to 9.7.1 — a release some
months old, not the one published three days before this was written. It is
loaded only when Word is pressed (its own 400 KB file), so no other page is
slower for it. Nothing is sent anywhere: the file is built on the desk's own
computer from the quotation already on screen. No database change.

## Not changed

Proformas and shipments still download as PDF or Excel only.
