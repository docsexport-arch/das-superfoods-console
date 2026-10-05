# 011 — A proforma can be edited while it is open; IFSC is removed

**Decided:** 2026-10-05, on the owner's instruction: an Edit option on the
proforma, and the IFSC code removed from the company profile and all documents.

## Editing a proforma

An **open** proforma can be edited from the list: number, party, buyer and
consignee, order details, lines and quantities. The totals are recomputed by
the same code that computes them when a proforma is raised — one function,
`save_proforma` (db/014), does both.

**The limits, and why**

- *Not once it has been invoiced.* When a shipment is raised against a
  proforma, the proforma becomes the record of what was invoiced (decisions/001).
  It no longer offers Edit, and the database refuses the edit.
- *Not while a shipment draft exists against it.* The draft was filled in from
  the lines as they were. Discard the draft first, then edit.
- *Only from the version that was opened.* If a colleague changed it in the
  meantime, the save is refused and says so, rather than overwriting their work.
- *The number can change*, under the same rule as before: present, plain
  characters, not used by any other proforma.
- *The raise date and the author do not change.* An edit is recorded in the
  audit log with the proforma as it was and as it is now.
- *International stays international*, private label stays private label.

**Two things an edit will not do behind anyone's back**

- Swap the buyer or consignee. If the party master has changed since the
  proforma was raised, the names on the proforma stay on offer, marked
  "on this proforma", and stay selected.
- Fill in a consignee. A proforma raised without one stays "Not set".

**One thing it does do:** ports, shipment and payment terms, conditions and
currency are read from the party again when an edit is saved — the form shows
them, and what it shows is what is saved. If the party it was raised for is no
longer on file, the proforma cannot be edited here.

## IFSC

Removed from the company screen, from what the company screen saves, from the
data the screens are given, and from the proforma PDF and Excel. No other
document showed it.

The **database column is kept for now** and its stored value is left alone
(`save_company` neither reads nor wipes it). Two things still touch it: the
client on production today reads it, and `create_shipment` copies it into each
shipment's company snapshot, which nothing displays. Both are cleaned up when
that client is retired (OPEN_ITEMS). Until then the old live site still shows
the IFSC it has.
