-- db/014 — a proforma can be edited; the company profile stops carrying IFSC.
--
-- 1. EDIT A PROFORMA. One function now raises a proforma and edits one:
--    save_proforma. It is the db/013 create_proforma — same checks, same
--    arithmetic, written once — plus an edit path taken when `id` is sent:
--      · only an OPEN proforma can be edited. Once a shipment has been invoiced
--        against it, it is a record of what was invoiced and stays as it is;
--      · the edit must come from the version that was opened (expectedUpdatedAt),
--        so two people editing at once cannot silently overwrite each other;
--      · a proforma with a shipment draft against it cannot be edited until
--        that draft is discarded — the draft was filled in from the old lines;
--      · the number can be changed, under the same rule as before (present,
--        plain characters, not used by any other proforma);
--      · the date it was raised, and who raised it, are not changed by an edit.
--    The audit row keeps the proforma as it was and as it is now.
--
--    create_proforma stays as a thin entry point for a browser tab still
--    running an older copy of the console; raise_from_draft now calls
--    save_proforma. Neither can reach the edit path.
--
-- 2. NO IFSC. On the owner's instruction the IFSC code is gone from the
--    company profile and every document. save_company no longer reads or
--    writes it. The COLUMN stays for now, untouched: the client on production
--    today still reads it, and create_shipment still copies it into its
--    snapshot. Both go when that client is retired (OPEN_ITEMS).

-- ------------------------------------------------- raise or edit a proforma
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
  if exists (select 1 from public.proformas where upper(btrim(doc_no)) = upper(v_no) and id is distinct from v_id) then
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

-- An older tab still calls this to raise a proforma. It can only create.
create or replace function public.create_proforma(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_access('proforma') then perform public._fail(403, 'You do not have access to proforma.'); end if;
  return public.save_proforma(p - 'id' - 'expectedUpdatedAt');
end;
$$;

-- db/012's function, calling save_proforma. A draft always creates.
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
    v_out := public.save_proforma(p - 'id' - 'expectedUpdatedAt');
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

-- ---------------------------------------------------------------- company
-- db/009's function without the IFSC line.
create or replace function public.save_company(p jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if not public.has_access('company') then perform public._fail(403, 'You do not have access to the company profile.'); end if;
  select to_jsonb(c) into v_before from public.company_profile c where c.id = 1 for update;
  update public.company_profile set
    name = coalesce(p ->> 'name', ''), address = coalesce(p ->> 'address', ''),
    bank_name = coalesce(p ->> 'bankName', ''), account_no = coalesce(p ->> 'accountNo', ''),
    swift = coalesce(p ->> 'swift', ''),
    gst_no = coalesce(p ->> 'gstNo', ''), iec_code = coalesce(p ->> 'iecCode', ''),
    updated_at = now()
  where id = 1
  returning to_jsonb(company_profile) into v_after;
  perform public._audit('Company profile edited', 'company', '1', coalesce(p ->> 'name', ''), v_before, v_after);
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
  -- 1. save_proforma: signed-in only, checks the caller itself, keeps the
  --    number rule, and its edit path refuses an invoiced proforma.
  if has_function_privilege('anon', 'public.save_proforma(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_proforma(jsonb)', 'execute') then
    raise exception 'db/014: save_proforma has the wrong grants';
  end if;
  if def not like '%has_access(''proforma'')%' then raise exception 'db/014: save_proforma has no access check'; end if;
  if def not like '%id is distinct from v_id%' then raise exception 'db/014: the number check does not exclude the proforma being edited'; end if;
  if def not like '%v_old.shipment_id is not null%' then raise exception 'db/014: an invoiced proforma is not protected from editing'; end if;
  if def like '%_alloc_doc_no%' then raise exception 'db/014: save_proforma allocates a number'; end if;

  -- 2. The two entry points that must only ever create both strip the id.
  select string_agg(f, ', ') into bad
  from unnest(array['public.create_proforma(jsonb)', 'public.raise_from_draft(uuid, jsonb)']) f
  where pg_get_functiondef(f::regprocedure) not like '%public.save_proforma(p - ''id'' - ''expectedUpdatedAt'')%';
  if bad is not null then raise exception 'db/014: can reach the edit path: %', bad; end if;

  -- 3. Nothing callable without signing in; every definer function a
  --    signed-in user can call still checks the caller in its own body.
  with fns as materialized (
    select p.oid, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  )
  select string_agg(f.oid::regprocedure::text, ', ') into bad from fns f
  where has_function_privilege('anon', f.oid, 'execute')
     or (f.prosecdef and has_function_privilege('authenticated', f.oid, 'execute')
         and pg_get_functiondef(f.oid) !~ '(has_access\(|is_admin\(|auth\.uid\(\))');
  if bad is not null then raise exception 'db/014: function open or unguarded: %', bad; end if;

  -- 4. save_company no longer touches IFSC; the column is still there for the
  --    client that is live today.
  if pg_get_functiondef('public.save_company(jsonb)'::regprocedure) ilike '%ifsc%' then
    raise exception 'db/014: save_company still handles IFSC';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'company_profile' and column_name = 'ifsc') then
    raise exception 'db/014: the ifsc column is gone — the live client still reads it';
  end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (14, 'edit_proforma_and_no_ifsc') on conflict (id) do nothing;

select 'db/014 ✓ proformas can be edited while open; IFSC no longer read or written' as status;
