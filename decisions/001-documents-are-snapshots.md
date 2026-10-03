# 001 — A document keeps the values it was created with

**Decided:** 2026-07 (original spec §12), restated 2026-10-03.

Master data — party terms, product rates, the company's bank details — is copied
into a document at the moment the document is created. Editing the master later
changes what *future* documents pull in and nothing else. The `party_id` /
`proforma_id` columns are for traceability; nothing is re-read through them for
display.

**Why:** an invoice issued in March must still say what it said in March.

**Rules out:** "refresh this document from the master", and any report that
joins a document back to the live master to get a price.
