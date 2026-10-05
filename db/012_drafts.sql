-- db/012 — saved drafts for proformas and shipments.
--
-- A proforma or a shipment can be saved part-way and finished later, by the
-- same person or a colleague. A draft is the FORM, kept as it was left. It is
-- not a document: it has no number, moves no money figure and marks nothing as
-- invoiced. The number is allocated only when the document is actually raised,
-- so drafts leave no gaps in the sequence.
--
-- Drafts are shared, like everything else here: anyone who holds the proforma
-- grant sees the proforma drafts, anyone who holds the shipments grant sees
-- the shipment drafts.
--
-- Born locked down (Bible §9a): signed-in users get SELECT and nothing else,
-- and there is no write policy. Every change goes through the three functions
-- below, each of which checks the caller and writes the audit row.
--
-- Additive only. The client on production today never reads this table.

-- -------------------------------------------------------------- the table
create table if not exists public.drafts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  title       text not null default '',
  ref_id      uuid,                               -- shipment: the proforma it is against
  payload     jsonb not null default '{}'::jsonb, -- the form, exactly as it was left
  saved_by    text not null default '',           -- who last saved it, for display
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid,
  constraint drafts_kind_valid        check (kind in ('proforma', 'shipment')),
  constraint drafts_payload_is_object check (jsonb_typeof(payload) = 'object'),
  constraint drafts_shipment_has_ref  check (kind <> 'shipment' or ref_id is not null)
);

create index if not exists drafts_live_idx
  on public.drafts (kind, updated_at desc) where deleted_at is null;

-- One live shipment draft per proforma: two people cannot each keep their own
-- half-finished shipment against the same proforma without knowing.
create unique index if not exists drafts_one_per_proforma
  on public.drafts (ref_id) where kind = 'shipment' and deleted_at is null;

-- ------------------------------------------------------------ who may read
alter table public.drafts enable row level security;
revoke all on public.drafts from anon, authenticated, public;
grant select on public.drafts to authenticated;

drop policy if exists drafts_read on public.drafts;
create policy drafts_read on public.drafts for select using (
     (kind = 'proforma' and public.has_access('proforma'))
  or (kind = 'shipment' and public.has_access('shipments'))
);

-- Live updates, as for every other table: a colleague's draft appears without
-- a reload. Full row identity so a retired draft is announced too.
alter table public.drafts replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drafts'
  ) then
    alter publication supabase_realtime add table public.drafts;
  end if;
end $$;

-- ------------------------------------------------------------ save a draft
-- Reads: id, kind, title, refId, payload, expectedUpdatedAt. The CONTENT of
-- payload is deliberately not interpreted here — it is the form's own state,
-- and the document functions validate it when the document is raised.
create or replace function public.save_draft(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id      uuid  := public._uuid(p ->> 'id');
  v_kind    text  := coalesce(p ->> 'kind', '');
  v_title   text  := left(btrim(coalesce(p ->> 'title', '')), 200);
  v_ref     uuid  := public._uuid(p ->> 'refId');
  v_payload jsonb := coalesce(p -> 'payload', '{}'::jsonb);
  v_section text;
  v_who     text;
  v_other   text;
  v_row     public.drafts;
  v_new     boolean := false;
begin
  if v_kind not in ('proforma', 'shipment') then
    perform public._fail(400, 'A draft is for a proforma or a shipment.');
  end if;
  v_section := case v_kind when 'proforma' then 'proforma' else 'shipments' end;
  if not public.has_access(v_section) then
    perform public._fail(403, 'You do not have access to ' || v_section || '.');
  end if;
  if jsonb_typeof(v_payload) is distinct from 'object' then
    perform public._fail(400, 'A draft must carry the form it was saved from.');
  end if;
  if octet_length(v_payload::text) > 300000 then
    perform public._fail(400, 'This draft is too large to save.');
  end if;
  if v_title = '' then v_title := 'Untitled draft'; end if;

  if v_kind = 'shipment' then
    if v_ref is null then perform public._fail(400, 'A shipment draft must name its proforma.'); end if;
    perform 1 from public.proformas where id = v_ref and deleted_at is null and shipment_id is null;
    if not found then
      perform public._fail(409, 'That proforma is no longer open, so a shipment draft cannot be saved against it.');
    end if;
    -- Someone else already has a draft against this proforma and this save did
    -- not come from it: refuse rather than overwrite their work unseen.
    if v_id is null then
      select saved_by into v_other from public.drafts
      where kind = 'shipment' and ref_id = v_ref and deleted_at is null;
      if found then
        perform public._fail(409, 'A draft already exists for this proforma (saved by ' || v_other || '). Reload and continue that one.');
      end if;
    end if;
  else
    v_ref := null;
  end if;

  select email into v_who from public.profiles where id = auth.uid();

  if v_id is not null then
    select * into v_row from public.drafts where id = v_id and deleted_at is null for update;
    if not found then perform public._fail(404, 'That draft was already used or discarded.'); end if;
    if v_row.kind <> v_kind or v_row.ref_id is distinct from v_ref then
      perform public._fail(400, 'A draft cannot be moved to a different document.');
    end if;
    if nullif(p ->> 'expectedUpdatedAt', '') is not null
       and v_row.updated_at <> (p ->> 'expectedUpdatedAt')::timestamptz then
      perform public._fail(409, 'Someone else saved this draft since you opened it. Reload to see their version.');
    end if;
    update public.drafts set
      title = v_title, payload = v_payload, saved_by = coalesce(v_who, ''),
      updated_at = now(), updated_by = auth.uid()
    where id = v_id
    returning * into v_row;
  else
    insert into public.drafts (kind, title, ref_id, payload, saved_by, created_by, updated_by)
    values (v_kind, v_title, v_ref, v_payload, coalesce(v_who, ''), auth.uid(), auth.uid())
    returning * into v_row;
    v_new := true;
  end if;

  perform public._audit(case when v_new then 'Draft saved' else 'Draft updated' end,
    'draft', v_row.id::text, v_kind || ' — ' || v_title, null, null);
  return jsonb_build_object('id', v_row.id, 'updated_at', v_row.updated_at);
end;
$$;

-- --------------------------------------------------------- discard a draft
create or replace function public.delete_draft(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.drafts;
begin
  if not (public.has_access('proforma') or public.has_access('shipments')) then
    perform public._fail(403, 'You do not have access to drafts.');
  end if;
  select * into v_row from public.drafts where id = p_id and deleted_at is null for update;
  if not found then perform public._fail(404, 'That draft was already used or discarded.'); end if;
  if not public.has_access(case v_row.kind when 'proforma' then 'proforma' else 'shipments' end) then
    perform public._fail(403, 'You do not have access to that draft.');
  end if;

  update public.drafts set deleted_at = now(), deleted_by = auth.uid(), updated_at = now() where id = p_id;
  perform public._audit('Draft discarded', 'draft', p_id::text, v_row.kind || ' — ' || v_row.title, null, null);
end;
$$;

-- ------------------------------------------- raise the document from a draft
-- ONE transaction: the document is created by the same function that creates
-- it without a draft (so the checks and the arithmetic are identical), and the
-- draft is retired with it. The row lock means two people who press the button
-- on the same draft get one document, not two.
create or replace function public.raise_from_draft(p_draft uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.drafts;
  v_out jsonb;
begin
  if not (public.has_access('proforma') or public.has_access('shipments')) then
    perform public._fail(403, 'You do not have access to drafts.');
  end if;
  select * into v_row from public.drafts where id = p_draft and deleted_at is null for update;
  if not found then
    perform public._fail(409, 'That draft was already used or discarded. Reload to see what was raised from it.');
  end if;
  if not public.has_access(case v_row.kind when 'proforma' then 'proforma' else 'shipments' end) then
    perform public._fail(403, 'You do not have access to that draft.');
  end if;

  if v_row.kind = 'proforma' then
    v_out := public.create_proforma(p);
  else
    if public._uuid(p ->> 'piId') is distinct from v_row.ref_id then
      perform public._fail(400, 'This draft belongs to a different proforma.');
    end if;
    v_out := public.create_shipment(p);
  end if;

  update public.drafts set deleted_at = now(), deleted_by = auth.uid(), updated_at = now() where id = v_row.id;
  perform public._audit('Draft raised', 'draft', v_row.id::text,
    v_row.kind || ' — ' || v_row.title || ' → ' || coalesce(v_out ->> 'doc_no', ''), null, null);
  return v_out;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.save_draft(jsonb)', 'public.delete_draft(uuid)', 'public.raise_from_draft(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from anon, public', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ------------------------------------------------------------------ gates
do $$
declare
  bad text;
begin
  -- 1. Row-level security is on, and signed-in users can read but not write.
  if not (select relrowsecurity from pg_class where oid = 'public.drafts'::regclass) then
    raise exception 'db/012: row-level security is off on drafts';
  end if;
  if not has_table_privilege('authenticated', 'public.drafts', 'select') then
    raise exception 'db/012: signed-in users cannot read drafts';
  end if;
  select string_agg(priv, ', ') into bad
  from unnest(array['insert', 'update', 'delete', 'truncate']) priv
  where has_table_privilege('authenticated', 'public.drafts', priv);
  if bad is not null then raise exception 'db/012: signed-in users can write drafts directly: %', bad; end if;

  -- 2. Nothing for anyone signed out.
  select string_agg(priv, ', ') into bad
  from unnest(array['select', 'insert', 'update', 'delete']) priv
  where has_table_privilege('anon', 'public.drafts', priv);
  if bad is not null then raise exception 'db/012: anon holds % on drafts', bad; end if;

  -- 3. No write policy: with no grant behind it, one would be a trap.
  select string_agg(policyname, ', ') into bad from pg_policies
  where schemaname = 'public' and tablename = 'drafts' and cmd <> 'SELECT';
  if bad is not null then raise exception 'db/012: write policy on drafts: %', bad; end if;

  -- 4. The three functions: signed-in only, definer, search_path pinned, and
  --    each checks the caller in its own body.
  with fns as materialized (
    select p.oid, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('save_draft', 'delete_draft', 'raise_from_draft')
  )
  select string_agg(f.oid::regprocedure::text, ', ') into bad from fns f
  where has_function_privilege('anon', f.oid, 'execute')
     or not has_function_privilege('authenticated', f.oid, 'execute')
     or not f.prosecdef
     or not coalesce(f.proconfig::text, '') like '%search_path=public%'
     or pg_get_functiondef(f.oid) !~ 'has_access\(';
  if bad is not null then raise exception 'db/012: draft function not locked down: %', bad; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('save_draft', 'delete_draft', 'raise_from_draft')) <> 3 then
    raise exception 'db/012: expected exactly three draft functions';
  end if;

  -- 5. Live updates are wired.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drafts'
  ) then raise exception 'db/012: drafts is not in the realtime publication'; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (12, 'drafts') on conflict (id) do nothing;

select 'db/012 ✓ drafts for proformas and shipments; read by grant, written only through RPCs' as status;
