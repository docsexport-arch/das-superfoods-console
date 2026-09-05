-- =====================================================================
--  Das Superfoods — Export console
--  Supabase schema: tables, row-level security, document numbering.
--
--  Run this once in your Supabase project:
--    Dashboard → SQL Editor → New query → paste → Run
--
--  It is safe to re-run: every object is created with "if not exists"
--  or dropped-and-recreated.
-- =====================================================================

-- ---------------------------------------------------------------- profiles
-- One row per auth user. Supabase Auth owns the password; this table owns
-- the role and the section grants that the console reads.
create table if not exists public.profiles (
  id                uuid primary key references auth.users on delete cascade,
  full_name         text        not null default '',
  email             text        not null default '',
  role              text        not null default 'staff' check (role in ('admin', 'staff')),
  access_documents  boolean     not null default false,
  access_parties    boolean     not null default false,
  access_company    boolean     not null default false,
  active            boolean     not null default true,
  created_at        timestamptz not null default now(),
  last_login        timestamptz
);

-- The very first account to sign up becomes the admin; everyone after that
-- starts as staff with no sections until an admin grants them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  first_user boolean;
begin
  select count(*) = 0 into first_user from public.profiles;

  insert into public.profiles (id, full_name, email, role, access_documents, access_parties, access_company)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    case when first_user then 'admin' else 'staff' end,
    first_user, first_user, first_user
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------- access helpers
-- SECURITY DEFINER so policies can read profiles without recursing into
-- the policies on profiles itself.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

create or replace function public.has_access(section text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active
      and (
        p.role = 'admin'
        or (section = 'documents' and p.access_documents)
        or (section = 'parties'   and p.access_parties)
        or (section = 'company'   and p.access_company)
      )
  );
$$;

-- ------------------------------------------------------------ master data
create table if not exists public.company_profile (
  id           int primary key default 1 check (id = 1),   -- single row
  name         text not null default '',
  address      text not null default '',
  bank_name    text not null default '',
  account_no   text not null default '',
  ifsc         text not null default '',
  swift        text not null default '',
  gst_no       text not null default '',
  iec_code     text not null default '',
  updated_at   timestamptz not null default now()
);
insert into public.company_profile (id) values (1) on conflict (id) do nothing;

create table if not exists public.parties (
  id                 uuid primary key default gen_random_uuid(),
  type               text not null check (type in ('international', 'domestic')),
  buyer_name         text not null,
  buyer_address      text not null default '',
  consignee_name     text not null default '',
  consignee_address  text not null default '',
  consignee_options  text[] not null default '{}',
  country            text not null default '',
  currency           text not null default 'USD' check (currency in ('USD', 'INR')),
  shipment_term      text not null default '',
  payment_term       text not null default '',
  conditions         text not null default '',
  port_of_loading    text not null default '',
  destination_port   text not null default '',
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id)
);

create table if not exists public.party_products (
  id                uuid primary key default gen_random_uuid(),
  party_id          uuid not null references public.parties(id) on delete cascade,
  name              text not null default '',
  hsn               text not null default '',
  rate              numeric(14,4) not null default 0,   -- per box, export
  mrp               numeric(14,4) not null default 0,   -- per box, domestic
  net_wt            numeric(12,4) not null default 0,   -- kg per box
  gross_wt          numeric(12,4) not null default 0,   -- kg per box
  packs_per_box     int           not null default 0,
  weight_per_pack_g numeric(12,2) not null default 0
);
create index if not exists party_products_party_idx on public.party_products(party_id);

-- --------------------------------------------------------------- documents
-- Documents keep their own copy of every value they were created with; the
-- *_id columns are for traceability only and are never re-read for display.
create table if not exists public.quotations (
  id             uuid primary key default gen_random_uuid(),
  doc_no         text not null unique,
  doc_date       date not null default current_date,
  party_id       uuid references public.parties(id) on delete set null,
  buyer_name     text not null default '',
  buyer_address  text not null default '',
  country        text not null default '',
  shipment_term  text not null default '',
  payment_term   text not null default '',
  igst           boolean not null default false,
  igst_rate      numeric(6,2) not null default 0,
  total_value    numeric(16,2) not null default 0,
  igst_amount    numeric(16,2) not null default 0,
  grand_total    numeric(16,2) not null default 0,
  items          jsonb not null default '[]',
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id)
);

create table if not exists public.proformas (
  id                 uuid primary key default gen_random_uuid(),
  doc_no             text not null unique,
  doc_date           date not null default current_date,
  type               text not null check (type in ('international', 'domestic')),
  party_id           uuid references public.parties(id) on delete set null,
  quotation_ref      text not null default '',
  buyer_name         text not null default '',
  buyer_address      text not null default '',
  consignee_name     text not null default '',
  consignee_address  text not null default '',
  consignee_options  text[] not null default '{}',
  port_of_loading    text not null default '',
  destination_port   text not null default '',
  shipment_term      text not null default '',
  payment_term       text not null default '',
  conditions         text not null default '',
  currency           text not null default 'USD',
  order_no           text not null default '',
  order_date         date,
  additional_details text not null default '',
  total_boxes        int not null default 0,
  total_value        numeric(16,2) not null default 0,
  taxable_value      numeric(16,2) not null default 0,
  tax_rate           numeric(6,2)  not null default 0,
  tax_amount         numeric(16,2) not null default 0,
  grand_total        numeric(16,2) not null default 0,
  items              jsonb not null default '[]',
  shipment_id        uuid,                    -- set once invoiced; NULL = open
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id)
);
create index if not exists proformas_open_idx on public.proformas(shipment_id) where shipment_id is null;

create table if not exists public.shipments (
  id                  uuid primary key default gen_random_uuid(),
  doc_no              text not null unique,
  tax_doc_no          text not null default '',
  commercial_doc_no   text not null default '',
  doc_date            date not null default current_date,
  proforma_id         uuid references public.proformas(id) on delete set null,
  proforma_no         text not null default '',
  proforma_date       date,
  buyer_name          text not null default '',
  buyer_address       text not null default '',
  order_no            text not null default '',
  order_date          date,
  exchange_rate       numeric(12,4) not null default 1,
  container_no        text not null default '',
  vehicle_no          text not null default '',
  customs_seal        text not null default '',
  line_seal           text not null default '',
  port_of_loading     text not null default '',
  incoterm            text not null default '',
  gst_percent         numeric(6,2)  not null default 0,
  round_off           numeric(16,2) not null default 0,
  freight             numeric(16,2) not null default 0,
  other_adjustment    numeric(16,2) not null default 0,
  other_reason        text not null default '',
  tax_invoice         jsonb not null default '{}',
  commercial_invoice  jsonb not null default '{}',
  packing_list        jsonb not null default '{}',
  company_snapshot    jsonb not null default '{}',
  items               jsonb not null default '[]',
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id)
);

alter table public.proformas
  drop constraint if exists proformas_shipment_fk;
alter table public.proformas
  add constraint proformas_shipment_fk
  foreign key (shipment_id) references public.shipments(id) on delete set null;

-- ------------------------------------------------------------- audit log
create table if not exists public.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text not null default '',
  action     text not null,
  detail     text not null default ''
);
create index if not exists audit_log_at_idx on public.audit_log(at desc);

-- ------------------------------------------------- document numbering
-- One independent series per document type, resetting each calendar year.
create table if not exists public.doc_counters (
  series text not null,
  year   int  not null,
  value  int  not null default 0,
  primary key (series, year)
);

create or replace function public.next_doc_no(series_key text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  y      int := extract(year from current_date);
  n      int;
  prefix text;
begin
  if not public.has_access('documents') then
    raise exception 'not authorised to create documents';
  end if;

  prefix := case series_key
    when 'quotation'       then 'DS-QUO'
    when 'pi_international' then 'DS-PI-INTL'
    when 'pi_domestic'     then 'DS-PI-DOM'
    when 'final'           then 'DS-INV'
    else null
  end;
  if prefix is null then
    raise exception 'unknown document series: %', series_key;
  end if;

  -- Atomic: concurrent callers can never take the same number.
  insert into public.doc_counters (series, year, value)
  values (series_key, y, 1)
  on conflict (series, year)
  do update set value = public.doc_counters.value + 1
  returning value into n;

  return prefix || '-' || y || '-' || lpad(n::text, 4, '0');
end;
$$;

-- ================================================================
--  Row level security
-- ================================================================
alter table public.profiles        enable row level security;
alter table public.company_profile enable row level security;
alter table public.parties         enable row level security;
alter table public.party_products  enable row level security;
alter table public.quotations      enable row level security;
alter table public.proformas       enable row level security;
alter table public.shipments       enable row level security;
alter table public.audit_log       enable row level security;
alter table public.doc_counters    enable row level security;

-- profiles: you can always read yourself; admins read and write everyone.
drop policy if exists profiles_self_read  on public.profiles;
drop policy if exists profiles_admin_read on public.profiles;
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_self_read   on public.profiles for select using (id = auth.uid());
create policy profiles_admin_read  on public.profiles for select using (public.is_admin());
create policy profiles_admin_write on public.profiles for all    using (public.is_admin()) with check (public.is_admin());

-- company profile: hidden entirely without the grant.
drop policy if exists company_read  on public.company_profile;
drop policy if exists company_write on public.company_profile;
create policy company_read  on public.company_profile for select using (public.has_access('company'));
create policy company_write on public.company_profile for update using (public.has_access('company')) with check (public.has_access('company'));

-- party master: hidden entirely without the grant.
drop policy if exists parties_read  on public.parties;
drop policy if exists parties_write on public.parties;
create policy parties_read  on public.parties for select using (public.has_access('parties'));
create policy parties_write on public.parties for all    using (public.has_access('parties')) with check (public.has_access('parties'));

drop policy if exists party_products_read  on public.party_products;
drop policy if exists party_products_write on public.party_products;
create policy party_products_read  on public.party_products for select using (public.has_access('parties'));
create policy party_products_write on public.party_products for all    using (public.has_access('parties')) with check (public.has_access('parties'));

-- documents: quotations, proformas and shipments travel together.
drop policy if exists quotations_read  on public.quotations;
drop policy if exists quotations_write on public.quotations;
create policy quotations_read  on public.quotations for select using (public.has_access('documents'));
create policy quotations_write on public.quotations for all    using (public.has_access('documents')) with check (public.has_access('documents'));

drop policy if exists proformas_read  on public.proformas;
drop policy if exists proformas_write on public.proformas;
create policy proformas_read  on public.proformas for select using (public.has_access('documents'));
create policy proformas_write on public.proformas for all    using (public.has_access('documents')) with check (public.has_access('documents'));

drop policy if exists shipments_read  on public.shipments;
drop policy if exists shipments_write on public.shipments;
create policy shipments_read  on public.shipments for select using (public.has_access('documents'));
create policy shipments_write on public.shipments for all    using (public.has_access('documents')) with check (public.has_access('documents'));

-- Documents need the party list to build a dropdown, but staff without the
-- party grant must not browse the master. The console reads parties only when
-- access_parties is set; proformas carry their own copy of everything else.

-- audit log: anyone signed in can append, only admins can read it back.
drop policy if exists audit_insert on public.audit_log;
drop policy if exists audit_read   on public.audit_log;
create policy audit_insert on public.audit_log for insert with check (auth.uid() is not null);
create policy audit_read   on public.audit_log for select using (public.is_admin());

-- counters are only ever touched through next_doc_no() (security definer).
drop policy if exists counters_no_direct on public.doc_counters;
create policy counters_no_direct on public.doc_counters for select using (public.is_admin());

-- ================================================================
--  After running this file
--  1. Authentication → Providers → Email: turn OFF "Confirm email" if you
--     want admin-created staff to sign in immediately with a temp password.
--  2. Sign up your own account FIRST — it is promoted to admin automatically.
--  3. Every account after that starts with no sections until you grant them
--     under Users & access.
-- ================================================================

-- =====================================================================
--  Applied 2026-09-05 to project jvpziatizbaghxhyslrg (ap-south-1)
-- =====================================================================

-- Realtime: broadcast row changes so two people working at the same time
-- see each other's edits without reloading. Realtime respects RLS, so each
-- client only receives rows their own grants already allow them to read.
alter publication supabase_realtime add table public.parties;
alter publication supabase_realtime add table public.party_products;
alter publication supabase_realtime add table public.quotations;
alter publication supabase_realtime add table public.proformas;
alter publication supabase_realtime add table public.shipments;
alter publication supabase_realtime add table public.company_profile;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.audit_log;

alter table public.parties        replica identity full;
alter table public.party_products replica identity full;
alter table public.quotations     replica identity full;
alter table public.proformas      replica identity full;
alter table public.shipments      replica identity full;

-- Lock down the SECURITY DEFINER helpers. handle_new_user is a trigger
-- function and must not be reachable over the REST API at all; the others
-- stay callable by signed-in users because RLS policies evaluate them.
revoke all     on function public.handle_new_user()      from anon, authenticated, public;
revoke execute on function public.is_admin()             from anon, public;
revoke execute on function public.has_access(text)       from anon, public;
revoke execute on function public.next_doc_no(text)      from anon, public;
grant  execute on function public.is_admin()        to authenticated;
grant  execute on function public.has_access(text)  to authenticated;
grant  execute on function public.next_doc_no(text) to authenticated;
