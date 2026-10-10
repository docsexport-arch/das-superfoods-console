-- db/027 — a proforma's date can be typed.
--
-- On the owner's instruction: a Date box beside the proforma number.
--
--   · save_proforma reads docDate. On a new proforma it is the date typed, or
--     today (IST) when none is sent. On an edit it is the date typed, or the
--     date the proforma already has when none is sent — so a copy of the
--     console that does not know about this (an older tab) changes nothing.
--   · Until now the date was always the day the proforma was raised and an
--     edit never moved it. An edit can now move it, on purpose; the audit row
--     keeps the proforma as it was.
--   · A date outside 2000–2100 is refused as a slip of the keyboard.
--
-- Nothing else about a proforma changes. A proforma typed by hand, without a
-- party from the master (decisions/035), needs nothing new here: party_id was
-- always allowed to be empty, and every detail printed on a proforma is stored
-- on the proforma itself.

-- db/022's function plus the typed date; everything else is unchanged.
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
  v_date    date  := public._date(p ->> 'docDate', 'Proforma date');
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
  -- The date can be typed (db/027). Left empty: today on a new proforma, unchanged on an edit.
  if v_date is not null and (v_date < date '2000-01-01' or v_date > date '2100-12-31') then
    perform public._fail(400, 'Check the proforma date — the year looks wrong.');
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
    -- Who raised it is not changed by an edit; the date changes only when one is sent.
    update public.proformas set
      doc_date = coalesce(v_date, doc_date),
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
    coalesce(v_date, public.ist_today()), v_type, v_party, coalesce(p ->> 'quotationRef', ''), v_buyer,
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

do $$
begin
  execute 'revoke all on function public.save_proforma(jsonb) from anon, public';
  execute 'grant execute on function public.save_proforma(jsonb) to authenticated, service_role';
end $$;

-- ------------------------------------------------------------------ gates
do $$
declare
  bad text;
  def text := pg_get_functiondef('public.save_proforma(jsonb)'::regprocedure);
begin
  -- 1. The date is read, used on a new proforma, and kept on an edit that sends none.
  if def not like '%public._date(p ->> ''docDate'', ''Proforma date'')%' then raise exception 'db/027: save_proforma does not read the date'; end if;
  if def not like '%coalesce(v_date, public.ist_today())%' then raise exception 'db/027: a new proforma with no date is not dated today'; end if;
  if def not like '%doc_date = coalesce(v_date, doc_date)%' then raise exception 'db/027: an edit that sends no date would change it'; end if;

  -- 2. Nothing it had was lost: access, the typed number and its rule, the
  --    invoiced rule, the 409, the draft rule, the arithmetic.
  if def not like '%has_access(''proforma'')%' then raise exception 'db/027: save_proforma lost its access check'; end if;
  if def not like '%upper(btrim(doc_no)) = upper(v_no) and id is distinct from v_id and deleted_at is null%'
     or def not like '%v_old.shipment_id is not null%' or def not like '%expectedUpdatedAt%'
     or def not like '%kind = ''shipment'' and ref_id = v_id%' or def like '%_alloc_doc_no%'
     or def not like '%round(v_taxable * v_rate / 100, 2)%' then
    raise exception 'db/027: save_proforma lost a rule it had';
  end if;
  if has_function_privilege('anon', 'public.save_proforma(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_proforma(jsonb)', 'execute') then
    raise exception 'db/027: save_proforma has the wrong grants';
  end if;

  -- 3. The two entry points that must only ever create still strip the id.
  select string_agg(f, ', ') into bad
  from unnest(array['public.create_proforma(jsonb)', 'public.raise_from_draft(uuid, jsonb)']) f
  where pg_get_functiondef(f::regprocedure) not like '%public.save_proforma(p - ''id'' - ''expectedUpdatedAt'')%';
  if bad is not null then raise exception 'db/027: can reach the edit path: %', bad; end if;

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
  if bad is not null then raise exception 'db/027: function open or unguarded: %', bad; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (27, 'proforma_date') on conflict (id) do nothing;

select 'db/027 ✓ a proforma''s date can be typed' as status;
