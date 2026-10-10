-- db/026 — an invoiced proforma can be deleted, together with its shipment.
--
-- On the owner's instruction: Delete on a proforma that has been invoiced.
--
-- db/022 refused it, because the shipment raised against the proforma points
-- at it. That is still the difficulty: a shipment's three documents are drawn
-- from the shipment AND its proforma (the pricing basis and the currency live
-- there), so a shipment left behind without its proforma could not be opened,
-- downloaded or edited. So the two go together, or not at all:
--
--   · the caller must say so — p_with_shipment — or the delete is refused with
--     a message that says what it would take. A copy of the console that does
--     not know about this (an older tab) therefore cannot do it by accident;
--   · the caller must hold Shipments as well as Proforma;
--   · both rows are retired, not removed (deleted_at / deleted_by), and each
--     gets its own audit row holding the whole record as it was;
--   · an OPEN proforma is deleted exactly as before.
--
-- The shipment's invoice numbers are not handed out again: the series only
-- moves forward, so a deleted shipment leaves a gap in it.

drop function if exists public.delete_proforma(uuid);

-- db/022's function with the refusal replaced by the paired delete.
create or replace function public.delete_proforma(p_id uuid, p_with_shipment boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row   public.proformas;
  v_ship  public.shipments;
  v_other text;
begin
  if not public.has_access('proforma') then perform public._fail(403, 'You do not have access to proforma.'); end if;
  select * into v_row from public.proformas where id = p_id and deleted_at is null for update;
  if not found then perform public._fail(404, 'That proforma no longer exists.'); end if;
  if v_row.shipment_id is not null then
    -- Invoiced: the proforma and the shipment raised against it go together,
    -- or not at all — a shipment cannot be read without its proforma. The
    -- caller must say so, and must hold Shipments as well.
    if not coalesce(p_with_shipment, false) then
      perform public._fail(409, v_row.doc_no || ' has been invoiced. Deleting it also deletes the shipment raised against it — reload the page to be asked.');
    end if;
    if not public.has_access('shipments') then
      perform public._fail(403, v_row.doc_no || ' has been invoiced. Deleting it also deletes its shipment, which needs access to Shipments.');
    end if;
    select * into v_ship from public.shipments where id = v_row.shipment_id and deleted_at is null for update;
    if found then
      update public.shipments set deleted_at = now(), deleted_by = auth.uid(), updated_at = now() where id = v_ship.id;
      perform public._audit('Shipment deleted', 'shipment', v_ship.id::text,
        v_ship.doc_no || ' — ' || v_ship.buyer_name || ' (with proforma ' || v_row.doc_no || ')', to_jsonb(v_ship), null);
    end if;
  end if;
  -- A shipment draft was started from this proforma; it would point at nothing.
  select saved_by into v_other from public.drafts
  where kind = 'shipment' and ref_id = p_id and deleted_at is null;
  if found then
    perform public._fail(409, 'A shipment draft exists for this proforma (saved by ' || v_other || '). Discard that draft before deleting the proforma.');
  end if;
  update public.proformas set deleted_at = now(), deleted_by = auth.uid(), updated_at = now() where id = p_id;
  perform public._audit('Proforma deleted', 'proforma', p_id::text,
    v_row.doc_no || ' — ' || v_row.buyer_name, to_jsonb(v_row), null);
end;
$$;

do $$
begin
  execute 'revoke all on function public.delete_proforma(uuid, boolean) from anon, public';
  execute 'grant execute on function public.delete_proforma(uuid, boolean) to authenticated, service_role';
end $$;

-- ------------------------------------------------------------------ gates
do $$
declare
  bad text;
  def text := pg_get_functiondef('public.delete_proforma(uuid, boolean)'::regprocedure);
begin
  -- 1. One delete_proforma, signed-in only, checking the caller itself.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'delete_proforma') <> 1 then
    raise exception 'db/026: there must be exactly one delete_proforma';
  end if;
  if has_function_privilege('anon', 'public.delete_proforma(uuid, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_proforma(uuid, boolean)', 'execute') then
    raise exception 'db/026: delete_proforma has the wrong grants';
  end if;
  if def not like '%has_access(''proforma'')%' then raise exception 'db/026: delete_proforma has no access check'; end if;

  -- 2. An invoiced proforma: only when asked for, only with Shipments, and the shipment goes with it.
  if def not like '%if not coalesce(p_with_shipment, false) then%' then raise exception 'db/026: an invoiced proforma can be deleted without saying so'; end if;
  if def not like '%has_access(''shipments'')%' then raise exception 'db/026: the shipment can be deleted without access to Shipments'; end if;
  if def not like '%update public.shipments set deleted_at = now()%' then raise exception 'db/026: the shipment would be left without its proforma'; end if;
  if def not like '%_audit(''Shipment deleted''%' or def not like '%_audit(''Proforma deleted''%' then
    raise exception 'db/026: a deletion leaves no audit row';
  end if;

  -- 3. Retired, never removed; a shipment draft still blocks it.
  if def ~* 'delete\s+from' then raise exception 'db/026: delete_proforma removes a row'; end if;
  if def not like '%kind = ''shipment'' and ref_id = p_id%' then raise exception 'db/026: a shipment draft would be orphaned'; end if;

  -- 4. Nothing callable without signing in; every definer function a
  --    signed-in user can call still checks the caller in its own body.
  with fns as materialized (
    select p.oid, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  )
  select string_agg(f.oid::regprocedure::text, ', ') into bad from fns f
  where has_function_privilege('anon', f.oid, 'execute')
     or (f.prosecdef and has_function_privilege('authenticated', f.oid, 'execute')
         and pg_get_functiondef(f.oid) !~ '(has_access\(|is_admin\(|auth\.uid\(\))');
  if bad is not null then raise exception 'db/026: function open or unguarded: %', bad; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (26, 'delete_invoiced_proforma') on conflict (id) do nothing;

select 'db/026 ✓ an invoiced proforma is deleted together with its shipment, when asked for' as status;
