-- db/025 — a quotation's number and date can be typed.
--
-- On the owner's instruction: a "Quotation no." box and a "Date" box on the
-- quotation.
--
--   · THE NUMBER. Typed by hand, or left empty — then one is allocated from
--     the series as before (DS-QUO-yyyy-nnnn). A typed number must be plain
--     characters, at most 40, and not in use by another quotation. The series
--     steps over any number that was typed by hand, so the two never collide.
--     On an edit the number can be changed; left empty, it stays as it is.
--   · THE DATE. Typed, or left empty — then it is today (IST) on a new
--     quotation and unchanged on an edit.
--   · A DELETED QUOTATION NO LONGER HOLDS ITS NUMBER, as with proformas
--     (db/022): the check and the unique index behind it look at live
--     quotations only.
--   · A copy of the console that sends neither (an older tab) behaves exactly
--     as it did: automatic number, today's date, and an edit changes neither.

-- The backstop for two people typing the same number at once. Built before
-- the table's original rule is dropped, so there is no moment without one.
create unique index if not exists quotations_doc_no_live_ci
  on public.quotations (upper(btrim(doc_no))) where deleted_at is null;
-- The original rule counted deleted quotations too, and minded capitals.
alter table public.quotations drop constraint if exists quotations_doc_no_key;

-- db/024's function plus the typed number and date; everything else is unchanged.
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
  v_no      text  := btrim(coalesce(p ->> 'docNo', ''));
  v_date    date  := public._date(p ->> 'docDate', 'Quotation date');
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
  -- The number can be typed by hand (db/025). Left empty, one is allocated
  -- below on a new quotation, and an edit keeps the number it has.
  if v_no <> '' then
    if length(v_no) > 40 or v_no !~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]*$' then
      perform public._fail(400, 'A quotation number can use letters, digits, spaces and . / _ - only, up to 40 characters.');
    end if;
    if exists (select 1 from public.quotations where upper(btrim(doc_no)) = upper(v_no) and id is distinct from v_id and deleted_at is null) then
      perform public._fail(409, 'Quotation number ' || v_no || ' is already in use. Type a different number.');
    end if;
  end if;
  -- The date can be typed too. Left empty: today on a new quotation, unchanged on an edit.
  if v_date is not null and (v_date < date '2000-01-01' or v_date > date '2100-12-31') then
    perform public._fail(400, 'Check the quotation date — the year looks wrong.');
  end if;
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
    -- No number typed: the next in the series, stepping over any that was typed by hand.
    if v_no = '' then
      loop
        v_no := public._alloc_doc_no('quotation');
        exit when not exists (select 1 from public.quotations where upper(btrim(doc_no)) = upper(v_no) and deleted_at is null);
      end loop;
    end if;
    insert into public.quotations (doc_no, doc_date, party_id, buyer_name, buyer_address, country,
      shipment_term, payment_term, igst, igst_rate, total_value, igst_amount, grand_total, items, created_by, currency, terms)
    values (v_no, coalesce(v_date, public.ist_today()), v_party, v_buyer,
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
      -- Changed only when sent: an edit with no number or no date keeps what is stored.
      doc_no = case when v_no <> '' then v_no else doc_no end,
      doc_date = coalesce(v_date, doc_date),
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
  -- 1. save_quotation reads both, keeps the number sound, and still allocates one when none is typed.
  if def not like '%p ->> ''docNo''%' or def not like '%p ->> ''docDate''%' then
    raise exception 'db/025: save_quotation does not read the number or the date';
  end if;
  if def not like '%v_no !~ ''^[A-Za-z0-9][A-Za-z0-9 ./_-]*$''%' then raise exception 'db/025: a typed quotation number is not checked'; end if;
  if def not like '%upper(btrim(doc_no)) = upper(v_no) and id is distinct from v_id and deleted_at is null%' then
    raise exception 'db/025: a typed quotation number can repeat a live one';
  end if;
  if def not like '%_alloc_doc_no(''quotation'')%' then raise exception 'db/025: an empty number is no longer allocated'; end if;

  -- 2. An older client's edit changes neither the number nor the date.
  if def not like '%doc_no = case when v_no <> '''' then v_no else doc_no end%'
     or def not like '%doc_date = coalesce(v_date, doc_date)%' then
    raise exception 'db/025: an edit that sends no number or date would change them';
  end if;

  -- 3. Nothing it had was lost: the guard, the totals, the 409, the currency, the terms.
  if def not like '%has_access(''quotations'')%' then raise exception 'db/025: save_quotation lost its access check'; end if;
  if def not like '%expectedUpdatedAt%' or def not like '%round(v_total * v_rate / 100, 2)%'
     or def not like '%currency = case when p ? ''currency'' then v_cur else currency end%'
     or def not like '%terms = case when p ? ''terms'' then v_terms else terms end%' then
    raise exception 'db/025: save_quotation lost a rule it had';
  end if;
  if has_function_privilege('anon', 'public.save_quotation(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_quotation(jsonb)', 'execute') then
    raise exception 'db/025: save_quotation has the wrong grants';
  end if;

  -- 4. Exactly one uniqueness rule on the number, covering live quotations only.
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'quotations_doc_no_live_ci'
                 and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%deleted_at IS NULL%') then
    raise exception 'db/025: the unique index on live quotation numbers is missing';
  end if;
  select string_agg(i.indexname, ', ') into bad from pg_indexes i
  where i.schemaname = 'public' and i.tablename = 'quotations' and i.indexdef like 'CREATE UNIQUE INDEX%'
    and i.indexdef like '%doc_no%' and i.indexdef not like '%deleted_at IS NULL%';
  if bad is not null then raise exception 'db/025: a deleted quotation''s number is still held by: %', bad; end if;

  -- 5. Nothing callable without signing in; every definer function a
  --    signed-in user can call still checks the caller in its own body.
  with fns as materialized (
    select p.oid, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  )
  select string_agg(f.oid::regprocedure::text, ', ') into bad from fns f
  where has_function_privilege('anon', f.oid, 'execute')
     or (f.prosecdef and has_function_privilege('authenticated', f.oid, 'execute')
         and pg_get_functiondef(f.oid) !~ '(has_access\(|is_admin\(|auth\.uid\(\))');
  if bad is not null then raise exception 'db/025: function open or unguarded: %', bad; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (25, 'quotation_number_and_date') on conflict (id) do nothing;

select 'db/025 ✓ a quotation''s number and date can be typed' as status;
