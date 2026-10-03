-- db/008 — soft delete on every destructive path (Bible §9c, §12).
--
-- A hard delete with no undo means one mis-click destroys a record and the
-- only evidence of it. Rows are now retired, not removed: deleted_at/deleted_by
-- are set by the RPCs in db/009 and the client reads only live rows.
-- updated_at doubles as the version stamp for the edit-conflict check.
-- The partial indexes are the hot path of every list: live rows, newest first,
-- ending on a unique key so paging is stable (§10b).

alter table public.parties
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists updated_at timestamptz not null default now();

alter table public.quotations
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists updated_at timestamptz not null default now();

alter table public.proformas
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists updated_at timestamptz not null default now();

alter table public.shipments
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists parties_live_idx    on public.parties    (created_at, id)      where deleted_at is null;
create index if not exists quotations_live_idx on public.quotations (created_at desc, id) where deleted_at is null;
create index if not exists proformas_live_idx  on public.proformas  (created_at desc, id) where deleted_at is null;
create index if not exists shipments_live_idx  on public.shipments  (created_at desc, id) where deleted_at is null;

do $$
declare missing text;
begin
  select string_agg(t, ', ') into missing
  from unnest(array['parties', 'quotations', 'proformas', 'shipments']) t
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = t and column_name = 'deleted_at'
  );
  if missing is not null then raise exception 'db/008: no deleted_at on: %', missing; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (8, 'soft_delete_columns') on conflict (id) do nothing;

select 'db/008 ✓ soft-delete columns and live-row indexes' as status;
