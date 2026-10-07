-- db/017 — a party can be saved as a draft.
--
-- Party creation gets the same "save part-way, finish later" that proformas
-- and shipments have (db/012). A party draft is the FORM as it was left: it is
-- not a party, appears in no picker and on no document, and is shared with
-- everyone who holds the Parties section.
--
-- Nothing new is built for it. The drafts table gains a third kind, 'party',
-- and the three draft functions learn that a party draft belongs to the
-- 'parties' grant. Creating the party from its draft is one transaction: it
-- calls save_party — the same function that creates a party without a draft —
-- and retires the draft with it.
--
-- Additive: one constraint and one policy widened, three functions replaced.
-- The client on production today reads neither the table nor the functions.

-- ---------------------------------------------------------- a third kind
alter table public.drafts drop constraint if exists drafts_kind_valid;
alter table public.drafts add constraint drafts_kind_valid
  check (kind in ('party', 'proforma', 'shipment'));

-- Who may read: each kind by the grant for its own section.
drop policy if exists drafts_read on public.drafts;
create policy drafts_read on public.drafts for select using (
     (kind = 'party'    and public.has_access('parties'))
  or (kind = 'proforma' and public.has_access('proforma'))
  or (kind = 'shipment' and public.has_access('shipments'))
);

-- ---------------------------------------------------------- the functions
-- Each is the live definition (db/012 for save and delete, db/016 for raise —
-- verified identical to the database before this was written) with the party
-- kind added and nothing else changed.
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
  if v_kind not in ('party', 'proforma', 'shipment') then
    perform public._fail(400, 'A draft is for a party, a proforma or a shipment.');
  end if;
  v_section := case v_kind when 'proforma' then 'proforma' when 'party' then 'parties' else 'shipments' end;
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

create or replace function public.delete_draft(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.drafts;
begin
  if not (public.has_access('parties') or public.has_access('proforma') or public.has_access('shipments')) then
    perform public._fail(403, 'You do not have access to drafts.');
  end if;
  select * into v_row from public.drafts where id = p_id and deleted_at is null for update;
  if not found then perform public._fail(404, 'That draft was already used or discarded.'); end if;
  if not public.has_access(case v_row.kind when 'proforma' then 'proforma' when 'party' then 'parties' else 'shipments' end) then
    perform public._fail(403, 'You do not have access to that draft.');
  end if;

  update public.drafts set deleted_at = now(), deleted_by = auth.uid(), updated_at = now() where id = p_id;
  perform public._audit('Draft discarded', 'draft', p_id::text, v_row.kind || ' — ' || v_row.title, null, null);
end;
$$;

create or replace function public.raise_from_draft(p_draft uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.drafts;
  v_out jsonb;
begin
  if not (public.has_access('parties') or public.has_access('proforma') or public.has_access('shipments')) then
    perform public._fail(403, 'You do not have access to drafts.');
  end if;
  select * into v_row from public.drafts where id = p_draft and deleted_at is null for update;
  if not found then
    perform public._fail(409, 'That draft was already used or discarded. Reload to see what was raised from it.');
  end if;
  if not public.has_access(case v_row.kind when 'proforma' then 'proforma' when 'party' then 'parties' else 'shipments' end) then
    perform public._fail(403, 'You do not have access to that draft.');
  end if;

  if v_row.kind = 'proforma' then
    v_out := public.save_proforma(p - 'id' - 'expectedUpdatedAt');
  elsif v_row.kind = 'party' then
    -- The same function that creates any party; without an id it can only create.
    v_out := jsonb_build_object('id', public.save_party(p - 'id'), 'doc_no', btrim(coalesce(p ->> 'buyerName', '')));
  else
    if public._uuid(p ->> 'piId') is distinct from v_row.ref_id then
      perform public._fail(400, 'This draft belongs to a different proforma.');
    end if;
    v_out := public.save_shipment(p - 'id' - 'expectedUpdatedAt');
  end if;

  update public.drafts set deleted_at = now(), deleted_by = auth.uid(), updated_at = now() where id = v_row.id;
  perform public._audit('Draft raised', 'draft', v_row.id::text,
    v_row.kind || ' — ' || v_row.title || ' → ' || coalesce(v_out ->> 'doc_no', ''), null, null);
  return v_out;
end;
$$;

-- ------------------------------------------------------------------ gates
do $$
declare
  bad text;
  f   text;
begin
  -- 1. The table still gives signed-in users SELECT and nothing else, with no
  --    write policy, and the read policy covers all three kinds by their grant.
  select string_agg(priv, ', ') into bad
  from unnest(array['insert', 'update', 'delete', 'truncate']) priv
  where has_table_privilege('authenticated', 'public.drafts', priv);
  if bad is not null then raise exception 'db/017: signed-in users can write drafts directly: %', bad; end if;
  select string_agg(policyname, ', ') into bad from pg_policies
  where schemaname = 'public' and tablename = 'drafts' and cmd <> 'SELECT';
  if bad is not null then raise exception 'db/017: write policy on drafts: %', bad; end if;
  select qual into bad from pg_policies where schemaname = 'public' and tablename = 'drafts' and policyname = 'drafts_read';
  if bad not like '%''party''%has_access(''parties''%' or bad not like '%''proforma''%' or bad not like '%''shipment''%' then
    raise exception 'db/017: the read policy does not cover all three kinds: %', bad;
  end if;

  -- 2. Every draft function maps a party draft to the parties grant — never to
  --    another section's — and still checks the caller.
  foreach f in array array['public.save_draft(jsonb)', 'public.delete_draft(uuid)', 'public.raise_from_draft(uuid, jsonb)'] loop
    if pg_get_functiondef(f::regprocedure) not like '%when ''party'' then ''parties''%' then
      raise exception 'db/017: % does not send a party draft to the parties grant', f;
    end if;
    if has_function_privilege('anon', f::regprocedure, 'execute')
       or not has_function_privilege('authenticated', f::regprocedure, 'execute') then
      raise exception 'db/017: % has the wrong grants', f;
    end if;
  end loop;

  -- 3. A party is created from its draft by the function that creates any
  --    party, and can only be created — never an edit of an existing one.
  if pg_get_functiondef('public.raise_from_draft(uuid, jsonb)'::regprocedure) not like '%public.save_party(p - ''id'')%' then
    raise exception 'db/017: raise_from_draft does not create the party through save_party';
  end if;
  if pg_get_functiondef('public.raise_from_draft(uuid, jsonb)'::regprocedure) not like '%public.save_proforma(p - ''id'' - ''expectedUpdatedAt'')%'
     or pg_get_functiondef('public.raise_from_draft(uuid, jsonb)'::regprocedure) not like '%public.save_shipment(p - ''id'' - ''expectedUpdatedAt'')%' then
    raise exception 'db/017: raise_from_draft lost its proforma or shipment path';
  end if;

  -- 4. Nothing callable without signing in; every definer function a
  --    signed-in user can call still checks the caller in its own body.
  with fns as materialized (
    select p.oid, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  )
  select string_agg(x.oid::regprocedure::text, ', ') into bad from fns x
  where has_function_privilege('anon', x.oid, 'execute')
     or (x.prosecdef and has_function_privilege('authenticated', x.oid, 'execute')
         and pg_get_functiondef(x.oid) !~ '(has_access\(|is_admin\(|auth\.uid\(\))');
  if bad is not null then raise exception 'db/017: function open or unguarded: %', bad; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (17, 'party_drafts') on conflict (id) do nothing;

select 'db/017 ✓ a party can be saved as a draft; read and written by the parties grant' as status;
