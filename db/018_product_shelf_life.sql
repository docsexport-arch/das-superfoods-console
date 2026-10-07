-- db/018 — each product on a party carries its own shelf life.
--
-- Different products keep for different lengths of time, so the shelf life
-- belongs to the product line, not to the party. Each line now carries a
-- number and a unit — months or years — for both international and
-- private-label parties.
--
--   shelf_life       how long, in the unit beside it. 0 means "not given".
--   shelf_life_unit  'months' or 'years', as it was typed. It is NOT converted:
--                    "2 years" stays 2 years, it does not become 24 months.
--
-- Additive only: two columns with defaults, and save_party learns two keys on
-- each product line. The client on production today never sends them and
-- names its columns one by one, so it is unaffected.
--
-- A line saved without the keys keeps the shelf life it has — a browser tab
-- still running an older copy of the console must not wipe it.

alter table public.party_products
  add column if not exists shelf_life      numeric not null default 0,
  add column if not exists shelf_life_unit text    not null default 'months';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'party_products_shelf_life_unit_valid') then
    alter table public.party_products
      add constraint party_products_shelf_life_unit_valid check (shelf_life_unit in ('months', 'years'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'party_products_shelf_life_not_negative') then
    alter table public.party_products
      add constraint party_products_shelf_life_not_negative check (shelf_life >= 0);
  end if;
end $$;

comment on column public.party_products.shelf_life is
  'Shelf life of this product, in shelf_life_unit. 0 = not given.';
comment on column public.party_products.shelf_life_unit is
  'months or years, as typed — never converted from one to the other.';

-- db/011's function with the two keys added to each product line; everything
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
    shelf_life_unit = case when e ? 'shelfLifeUnit' then e ->> 'shelfLifeUnit' else pp.shelf_life_unit end
  from jsonb_array_elements(v_items) e
  where pp.party_id = v_id and pp.id = public._uuid(e ->> 'id');

  insert into public.party_products (party_id, name, hsn, rate, mrp, net_wt, gross_wt, packs_per_box, weight_per_pack_g,
    shelf_life, shelf_life_unit)
  select v_id, btrim(e ->> 'name'), coalesce(e ->> 'hsn', ''),
    public._num(e ->> 'rate', 'Rate'), public._num(e ->> 'mrp', 'MRP'),
    public._num(e ->> 'netWt', 'Net weight'), public._num(e ->> 'grossWt', 'Gross weight'),
    public._num(e ->> 'packsPerBox', 'Packs per box')::int, public._num(e ->> 'weightPerPackG', 'Weight per pack'),
    public._num(e ->> 'shelfLife', 'Shelf life'), coalesce(nullif(e ->> 'shelfLifeUnit', ''), 'months')
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
  missing text;
begin
  -- 1. Both columns exist, never null, and can only hold what they should.
  select string_agg(c, ', ') into missing
  from unnest(array['shelf_life', 'shelf_life_unit']) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'party_products' and column_name = c and is_nullable = 'NO');
  if missing is not null then raise exception 'db/018: party_products is missing: %', missing; end if;
  if (select count(*) from pg_constraint
      where conname in ('party_products_shelf_life_unit_valid', 'party_products_shelf_life_not_negative')) <> 2 then
    raise exception 'db/018: a shelf-life constraint is missing';
  end if;

  -- 2. The function reads both keys on a line, keeps what an older client does
  --    not send, still reads the other names (db/011) and still checks the caller.
  if def not like '%''shelfLife''%' or def not like '%''shelfLifeUnit''%' then
    raise exception 'db/018: save_party does not read the shelf life';
  end if;
  if def not like '%e ? ''shelfLife''%' or def not like '%e ? ''shelfLifeUnit''%' then
    raise exception 'db/018: save_party would wipe a shelf life an older client did not send';
  end if;
  if def not like '%''altBuyers''%' then raise exception 'db/018: save_party lost the other buyer names'; end if;
  if def not like '%has_access(''parties'')%' then raise exception 'db/018: save_party lost its access check'; end if;

  -- 3. Replacing it did not open it to anyone signed out.
  if has_function_privilege('anon', 'public.save_party(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_party(jsonb)', 'execute') then
    raise exception 'db/018: save_party has the wrong grants';
  end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (18, 'product_shelf_life') on conflict (id) do nothing;

select 'db/018 ✓ each product line carries a shelf life in months or years' as status;
