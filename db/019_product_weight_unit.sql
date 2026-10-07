-- db/019 — each product line remembers the unit its weights were typed in.
--
-- The party form took net and gross weight per box in grams only. It now lets
-- whoever enters a product choose the unit: gram, kilogram or MT (metric
-- tonne), one choice per product line covering both weights.
--
-- What is stored does not change: net_wt and gross_wt stay in KILOGRAMS per
-- box. Every packing list, shipment total and Excel column is in kg and tonnes
-- and reads those two columns as it always has. The new column only records
-- the unit the line was typed in, so the form can show the weights back the
-- way they were entered:
--
--   weight_unit  'g' | 'kg' | 'mt'. Lines that exist today were typed in
--                grams, so that is what they are marked as.
--
-- Additive only. The client on production today names its columns one by one
-- and is unaffected. A line saved without the key keeps the unit it has.

alter table public.party_products
  add column if not exists weight_unit text not null default 'g';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'party_products_weight_unit_valid') then
    alter table public.party_products
      add constraint party_products_weight_unit_valid check (weight_unit in ('g', 'kg', 'mt'));
  end if;
end $$;

comment on column public.party_products.weight_unit is
  'The unit net_wt and gross_wt were typed in on the party form: g, kg or mt. The two columns themselves are always kilograms.';

-- db/018's function with the one key added to each product line; everything
-- else is unchanged.
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
  -- The unit the weights were typed in: grams, kilograms or MT, nothing else.
  -- (The weights themselves always arrive, and are stored, in kilograms.)
  if exists (select 1 from jsonb_array_elements(v_items) e
             where e ? 'weightUnit' and coalesce(e ->> 'weightUnit', '') not in ('g', 'kg', 'mt')) then
    perform public._fail(400, 'Weight is given in grams, kilograms or MT.');
  end if;
  -- Shelf life is a length and a unit, as typed: months or years, nothing else.
  if exists (select 1 from jsonb_array_elements(v_items) e
             where e ? 'shelfLifeUnit' and coalesce(e ->> 'shelfLifeUnit', '') not in ('months', 'years')) then
    perform public._fail(400, 'Shelf life is given in months or years.');
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e where public._num(e ->> 'shelfLife', 'Shelf life') < 0) then
    perform public._fail(400, 'A shelf life cannot be negative.');
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
    weight_per_pack_g = public._num(e ->> 'weightPerPackG', 'Weight per pack'),
    -- Added in db/018. A line sent without these keys keeps what it has.
    shelf_life = case when e ? 'shelfLife' then public._num(e ->> 'shelfLife', 'Shelf life') else pp.shelf_life end,
    shelf_life_unit = case when e ? 'shelfLifeUnit' then e ->> 'shelfLifeUnit' else pp.shelf_life_unit end,
    -- Added in db/019. Same rule: a line sent without the key keeps its unit.
    weight_unit = case when e ? 'weightUnit' then e ->> 'weightUnit' else pp.weight_unit end
  from jsonb_array_elements(v_items) e
  where pp.party_id = v_id and pp.id = public._uuid(e ->> 'id');

  insert into public.party_products (party_id, name, hsn, rate, mrp, net_wt, gross_wt, packs_per_box, weight_per_pack_g,
    shelf_life, shelf_life_unit, weight_unit)
  select v_id, btrim(e ->> 'name'), coalesce(e ->> 'hsn', ''),
    public._num(e ->> 'rate', 'Rate'), public._num(e ->> 'mrp', 'MRP'),
    public._num(e ->> 'netWt', 'Net weight'), public._num(e ->> 'grossWt', 'Gross weight'),
    public._num(e ->> 'packsPerBox', 'Packs per box')::int, public._num(e ->> 'weightPerPackG', 'Weight per pack'),
    public._num(e ->> 'shelfLife', 'Shelf life'), coalesce(nullif(e ->> 'shelfLifeUnit', ''), 'months'),
    coalesce(nullif(e ->> 'weightUnit', ''), 'g')
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
  -- 1. The column exists, never null, and can only hold a known unit.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'party_products' and column_name = 'weight_unit' and is_nullable = 'NO'
  ) then raise exception 'db/019: party_products.weight_unit is missing or nullable'; end if;
  if not exists (select 1 from pg_constraint where conname = 'party_products_weight_unit_valid') then
    raise exception 'db/019: the weight-unit constraint is missing';
  end if;

  -- 2. The function reads the key, keeps what an older client does not send,
  --    and still stores the weights themselves exactly as it did (kilograms).
  if def not like '%''weightUnit''%' then raise exception 'db/019: save_party does not read the weight unit'; end if;
  if def not like '%e ? ''weightUnit''%' then
    raise exception 'db/019: save_party would reset a unit an older client did not send';
  end if;
  if def not like '%net_wt = public._num(e ->> ''netWt'', ''Net weight''), gross_wt = public._num(e ->> ''grossWt'', ''Gross weight'')%' then
    raise exception 'db/019: save_party no longer stores the weights as sent';
  end if;

  -- 3. Nothing db/011 and db/018 added was lost, and the caller is still checked.
  if def not like '%''altBuyers''%' or def not like '%e ? ''shelfLife''%' then
    raise exception 'db/019: save_party lost the other names or the shelf life';
  end if;
  if def not like '%has_access(''parties'')%' then raise exception 'db/019: save_party lost its access check'; end if;
  if has_function_privilege('anon', 'public.save_party(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_party(jsonb)', 'execute') then
    raise exception 'db/019: save_party has the wrong grants';
  end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (19, 'product_weight_unit') on conflict (id) do nothing;

select 'db/019 ✓ each product line records the unit its weights were typed in; weights stay in kg' as status;
