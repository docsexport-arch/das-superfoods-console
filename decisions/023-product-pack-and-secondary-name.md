# 023 — A product line describes its pack: weight, unit, pieces per box, secondary name

**Decided:** 2026-10-08, on the owner's instruction, with a table as the
example (the product named in it was for illustration only):

| Product | Weight | Unit | Pieces per box | Secondary name |
|---|---|---|---|---|
| High Protein Oats Dark Chocolate | 400 | g | 20 | High protein oats 400gm*20 pcs |
| High Protein Oats Dark Chocolate | 1 | kg | 10 | High protein oats 1kg*10 pcs |

The same product is sold in more than one pack. The **product name stays the
same** on each line; what tells the lines apart is held separately, beside it.
The Products table on the party form — international and private label — now
begins with exactly those five columns:

- **Product** — the name, on its own.
- **Weight** and **Unit** — the weight of ONE piece, in g, kg or MT.
- **Pieces per box** — what the form used to call "Packs / box". Same figure,
  relabelled; it is what turns boxes into units everywhere else.
- **Secondary name** — a second name for the line that says the pack, typed
  freely in the desk's own words.

Everything that was there before follows them: HSN, rate or MRP, net and gross
weight per box, their unit (now headed **Box wt unit** so it is not mistaken
for the piece's), shelf life.

**Two weights, two units.** The weight of a piece and the weight of a box are
different things with their own unit each. The piece's weight is stored in
grams and the box weights in kilograms (unchanged); each remembers the unit it
was typed in and shows it back that way (db/020, db/019). As elsewhere,
choosing a unit says what the number means and does not convert it.

**This brings back a field that was removed.** The "g / pack" box was taken off
the form on 2026-10-05 at the owner's request. The column was kept, and is now
shown again as Weight + Unit, because the pack cannot be described without it.

**Where the pack shows**

- *Party form* and the *price-list Excel* (Secondary name, Weight / piece).
- *Proforma form* — the product picker lists a line as "name — secondary name"
  (or "name — 400 g × 20" when no secondary name was typed), and each line on
  the form shows it under the name. Without this, two packs of one product
  would be indistinguishable when raising a proforma.

**What it does not do — yet**

- The secondary name is **not printed** on the proforma PDF/Excel or the
  shipment documents: those still show the product name only. A proforma with
  two packs of one product therefore prints two lines with the same name. This
  is a customer-facing choice — product name, secondary name, or both — and
  waits for the owner. Lines raised from now on carry the pack, so it can be
  switched on without re-entering anything.
- Nothing is worked out from the piece weight: net weight per box is still
  typed, not computed as weight × pieces.
- The secondary name is not suggested from the other columns.

**Rules in the database**

- The same product name may appear on more than one line of a party.
- A line saved without the new fields keeps what it has.
