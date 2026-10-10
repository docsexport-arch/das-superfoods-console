# 029 — A quotation carries terms typed by hand

**Decided:** 2026-10-10, on the owner's instruction: add an option for terms;
terms can be added as required, manually. Read as the quotation — the page the
last several instructions were about.

## On the form

A **Terms** list under the product lines: one box per term, **Add another
term**, and a bin beside each box once there is more than one — the same as
Conditions on a party (decisions/012). Empty boxes are ignored. No terms is
fine.

## On the quotation file — PDF and Word alike

Under the amount in words, headed **Terms & conditions**, numbered in the order
typed:

    TERMS & CONDITIONS
    1. 1 x 40' container, floor loading (non-palletized cargo).
    2. Documents: Commercial Invoice, Packing List, Bill of Lading …
    3. Delivery within 30 days of receipt of advance.

A quotation with no typed terms has no heading and reads exactly as before.
Both files are drawn from the same description of the quotation
(decisions/027), so they cannot list different terms.

## Added, not replacing

The typed terms are in addition to what the quotation already says: the
Shipment and Payment terms at the top, and the standing small-print note
("valid for 30 days … subject to confirmation of availability"). That note
still prints. If a typed term gives a different validity, the two will
disagree on the page — the standing note can be removed, or made to print only
when no terms are typed, if the owner prefers.

## Stored

`quotations.terms` (db/024): one text, a term per line, as a party's
conditions are. `save_quotation` stores what it is sent; an edit that does not
carry the terms (an older copy of the console) leaves them alone; more than
6,000 characters in all is refused rather than cut short. The terms are
wording only — nothing is worked out from them.

## Also

The quotations Excel list has a Terms column. A party's own conditions are not
copied onto a quotation: they are printed on that party's proformas, and a
quotation is often for a buyer who is not a party yet.

## Not changed

Proformas (which take their conditions from the party) and shipments.
