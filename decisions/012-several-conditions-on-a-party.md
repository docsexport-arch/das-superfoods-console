# 012 — A party can carry several conditions

**Decided:** 2026-10-06, on the owner's instruction: in party creation, an
option to add another condition.

The party form's single Conditions box is now a list: **Condition 1**,
**Condition 2**, … with **Add another condition** and a remove button on each
(when there is more than one). There is no fixed limit.

**Kept as one text, a condition per line.** The list is joined into the
existing `conditions` field when the party is saved and split again when it is
opened (`conditionsToText` / `conditionsFromText` in `lib/format.js`). So:

- no schema change, and no change to any database function — the party and the
  proforma already carry `conditions` as text;
- a party or proforma saved earlier with one condition reads exactly as before;
- a blank box is not a condition, and a line break pasted into one box does not
  split it in two.

**Where they appear**

- *Proforma form* — the conditions that will be printed are listed, numbered.
- *Proforma PDF and Excel* — one line (or row) per condition, numbered when
  there is more than one. A single condition prints as it always did.

**What it rules out**

- Conditions are still set on the party, not typed per proforma. A proforma
  takes the party's conditions when it is raised or edited.
- The older live client shows the same text in its single box, run together on
  one line — readable, but it should not be used to edit a party that has more
  than one condition until it is retired.
