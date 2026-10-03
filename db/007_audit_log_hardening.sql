-- db/007 — the audit log becomes append-only and stops trusting the client.
--
-- Until now the browser inserted its own audit rows and supplied the actor's
-- name itself, so the trail was forgeable (Bible §9a: "never authorize from an
-- argument the caller controls"). From here the log is written INSIDE the
-- definer RPCs (§9e), the actor is derived from auth.uid(), and no role —
-- service_role included — can update, delete or truncate a row.
-- The client's insert policy stays until db/010, when the RPC-only client is live.

alter table public.audit_log
  add column if not exists actor_id  uuid,
  add column if not exists entity    text not null default '',
  add column if not exists entity_id text not null default '',
  add column if not exists before    jsonb,
  add column if not exists after     jsonb;

create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);

create or replace function public._audit_log_append_only()
returns trigger
language plpgsql set search_path = public
as $$
begin
  raise exception using errcode = 'PT403', message = 'The audit log is append-only.';
end;
$$;

drop trigger if exists audit_log_no_rewrite on public.audit_log;
create trigger audit_log_no_rewrite
  before update or delete on public.audit_log
  for each row execute function public._audit_log_append_only();

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public._audit_log_append_only();

-- The only writer. Not an API: reachable from definer functions alone.
create or replace function public._audit(
  p_action text, p_entity text, p_entity_id text, p_detail text,
  p_before jsonb default null, p_after jsonb default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_actor text;
begin
  select email into v_actor from public.profiles where id = auth.uid();
  insert into public.audit_log (actor, actor_id, action, entity, entity_id, detail, before, after)
  values (coalesce(v_actor, 'system'), auth.uid(), p_action,
          coalesce(p_entity, ''), coalesce(p_entity_id, ''), coalesce(p_detail, ''), p_before, p_after);
end;
$$;
revoke all on function public._audit(text, text, text, text, jsonb, jsonb) from anon, authenticated, public;

-- Sign-in / sign-out / own-password events. The caller chooses from a fixed
-- list and nothing else; who they are comes from the session.
create or replace function public.log_session_event(p_event text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = 'PT401', message = 'Not signed in.';
  end if;
  if p_event not in ('Signed in', 'Signed out', 'Password changed') then
    raise exception using errcode = 'PT400', message = 'Unknown session event.';
  end if;
  perform public._audit(p_event, 'session', auth.uid()::text, '');
  if p_event = 'Signed in' then
    update public.profiles set last_login = now() where id = auth.uid();
  end if;
end;
$$;
revoke all on function public.log_session_event(text) from anon, public;
grant execute on function public.log_session_event(text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public._audit(text,text,text,text,jsonb,jsonb)', 'execute') then
    raise exception 'db/007: _audit is callable by authenticated';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.audit_log'::regclass and not tgisinternal) < 2 then
    raise exception 'db/007: audit_log is missing an append-only trigger';
  end if;
end $$;

insert into public.app_schema_migrations (id, name)
values (7, 'audit_log_hardening') on conflict (id) do nothing;

select 'db/007 ✓ audit log append-only, actor derived server-side' as status;
