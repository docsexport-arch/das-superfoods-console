-- db/013 — the proforma number is typed by hand.
--
-- Until now create_proforma took the next number from a counter. On the
-- owner's instruction the number is now typed by whoever raises the proforma
-- (key `docNo`), so it can follow whatever numbering the desk already uses.
--
-- Because nothing allocates the number any more, the function is what keeps
-- it sound: it must be present, it must be made of plain characters (it also
-- becomes a file name when the proforma is downloaded), and it must not repeat
-- — compared without regard to capitals or stray spaces, and counting retired
-- proformas too, so a number is never reused.
--
-- Shipment / invoice numbers are NOT affected: they are still allocated.
--
-- The client on production today inserts proformas directly and never calls
-- this function, so it is unaffected. A browser tab still running an older
-- copy of the preview client sends no `docNo` and is told to reload.

-- A second line of defence behind the check in the function: two people
-- typing the same number at the same moment.
create unique index if not exists proformas_doc_no_ci
  on public.proformas (upper(btrim(doc_no)));

-- The function below is the live definition (db/009 with the guard repointed
-- by db/010 — verified identical to the database before this was written)
-- with three changes: it reads docNo, validates it, and uses it.
create or replace function public.create_proforma(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_type    text  := coalesce(p ->> 'type', '');
  v_items   jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_buyer   text  := btrim(coalesce(p ->> 'buyerName', ''));
  v_party   uuid  := public._uuid(p ->> 'partyId');
  v_no      text  := btrim(coalesce(p ->> 'docNo', ''));
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
  -- The number is typed by hand, so this function is what keeps it sound.
  if v_no = '' then
    perform public._fail(400, 'Enter the proforma number. If you cannot see a box for it, reload the page.');
  end if;
  if length(v_no) > 40 or v_no !~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]*$' then
    perform public._fail(400, 'A proforma number can use letters, digits, spaces and . / _ - only, up to 40 characters.');
  end if;
  if exists (select 1 from public.proformas where upper(btrim(doc_no)) = upper(v_no)) then
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

-- ------------------------------------------------------------------ gates
do $$
declare
  def text := pg_get_functiondef('public.create_proforma(jsonb)'::regprocedure);
begin
  -- 1. The function takes the typed number and no longer allocates one.
  if def not like '%''docNo''%' then raise exception 'db/013: create_proforma does not read docNo'; end if;
  if def like '%_alloc_doc_no%' then raise exception 'db/013: create_proforma still allocates a number'; end if;

  -- 2. It still checks the caller itself, with the grant db/010 gave it.
  if def not like '%has_access(''proforma'')%' then raise exception 'db/013: create_proforma lost its access check'; end if;

  -- 3. Replacing it did not open it to anyone signed out.
  if has_function_privilege('anon', 'public.create_proforma(jsonb)', 'execute') then
    raise exception 'db/013: create_proforma is callable without signing in';
  end if;
  if not has_function_privilege('authenticated', 'public.create_proforma(jsonb)', 'execute') then
    raise exception 'db/013: create_proforma is no longer callable by signed-in users';
  end if;

  -- 4. The uniqueness backstop is in place.
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'proformas_doc_no_ci') then
    raise exception 'db/013: the case-insensitive unique index on proforma numbers is missing';
  end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (13, 'manual_proforma_number') on conflict (id) do nothing;

select 'db/013 ✓ proforma numbers are typed by hand; unique, validated, never reused' as status;
