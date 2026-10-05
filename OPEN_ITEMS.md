# Open items

What is owed. Checked against the Build Bible's Definition of Done (§20) and
new-portal checklist (Appendix C) on 2026-10-03. Nothing here is hidden behind
a green build.

## Only the owner can do these

| # | What | Why it matters | Where |
|---|---|---|---|
| 1 | **Move Supabase to the Pro plan** (or sign in at least weekly) | The free tier pauses the database after ~7 days idle. Every sign-in then fails and looks like a wrong password — it happened on 2026-10-03. Pro also brings daily backups; today there are none | Supabase → Billing |
| 2 | **Change the password that was typed into a chat** | A secret that reaches a transcript is treated as compromised (Bible §9b) | Key icon in the console header |
| 3 | **Switch off public sign-ups** | Accounts are admin-created now (decisions/005). Until this is off, anyone can create an account through the API — with no access to anything, but it should not exist | Supabase → Authentication → Sign In / Providers → "Allow new users to sign up" |
| 4 | **Turn on Network Restrictions** | Nothing in this portal connects to Postgres directly, so the raw port buys only password-guessing traffic | Supabase → Database → Settings → Network Restrictions |
| 5 | **Turn on leaked-password protection** and a password policy | The one real finding in the Security Advisor | Supabase → Authentication → Policies (Pro plan) |
| 6 | **Sign in the three CLIs** | Installed, not authenticated — each opens a browser: `gh auth login`, `vercel login`, `npx supabase login` | Your own terminal |
| 7 | **Sign off decisions 002 and 003** | 002 changes the INR figure on tax invoices; 003 departs from the Next.js default | `decisions/` |
| 8 | **Connect an email service** for password resets | Supabase's built-in mailer allows a handful of emails an hour | Supabase → Authentication → Emails → SMTP |
| 9 | **Decide: public or private repository** | It is public today. It holds no secret, but it does describe the system | GitHub → Settings |

## Owed by the build

**At promotion**
- [ ] Apply `db/pending/015_lockdown_direct_writes.sql` once the RPC-only client
      is live: move it into `db/`, bump `EXPECTED_MIGRATION` to 15 in the same
      commit. Until then the tables still accept direct writes from a signed-in
      user who has the grant.
- [ ] Then drop the three legacy columns (`access_documents`, `access_parties`,
      `access_company`) and the legacy branch of `_profiles_sync_access` — they
      exist only for the client that is live today (decisions/006).
- [ ] Then drop `company_profile.ifsc` and take `'ifsc'` out of the company
      snapshot in `create_shipment` — in ONE migration, since the function names
      the column. IFSC is already gone from every screen and document
      (decisions/011); the column is kept only because the live client reads it.

**Next increment — usability the Bible requires**
- [ ] Tables: sortable headers and reorderable columns from one column registry.
- [ ] Inline edit where data is shown; retire a proforma while it is open (edit exists — decisions/011).
- [ ] PDF for the proforma, and for the shipment's three documents (tax invoice,
      commercial invoice, packing list). Quotation PDF exists.
- [ ] Home as a briefing — one sentence saying what needs attention — not stat cards.
- [ ] Units alongside boxes on quotation lines (proforma and shipment have them).
- [ ] A currency on the quotation, so its amount-in-words names one.
- [ ] A person with Proforma but not Parties cannot raise a proforma: the form
      picks its buyer from the party master (decisions/006). The Users screen
      says so. If that pairing is a nuisance, the answer is a read-only buyer
      picker for proforma users — an owner decision, since it opens the price list.

**Not yet built**
- [ ] `check:grants` against the live database in CI (needs a `DATABASE_URL`
      secret). The same checks run today as the verifier at the end of db/009.
- [ ] Secret scan in CI.
- [ ] A verified `pg_dump` and a tested restore. **There is no backup today.**
- [ ] A health view and a freshness indicator.
- [ ] Login rate-limiting beyond Supabase's built-in limits.

## Accepted, with the reason

- **Security Advisor rule 0029** (signed-in users can call a definer function),
  12 rows. Every write is a definer RPC by rule. Accepted only while each one
  checks the caller in its own body — asserted by gate 4 at the end of db/009.
- **One Supabase project** for preview and production — decisions/004.
- **`verify_jwt` off** on the `admin-users` function. It verifies the caller
  itself so a refusal carries a readable message; tested with no token, the
  public key, and a forged token (all 401).
