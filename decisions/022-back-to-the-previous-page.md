# 022 — A Back option on every page, and the browser's Back works too

**Decided:** 2026-10-07, on the owner's instruction, pointing at the browser's
back arrow: the portal should have an option to go back to the page being
worked on, everywhere in the system.

Until now the console kept "which page is showing" to itself. The browser knew
nothing about it, so its back arrow left the console altogether.

The place is now kept in the **address bar** and the **browser's history**
(`lib/route.js`): `#/parties`, `#/parties/list`, `#/proforma`, and so on. One
mechanism gives three things:

- **A Back button at the top left of every page.** It returns to the page that
  was open before.
- **The browser's own Back and Forward arrows work** inside the console, and
  agree with the button — they are the same history.
- **A reload stays on the page** it was on, instead of returning to Overview.

**It cannot take anyone out of the console.** Each move inside the console is
numbered; Back is switched off on the first page opened, when there is no
earlier page of the console to return to.

**What counts as a page.** Each section in the toolbar, and — inside Parties —
its two screens: party creation and View or Edit party. So Back from View or
Edit party returns to party creation.

**What does not, yet.** A form opened inside a page — New proforma, Edit
shipment, a party being edited — is part of its page, not a page of its own.
Back from a page with a form open goes to the previous page and the form
closes, exactly as clicking another section does today. Anything typed and not
saved (or saved as a draft) is lost, as it is today. Making Back close just the
form is the natural next step if this turns out to matter.

**Rules**

- An address naming a section the account does not hold falls back to one it
  does; the address is never a way round the access rules (the database
  decides those).
- Moving to the page already showing adds nothing to the history, so Back
  never appears to do nothing.
- A screen reached by Back starts clean: no half-open edit, no message left
  from the screen it came from.
