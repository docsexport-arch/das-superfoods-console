# 034 — An invoiced proforma can be deleted, together with its shipment; only the chosen button is lit

**Decided:** 2026-10-10, on the owner's instruction, with a screenshot of an
Invoiced proforma whose row offered only Download: add Delete there, and
Download with PDF, Excel and Word. And: both creation buttons showing orange
is a bug — only the one chosen should be orange.

## 1. Delete on an invoiced proforma

decisions/026 refused this, because the shipment raised against the proforma
points at it. The owner now wants it, so the rule is replaced — but the
difficulty behind the old rule is real and decides the shape of the new one:

**A shipment cannot be read without its proforma.** Its tax invoice,
commercial invoice and packing list are drawn from the shipment *and* the
proforma (the pricing basis and the currency live there), and editing it
recalculates from the proforma. A shipment left behind after its proforma was
deleted would sit in the list unable to be opened, downloaded or edited.

So **the two are deleted together, or not at all.**

- The row of an invoiced proforma has **Delete** (and still no Edit).
- Delete does not ask "Delete X? Confirm". It says what else goes: "X has been
  invoiced. Deleting it also deletes shipment DS-INV-… and its tax invoice,
  commercial invoice and packing list." — then **Delete both** or **Cancel**.
- It needs the Shipments section as well as Proforma.
- The database will not do it unless it is told the shipment goes too, so a
  browser tab still running an older copy of the console cannot do it by
  accident.
- An open proforma is deleted exactly as before.

**What "deleted" means** is unchanged (decisions/026): both records are
retired, not erased. They leave every list and total, but the rows stay in the
database with who deleted them and when, and the audit log keeps each one
whole. There is no undelete button.

**Two consequences the owner should know:**

- The shipment's invoice numbers are not handed out again. The series only
  moves forward, so a deleted shipment leaves a gap in the tax-invoice
  numbering. For a real invoice that was issued to a buyer, the usual course is
  a credit note rather than a deletion; this is for records raised by mistake
  or in testing.
- The proforma's own number does come free (decisions/026).

**Not built, because not asked:** a Delete on the Shipments page that removes
only the shipment and returns its proforma to Open.

## 2. Download on that row

Already there since decisions/033: Download → **PDF · Word · Excel**, on every
proforma, open or invoiced. Nothing changed here.

## 3. Only the chosen button is lit

decisions/033 lit both International and Private label when no form was open,
as "two equal ways to start". The owner read two orange buttons as a bug. Now
neither is lit until one is clicked; then that one is orange and the other is
not.
