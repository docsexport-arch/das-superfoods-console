-- db/010 — one grant per toolbar section.
--
-- Access was three coarse grants (documents / parties / company). It is now one
-- grant per section an account can see:
--   overview · parties · quotations · proforma · shipments · analytics · company · users
-- An admin always holds all eight. Everyone else holds exactly what is ticked.
--
-- This changes WHO MAY READ AND WRITE, so it moves everything together
-- (Build Bible §9a): the column, the predicate, every policy, and every definer
-- function's own guard are changed in this one file, and the end of the file
-- asserts that nothing still gates on the retired predicate.
--
-- Supersedes the guards written in db/009 — that file now refuses to re-run.
--
-- Transition: the client on production today still reads and writes the three
-- legacy columns. A trigger keeps them and `sections` in step in both
-- directions until that client is retired; the legacy name 'documents' keeps
-- working in has_access() for the one function it still calls (next_doc_no).

-- ------------------------------------------------------------- the column
alter table public.profiles add column if not exists sections text[] not null default '{}';

-- Carry existing grants over, once. "documents" becomes the four document
-- sections; anyone who could see anything keeps the overview they already had.
update public.profiles p set sections =
  case when p.role = 'admin'
    then array['overview', 'parties', 'quotations', 'proforma', 'shipments', 'analytics', 'company', 'users']
    else array(
      select s from unnest(array['overview', 'parties', 'quotations', 'proforma', 'shipments', 'analytics', 'company', 'users'])
             with ordinality t(s, o)
      where (s = 'overview' and (p.access_documents or p.access_parties or p.access_company))
         or (s in ('quotations', 'proforma', 'shipments', 'analytics') and p.access_documents)
         or (s = 'parties' and p.access_parties)
         or (s = 'company' and p.access_company)
      order by o)
  end
where p.sections = '{}';

alter table public.profiles drop constraint if exists profiles_sections_valid;
alter table public.profiles add constraint profiles_sections_valid
  check (sections <@ array['overview', 'parties', 'quotations', 'proforma', 'shipments', 'analytics', 'company', 'users']::text[]);

-- ---------------------------------------------- keep both shapes in step
create or replace function public._profiles_sync_access()
returns trigger
language plpgsql set search_path = public
as $$
declare
  every_section constant text[] := array['overview', 'parties', 'quotations', 'proforma', 'shipments', 'analytics', 'company', 'users'];
  doc_sections  constant text[] := array['quotations', 'proforma', 'shipments', 'analytics'];
begin
  if new.role = 'admin' then
    new.sections := every_section;
  elsif tg_op = 'UPDATE' and new.sections is not distinct from old.sections then
    -- Only a legacy flag moved: that is the older client. Carry it into sections.
    if new.access_documents is distinct from old.access_documents then
      new.sections := case when new.access_documents
        then new.sections || doc_sections || array['overview']
        else array(select s from unnest(new.sections) s where s <> all (doc_sections)) end;
    end if;
    if new.access_parties is distinct from old.access_parties then
      new.sections := case when new.access_parties
        then new.sections || array['parties', 'overview'] else array_remove(new.sections, 'parties') end;
    end if;
    if new.access_company is distinct from old.access_company then
      new.sections := case when new.access_company
        then new.sections || array['company', 'overview'] else array_remove(new.sections, 'company') end;
    end if;
  elsif tg_op = 'INSERT' and new.sections = '{}' then
    if new.access_documents then new.sections := new.sections || doc_sections || array['overview']; end if;
    if new.access_parties   then new.sections := new.sections || array['parties', 'overview']; end if;
    if new.access_company   then new.sections := new.sections || array['company', 'overview']; end if;
  end if;

  -- One canonical order, no duplicates; the legacy flags are derived, never typed.
  new.sections := array(
    select s from unnest(every_section) with ordinality t(s, o) where s = any (new.sections) order by o);
  new.access_documents := new.sections && array['quotations', 'proforma', 'shipments'];
  new.access_parties   := 'parties' = any (new.sections);
  new.access_company   := 'company' = any (new.sections);
  return new;
end;
$$;

drop trigger if exists profiles_sync_access on public.profiles;
create trigger profiles_sync_access
  before insert or update on public.profiles
  for each row execute function public._profiles_sync_access();

-- --------------------------------------------------------- the predicate
-- Checks `active` — a deactivated account fails closed, whatever it holds.
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
        or section = any (p.sections)
        -- legacy name, still passed by next_doc_no() for the client live today
        or (section = 'documents' and p.sections && array['quotations', 'proforma', 'shipments'])
      )
  );
$$;

-- ---------------------------------------------------------------- policies
-- Named table by table on purpose: a loop over a list that mixes tiers is how
-- a write policy once handed out read access nobody decided to give.
drop policy if exists parties_read  on public.parties;
drop policy if exists parties_write on public.parties;
create policy parties_read  on public.parties for select using (public.has_access('parties'));
create policy parties_write on public.parties for all    using (public.has_access('parties')) with check (public.has_access('parties'));

drop policy if exists party_products_read  on public.party_products;
drop policy if exists party_products_write on public.party_products;
create policy party_products_read  on public.party_products for select using (public.has_access('parties'));
create policy party_products_write on public.party_products for all    using (public.has_access('parties')) with check (public.has_access('parties'));

drop policy if exists quotations_read  on public.quotations;
drop policy if exists quotations_write on public.quotations;
create policy quotations_read  on public.quotations for select using (public.has_access('quotations'));
create policy quotations_write on public.quotations for all    using (public.has_access('quotations')) with check (public.has_access('quotations'));

-- A shipment is raised against a proforma, so the shipments grant can READ
-- proformas (to pick one). Only the proforma grant can write them.
drop policy if exists proformas_read  on public.proformas;
drop policy if exists proformas_write on public.proformas;
create policy proformas_read  on public.proformas for select
  using (public.has_access('proforma') or public.has_access('shipments'));
create policy proformas_write on public.proformas for all
  using (public.has_access('proforma')) with check (public.has_access('proforma'));

drop policy if exists shipments_read  on public.shipments;
drop policy if exists shipments_write on public.shipments;
create policy shipments_read  on public.shipments for select using (public.has_access('shipments'));
create policy shipments_write on public.shipments for all    using (public.has_access('shipments')) with check (public.has_access('shipments'));

drop policy if exists company_read  on public.company_profile;
drop policy if exists company_write on public.company_profile;
create policy company_read  on public.company_profile for select using (public.has_access('company'));
create policy company_write on public.company_profile for update using (public.has_access('company')) with check (public.has_access('company'));

-- The users grant shows the account list and the audit log. It does NOT let a
-- non-admin change anyone's access: that would let them grant it to themselves.
drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_admin_read on public.profiles for select
  using (public.is_admin() or public.has_access('users'));

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select
  using (public.is_admin() or public.has_access('users'));

-- ------------------------------------------------- every function's guard
-- Rewritten from the LIVE definitions, not re-typed: a plpgsql body is only
-- parsed when it first runs, so a re-typed function can apply clean and break later.
do $$
declare
  r   record;
  def text;
begin
  for r in
    select * from (values
      ('public.save_quotation(jsonb)'::regprocedure,   'quotations'),
      ('public.delete_quotation(uuid)'::regprocedure,  'quotations'),
      ('public.create_proforma(jsonb)'::regprocedure,  'proforma'),
      ('public.create_shipment(jsonb)'::regprocedure,  'shipments')
    ) v(fn, section)
  loop
    def := pg_get_functiondef(r.fn);
    def := replace(def, 'has_access(''documents'')', format('has_access(%L)', r.section));
    def := replace(def, 'You do not have access to documents.', format('You do not have access to %s.', r.section));
    if position(format('has_access(%L)', r.section) in def) = 0 then
      raise exception 'db/010: % has no guard to repoint', r.fn;
    end if;
    execute def;
  end loop;
end $$;

-- ------------------------------------------------------ changing a grant
-- Only keys that are present are written. A demotion with no sections named
-- leaves the account holding nothing, rather than everything an admin had.
create or replace function public.set_user_access(p_user uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_before   public.profiles;
  v_after    public.profiles;
  v_role     text;
  v_sections text[];
begin
  if not public.is_admin() then perform public._fail(403, 'Only an administrator can manage accounts.'); end if;
  select * into v_before from public.profiles where id = p_user for update;
  if not found then perform public._fail(404, 'That account no longer exists.'); end if;

  v_role := coalesce(nullif(p ->> 'role', ''), v_before.role);
  if v_role not in ('admin', 'staff') then perform public._fail(400, 'Role must be admin or staff.'); end if;

  if p_user = auth.uid() and (v_role <> v_before.role or coalesce((p ->> 'active')::boolean, true) = false) then
    perform public._fail(400, 'You cannot change your own role or deactivate yourself — ask another administrator.');
  end if;

  if p ? 'sections' then
    if jsonb_typeof(p -> 'sections') is distinct from 'array' then
      perform public._fail(400, 'Sections must be a list.');
    end if;
    select coalesce(array_agg(x), '{}') into v_sections from jsonb_array_elements_text(p -> 'sections') x;
    if not v_sections <@ array['overview', 'parties', 'quotations', 'proforma', 'shipments', 'analytics', 'company', 'users'] then
      perform public._fail(400, 'Unknown section in the list.');
    end if;
  elsif v_before.role = 'admin' and v_role = 'staff' then
    v_sections := '{}';
  else
    v_sections := v_before.sections;
  end if;

  update public.profiles set
    role      = v_role,
    sections  = v_sections,
    full_name = case when p ? 'fullName' then btrim(p ->> 'fullName') else full_name end,
    active    = case when p ? 'active'   then (p ->> 'active')::boolean else active end
  where id = p_user
  returning * into v_after;

  perform public._audit('Access changed', 'user', p_user::text, v_after.email, to_jsonb(v_before), to_jsonb(v_after));
end;
$$;

-- Internals stay out of the API (by shape, so the new trigger function is covered).
do $$
declare r record;
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
  -- 1. No function still gates on the retired predicate. next_doc_no keeps the
  --    legacy name on purpose (the client live today calls it); has_access
  --    itself is where the legacy name is interpreted.
  with fns as materialized (
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  )
  select string_agg(f.proname, ', ') into bad from fns f
  where f.proname not in ('next_doc_no', 'has_access')
    and pg_get_functiondef(f.oid) like '%has_access(''documents'')%';
  if bad is not null then raise exception 'db/010: still gating on the old predicate: %', bad; end if;

  -- 2. No policy still names it either.
  select string_agg(tablename || '.' || policyname, ', ') into bad from pg_policies
  where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) like '%''documents''%';
  if bad is not null then raise exception 'db/010: policy still names the old grant: %', bad; end if;

  -- 3. Every admin holds all eight; the legacy flags agree with sections for everyone.
  select string_agg(email, ', ') into bad from public.profiles
  where (role = 'admin' and cardinality(sections) <> 8)
     or access_documents is distinct from (sections && array['quotations', 'proforma', 'shipments'])
     or access_parties   is distinct from ('parties' = any (sections))
     or access_company   is distinct from ('company' = any (sections));
  if bad is not null then raise exception 'db/010: sections and legacy flags disagree for: %', bad; end if;

  -- 4. Still nothing callable without signing in, and no internal reachable.
  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (has_function_privilege('anon', p.oid, 'execute')
      or ((p.proname like '\_%' or p.prorettype = 'trigger'::regtype)
          and has_function_privilege('authenticated', p.oid, 'execute')));
  if bad is not null then raise exception 'db/010: function reachable that should not be: %', bad; end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (10, 'per_section_access') on conflict (id) do nothing;

select 'db/010 ✓ one grant per section; policies and function guards repointed together' as status;
