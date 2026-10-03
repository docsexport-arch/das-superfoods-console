# Das Superfoods — Export console

The lean map of this repo. **How we build anything** is governed by the Pintola
Build Bible (`BUILD_BIBLE.md`, kept outside this repo — read it before a new
feature, and §24 of it when a rule here turns out to be wrong). This file only
says **where things are**.

## What it is

An order-to-shipment document console for the export desk: Quotation →
Proforma invoice → Shipment (tax invoice + commercial invoice + packing list),
with a party master, a company profile, accounts with per-section access, and
an append-only audit log. Single-digit concurrent users. Not connected to SAP.

## Stack

| Layer | What | Where |
|---|---|---|
| Client | React 19 + Vite SPA, Tailwind v4 | `src/` → built to `dist/` |
| Database | Supabase Postgres, `ap-south-1`, project `jvpziatizbaghxhyslrg` | `db/` |
| Server-side | one Edge Function, `admin-users` | `supabase/functions/` |
| Hosting | Vercel, auto-deploy from GitHub | `vercel.json` |

One Supabase project serves everything (decisions/004). Live:
https://das-superfoods-console.vercel.app · repo `docsexport-arch/das-superfoods-console`.

## Where things live

| Path | Holds |
|---|---|
| `src/app.jsx` | Every screen and form. Screens only — no data access, no arithmetic |
| `src/ui.jsx` | Shared pieces: `Field`, `Chip`, `ExcelButton`, `ErrorPanel`, `Dialog`, style constants |
| `src/tokens.css` | **All** colours, fonts, easing, print styles. The only place a hex may appear |
| `src/config.js` | Supabase URL + publishable key (public by design), timeouts |
| `src/lib/db.js` | Supabase client, `call()` (RPC + timeout), `readAll()` (paged), `fetchStore()`, row mappers, `adminApi()` |
| `src/lib/money.js` | Quotation / proforma / shipment arithmetic — the client **preview** of what the SQL computes |
| `src/lib/format.js` | The one number + date utility: IST, dd/mm/yyyy, `toNumber`, amount in words |
| `src/lib/payloads.js` | The keys sent to each RPC — the client half of the RPC contract |
| `src/lib/excel.js` | Excel export with formula-injection defang (SheetJS loaded on demand) |
| `src/lib/migrations.js` | `EXPECTED_MIGRATION` + drift calculation for the admin banner |
| `db/NNN_*.sql` | Applied migrations, in order. `001-005_bootstrap.sql` is the first wave |
| `db/pending/` | Written but **not applied** — each file's header says what it waits for |
| `supabase/functions/admin-users/` | Creates accounts and sets passwords with the secret key |
| `tests/` | Unit tests, render tests, and `gates.test.js` (reads the repo itself) |
| `scripts/check-bundle.mjs` | Inspects the built client before deploy |
| `decisions/` | Append-only. What was decided, when, why, what it rules out |
| `OPEN_ITEMS.md` | What is owed, and what only the owner can do |

## Conventions that are enforced, not just written

- **Writes are RPCs.** One transaction each; the role check, the arithmetic and
  the audit row are inside. `gates.test.js` fails on a direct table write.
- **RPC contract.** Add a field → add it to the SQL **and** `payloads.js` in the
  same commit. The contract test fails if the SQL would throw a key away.
- **Migrations.** Numbered, idempotent, never edited once applied. Each inserts
  its own id into `app_schema_migrations` and ends with a `DO` verifier. Bump
  `EXPECTED_MIGRATION` in the same commit — the gate reads `db/` and checks.
- **Time is IST.** `public.ist_today()` in SQL, `todayIST()` in the client.
  `current_date` and `toISOString()` dates are both gated out.
- **Tokens only.** No hex outside `tokens.css`; both themes must work.
- **A failed read throws.** It is shown as an error, never as an empty table.
- **Every table has an Excel export**; quantities show boxes **and** units.

## Roles and access

`admin` holds everything. `staff` hold any of eight grants, one per toolbar
section — `overview`, `parties`, `quotations`, `proforma`, `shipments`,
`analytics`, `company`, `users` (decisions/006). The list lives in four places
that a gate keeps identical: the check constraint `profiles_sections_valid`
(db/010), `SECTION_KEYS` in `lib/db.js`, `SECTIONS` in `app.jsx`, and the
`admin-users` function.

`public.has_access(section)` / `public.is_admin()` are the gate — used by every
RLS policy and inside every write function, and both check `active`.
`accessOf()` in `db.js` mirrors them to decide what to draw. The `users` grant
reads accounts and the audit log; only an admin can change them.

## Working loop

```
npm run dev            # http://localhost:5173
npm run check          # tests + build + bundle check — what Vercel runs too
git push               # branch → Vercel preview; main → production
```

Risky or large work goes on a branch and is reviewed on its preview URL before
it reaches `main`. SQL is applied through Supabase (MCP or the SQL editor); a
push deploys code only, so **schema goes first** and stays compatible with the
client that is live until the new one is promoted.

## Verified facts about this environment

- The Supabase project is on the **free tier and auto-pauses** after ~7 days
  idle. A paused project makes every sign-in fail (2026-10-03). See OPEN_ITEMS.
- Admin-gated RPCs cannot be run from the SQL editor (no `auth.uid()`). They are
  exercised inside a `DO` block that sets `request.jwt.claims` and ends in
  `raise exception`, which rolls everything back.
- `pg_get_functiondef` refuses aggregates and the planner may call it before a
  schema filter — materialise the function list first (db/009 gate 4–5).
