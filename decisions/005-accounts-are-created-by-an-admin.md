# 005 — Accounts are created by an administrator, and never deleted

**Decided:** 2026-10-03, on the owner's request to create accounts and set
passwords directly.

- The sign-in screen has no "create account". An admin adds a person under
  Users, sets a first password, and passes it on in person or by phone.
- Anyone can change their own password (key icon in the header) or reset it by
  email. An admin can set anyone's password.
- An account is deactivated, not deleted. Deactivation blocks it at once —
  every role check reads `active` — and the audit trail keeps a name.

**Why:** the first design had staff register themselves; Supabase's free mailer
then rate-limited the confirmation emails and nobody could join.

**Owed (owner, dashboard):** switch off public sign-ups in Supabase Auth. Until
then a stranger can still create an account through the API. It would have no
access to anything — every grant defaults to false — but it should not exist.
