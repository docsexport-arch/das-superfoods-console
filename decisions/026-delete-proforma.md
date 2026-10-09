# 026 — A proforma can be deleted, and its number comes free

**Decided:** 2026-10-09, on the owner's instruction, with a screenshot of the
proforma list: add Delete in the Actions column, beside Edit.

## On screen

An open proforma's row reads **Edit · Delete · Download**. Delete does nothing
by itself: the row asks "Delete PI-number? Confirm · Cancel", the same two-step
as a quotation or a party. After Confirm the proforma leaves the list and the
page says so.

## What may be deleted

The same rule as editing (decisions/011):

| Proforma | Delete |
|---|---|
| Open | Yes |
| Invoiced — a shipment has been raised against it | No. It is the record of what was invoiced, and the shipment points at it. The row shows no Delete, and the database refuses one anyway. |
| Open, with a shipment draft saved against it | Not until that draft is discarded — the page says whose draft it is. Otherwise the draft would point at a proforma that is gone. |

Only someone who holds the Proforma section can delete.

## What "deleted" means

The proforma is retired, not erased (db/008): it disappears from every list,
total and picker, but the row stays in the database with who deleted it and
when, and the audit log keeps the whole proforma as it was. There is no
"undelete" button; bringing one back is a job for whoever looks after the
database.

## The number comes free

Proforma numbers are typed by hand and no two may match (decisions/010). A
deleted proforma no longer counts: the usual reason to delete one is that it
was raised wrongly, and the corrected one needs the same number. So the number
of a deleted proforma can be typed again straight away.

Two rules in the database held the number and both now look at live proformas
only: the check inside `save_proforma`, and the unique index behind it
(`proformas_doc_no_live_ci`, replacing `proformas_doc_no_ci` and the table's
original `proformas_doc_no_key`). The second of those was found by the trial
run, not by reading — raising the number again failed until it was removed.
Two live proformas still cannot share a number, whatever the capitals or
spaces.

A consequence, accepted: the audit log can show two proformas with the same
number, one deleted. They are told apart by their dates and ids.

## Not changed

Shipments have no Delete. Quotations and parties already had one.
