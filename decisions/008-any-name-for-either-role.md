# 008 — Any name on a party can be the buyer or the consignee

**Decided:** 2026-10-05, on the owner's instruction: sometimes the consignee is
the buyer, so every buyer name and every consignee name on a party must be
available when choosing the buyer and when choosing the consignee. Extends 007.

A party's names are treated as **one list** — the buyer, the other names added
on the party, and the consignee (`partyNames()` in `lib/db.js`). That one list
is offered twice:

- *Quotation* — "Buyer on this quotation".
- *Proforma* — "Buyer on this proforma" and "Consignee on this proforma".

Nothing changes until someone picks: the buyer defaults to the party's main
buyer and the consignee to the party's own consignee. A name and address that
is both buyer and consignee appears once, marked with both roles. A party with
only one name shows no picker.

**Carried through to the shipment.** The proforma stores the name and address
chosen for each role, and takes every name on the party along as its consignee
options, so the shipment form can still name any of them as the consignee.

**No schema change.** The proforma function already takes the buyer and the
consignee as sent; the party's extra names are the list added in db/011.

**What it rules out**

- No separate "other consignees" list. One list serves both roles, which is
  the point of the request; a second list would have to be kept in step.
- A party with no consignee on file gets "Not set" for the consignee rather
  than the buyer being filled in silently — whoever raises the document chooses.
