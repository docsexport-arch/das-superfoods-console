-- db/006 — migration ledger, IST dates, and the second control on every table.
--
-- 1. Ledger. Every migration from here inserts its OWN id (Bible §6), and the
--    client's drift banner names any gap. Ids 1–5 are the bootstrap wave applied
--    on 2026-09-05 before the ledger existed; they are recorded here once.
-- 2. IST. doc_date defaulted to current_date, which is UTC: a document raised
--    between 00:00 and 05:30 IST carried yesterday's date, and on 1 January would
--    have been numbered into last year's series (Bible §5).
-- 3. Grants. Supabase pre-grants every new table in public to anon. RLS already
--    refuses the rows; this removes the grant so there are two controls, not one
--    (Bible §9a).

create table if not exists public.app_schema_migrations (
  id         int primary key,
  name       text not null,
  applied_at timestamptz not null default now()
);
alter table public.app_schema_migrations enable row level security;
revoke all on public.app_schema_migrations from anon, authenticated, public;
grant select on public.app_schema_migrations to authenticated;

drop policy if exists ledger_admin_read on public.app_schema_migrations;
create policy ledger_admin_read on public.app_schema_migrations
  for select to authenticated using (public.is_admin());

insert into public.app_schema_migrations (id, name) values
  (1, 'core_schema_profiles_master_documents'),
  (2, 'row_level_security_policies'),
  (3, 'enable_realtime_broadcast'),
  (4, 'harden_security_definer_functions'),
  (5, 'pin_admin_to_owner_email')
on conflict (id) do nothing;

-- One definition of "today" for the whole portal.
create or replace function public.ist_today()
returns date
language sql stable set search_path = public
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

revoke all on function public.ist_today() from anon, public;
grant execute on function public.ist_today() to authenticated, service_role;

alter table public.quotations alter column doc_date set default public.ist_today();
alter table public.proformas  alter column doc_date set default public.ist_today();
alter table public.shipments  alter column doc_date set default public.ist_today();

-- Number allocation, split in two. _alloc_doc_no is the mechanism and is not an
-- API: only definer functions reach it. next_doc_no keeps its signature and its
-- guard for the client that is live today; db/010 retires it once the RPC-only
-- client is promoted.
create or replace function public._alloc_doc_no(series_key text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  y      int := extract(year from public.ist_today());
  n      int;
  prefix text;
begin
  prefix := case series_key
    when 'quotation'        then 'DS-QUO'
    when 'pi_international' then 'DS-PI-INTL'
    when 'pi_domestic'      then 'DS-PI-DOM'
    when 'final'            then 'DS-INV'
    else null
  end;
  if prefix is null then
    raise exception using errcode = 'PT400', message = 'Unknown document series: ' || coalesce(series_key, '(none)');
  end if;

  insert into public.doc_counters (series, year, value)
  values (series_key, y, 1)
  on conflict (series, year)
  do update set value = public.doc_counters.value + 1
  returning value into n;

  return prefix || '-' || y || '-' || lpad(n::text, 4, '0');
end;
$$;
revoke all on function public._alloc_doc_no(text) from anon, authenticated, public;

create or replace function public.next_doc_no(series_key text)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_access('documents') then
    raise exception using errcode = 'PT403', message = 'You do not have access to documents.';
  end if;
  return public._alloc_doc_no(series_key);
end;
$$;
revoke all on function public.next_doc_no(text) from anon, public;
grant execute on function public.next_doc_no(text) to authenticated, service_role;

-- The second control: no anon privilege on any table, now or for tables created later.
revoke all on all tables in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;

do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
    and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate');
  if bad is not null then raise exception 'db/006: anon still holds privileges on: %', bad; end if;

  if position('ist_today' in pg_get_functiondef('public._alloc_doc_no(text)'::regprocedure)) = 0 then
    raise exception 'db/006: _alloc_doc_no does not take its year from ist_today()';
  end if;
  if has_function_privilege('authenticated', 'public._alloc_doc_no(text)', 'execute') then
    raise exception 'db/006: _alloc_doc_no is callable by authenticated';
  end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (6, 'ledger_ist_and_anon_revokes') on conflict (id) do nothing;

select 'db/006 ✓ ledger, IST dates, anon revoked on every table' as status;
