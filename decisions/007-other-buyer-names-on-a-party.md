# 007 — Other buyer names live on the party

**Decided:** 2026-10-05, on the owner's instruction: the same party sometimes
places an order under a different name, and that name and address must be
available on the party.

A party keeps its main buyer name and address, and beside them a list of other
buyer names, each with its own address (`parties.alt_buyers`, db/011). There is
no fixed limit — the request was for one more, but a second "other" name would
otherwise need another schema change.

**How it is used**

- *Party form* — an "Other buyer names" section: add, edit, remove rows.
- *Quotation and proforma forms* — when the chosen party has more than one
  name, a picker asks which name goes on this document; the address follows it.
  With only one name the picker is not drawn and nothing changes.
- *Party list, Excel export, search* — the other names are shown and searchable.
- *Shipment* — takes its buyer from the proforma, so it follows automatically.

**What it rules out**

- Not a second party. The price list, terms, ports and consignee stay shared:
  one party, several names. Two buyers with different prices are two parties.
- A document does not point back at the list. It stores the name and address
  it was raised with (decisions/001), so renaming or removing an "other" name
  later never changes a quotation or proforma already issued.

**One rule in the database**

A save that does not carry `altBuyers` leaves the stored names alone. A browser
tab still running an older copy of the console must not wipe names it has never
heard of. To clear them, the client sends an empty list.
