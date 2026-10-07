-- db/016 — a shipment can be edited; its company block carries the full bank details.
--
-- 1. EDIT A SHIPMENT. One function now invoices a shipment and edits one:
--    save_shipment. It is create_shipment as it stood (db/009, guard repointed
--    by db/010) — same checks, same arithmetic, written once — plus an edit
--    path taken when `id` is sent. An edit:
--      · must come from the version that was opened (expectedUpdatedAt), so two
--        people editing at once cannot silently overwrite each other;
--      · recomputes every total with the same code that computed them first,
--        from the proforma the shipment was raised against;
--      · does NOT change the invoice numbers, the invoice date, the proforma it
--        is against, the buyer copied from that proforma, who raised it, or the
--        company block as it stood when the set was generated;
--      · is recorded in the audit log with the shipment as it was and as it is.
--
--    create_shipment stays as a thin entry point for a browser tab still
--    running an older copy of the console; raise_from_draft now calls
--    save_shipment. Neither can reach the edit path.
--
-- 2. THE COMPANY BLOCK copied onto a new shipment now includes the account
--    name and the branch (db/015), so the shipment's documents can print the
--    full bank details for a transfer, and no longer includes IFSC (removed in
--    db/014). Shipments invoiced before this keep the block they were given.
--
-- Additive: one new function, three replaced. The client on production today
-- inserts shipments directly and calls none of them.

-- ------------------------------------------------ invoice or edit a shipment
create or replace function public.save_shipment(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_pi       public.proformas;
  v_items    jsonb   := coalesce(p -> 'items', '[]'::jsonb);
  v_freight  numeric := public._num(p ->> 'freight', 'Freight');
  v_other    numeric := public._num(p ->> 'otherAdj', 'Other charge');
  v_gst_pct  numeric := public._num(p ->> 'gstPercent', 'GST %');
  v_round    numeric := public._num(p ->> 'roundOff', 'Round off');
  v_exch     numeric := public._num(p ->> 'exchangeRate', 'Exchange rate');
  v_com_cur  text;
  v_intl     boolean;
  v_boxes    numeric; v_packs numeric; v_net numeric; v_gross numeric;
  v_base     numeric; v_doc_total numeric; v_inr_total numeric; v_gst numeric; v_com_total numeric;
  v_company  jsonb;
  v_no       text;
  v_row      public.shipments;
  v_id       uuid    := public._uuid(p ->> 'id');
  v_old      public.shipments;
  v_tax_doc  jsonb;
  v_com_doc  jsonb;
  v_pack     jsonb;
begin
  if not public.has_access('shipments') then perform public._fail(403, 'You do not have access to shipments.'); end if;

  if v_id is not null then
    -- Editing: the shipment as it stands, from the version that was opened,
    -- and the proforma it was raised against (which no longer changes).
    select * into v_old from public.shipments where id = v_id and deleted_at is null for update;
    if not found then perform public._fail(404, 'That shipment no longer exists.'); end if;
    if nullif(p ->> 'expectedUpdatedAt', '') is not null
       and v_old.updated_at <> (p ->> 'expectedUpdatedAt')::timestamptz then
      perform public._fail(409, 'Someone else changed this shipment since you opened it. Reload to see their version.');
    end if;
    select * into v_pi from public.proformas where id = v_old.proforma_id;
    if not found then
      perform public._fail(409, 'The proforma this shipment was raised against is missing, so it cannot be recalculated.');
    end if;
  else
    -- The row lock is what stops two people invoicing the same proforma at once.
    select * into v_pi from public.proformas
    where id = public._uuid(p ->> 'piId') and deleted_at is null for update;
    if not found then perform public._fail(404, 'That proforma no longer exists.'); end if;
    if v_pi.shipment_id is not null then
      perform public._fail(409, v_pi.doc_no || ' has already been invoiced. Reload to see it.');
    end if;
  end if;

  perform public._check_lines(v_items, 'name');
  v_intl := v_pi.type = 'international';

  select coalesce(sum(public._num(e ->> 'boxQty', 'Box quantity')), 0),
         coalesce(sum(public._num(e ->> 'boxQty') * public._num(e ->> 'packsPerBox', 'Packs per box')), 0),
         coalesce(sum(public._num(e ->> 'boxQty') * public._num(e ->> 'netWt', 'Net weight')), 0),
         coalesce(sum(public._num(e ->> 'boxQty') * public._num(e ->> 'grossWt', 'Gross weight')), 0),
         coalesce(sum(public._num(e ->> 'boxQty') *
           public._num(case when v_intl then e ->> 'rate' else e ->> 'mrp' end, 'Rate')), 0)
    into v_boxes, v_packs, v_net, v_gross, v_base
  from jsonb_array_elements(v_items) e;
  if v_boxes <= 0 then perform public._fail(400, 'Enter the stuffed box quantity on at least one line.'); end if;

  if v_other <> 0 and btrim(coalesce(p ->> 'otherReason', '')) = '' then
    perform public._fail(400, 'Give a reason for the other charge or deduction.');
  end if;

  if v_pi.currency = 'INR' then
    v_exch := 1;
  elsif v_exch <= 0 then
    perform public._fail(400, 'Enter the exchange rate — the tax invoice is in INR and this proforma is in ' || v_pi.currency || '.');
  end if;

  v_com_cur := coalesce(nullif(p ->> 'commercialCurrency', ''), v_pi.currency);
  if v_com_cur not in ('USD', 'INR') then perform public._fail(400, 'Commercial invoice currency must be USD or INR.'); end if;

  v_doc_total := round(v_base + v_freight + v_other, 2);
  v_inr_total := round(v_doc_total * v_exch, 2);
  v_gst       := round(v_inr_total * v_gst_pct / 100, 2);
  v_com_total := case
    when v_com_cur = v_pi.currency then v_doc_total
    when v_com_cur = 'INR'         then v_inr_total
    else round(v_doc_total / v_exch, 2)
  end;

  -- The company block is read here, not sent by the browser, so a user without
  -- access to the company profile still produces a correct invoice.
  select jsonb_build_object('name', c.name, 'address', c.address, 'bankName', c.bank_name,
           'accountName', c.account_name, 'bankBranch', c.bank_branch,
           'accountNo', c.account_no, 'swift', c.swift, 'gstNo', c.gst_no, 'iecCode', c.iec_code)
    into v_company from public.company_profile c where c.id = 1;

  -- The three document blocks are worked out once, for invoicing and editing alike.
  v_tax_doc := jsonb_build_object('consignee', coalesce(nullif(btrim(p ->> 'taxConsignee'), ''), 'TO THE ORDER'),
      'currency', 'INR', 'total', v_inr_total, 'gst', v_gst, 'roundOff', v_round,
      'grandTotal', v_inr_total + v_gst + v_round);
  v_com_doc := jsonb_build_object('consignee', coalesce(nullif(btrim(p ->> 'commercialConsignee'), ''), v_pi.consignee_name),
      'currency', v_com_cur, 'total', v_com_total);
  v_pack    := jsonb_build_object('totalBoxes', v_boxes, 'totalPacks', v_packs, 'netWeight', v_net,
      'grossWeight', v_gross, 'grandTotal', v_net + v_gross);

  if v_id is not null then
    -- The invoice numbers, the invoice date, the proforma it is against, the
    -- buyer copied from it, who raised it and the company block as it stood
    -- when the set was generated are not changed by an edit.
    update public.shipments set
      exchange_rate = v_exch,
      container_no = coalesce(p ->> 'containerNo', ''), vehicle_no = coalesce(p ->> 'vehicleNo', ''),
      customs_seal = coalesce(p ->> 'customSeal', ''), line_seal = coalesce(p ->> 'lineSeal', ''),
      port_of_loading = coalesce(nullif(p ->> 'portOfLoading', ''), v_pi.port_of_loading),
      incoterm = coalesce(nullif(p ->> 'incoterm', ''), v_pi.shipment_term),
      gst_percent = v_gst_pct, round_off = v_round, freight = v_freight, other_adjustment = v_other,
      other_reason = coalesce(p ->> 'otherReason', ''),
      tax_invoice = v_tax_doc, commercial_invoice = v_com_doc, packing_list = v_pack,
      items = v_items, updated_at = now()
    where id = v_id
    returning * into v_row;
    perform public._audit('Shipment edited', 'shipment', v_row.id::text,
      v_row.doc_no || ' against ' || v_pi.doc_no || ' — ' || v_pi.buyer_name, to_jsonb(v_old), to_jsonb(v_row));
    return jsonb_build_object('id', v_row.id, 'doc_no', v_row.doc_no);
  end if;

  v_no := public._alloc_doc_no('final');

  insert into public.shipments (doc_no, tax_doc_no, commercial_doc_no, doc_date, proforma_id, proforma_no,
    proforma_date, buyer_name, buyer_address, order_no, order_date, exchange_rate, container_no, vehicle_no,
    customs_seal, line_seal, port_of_loading, incoterm, gst_percent, round_off, freight, other_adjustment,
    other_reason, tax_invoice, commercial_invoice, packing_list, company_snapshot, items, created_by)
  values (v_no, v_no || '-TAX', v_no || '-COM', public.ist_today(), v_pi.id, v_pi.doc_no, v_pi.doc_date,
    v_pi.buyer_name, v_pi.buyer_address, v_pi.order_no, v_pi.order_date, v_exch,
    coalesce(p ->> 'containerNo', ''), coalesce(p ->> 'vehicleNo', ''), coalesce(p ->> 'customSeal', ''),
    coalesce(p ->> 'lineSeal', ''), coalesce(nullif(p ->> 'portOfLoading', ''), v_pi.port_of_loading),
    coalesce(nullif(p ->> 'incoterm', ''), v_pi.shipment_term), v_gst_pct, v_round, v_freight, v_other,
    coalesce(p ->> 'otherReason', ''),
    v_tax_doc, v_com_doc, v_pack,
    coalesce(v_company, '{}'::jsonb), v_items, auth.uid())
  returning * into v_row;

  update public.proformas set shipment_id = v_row.id, updated_at = now() where id = v_pi.id;

  perform public._audit('Shipment invoiced', 'shipment', v_row.id::text,
    v_no || ' against ' || v_pi.doc_no || ' — ' || v_pi.buyer_name, null, to_jsonb(v_row));
  return jsonb_build_object('id', v_row.id, 'doc_no', v_no);
end;
$$;

-- An older tab still calls this to invoice a shipment. It can only create.
create or replace function public.create_shipment(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_access('shipments') then perform public._fail(403, 'You do not have access to shipments.'); end if;
  return public.save_shipment(p - 'id' - 'expectedUpdatedAt');
end;
$$;

-- db/014's function, calling save_shipment. A draft always creates.
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
    v_out := public.save_shipment(p - 'id' - 'expectedUpdatedAt');
  end if;

  update public.drafts set deleted_at = now(), deleted_by = auth.uid(), updated_at = now() where id = v_row.id;
  perform public._audit('Draft raised', 'draft', v_row.id::text,
    v_row.kind || ' — ' || v_row.title || ' → ' || coalesce(v_out ->> 'doc_no', ''), null, null);
  return v_out;
end;
$$;

do $$
begin
  execute 'revoke all on function public.save_shipment(jsonb) from anon, public';
  execute 'grant execute on function public.save_shipment(jsonb) to authenticated, service_role';
end $$;

-- ------------------------------------------------------------------ gates
do $$
declare
  bad text;
  def text := pg_get_functiondef('public.save_shipment(jsonb)'::regprocedure);
begin
  -- 1. save_shipment: signed-in only, checks the caller itself, and an edit
  --    cannot move the numbers, the date or the company block.
  if has_function_privilege('anon', 'public.save_shipment(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_shipment(jsonb)', 'execute') then
    raise exception 'db/016: save_shipment has the wrong grants';
  end if;
  if def not like '%has_access(''shipments'')%' then raise exception 'db/016: save_shipment has no access check'; end if;
  if def not like '%v_old.updated_at <>%' then raise exception 'db/016: an edit is not checked against the version that was opened'; end if;
  if def ~ 'update public\.shipments set[^;]*(doc_no|doc_date|company_snapshot|proforma_id|created_by)\s*=' then
    raise exception 'db/016: an edit would change something that must stay as issued';
  end if;

  -- 2. The company block carries the transfer details and no IFSC.
  if def not like '%''accountName'', c.account_name%' or def not like '%''bankBranch'', c.bank_branch%' then
    raise exception 'db/016: the company block is missing account name or branch';
  end if;
  if def ilike '%ifsc%' then raise exception 'db/016: the company block still copies IFSC'; end if;

  -- 3. The two entry points that must only ever create both strip the id.
  select string_agg(f, ', ') into bad
  from unnest(array['public.create_shipment(jsonb)', 'public.raise_from_draft(uuid, jsonb)']) f
  where pg_get_functiondef(f::regprocedure) not like '%public.save_shipment(p - ''id'' - ''expectedUpdatedAt'')%';
  if bad is not null then raise exception 'db/016: can reach the edit path: %', bad; end if;
  if pg_get_functiondef('public.raise_from_draft(uuid, jsonb)'::regprocedure)
       not like '%public.save_proforma(p - ''id'' - ''expectedUpdatedAt'')%' then
    raise exception 'db/016: raise_from_draft lost its proforma path';
  end if;

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
  if bad is not null then raise exception 'db/016: function open or unguarded: %', bad; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (16, 'edit_shipment') on conflict (id) do nothing;

select 'db/016 ✓ shipments can be edited; new shipments carry the full bank block' as status;
