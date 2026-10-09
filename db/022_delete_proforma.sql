-- db/022 — a proforma can be deleted.
--
-- 1. DELETE A PROFORMA. delete_proforma(p_id) retires an OPEN proforma:
--      · only someone who holds the proforma grant;
--      · never one a shipment has been invoiced against — that proforma is the
--        record of what was invoiced, and the shipment points at it;
--      · never one with a shipment draft against it, until that draft is
--        discarded — the same rule as editing (db/014), so nobody's half-made
--        shipment is left pointing at nothing;
--      · the row is retired, not removed (deleted_at / deleted_by, db/008), and
--        the audit row keeps the whole proforma as it was.
--
-- 2. ITS NUMBER COMES FREE. Proforma numbers are typed by hand (db/013) and no
--    two proformas may share one. A deleted proforma no longer counts: both
--    the check in save_proforma and the unique index behind it now look at
--    live proformas only, so a proforma raised by mistake can be deleted and
--    raised again under the same number.

-- ------------------------------------------------------ delete a proforma
create or replace function public.delete_proforma(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row   public.proformas;
  v_other text;
begin
  if not public.has_access('proforma') then perform public._fail(403, 'You do not have access to proforma.'); end if;
  select * into v_row from public.proformas where id = p_id and deleted_at is null for update;
  if not found then perform public._fail(404, 'That proforma no longer exists.'); end if;
  if v_row.shipment_id is not null then
    perform public._fail(409, v_row.doc_no || ' has already been invoiced, so it can no longer be deleted.');
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
  execute 'revoke all on function public.delete_proforma(uuid) from anon, public';
  execute 'grant execute on function public.delete_proforma(uuid) to authenticated, service_role';
end $$;

-- ------------------------------------- the number of a deleted proforma is free
-- db/014's function with one change: the number check skips deleted proformas.
create or replace function public.save_proforma(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_type    text  := coalesce(p ->> 'type', '');
  v_items   jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_buyer   text  := btrim(coalesce(p ->> 'buyerName', ''));
  v_party   uuid  := public._uuid(p ->> 'partyId');
  v_no      text  := btrim(coalesce(p ->> 'docNo', ''));
  v_id      uuid  := public._uuid(p ->> 'id');
  v_old     public.proformas;
  v_other   text;
  v_intl    boolean;
  v_boxes   numeric;
  v_total   numeric;
  v_taxable numeric;
  v_rate    numeric;
  v_tax     numeric;
  v_opts    text[];
  v_row     public.proformas;
begin
  if not public.has_access('proforma') then perform public._fail(403, 'You do not have access to proforma.'); end if;
  if v_type not in ('international', 'domestic') then perform public._fail(400, 'Proforma type must be international or domestic.'); end if;
  if v_buyer = '' then perform public._fail(400, 'A proforma needs a buyer.'); end if;
  -- Editing: only an open proforma, and only from the version that was opened.
  if v_id is not null then
    select * into v_old from public.proformas where id = v_id and deleted_at is null for update;
    if not found then perform public._fail(404, 'That proforma no longer exists.'); end if;
    if v_old.shipment_id is not null then
      perform public._fail(409, v_old.doc_no || ' has already been invoiced, so it can no longer be edited.');
    end if;
    if v_old.type <> v_type then
      perform public._fail(400, 'A proforma cannot change between international and private label.');
    end if;
    if nullif(p ->> 'expectedUpdatedAt', '') is not null
       and v_old.updated_at <> (p ->> 'expectedUpdatedAt')::timestamptz then
      perform public._fail(409, 'Someone else changed this proforma since you opened it. Reload to see their version.');
    end if;
    -- A shipment draft was filled in from the lines as they were.
    select saved_by into v_other from public.drafts
    where kind = 'shipment' and ref_id = v_id and deleted_at is null;
    if found then
      perform public._fail(409, 'A shipment draft exists for this proforma (saved by ' || v_other || '). Discard that draft before editing the proforma.');
    end if;
  end if;
  -- The number is typed by hand, so this function is what keeps it sound.
  if v_no = '' then
    perform public._fail(400, 'Enter the proforma number. If you cannot see a box for it, reload the page.');
  end if;
  if length(v_no) > 40 or v_no !~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]*$' then
    perform public._fail(400, 'A proforma number can use letters, digits, spaces and . / _ - only, up to 40 characters.');
  end if;
  -- A deleted proforma no longer holds its number (db/022).
  if exists (select 1 from public.proformas where upper(btrim(doc_no)) = upper(v_no) and id is distinct from v_id and deleted_at is null) then
    perform public._fail(409, 'Proforma number ' || v_no || ' is already in use. Type a different number.');
  end if;
  perform public._check_lines(v_items, 'name');
  if v_party is not null and not exists (select 1 from public.parties where id = v_party) then v_party := null; end if;
  v_intl := v_type = 'international';

  select coalesce(sum(public._num(e ->> 'boxQty', 'Box quantity')), 0),
         round(coalesce(sum(public._num(e ->> 'boxQty') * public._num(e ->> 'rate', 'Rate')), 0), 2),
         round(coalesce(sum(public._num(e ->> 'boxQty') * public._num(e ->> 'mrp', 'MRP')), 0), 2)
    into v_boxes, v_total, v_taxable
  from jsonb_array_elements(v_items) e;
  if v_boxes <= 0 then perform public._fail(400, 'Enter a box quantity on at least one line.'); end if;

  v_rate := case when v_intl then 0 else public._num(p ->> 'taxRate', 'Tax rate') end;
  v_tax  := case when v_intl then 0 else round(v_taxable * v_rate / 100, 2) end;

  select coalesce(array_agg(distinct btrim(x)), '{}') into v_opts
  from jsonb_array_elements_text(
    case when jsonb_typeof(p -> 'consigneeOptions') = 'array' then p -> 'consigneeOptions' else '[]'::jsonb end) x
  where btrim(x) <> '';

  if v_id is not null then
    -- The date it was raised and who raised it are not changed by an edit.
    update public.proformas set
      doc_no = v_no, party_id = v_party, quotation_ref = coalesce(p ->> 'quotationRef', ''),
      buyer_name = v_buyer, buyer_address = coalesce(p ->> 'buyerAddress', ''),
      consignee_name = coalesce(p ->> 'consigneeName', ''), consignee_address = coalesce(p ->> 'consigneeAddress', ''),
      consignee_options = v_opts,
      port_of_loading = coalesce(p ->> 'portOfLoading', ''), destination_port = coalesce(p ->> 'destinationPort', ''),
      shipment_term = coalesce(p ->> 'shipmentTerm', ''), payment_term = coalesce(p ->> 'paymentTerm', ''),
      conditions = coalesce(p ->> 'conditions', ''),
      currency = coalesce(nullif(p ->> 'currency', ''), case when v_intl then 'USD' else 'INR' end),
      order_no = coalesce(p ->> 'buyerOrderNo', ''), order_date = public._date(p ->> 'buyerOrderDate', 'Order date'),
      additional_details = coalesce(p ->> 'additionalDetails', ''),
      total_boxes = v_boxes::int, total_value = v_total, taxable_value = v_taxable,
      tax_rate = v_rate, tax_amount = v_tax,
      grand_total = case when v_intl then v_total else v_taxable + v_tax end,
      items = v_items, updated_at = now()
    where id = v_id
    returning * into v_row;
    perform public._audit('Proforma edited', 'proforma', v_row.id::text,
      v_row.doc_no || ' — ' || v_buyer, to_jsonb(v_old), to_jsonb(v_row));
    return jsonb_build_object('id', v_row.id, 'doc_no', v_row.doc_no);
  end if;

  insert into public.proformas (doc_no, doc_date, type, party_id, quotation_ref, buyer_name, buyer_address,
    consignee_name, consignee_address, consignee_options, port_of_loading, destination_port,
    shipment_term, payment_term, conditions, currency, order_no, order_date, additional_details,
    total_boxes, total_value, taxable_value, tax_rate, tax_amount, grand_total, items, created_by)
  values (
    v_no,
    public.ist_today(), v_type, v_party, coalesce(p ->> 'quotationRef', ''), v_buyer,
    coalesce(p ->> 'buyerAddress', ''), coalesce(p ->> 'consigneeName', ''), coalesce(p ->> 'consigneeAddress', ''),
    v_opts, coalesce(p ->> 'portOfLoading', ''), coalesce(p ->> 'destinationPort', ''),
    coalesce(p ->> 'shipmentTerm', ''), coalesce(p ->> 'paymentTerm', ''), coalesce(p ->> 'conditions', ''),
    coalesce(nullif(p ->> 'currency', ''), case when v_intl then 'USD' else 'INR' end),
    coalesce(p ->> 'buyerOrderNo', ''), public._date(p ->> 'buyerOrderDate', 'Order date'),
    coalesce(p ->> 'additionalDetails', ''),
    v_boxes::int, v_total, v_taxable, v_rate, v_tax,
    case when v_intl then v_total else v_taxable + v_tax end, v_items, auth.uid())
  returning * into v_row;

  perform public._audit('Proforma created', 'proforma', v_row.id::text,
    v_row.doc_no || ' — ' || v_buyer, null, to_jsonb(v_row));
  return jsonb_build_object('id', v_row.id, 'doc_no', v_row.doc_no);
end;
$$;

-- The backstop index follows the same rule. Built under a new name first, so
-- there is no moment without one.
create unique index if not exists proformas_doc_no_live_ci
  on public.proformas (upper(btrim(doc_no))) where deleted_at is null;
drop index if exists public.proformas_doc_no_ci;
-- The table was born with a plain unique rule on the number (db/001-005). It
-- counts deleted proformas too, so it goes; the index above replaces it and is
-- stricter for live ones (it ignores case and stray spaces).
alter table public.proformas drop constraint if exists proformas_doc_no_key;

-- ------------------------------------------------------------------ gates
do $$
declare
  bad text;
  def text := pg_get_functiondef('public.delete_proforma(uuid)'::regprocedure);
  sav text := pg_get_functiondef('public.save_proforma(jsonb)'::regprocedure);
begin
  -- 1. delete_proforma: signed-in only, checks the caller itself, refuses an
  --    invoiced proforma, retires rather than removes.
  if has_function_privilege('anon', 'public.delete_proforma(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_proforma(uuid)', 'execute') then
    raise exception 'db/022: delete_proforma has the wrong grants';
  end if;
  if def not like '%has_access(''proforma'')%' then raise exception 'db/022: delete_proforma has no access check'; end if;
  if def not like '%v_row.shipment_id is not null%' then raise exception 'db/022: an invoiced proforma is not protected from deletion'; end if;
  if def not like '%kind = ''shipment'' and ref_id = p_id%' then raise exception 'db/022: a shipment draft would be orphaned'; end if;
  if def ~* 'delete\s+from\s+public\.proformas' then raise exception 'db/022: delete_proforma removes the row'; end if;
  if def not like '%_audit(''Proforma deleted''%' then raise exception 'db/022: a deletion leaves no audit row'; end if;

  -- 2. save_proforma: a deleted proforma's number is free; nothing else moved.
  if sav not like '%upper(btrim(doc_no)) = upper(v_no) and id is distinct from v_id and deleted_at is null%' then
    raise exception 'db/022: the number check still counts deleted proformas';
  end if;
  if sav not like '%has_access(''proforma'')%' or sav not like '%v_old.shipment_id is not null%' or sav like '%_alloc_doc_no%' then
    raise exception 'db/022: save_proforma lost a rule it had';
  end if;
  if has_function_privilege('anon', 'public.save_proforma(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_proforma(jsonb)', 'execute') then
    raise exception 'db/022: save_proforma has the wrong grants';
  end if;

  -- 3. Exactly one uniqueness backstop, and it covers live proformas only.
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'proformas_doc_no_live_ci'
                 and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%deleted_at IS NULL%') then
    raise exception 'db/022: the unique index on live proforma numbers is missing';
  end if;
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'proformas_doc_no_ci') then
    raise exception 'db/022: the old index still blocks a deleted proforma''s number';
  end if;

  -- 3b. No other uniqueness rule on the number is left to block a reuse.
  select string_agg(i.indexname, ', ') into bad from pg_indexes i
  where i.schemaname = 'public' and i.tablename = 'proformas' and i.indexdef like 'CREATE UNIQUE INDEX%'
    and i.indexdef like '%doc_no%' and i.indexdef not like '%deleted_at IS NULL%';
  if bad is not null then raise exception 'db/022: a deleted proforma''s number is still held by: %', bad; end if;

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
  if bad is not null then raise exception 'db/022: function open or unguarded: %', bad; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (22, 'delete_proforma') on conflict (id) do nothing;

select 'db/022 ✓ an open proforma can be deleted; its number comes free' as status;
