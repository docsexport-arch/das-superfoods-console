# 006 — One grant per toolbar section

**Decided:** 2026-10-03, on the owner's instruction. Replaces the three coarse
grants (documents / parties / company) from the first build.

Each toolbar section is its own grant: overview, parties, quotations, proforma,
shipments, analytics, company, users. An account sees and can use a section
only if it is ticked for that account. An admin always holds all eight.

**What each grant carries**

| Grant | Reads | Writes |
|---|---|---|
| overview | the home page; figures only for sections also held | — |
| parties | party master and price list | create, edit, retire parties |
| quotations | quotations | create, edit, retire, print |
| proforma | proforma invoices | raise proformas |
| shipments | shipments, **and proformas** (a shipment is raised against one) | invoice a shipment |
| analytics | the analytics page (phase 2) | — |
| company | company profile and bank details | edit it |
| users | every account and the audit log | **nothing** |

**Two deliberate limits**

1. *The users grant can look but not change.* Adding an account, setting a
   password and changing anyone's access stay with admins. If a non-admin could
   change access they could tick every box on their own row, and the grant
   system would mean nothing. Someone who should manage accounts is made an admin.
2. *Proforma does not include Parties.* The proforma form picks its buyer from
   the party master, so a person who raises proformas needs both ticked. The
   price list was not opened to proforma users automatically, because the owner
   asked for master data to be hidden from anyone not specifically granted it.

**Enforced in the database, not the screen.** `public.has_access(section)` is
used by every row-level-security policy and inside every write function, and it
checks `active`. The toolbar only decides what to draw.

**Rules out:** per-section "view only" versus "edit" — a grant is both. Reopen
if someone needs to read a section they must not change.

**Transition:** the client on production still uses the three legacy columns. A
trigger keeps them in step with `sections` until that client is retired
(db/010). The legacy columns and the trigger's legacy branch can then go.
