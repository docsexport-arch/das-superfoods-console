-- db/009 — RPCs are the API (Bible §5): every write is ONE transaction.
--
-- Before this, the browser issued each step itself: "update party → delete its
-- products → insert products" and "insert shipment → mark proforma invoiced".
-- A closed tab or a second user in between left half-states — a party with no
-- products, or one proforma invoiced twice. Each function below:
--   · checks the caller from auth.uid() in its own body (never from an argument),
--   · does the business math server-side so the client cannot drift from it,
--   · allocates the document number in the same transaction as the insert,
--   · writes the audit row itself, with before/after, so it cannot be skipped.
-- Refusals leave as PT4xx classes with a human sentence; nothing here raises
-- 40001/40P01, which PostgREST would retry for ever.

-- ------------------------------------------------------------ internals
create or replace function public._fail(p_status int, p_message text)
returns void language plpgsql set search_path = public
as $$
begin
  raise exception using errcode = 'PT' || p_status::text, message = p_message;
end;
$$;

-- Empty means zero; anything else must be a number or the call is refused.
create or replace function public._num(p_value text, p_label text default 'A value')
returns numeric language plpgsql immutable set search_path = public
as $$
begin
  if p_value is null or btrim(p_value) = '' then return 0; end if;
  return btrim(p_value)::numeric;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = 'PT400', message = p_label || ' is not a number: ' || left(p_value, 40);
end;
$$;

create or replace function public._date(p_value text, p_label text default 'A date')
returns date language plpgsql immutable set search_path = public
as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return btrim(p_value)::date;
exception when others then
  raise exception using errcode = 'PT400', message = p_label || ' is not a valid date: ' || left(p_value, 40);
end;
$$;

-- A client-side temporary id is not a uuid; that is how a new row is recognised.
create or replace function public._uuid(p_value text)
returns uuid language plpgsql immutable set search_path = public
as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return btrim(p_value)::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public._party_snapshot(p_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select to_jsonb(t) || jsonb_build_object('products', coalesce((
    select jsonb_agg(to_jsonb(pp) order by pp.name, pp.id)
    from public.party_products pp where pp.party_id = t.id), '[]'::jsonb))
  from public.parties t where t.id = p_id;
$$;

-- Shared line validation for the three document types.
create or replace function public._check_lines(p_items jsonb, p_name_key text)
returns void language plpgsql immutable set search_path = public
as $$
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    perform public._fail(400, 'Add at least one product line.');
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where btrim(coalesce(e ->> p_name_key, '')) = '') then
    perform public._fail(400, 'Every product line needs a product name.');
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where public._num(e ->> 'boxQty', 'Box quantity') < 0) then
    perform public._fail(400, 'A box quantity cannot be negative.');
  end if;
end;
$$;

-- ---------------------------------------------------------------- parties
create or replace function public.save_party(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id     uuid  := public._uuid(p ->> 'id');
  v_type   text  := coalesce(p ->> 'type', '');
  v_cur    text  := coalesce(nullif(p ->> 'currency', ''), 'USD');
  v_name   text  := btrim(coalesce(p ->> 'buyerName', ''));
  v_items  jsonb := coalesce(p -> 'products', '[]'::jsonb);
  v_opts   text[];
  v_before jsonb;
begin
  if not public.has_access('parties') then perform public._fail(403, 'You do not have access to the party master.'); end if;
  if v_name = '' then perform public._fail(400, 'Buyer name is required.'); end if;
  if v_type not in ('international', 'domestic') then perform public._fail(400, 'Party type must be international or domestic.'); end if;
  if v_cur not in ('USD', 'INR') then perform public._fail(400, 'Currency must be USD or INR.'); end if;
  if jsonb_typeof(v_items) is distinct from 'array' then perform public._fail(400, 'Products must be a list.'); end if;
  if exists (select 1 from jsonb_array_elements(v_items) e where btrim(coalesce(e ->> 'name', '')) = '') then
    perform public._fail(400, 'Every product line needs a name.');
  end if;

  select coalesce(array_agg(distinct btrim(x)), '{}') into v_opts
  from jsonb_array_elements_text(
    case when jsonb_typeof(p -> 'consigneeOptions') = 'array' then p -> 'consigneeOptions' else '[]'::jsonb end) x
  where btrim(x) <> '';

  if v_id is not null then
    perform 1 from public.parties where id = v_id and deleted_at is null for update;
    if not found then perform public._fail(404, 'That party no longer exists.'); end if;
    v_before := public._party_snapshot(v_id);
    update public.parties set
      type = v_type, buyer_name = v_name,
      buyer_address = coalesce(p ->> 'buyerAddress', ''),
      consignee_name = coalesce(p ->> 'consigneeName', ''),
      consignee_address = coalesce(p ->> 'consigneeAddress', ''),
      consignee_options = v_opts,
      country = coalesce(p ->> 'country', ''), currency = v_cur,
      shipment_term = coalesce(p ->> 'shipmentTerm', ''),
      payment_term = coalesce(p ->> 'paymentTerm', ''),
      conditions = coalesce(p ->> 'conditions', ''),
      port_of_loading = coalesce(p ->> 'portOfLoading', ''),
      destination_port = coalesce(p ->> 'destinationPort', ''),
      updated_at = now()
    where id = v_id;
  else
    insert into public.parties (type, buyer_name, buyer_address, consignee_name, consignee_address,
      consignee_options, country, currency, shipment_term, payment_term, conditions,
      port_of_loading, destination_port, created_by)
    values (v_type, v_name, coalesce(p ->> 'buyerAddress', ''), coalesce(p ->> 'consigneeName', ''),
      coalesce(p ->> 'consigneeAddress', ''), v_opts, coalesce(p ->> 'country', ''), v_cur,
      coalesce(p ->> 'shipmentTerm', ''), coalesce(p ->> 'paymentTerm', ''), coalesce(p ->> 'conditions', ''),
      coalesce(p ->> 'portOfLoading', ''), coalesce(p ->> 'destinationPort', ''), auth.uid())
    returning id into v_id;
  end if;

  -- Product lines are diffed, not wiped and re-inserted: a line that survives
  -- an edit keeps its id, so documents that reference it stay traceable.
  delete from public.party_products pp
  where pp.party_id = v_id
    and not exists (select 1 from jsonb_array_elements(v_items) e where public._uuid(e ->> 'id') = pp.id);

  update public.party_products pp set
    name = btrim(e ->> 'name'), hsn = coalesce(e ->> 'hsn', ''),
    rate = public._num(e ->> 'rate', 'Rate'), mrp = public._num(e ->> 'mrp', 'MRP'),
    net_wt = public._num(e ->> 'netWt', 'Net weight'), gross_wt = public._num(e ->> 'grossWt', 'Gross weight'),
    packs_per_box = public._num(e ->> 'packsPerBox', 'Packs per box')::int,
    weight_per_pack_g = public._num(e ->> 'weightPerPackG', 'Weight per pack')
  from jsonb_array_elements(v_items) e
  where pp.party_id = v_id and pp.id = public._uuid(e ->> 'id');

  insert into public.party_products (party_id, name, hsn, rate, mrp, net_wt, gross_wt, packs_per_box, weight_per_pack_g)
  select v_id, btrim(e ->> 'name'), coalesce(e ->> 'hsn', ''),
    public._num(e ->> 'rate', 'Rate'), public._num(e ->> 'mrp', 'MRP'),
    public._num(e ->> 'netWt', 'Net weight'), public._num(e ->> 'grossWt', 'Gross weight'),
    public._num(e ->> 'packsPerBox', 'Packs per box')::int, public._num(e ->> 'weightPerPackG', 'Weight per pack')
  from jsonb_array_elements(v_items) e
  where not exists (
    select 1 from public.party_products pp where pp.party_id = v_id and pp.id = public._uuid(e ->> 'id'));

  perform public._audit(case when v_before is null then 'Party created' else 'Party edited' end,
    'party', v_id::text, v_name, v_before, public._party_snapshot(v_id));
  return v_id;
end;
$$;

create or replace function public.delete_party(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.has_access('parties') then perform public._fail(403, 'You do not have access to the party master.'); end if;
  perform 1 from public.parties where id = p_id and deleted_at is null for update;
  if not found then perform public._fail(404, 'That party no longer exists.'); end if;
  v_before := public._party_snapshot(p_id);
  update public.parties set deleted_at = now(), deleted_by = auth.uid(), updated_at = now() where id = p_id;
  perform public._audit('Party deleted', 'party', p_id::text, v_before ->> 'buyer_name', v_before, null);
end;
$$;

-- ------------------------------------------------------------- quotations
create or replace function public.save_quotation(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id      uuid  := public._uuid(p ->> 'id');
  v_items   jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_buyer   text  := btrim(coalesce(p ->> 'buyerName', ''));
  v_country text  := btrim(coalesce(p ->> 'country', ''));
  v_party   uuid  := public._uuid(p ->> 'partyId');
  v_total   numeric;
  v_igst    boolean;
  v_rate    numeric;
  v_tax     numeric;
  v_row     public.quotations;
  v_before  jsonb;
begin
  if not public.has_access('documents') then perform public._fail(403, 'You do not have access to documents.'); end if;
  if v_buyer = '' then perform public._fail(400, 'Buyer name is required.'); end if;
  perform public._check_lines(v_items, 'product');
  if v_party is not null and not exists (select 1 from public.parties where id = v_party) then v_party := null; end if;

  select round(coalesce(sum(public._num(e ->> 'boxQty', 'Box quantity') * public._num(e ->> 'boxRate', 'Box rate')), 0), 2)
    into v_total from jsonb_array_elements(v_items) e;

  -- IGST exists only for Indian buyers; an export quotation never carries it.
  v_igst := lower(v_country) = 'india' and coalesce(p ->> 'igst', '') in ('true', 't', 'yes', '1');
  v_rate := case when v_igst then public._num(p ->> 'igstRate', 'IGST rate') else 0 end;
  v_tax  := round(v_total * v_rate / 100, 2);

  if v_id is null then
    insert into public.quotations (doc_no, doc_date, party_id, buyer_name, buyer_address, country,
      shipment_term, payment_term, igst, igst_rate, total_value, igst_amount, grand_total, items, created_by)
    values (public._alloc_doc_no('quotation'), public.ist_today(), v_party, v_buyer,
      coalesce(p ->> 'buyerAddress', ''), v_country, coalesce(p ->> 'shipmentTerm', ''),
      coalesce(p ->> 'paymentTerm', ''), v_igst, v_rate, v_total, v_tax, v_total + v_tax, v_items, auth.uid())
    returning * into v_row;
    perform public._audit('Quotation created', 'quotation', v_row.id::text,
      v_row.doc_no || ' — ' || v_buyer, null, to_jsonb(v_row));
  else
    select * into v_row from public.quotations where id = v_id and deleted_at is null for update;
    if not found then perform public._fail(404, 'That quotation no longer exists.'); end if;
    -- Answered once with 409; the client reloads. Never a retryable class.
    if nullif(p ->> 'expectedUpdatedAt', '') is not null
       and v_row.updated_at <> (p ->> 'expectedUpdatedAt')::timestamptz then
      perform public._fail(409, 'Someone else changed ' || v_row.doc_no || ' while you were editing it. Reload and try again.');
    end if;
    v_before := to_jsonb(v_row);
    update public.quotations set
      party_id = v_party, buyer_name = v_buyer, buyer_address = coalesce(p ->> 'buyerAddress', ''),
      country = v_country, shipment_term = coalesce(p ->> 'shipmentTerm', ''),
      payment_term = coalesce(p ->> 'paymentTerm', ''), igst = v_igst, igst_rate = v_rate,
      total_value = v_total, igst_amount = v_tax, grand_total = v_total + v_tax,
      items = v_items, updated_at = now()
    where id = v_id
    returning * into v_row;
    perform public._audit('Quotation edited', 'quotation', v_row.id::text,
      v_row.doc_no || ' — ' || v_buyer, v_before, to_jsonb(v_row));
  end if;

  return jsonb_build_object('id', v_row.id, 'doc_no', v_row.doc_no);
end;
$$;

create or replace function public.delete_quotation(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.quotations;
begin
  if not public.has_access('documents') then perform public._fail(403, 'You do not have access to documents.'); end if;
  select * into v_row from public.quotations where id = p_id and deleted_at is null for update;
  if not found then perform public._fail(404, 'That quotation no longer exists.'); end if;
  update public.quotations set deleted_at = now(), deleted_by = auth.uid(), updated_at = now() where id = p_id;
  perform public._audit('Quotation deleted', 'quotation', p_id::text,
    v_row.doc_no || ' — ' || v_row.buyer_name, to_jsonb(v_row), null);
end;
$$;

-- -------------------------------------------------------------- proformas
create or replace function public.create_proforma(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_type    text  := coalesce(p ->> 'type', '');
  v_items   jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_buyer   text  := btrim(coalesce(p ->> 'buyerName', ''));
  v_party   uuid  := public._uuid(p ->> 'partyId');
  v_intl    boolean;
  v_boxes   numeric;
  v_total   numeric;
  v_taxable numeric;
  v_rate    numeric;
  v_tax     numeric;
  v_opts    text[];
  v_row     public.proformas;
begin
  if not public.has_access('documents') then perform public._fail(403, 'You do not have access to documents.'); end if;
  if v_type not in ('international', 'domestic') then perform public._fail(400, 'Proforma type must be international or domestic.'); end if;
  if v_buyer = '' then perform public._fail(400, 'A proforma needs a buyer.'); end if;
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

  insert into public.proformas (doc_no, doc_date, type, party_id, quotation_ref, buyer_name, buyer_address,
    consignee_name, consignee_address, consignee_options, port_of_loading, destination_port,
    shipment_term, payment_term, conditions, currency, order_no, order_date, additional_details,
    total_boxes, total_value, taxable_value, tax_rate, tax_amount, grand_total, items, created_by)
  values (
    public._alloc_doc_no(case when v_intl then 'pi_international' else 'pi_domestic' end),
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

-- -------------------------------------------------------------- shipments
-- Money rule (decisions/002): line amounts, freight and other charges are in the
-- proforma's currency. The tax invoice is always INR, so a USD proforma is
-- converted at the exchange rate entered for this shipment; GST and round-off
-- are applied to the INR figure.
create or replace function public.create_shipment(p jsonb)
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
begin
  if not public.has_access('documents') then perform public._fail(403, 'You do not have access to documents.'); end if;

  -- The row lock is what stops two people invoicing the same proforma at once.
  select * into v_pi from public.proformas
  where id = public._uuid(p ->> 'piId') and deleted_at is null for update;
  if not found then perform public._fail(404, 'That proforma no longer exists.'); end if;
  if v_pi.shipment_id is not null then
    perform public._fail(409, v_pi.doc_no || ' has already been invoiced. Reload to see it.');
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
           'accountNo', c.account_no, 'ifsc', c.ifsc, 'swift', c.swift, 'gstNo', c.gst_no, 'iecCode', c.iec_code)
    into v_company from public.company_profile c where c.id = 1;

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
    jsonb_build_object('consignee', coalesce(nullif(btrim(p ->> 'taxConsignee'), ''), 'TO THE ORDER'),
      'currency', 'INR', 'total', v_inr_total, 'gst', v_gst, 'roundOff', v_round,
      'grandTotal', v_inr_total + v_gst + v_round),
    jsonb_build_object('consignee', coalesce(nullif(btrim(p ->> 'commercialConsignee'), ''), v_pi.consignee_name),
      'currency', v_com_cur, 'total', v_com_total),
    jsonb_build_object('totalBoxes', v_boxes, 'totalPacks', v_packs, 'netWeight', v_net,
      'grossWeight', v_gross, 'grandTotal', v_net + v_gross),
    coalesce(v_company, '{}'::jsonb), v_items, auth.uid())
  returning * into v_row;

  update public.proformas set shipment_id = v_row.id, updated_at = now() where id = v_pi.id;

  perform public._audit('Shipment invoiced', 'shipment', v_row.id::text,
    v_no || ' against ' || v_pi.doc_no || ' — ' || v_pi.buyer_name, null, to_jsonb(v_row));
  return jsonb_build_object('id', v_row.id, 'doc_no', v_no);
end;
$$;

-- ---------------------------------------------------------------- company
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
    ifsc = coalesce(p ->> 'ifsc', ''), swift = coalesce(p ->> 'swift', ''),
    gst_no = coalesce(p ->> 'gstNo', ''), iec_code = coalesce(p ->> 'iecCode', ''),
    updated_at = now()
  where id = 1
  returning to_jsonb(company_profile) into v_after;
  perform public._audit('Company profile edited', 'company', '1', coalesce(p ->> 'name', ''), v_before, v_after);
end;
$$;

-- ------------------------------------------------------------------ users
-- Only keys that are present are written, so a partial payload never blanks a
-- field it did not mention.
create or replace function public.set_user_access(p_user uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_before public.profiles;
  v_after  public.profiles;
  v_role   text;
begin
  if not public.is_admin() then perform public._fail(403, 'Only an administrator can manage accounts.'); end if;
  select * into v_before from public.profiles where id = p_user for update;
  if not found then perform public._fail(404, 'That account no longer exists.'); end if;

  v_role := coalesce(nullif(p ->> 'role', ''), v_before.role);
  if v_role not in ('admin', 'staff') then perform public._fail(400, 'Role must be admin or staff.'); end if;

  if p_user = auth.uid() and (v_role <> v_before.role or coalesce((p ->> 'active')::boolean, true) = false) then
    perform public._fail(400, 'You cannot change your own role or deactivate yourself — ask another administrator.');
  end if;

  update public.profiles set
    role = v_role,
    full_name        = case when p ? 'fullName' then btrim(p ->> 'fullName') else full_name end,
    active           = case when p ? 'active'    then (p ->> 'active')::boolean    else active end,
    access_documents = case when v_role = 'admin' then true
                            when p ? 'documents' then (p ->> 'documents')::boolean else access_documents end,
    access_parties   = case when v_role = 'admin' then true
                            when p ? 'parties'   then (p ->> 'parties')::boolean   else access_parties end,
    access_company   = case when v_role = 'admin' then true
                            when p ? 'company'   then (p ->> 'company')::boolean   else access_company end
  where id = p_user
  returning * into v_after;

  perform public._audit('Access changed', 'user', p_user::text, v_after.email, to_jsonb(v_before), to_jsonb(v_after));
end;
$$;

-- ----------------------------------------------------------------- grants
-- The API surface, named once.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.save_party(jsonb)', 'public.delete_party(uuid)',
    'public.save_quotation(jsonb)', 'public.delete_quotation(uuid)',
    'public.create_proforma(jsonb)', 'public.create_shipment(jsonb)',
    'public.save_company(jsonb)', 'public.set_user_access(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from anon, public', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Internals are not an API. Revoked by shape — trigger functions and the "_"
-- prefix — so the next one added is covered without anyone remembering (§9b).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like '\_%' or p.prorettype = 'trigger'::regtype)
  loop
    execute format('revoke all on function %s from anon, authenticated, public', r.sig);
  end loop;
end $$;

-- ------------------------------------------------------------------ gates
do $$
declare
  bad text;
begin
  -- 1. Nothing in public is callable without signing in.
  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'db/009: callable by anon: %', bad; end if;

  -- 2. No internal or trigger function is reachable over the API.
  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like '\_%' or p.prorettype = 'trigger'::regtype)
    and has_function_privilege('authenticated', p.oid, 'execute');
  if bad is not null then raise exception 'db/009: internal function callable by authenticated: %', bad; end if;

  -- 3. Every definer function pins its search_path.
  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if bad is not null then raise exception 'db/009: definer function without search_path: %', bad; end if;

  -- 4. Every definer function a signed-in user can call checks the caller in its
  --    own body. This is the condition under which advisor rule 0029 is accepted.
  with fns as materialized (
    select p.oid, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  )
  select string_agg(f.oid::regprocedure::text, ', ') into bad from fns f
  where f.prosecdef
    and has_function_privilege('authenticated', f.oid, 'execute')
    and pg_get_functiondef(f.oid) !~ '(has_access\(|is_admin\(|auth\.uid\(\))';
  if bad is not null then raise exception 'db/009: definer function with no caller check: %', bad; end if;

  -- 5. No retryable SQLSTATE anywhere (PostgREST would retry it for ever).
  -- pg_get_functiondef refuses aggregates, and the planner may call it before
  -- the schema filter — so the list is materialised first (Bible §6).
  with fns as materialized (
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  )
  select string_agg(f.oid::regprocedure::text, ', ') into bad from fns f
  where pg_get_functiondef(f.oid) ~ '40001|40P01';
  if bad is not null then raise exception 'db/009: retryable SQLSTATE raised by: %', bad; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (9, 'write_rpcs') on conflict (id) do nothing;

select 'db/009 ✓ atomic write RPCs, internals revoked, five gates passed' as status;
