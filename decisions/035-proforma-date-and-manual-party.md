# 035 — A proforma's date is typed; a proforma can be typed by hand, without a party

**Decided:** 2026-10-10, on the owner's instruction: "In proforma, add option
of date beside proforma no. In party add option of manually selection of
party."

## 1. Date, beside Proforma no.

A **Date** box, second on the form. It starts as today on a new proforma, and
as the proforma's own date when editing. Whatever it holds is the PI Date on
the proforma (PDF, Word, Excel).

Until now the date was always the day the proforma was made, and an edit never
moved it (decisions/011 said so on the form). An edit can now change it, on
purpose; the audit log keeps the proforma as it was. A copy of the console
that does not send a date — an older tab — still changes nothing.

## 2. "Manual entry" in the Party list

**How this was read.** The quotation form's Party list has "Manual entry" for
a buyer who is not in Parties; the owner has been asking for the quotation's
options on the proforma. So: the Party list on the proforma form gets **Manual
entry — type the details**, after the parties. (The other reading — that no
party should be pre-chosen, so one must be picked by hand — was not built. A
new proforma still starts on the first party, as before.)

**What Manual entry gives.** In place of the party's summary, boxes to type:

- Buyer name and address; Consignee (or Ship to) name and address;
- Shipment term, Payment term, Currency (USD or INR);
- Conditions — one box each, Add another condition;
- product lines, every cell typed: Product, HSN, Units / box, Net kg / box,
  Gross kg / box, Rate / box (or MRP / box), Box qty. The units and the
  weights are asked for because a party product would have brought them: the
  unit count on the proforma and the packing list of its shipment are made
  from them.

**What it does not do.** Nothing is added to Parties: the details live on that
proforma only. Typing the same buyer twice is typing it twice; a buyer who
will order again belongs in Parties.

**Everything after is the same.** A hand-typed proforma is saved through the
same function, numbered and dated the same way, downloads as PDF, Word and
Excel, can be saved as a draft and continued, edited (it opens on Manual entry
with everything it says), deleted, and invoiced into a shipment. The database
needed nothing new for it: a proforma was always allowed to have no party, and
every detail printed on one is stored on the proforma itself.

**Two small consequences.**

- With no party of that kind on file, the form used to stop at "create one
  under Parties first". It now opens on Manual entry.
- A proforma whose party was later removed from Parties is still not editable
  here (decisions/011): only a proforma that never had a party opens on Manual
  entry.
