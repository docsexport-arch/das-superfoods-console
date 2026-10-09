# 025 — A party carries mobile, mail id and tax id for its buyer and for its consignee / ship-to

**Decided:** 2026-10-09, on the owner's instruction: on a party, for both
international and private label, below the buyer address and below the
consignee address / ship-to address, add boxes for mobile contact no., mail id
and tax id.

Six boxes, three under each address:

| Under | International | Private label / India |
|---|---|---|
| Buyer address | Buyer mobile contact no. · Buyer mail id · Buyer tax id | the same |
| Consignee address / Shipping address | Consignee mobile contact no. · Consignee mail id · Consignee tax id | Ship-to mobile contact no. · Ship-to mail id · Ship-to tax id |

The consignee and the ship-to are the same field on the party (decisions/017),
so their contact details are too: one set of three columns, named for the kind
of party on screen.

**Kept as typed.** Nothing checks the shape of a number, a mail id or a tax id.
A mobile number may carry a country code or an extension; a tax id is whatever
the buyer's country issues (GSTIN, TIN, VAT, EIN …), and the console has no
business refusing one it does not recognise. Spaces at either end are trimmed.
All six are optional.

**Stored** in six columns on `parties` (db/021), never null, blank by default.
`save_party` writes each when it is sent and leaves it alone when it is not, so
the older copy of the console still on the live link cannot blank them by
saving a party it opened.

**Where they show.** On the party form (new, edit and draft), and in the party
price list in Excel. **Not on documents:** a proforma or a shipment set prints
exactly what it printed before. Printing a buyer's tax id or contact on the PI
is a separate decision about the document, and has not been asked for.

**Other buyer / consignee names** (decisions/007) carry a name and an address
only; they have no contact boxes.
