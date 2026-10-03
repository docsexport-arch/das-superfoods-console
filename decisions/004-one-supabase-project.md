# 004 — One Supabase project for everything

**Decided:** 2026-10-03, on the owner's instruction ("data set to be used is 1 only").

Preview deployments and production read and write the same database. This is a
deliberate departure from the Build Bible (§5: dev and prod must not share a
project — FOO wiped production twice that way).

**What stands in for the missing isolation:**
- Schema goes first and stays compatible with the live client; anything that
  would break it waits in `db/pending/` with the condition written in its header.
- Every write is an audited RPC; deletes are soft; the audit log is append-only.
- New RPCs are exercised inside a transaction that is rolled back, never by
  creating test documents.

**Residual risk, stated plainly:** a preview build with a bug in a write path
writes to real data. There is no second database to absorb it.
**Reopen when:** the console holds data that would be costly to lose.
