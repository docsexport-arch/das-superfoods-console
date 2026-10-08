# 024 — Product details are laid out as a card per product, not one long row

**Decided:** 2026-10-08, on the owner's instruction, with a screenshot of the
Products table: the columns were squeezed into one line — the net-weight box
too narrow to read its own number, the product name pushed out of view — and
it need not be a single line.

After 020–023 a product line carried eleven boxes. One table row cannot hold
that many at a readable width. Each product is now a **card**, its boxes laid
out over three lines, each with its label above it:

| Line | Boxes |
|---|---|
| 1 — the product and its pack | Product · Weight · Unit · Pieces per box |
| 2 — its second name, code and price | Secondary name · HSN · Rate / box (or MRP / box) |
| 3 — the box, and how long it keeps | Net wt / box · Gross wt / box · Box wt unit · Shelf life |

The order is unchanged from 023 — Product, Weight, Unit, Pieces per box,
Secondary name first, as the owner listed them — only the arrangement is new.
Each card is headed "Product 1", "Product 2" …, with Remove at its top right;
"Add product line" is a full-width button under the last card. On a narrow
screen the boxes stack one under another.

Nothing about what is stored or sent changed: same boxes, same names, same
values. Measured in the browser at a normal desktop width, the narrowest box is
176 px, no number is cut off, and nothing scrolls sideways.
