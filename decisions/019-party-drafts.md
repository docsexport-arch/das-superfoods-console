# 019 — A party can be saved as a draft; the creation screen lists only drafts

**Decided:** 2026-10-07, on the owner's instruction: a Save draft option in
party creation for both International and Private label / India; only draft
(incomplete, not yet created) parties are shown on the party screen; once a
party is created it moves to View or Edit party. Completes 018.

**Save draft** sits beside Create party on the creation form, for both kinds.
A draft is the form as it stands — a name and nothing else is fine. Nothing is
checked until the party is created.

**The creation screen** shows, under the form, a **Draft parties** list: each
with who saved it and when, **Continue draft** and **Discard**. Continuing one
opens the form exactly as it was left — boxes, other names, conditions, product
rows with their weights — on the right kind of party. That is the only list on
the creation screen.

**Once created**, the party leaves the draft list and appears under View or
Edit party. Creating from a draft is one transaction (`raise_from_draft`,
db/017): the party is created by the same function that creates any party, and
the draft is retired with it — two people pressing Create on the same draft get
one party.

**What a draft is not.** It is not a party: it is in no buyer picker, on no
quotation or proforma, in no Excel export, and not counted in the number beside
View or Edit party.

**Shared.** Like proforma and shipment drafts (decisions/009), party drafts live
in the database, not the browser: a draft saved on one computer can be continued
on another by anyone who holds the Parties section — and only by them.

**What it rules out**

- No auto-save. A form that is closed or cleared without Save draft is gone;
  "unsaved" work cannot be listed because the system never received it.
- Editing an existing party has no Save draft: it is already a party, and an
  edit either saves or it does not.
- A draft does not reserve a name. Two drafts, or a draft and a party, can
  carry the same buyer name.
