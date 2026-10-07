# 021 — A product's weights can be typed in grams, kilograms or MT

**Decided:** 2026-10-07, on the owner's instruction: the same kind of choice as
shelf life, for weight — gram, kilogram or MT — when adding product details in
party creation.

Every product line on the party form (international and private label) has a
**Weight unit** choice — **g**, **kg** or **MT** — beside Net wt / box and Gross
wt / box. One choice per line covers both weights. A new line starts in grams,
as before.

**What is stored does not change.** Net and gross weight are still stored in
**kilograms per box**. Every packing list, shipment total and Excel column is in
kg and tonnes and reads those figures as it always has. The line also records
the unit it was typed in (db/019), so the form shows the weight back the way it
was entered: a line typed as 12 kg shows 12 kg, not 12000 g.

**Choosing a unit says what the number means; it does not convert the number.**
Type 12 and choose kg: 12 kg. Change the choice to g and it is 12 g — the number
on screen stays, exactly as changing months to years does for shelf life. This
is the rule to know: on an existing line, changing only the unit changes the
weight a thousandfold. It is visible on the line, and the unit sits right
beside the numbers for that reason.

**Lines that exist today** were typed in grams and are marked so; they look and
behave exactly as before.

**Rules in the database**

- Only g, kg or mt.
- The database stores the kilograms it is sent; it does not convert by the unit
  a second time. The conversion is done once, by the form.
- A line saved without the unit keeps the unit it has — a browser tab on an
  older copy of the console must not reset it.

**What it rules out**

- No separate unit for net and for gross on one line.
- No other units (pounds, ounces). MT is the metric tonne, 1000 kg.
- Weights below 0.1 g cannot be held: the column keeps four decimals of a
  kilogram.
