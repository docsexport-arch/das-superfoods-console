# 030 — Quotation number and date are typed; files are named Buyer_Number; the standing line is gone

**Decided:** 2026-10-10, on three instructions from the owner in one sitting.

## 1. "Quotation no." and "Date" boxes

The first two boxes on the quotation form.

**Quotation no.** Type the number, or leave the box empty on a new quotation
and it is given the next number in the series as before (DS-QUO-2026-0003).
The owner asked for an *option* to give a number, so the automatic number is
kept for when none is typed — unlike a proforma, whose number must be typed
(decisions/010).

- A typed number: letters, digits, spaces and . / _ - ; at most 40 characters;
  not already used by another quotation, whatever the capitals. The page says
  so at once and the database decides.
- The automatic series steps over a number that was typed by hand, so the two
  never collide.
- On Edit the number can be changed. If the box is emptied, the quotation
  keeps the number it has.
- A deleted quotation no longer holds its number (as with proformas,
  decisions/026).

**Date.** Starts as today; any date can be typed. On Edit it shows the
quotation's date and can be changed. Before this, the date was always the day
the quotation was made.

The quotation file prints them as **Quotation No.: …** and **Date: dd/mm/yyyy**.

## 2. File names: Buyer Name_Quotation number

The PDF and the Word file are both named after the buyer and the number:

    Sample Importers Inc_DS-QUO-2026-0007.pdf
    Sample Importers Inc_DS-QUO-2026-0007.docx

The name reads as typed. Only what a file name cannot hold is changed:
\ / : | become a dash (so Q/26-27/001 is Q-26-27-001), and * ? " < > are
dropped. A part never ends in a dot or a space, which Windows drops or
refuses — "Inc." becomes "Inc".

The PDF's name is the name the browser offers in its Save dialog; it can still
be changed there.

## 3. The standing line is removed

"This quotation is valid for 30 days from the date above. Prices are quoted on
… terms and are subject to confirmation of availability at the time of order.
IGST is not applicable on export supplies." no longer prints on any quotation,
export or Indian, PDF or Word. Validity, availability or tax wording that a
quotation needs is typed under Terms (decisions/029), which now holds
everything printed below the amount in words.

## Stored

`save_quotation` (db/025) reads `docNo` and `docDate`. An edit that sends
neither — an older copy of the console — changes neither. The table's original
unique rule on the number is replaced by `quotations_doc_no_live_ci`, which
ignores capitals and deleted quotations.

## Not changed

Proforma and shipment file names (Proforma-<number>, Shipment-<number>).
