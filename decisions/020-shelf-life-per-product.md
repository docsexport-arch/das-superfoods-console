# 020 — Each product has its own shelf life, in months or years

**Decided:** 2026-10-07, on the owner's instruction: a shelf-life field in the
product details of both international and private-label parties, because each
product keeps for a different time; with a choice of months or years.

Every product line on the party form has a **Shelf life** column: a length, and
a choice of **Months** or **Years** (db/018). It is on the line, not the party —
two products on one party can carry different shelf lives.

**Kept as typed.** "2 years" is stored as 2 and years. It is not turned into 24
months, so it reads back the way it was entered. A product with none shows an
empty box, and exports as blank rather than "0 months".

**Where it shows.** On the party form, and in the party price-list Excel export
("18 months", "2 years").

**What it does not do — yet**

- It is not printed on the proforma or the shipment documents, and it is not
  copied onto proforma lines. The instruction was to record it on the product.
- It does not fill in the expiry date on a shipment. The natural next step is
  EXP = MFG + shelf life on the shipment form; that changes what a shipping
  document says, so it waits for the owner to ask for it.

**Rules in the database**

- Only months or years; never a negative length.
- A product line saved without these fields keeps the shelf life it has — a
  browser tab on an older copy of the console must not wipe it.
- The client on production today rewrites a party's product lines when it saves
  one, without knowing this field. A party edited on the old live site loses its
  shelf lives; this stops when that client is retired at promotion.
