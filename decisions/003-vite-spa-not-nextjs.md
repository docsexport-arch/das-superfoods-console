# 003 — A Vite SPA, not Next.js

**Decided:** 2026-10-03 by Claude. **Needs the owner's sign-off** — the Build
Bible's default for a new portal is Next.js (App Router).

The console already existed as a working React SPA. It was moved to a Vite build
(the same shape as MasterALLOC, the estate's reference implementation) rather
than rewritten for Next.js.

**Why:** the reason the Bible prefers Next.js is that it keeps the secret key
server-side by construction. Here the only work that needs that key — creating
accounts and setting passwords — is isolated in one Edge Function, and the
client holds the publishable key only (`check:bundle` and a gate test both fail
on a secret). A Next.js port would be a rewrite of every screen for no change
in what a user can do.

**Rules out, for now:** Server Components, Route Handlers, Server Actions.
**Reopen when:** a second server-side need appears (a SAP feed, PDF generation
on the server, a scheduled job).
