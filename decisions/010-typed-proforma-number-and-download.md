# 010 — The proforma number is typed; a proforma downloads as PDF or Excel

**Decided:** 2026-10-05, on the owner's instruction.

## The number

The proforma number is typed by whoever raises the proforma, instead of being
taken from a counter (db/013). It can follow whatever numbering the desk
already uses.

Because nothing allocates it, `create_proforma` is what keeps it sound:

- it must be there;
- letters, digits, spaces and `. / _ -` only, starting with a letter or digit,
  up to 40 characters — it also becomes a file name on download;
- it must not repeat, compared without regard to capitals or stray spaces, and
  counting retired proformas, so a number is never reused. A unique index backs
  the check for two people typing the same number at the same moment.

A draft keeps the number that was typed, but does not reserve it: the check
happens when the proforma is created.

**What it rules out**

- No automatic "next number" suggestion. The system no longer knows the desk's
  sequence, and a suggestion that is sometimes wrong is worse than none.
- Gaps and out-of-order numbers are possible now — that is the price of typing
  them. The audit log still records who raised each proforma and when.
- **Shipment / invoice numbers are unchanged**: still allocated by the system.
  A tax invoice number has rules of its own (unbroken series); making that one
  manual would be a separate decision.
- The number cannot be edited after the proforma is created (proformas are not
  editable yet — OPEN_ITEMS).

## The download

Each proforma in the list has **Download → PDF / Excel**.

- *PDF* is the printed page: the browser's "Save as PDF" makes the file, the
  same way the quotation does. The file is named after the proforma number.
- *Excel* is the same document as rows (`lib/documents.js`): letterhead,
  parties, terms, lines with boxes **and** units, totals, amount in words, bank.

Both read the totals the database stored; neither re-does the arithmetic.

**Known limit.** The letterhead and bank details come from the company profile,
which only accounts holding the *Company* section can read. Someone with
Proforma but not Company gets a download with the company name defaulted and
the bank lines blank. Tick Company for anyone who sends proformas out, or ask
for a read-only letterhead for document sections (an owner decision — it shows
bank details to more accounts).
