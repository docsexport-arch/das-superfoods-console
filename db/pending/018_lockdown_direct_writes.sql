-- db/018 — PENDING. Do not run until the RPC-only client is live on production.
--
-- Why it waits: the client on production today (commit 0aab035) still writes
-- straight into the tables and inserts its own audit rows. This migration
-- removes exactly those paths, so running it early would break the live site.
-- The order is: promote branch lockdown-wave-1 → confirm the live site works →
-- move this file up to db/, bump EXPECTED_MIGRATION to 18 in the same commit,
-- then apply it.
--
-- What it does: after this, the ONLY way to change data is a definer RPC that
-- checks the caller, does the arithmetic, and writes the audit row. The tables
-- become read-only to signed-in users, which is the Bible's "two controls":
-- RLS decides which rows you may read; the absence of a write grant means even
-- a policy mistake cannot be turned into a write (§9a).

-- 1. Signed-in users keep SELECT and nothing else.
revoke insert, update, delete, truncate on
  public.parties, public.party_products, public.quotations, public.proformas,
  public.shipments, public.company_profile, public.profiles, public.audit_log,
  public.doc_counters
from authenticated;

-- 2. The write policies go with the grants — a policy with no grant behind it
--    is a trap for whoever restores the grant later.
drop policy if exists parties_write         on public.parties;
drop policy if exists party_products_write  on public.party_products;
drop policy if exists quotations_write      on public.quotations;
drop policy if exists proformas_write       on public.proformas;
drop policy if exists shipments_write       on public.shipments;
drop policy if exists company_write         on public.company_profile;
drop policy if exists profiles_admin_write  on public.profiles;
drop policy if exists audit_insert          on public.audit_log;

-- 3. FOR ALL included SELECT, so dropping it must not take reads with it.
--    The *_read policies from the bootstrap wave already cover SELECT; assert it.
do $$
declare missing text;
begin
  select string_agg(t, ', ') into missing
  from unnest(array['parties', 'party_products', 'quotations', 'proformas', 'shipments', 'company_profile', 'profiles', 'audit_log']) t
  where not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = t and p.cmd = 'SELECT');
  if missing is not null then raise exception 'db/018: no SELECT policy left on: %', missing; end if;
end $$;

-- 4. Number allocation is no longer a client call: the create RPCs allocate
--    inside their own transaction. The old entry point is retired.
revoke execute on function public.next_doc_no(text) from authenticated;

-- 5. Gates.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate');
  if bad is not null then raise exception 'db/018: authenticated can still write directly to: %', bad; end if;

  if has_function_privilege('authenticated', 'public.next_doc_no(text)', 'execute') then
    raise exception 'db/018: next_doc_no is still callable by authenticated';
  end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (18, 'lockdown_direct_writes') on conflict (id) do nothing;

select 'db/018 ✓ tables are read-only to clients; every write is an RPC' as status;
