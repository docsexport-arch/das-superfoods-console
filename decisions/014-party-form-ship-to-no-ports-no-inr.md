# 014 — Party form: "Ship to", no ports, no INR for an international party

**Decided:** 2026-10-06, on the owner's instruction for party creation: call the
consignee "Ship to" / "Shipping address", remove port of loading and
destination port, and remove INR from the currency.

## Ship to

The party form's *Consignee name* and *Consignee address* are now **Ship to**
and **Shipping address**. It is a label change only: the same two fields, the
same data, and it still becomes the default consignee on a proforma.

The proforma and its documents still say "Consignee" — the instruction was for
party creation, and "consignee" is the word on an export document. In the
buyer/consignee pickers a party's ship-to name is still tagged "(consignee)".

## Ports

Port of loading and destination port are gone from the party form. A port
belongs to a shipment, not to a customer.

They did not simply disappear: the proforma and the shipment print them, so
they needed somewhere to be typed. **The two boxes are now on the proforma form**
(international only). This part was not asked for in so many words; it is the
consequence of the removal, and is called out to the owner as such.

- A party saved before this change may still hold a pair of ports. They are not
  shown on the party form any more, and are kept untouched when the party is
  saved. Their one remaining use is as the *starting value* of the port boxes on
  a new proforma for that party — visible, and changeable.
- Nothing reads a port off the party unseen: what a proforma saves is what is in
  its boxes.
- Editing a proforma shows the ports it was raised with; blank stays blank.
- A proforma with no ports says nothing about ports on its PDF and Excel,
  instead of printing dashes.
- The party list's Excel export no longer has port columns.

## Currency

An international party is offered **USD only**. INR remains for a
private-label / India party, where it is the normal case.

A party already saved in INR keeps it: the option is shown for that party so
that opening and saving it never changes its currency unasked.

This is one reading of "remove: Currency: INR". The other — removing the
currency box altogether — was not taken, because the proforma, the amount in
words and the shipment's exchange-rate rule all depend on the party's currency.

## What it rules out

- No database change. The party columns for ports stay (the client on
  production today still reads them); they are dropped with the other retired
  columns when that client goes (OPEN_ITEMS).
