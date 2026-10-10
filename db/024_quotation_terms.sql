-- db/024 — a quotation carries terms typed by hand.
--
-- On the owner's instruction: add terms to a quotation as required, manually.
--
--   · quotations.terms is ONE text, a term per line — the same shape as a
--     party's conditions (decisions/012). Empty when none were typed.
--   · save_quotation stores what it is sent, and an edit that does not carry
--     the key (an older copy of the console) leaves the stored terms alone.
--   · The terms are wording only. Nothing reads them to work anything out.

alter table public.quotations
  add column if not exists terms text not null default '';

comment on column public.quotations.terms is
  'Terms typed on the quotation, one per line. Printed on the quotation; empty when none were typed.';

-- db/023's function plus the terms; everything else is unchanged.
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
  v_cur     text  := upper(btrim(coalesce(p ->> 'currency', '')));
  v_terms   text  := btrim(coalesce(p ->> 'terms', ''));
  v_total   numeric;
  v_igst    boolean;
  v_rate    numeric;
  v_tax     numeric;
  v_row     public.quotations;
  v_before  jsonb;
begin
  if not public.has_access('quotations') then perform public._fail(403, 'You do not have access to quotations.'); end if;
  if v_buyer = '' then perform public._fail(400, 'Buyer name is required.'); end if;
  -- The currency the prices are in (db/023). Nothing is converted.
  if p ? 'currency' and v_cur not in ('USD', 'INR') then perform public._fail(400, 'Currency must be USD or INR.'); end if;
  -- Terms typed on the quotation, one per line (db/024). Wording only.
  if length(v_terms) > 6000 then perform public._fail(400, 'The terms are too long. Keep them under 6,000 characters in all.'); end if;
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
      shipment_term, payment_term, igst, igst_rate, total_value, igst_amount, grand_total, items, created_by, currency, terms)
    values (public._alloc_doc_no('quotation'), public.ist_today(), v_party, v_buyer,
      coalesce(p ->> 'buyerAddress', ''), v_country, coalesce(p ->> 'shipmentTerm', ''),
      coalesce(p ->> 'paymentTerm', ''), v_igst, v_rate, v_total, v_tax, v_total + v_tax, v_items, auth.uid(), v_cur, v_terms)
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
      -- A save that does not carry the key leaves the currency alone.
      currency = case when p ? 'currency' then v_cur else currency end,
      terms = case when p ? 'terms' then v_terms else terms end,
      items = v_items, updated_at = now()
    where id = v_id
    returning * into v_row;
    perform public._audit('Quotation edited', 'quotation', v_row.id::text,
      v_row.doc_no || ' — ' || v_buyer, v_before, to_jsonb(v_row));
  end if;

  return jsonb_build_object('id', v_row.id, 'doc_no', v_row.doc_no);
end;
$$;

do $$
begin
  execute 'revoke all on function public.save_quotation(jsonb) from anon, public';
  execute 'grant execute on function public.save_quotation(jsonb) to authenticated, service_role';
end $$;

-- ------------------------------------------------------------------ gates
do $$
declare
  bad text;
  def text := pg_get_functiondef('public.save_quotation(jsonb)'::regprocedure);
begin
  -- 1. The column is there and never null.
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'quotations' and column_name = 'terms'
                   and is_nullable = 'NO' and data_type = 'text') then
    raise exception 'db/024: quotations.terms is missing or nullable';
  end if;

  -- 2. save_quotation reads the terms, and keeps them when an older client saves.
  if def not like '%p ->> ''terms''%' then raise exception 'db/024: save_quotation does not read the terms'; end if;
  if def not like '%terms = case when p ? ''terms'' then v_terms else terms end%' then
    raise exception 'db/024: an edit from an older client would blank the terms';
  end if;

  -- 3. Nothing it had was lost: the guard, the number, the totals, the 409, the currency.
  if def not like '%has_access(''quotations'')%' then raise exception 'db/024: save_quotation lost its access check'; end if;
  if def not like '%_alloc_doc_no(''quotation'')%' or def not like '%expectedUpdatedAt%'
     or def not like '%round(v_total * v_rate / 100, 2)%'
     or def not like '%currency = case when p ? ''currency'' then v_cur else currency end%'
     or def not like '%v_cur not in (''USD'', ''INR'')%' then
    raise exception 'db/024: save_quotation lost a rule it had';
  end if;
  if has_function_privilege('anon', 'public.save_quotation(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_quotation(jsonb)', 'execute') then
    raise exception 'db/024: save_quotation has the wrong grants';
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
  if bad is not null then raise exception 'db/024: function open or unguarded: %', bad; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (24, 'quotation_terms') on conflict (id) do nothing;

select 'db/024 ✓ a quotation carries its own terms' as status;
