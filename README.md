# Das Superfoods — Export console

Order-to-shipment document console: Quotation → Proforma invoice → Shipment
(tax invoice + commercial invoice + packing list), with party master data,
company profile, user accounts and an audit log.

## Repository layout

| Path | What it is |
|---|---|
| `index.html` | The built console — one self-contained file, opens with a double-click, no install |
| `src/app.jsx` | Application source. `index.html` embeds this and compiles it in the browser |
| `tools/build-html.ps1` | Rebuilds `index.html` from `src/app.jsx` (downloads and inlines React, Tailwind, Babel, icons) |
| `tools/server.ps1` | Tiny static server for local testing — no Node required |
| `supabase/schema.sql` | Database schema, row-level security and document numbering for the hosted version |

## Running it locally

Double-click `index.html`, or serve it:

```powershell
powershell -ExecutionPolicy Bypass -File tools/server.ps1 -Port 5173
```

After editing `src/app.jsx`:

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-html.ps1
```

## Current state: single-browser

**This build stores everything in the browser's local storage.** That has two
consequences worth being blunt about:

- **Data is not shared.** Every browser, machine and user account keeps its own
  separate copy. Two staff on two laptops do not see each other's parties or
  documents. Hosting the same file on a public URL does not change this — each
  visitor still gets their own private copy.
- **The access control is a workflow boundary, not security.** Passwords are
  hashed (SHA-256 with a per-user salt) but anyone who can open the browser's
  developer tools can read or replace the stored data.

Use **Users → Export backup** regularly. It is the only recovery route: there is
no server and no email behind the accounts, so a forgotten password can only be
resolved with *Locked out? Reset this console* on the sign-in screen, which
erases that browser's data.

## Next step: the hosted version

`supabase/schema.sql` is the database side of moving this to a real multi-user
system. Once applied, the console needs its data layer swapped from local
storage to Supabase:

- **Auth** — Supabase Auth replaces the in-browser password check. Real
  sign-in, real password resets by email, no lockouts.
- **Data** — the tables in `schema.sql` replace the local store, so everyone
  works on the same parties and documents.
- **Permissions** — the Admin / Documents / Party master / Company profile model
  is enforced by row-level security in Postgres, not just hidden in the UI.
- **Numbering** — `next_doc_no()` allocates document numbers atomically, so two
  people creating an invoice at the same moment cannot take the same number.

### Setting up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → New query → paste `supabase/schema.sql` → Run.
3. Authentication → Providers → Email: decide whether to require email
   confirmation (turn it off if you want to hand staff a temp password).
4. Sign up your own account first — the schema promotes the first account to
   admin automatically.
5. Copy **Project URL** and the **anon / publishable key** from
   Project Settings → API.

The anon key is designed to be embedded in client code and is safe to share.
The **service_role key is not** — it bypasses every row-level security policy.
Never put it in this repository or in the browser.

### Deploying to Vercel

The console is a static file, so no build step is required:

- Framework preset: **Other**
- Build command: none
- Output directory: `.` (repository root)

Connect the GitHub repository to Vercel and every push deploys automatically.
Consider turning on Vercel password protection while the app still holds real
company data in the browser.
