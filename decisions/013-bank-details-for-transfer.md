# 013 — Bank details for transfer, on the company profile and the proforma

**Decided:** 2026-10-06, on the owner's instruction: the proforma must give
the buyer the full bank details for a transfer, and whatever that needs must be
enterable on the company profile.

The proforma (PDF and Excel) now ends with:

    BANK DETAILS FOR TRANSFER
    Account Name:    …
    Bank:            …
    Branch:          …
    Account Number:  …
    Swift Code:      …

The profile already held bank, account number and SWIFT. Two fields were
missing and were added (db/015): **account name** — the name the account is
held in — and **branch**. The Company page groups all five under "Bank details
for transfer".

**Rules**

- *The values are typed by the owner on the Company page.* They are data, not
  code: no bank detail is written into the repository, a migration or a test.
  A gate fails the build if a long digit string appears in source, migrations
  or decisions.
- *Nothing is guessed.* A detail left blank prints as "—". In particular the
  account name is **not** filled in from the company name: for a transfer it
  must match the bank's record exactly, and only the owner knows that.
- *An older copy of the console cannot blank them.* A save that does not send
  the two new fields leaves them as they are.
- *PDF and Excel say the same thing*, in the same order, from one place.
- *IFSC stays off* (decisions/011).

**Known limits**

- The proforma reads the company profile **at the moment it is downloaded**, not
  when it was raised. Change the bank details and every proforma downloaded
  afterwards shows the new ones, including older proformas.
- Only accounts holding the *Company* section can read the profile. Someone
  with Proforma but not Company downloads a proforma with these lines blank.
- The shipment's stored company snapshot does not yet include account name and
  branch. Nothing displays them on a shipment today; they go in when the
  shipment documents get their own PDFs (OPEN_ITEMS).
