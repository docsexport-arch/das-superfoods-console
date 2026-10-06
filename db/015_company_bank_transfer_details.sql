-- db/015 — the company profile carries the full bank details for a transfer.
--
-- A proforma has to tell the buyer where to send the money: the name the
-- account is held in, the bank, the branch, the account number and the SWIFT
-- code. The profile already had bank, account number and SWIFT. This adds the
-- two that were missing:
--   account_name — the beneficiary name, exactly as the bank holds it
--   bank_branch  — the branch and its address
--
-- Additive only: two columns with defaults, and save_company learns two keys.
-- The client on production today updates the columns it knows by name and is
-- unaffected.
--
-- A save that does not carry the new keys leaves the stored values alone — a
-- browser tab still running an older copy of the console must not blank them.
--
-- The values themselves are typed by the owner on the Company page. Nothing
-- here writes a bank detail.

alter table public.company_profile
  add column if not exists account_name text not null default '',
  add column if not exists bank_branch  text not null default '';

comment on column public.company_profile.account_name is
  'Beneficiary name for a bank transfer, as the bank holds it. Printed on the proforma.';
comment on column public.company_profile.bank_branch is
  'Bank branch and its address. Printed on the proforma.';

-- db/014's function with the two keys added; everything else is unchanged.
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
    -- Added in db/015. A save that does not carry these keys leaves them as
    -- they are: an older copy of the console must not blank them.
    account_name = case when p ? 'accountName' then btrim(coalesce(p ->> 'accountName', '')) else account_name end,
    bank_branch  = case when p ? 'bankBranch'  then btrim(coalesce(p ->> 'bankBranch', ''))  else bank_branch end,
    swift = coalesce(p ->> 'swift', ''),
    gst_no = coalesce(p ->> 'gstNo', ''), iec_code = coalesce(p ->> 'iecCode', ''),
    updated_at = now()
  where id = 1
  returning to_jsonb(company_profile) into v_after;
  perform public._audit('Company profile edited', 'company', '1', coalesce(p ->> 'name', ''), v_before, v_after);
end;
$$;

-- ------------------------------------------------------------------ gates
do $$
declare
  def text := pg_get_functiondef('public.save_company(jsonb)'::regprocedure);
  missing text;
begin
  -- 1. Both columns exist and are never null.
  select string_agg(c, ', ') into missing
  from unnest(array['account_name', 'bank_branch']) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'company_profile' and column_name = c
      and is_nullable = 'NO' and data_type = 'text');
  if missing is not null then raise exception 'db/015: company_profile is missing: %', missing; end if;

  -- 2. The function reads both keys, keeps what an older client does not send,
  --    still checks the caller, and still does not touch IFSC.
  if def not like '%''accountName''%' or def not like '%''bankBranch''%' then
    raise exception 'db/015: save_company does not read the new keys';
  end if;
  if def not like '%p ? ''accountName''%' or def not like '%p ? ''bankBranch''%' then
    raise exception 'db/015: save_company would blank a value an older client did not send';
  end if;
  if def not like '%has_access(''company'')%' then raise exception 'db/015: save_company lost its access check'; end if;
  if def ilike '%ifsc%' then raise exception 'db/015: save_company handles IFSC again'; end if;

  -- 3. Replacing it did not open it to anyone signed out.
  if has_function_privilege('anon', 'public.save_company(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_company(jsonb)', 'execute') then
    raise exception 'db/015: save_company has the wrong grants';
  end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (15, 'company_bank_transfer_details') on conflict (id) do nothing;

select 'db/015 ✓ company profile carries account name and branch; save_company reads them' as status;
