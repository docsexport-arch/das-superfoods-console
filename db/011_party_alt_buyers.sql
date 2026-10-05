-- db/011 — other buyer names on a party.
--
-- The same party sometimes places an order under a different name. A party now
-- carries any number of other buyer names, each with its own address, beside
-- its main one. Whoever raises a quotation or a proforma picks which name goes
-- on that document; the document keeps the name it was raised with, as before.
--
-- Additive only: one new column with a default, and save_party learns one new
-- key (`altBuyers`). The client on production today never sends that key and
-- never names the column, so it keeps working untouched.
--
-- A save that does not carry the key leaves the stored names alone — a browser
-- tab still running an older copy of the console must not wipe them.

-- ------------------------------------------------------------- the column
alter table public.parties
  add column if not exists alt_buyers jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parties_alt_buyers_is_list') then
    alter table public.parties
      add constraint parties_alt_buyers_is_list check (jsonb_typeof(alt_buyers) = 'array');
  end if;
end $$;

comment on column public.parties.alt_buyers is
  'Other names this party orders under: [{"name": text, "address": text}]. Written only by save_party.';

-- ---------------------------------------------------------------- parties
-- The db/009 function with the new key added; everything else is unchanged.
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
  v_alt    jsonb;
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

  -- Other names the same party orders under. Blank rows are dropped; a row
  -- with an address but no name is refused rather than silently lost.
  if p ? 'altBuyers' and jsonb_typeof(p -> 'altBuyers') is distinct from 'array' then
    perform public._fail(400, 'Other buyer names must be a list.');
  end if;
  if exists (
    select 1 from jsonb_array_elements(case when p ? 'altBuyers' then p -> 'altBuyers' else '[]'::jsonb end) e
    where btrim(coalesce(e ->> 'name', '')) = '' and btrim(coalesce(e ->> 'address', '')) <> ''
  ) then
    perform public._fail(400, 'Every other buyer needs a name, not only an address.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', btrim(t.e ->> 'name'),
           'address', btrim(coalesce(t.e ->> 'address', ''))) order by t.ord), '[]'::jsonb)
    into v_alt
  from jsonb_array_elements(case when p ? 'altBuyers' then p -> 'altBuyers' else '[]'::jsonb end)
       with ordinality as t(e, ord)
  where btrim(coalesce(t.e ->> 'name', '')) <> '';

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
      alt_buyers = case when p ? 'altBuyers' then v_alt else alt_buyers end,
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
      port_of_loading, destination_port, alt_buyers, created_by)
    values (v_type, v_name, coalesce(p ->> 'buyerAddress', ''), coalesce(p ->> 'consigneeName', ''),
      coalesce(p ->> 'consigneeAddress', ''), v_opts, coalesce(p ->> 'country', ''), v_cur,
      coalesce(p ->> 'shipmentTerm', ''), coalesce(p ->> 'paymentTerm', ''), coalesce(p ->> 'conditions', ''),
      coalesce(p ->> 'portOfLoading', ''), coalesce(p ->> 'destinationPort', ''), v_alt, auth.uid())
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

-- ------------------------------------------------------------------ gates
do $$
declare
  def text := pg_get_functiondef('public.save_party(jsonb)'::regprocedure);
begin
  -- 1. The column is there, never null, and can only hold a list.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parties' and column_name = 'alt_buyers'
      and is_nullable = 'NO' and data_type = 'jsonb'
  ) then raise exception 'db/011: parties.alt_buyers is missing or nullable'; end if;
  if not exists (select 1 from pg_constraint where conname = 'parties_alt_buyers_is_list') then
    raise exception 'db/011: the list constraint on parties.alt_buyers is missing';
  end if;

  -- 2. The function reads the new key, and still checks the caller itself.
  if def not like '%''altBuyers''%' then raise exception 'db/011: save_party does not read altBuyers'; end if;
  if def not like '%has_access(''parties'')%' then raise exception 'db/011: save_party lost its access check'; end if;

  -- 3. Replacing the function did not open it to anyone signed out.
  if has_function_privilege('anon', 'public.save_party(jsonb)', 'execute') then
    raise exception 'db/011: save_party is callable without signing in';
  end if;
  if not has_function_privilege('authenticated', 'public.save_party(jsonb)', 'execute') then
    raise exception 'db/011: save_party is no longer callable by signed-in users';
  end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (11, 'party_alt_buyers') on conflict (id) do nothing;

select 'db/011 ✓ a party can carry other buyer names; save_party reads altBuyers' as status;
