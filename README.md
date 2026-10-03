# Das Superfoods — Export console

Order-to-shipment documents for the export desk: **Quotation → Proforma invoice
→ Shipment** (tax invoice, commercial invoice, packing list), with a party
master, company profile, user accounts with per-section access, and an audit log.

Live: https://das-superfoods-console.vercel.app

Everyone works on one shared database. A change made by one person appears on
everyone else's screen without a refresh.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # tests + build + bundle check
```

Requires Node 24. `git push` on a branch gives a Vercel preview; `main` is production.

## How it is put together

| | |
|---|---|
| Client | React 19 + Vite, Tailwind v4 — `src/` |
| Database | Supabase Postgres (Mumbai). Row-level security on every table — `db/` |
| Writes | Postgres functions only: one transaction each, with the role check, the arithmetic and the audit row inside |
| Accounts | Supabase Auth. Created by an administrator; the secret key lives only in the `admin-users` Edge Function |
| Hosting | Vercel |

Start with **`CLAUDE.md`** for where things live, **`decisions/`** for why, and
**`OPEN_ITEMS.md`** for what is still owed — including what only the owner can do.

## Database

Migrations are in `db/`, numbered and applied in order. Each records itself in
`app_schema_migrations`, and an administrator sees a banner in the console if
the database and the deployed build are out of step. Files in `db/pending/` are
written but not applied; each says what it is waiting for.

To stand up a fresh project: run `db/001-005_bootstrap.sql`, then `006` onwards
in order, in the Supabase SQL editor. Change the owner address in the bootstrap
file first — it decides who becomes the first administrator.
