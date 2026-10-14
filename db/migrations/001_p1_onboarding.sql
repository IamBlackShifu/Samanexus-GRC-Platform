-- Apply after db/schema.sql. Safe to rerun; creation and framework selection are atomic.
begin;
alter table public.organisations add column if not exists setup_key uuid unique;
create table if not exists public.org_frameworks (
  org_id uuid not null references public.organisations(id) on delete cascade,
  framework_id uuid not null references public.frameworks(id) on delete restrict,
  selected_at timestamptz not null default now(),
  selected_by uuid references public.users(id) on delete set null,
  primary key (org_id, framework_id)
);
alter table public.org_frameworks enable row level security;
drop policy if exists org_frameworks_read on public.org_frameworks;
create policy org_frameworks_read on public.org_frameworks for select to authenticated
  using (public.is_super_admin() or org_id = public.current_org_id());
insert into public.frameworks(code, name, version, description)
values ('CE', 'Cyber Essentials', 'Danzell 2026', 'Preparation for the Cyber Essentials verified self-assessment.')
on conflict (code) do nothing;
-- Existing tracked controls establish existing selections; no organisations are deleted.
insert into public.org_frameworks(org_id, framework_id)
select distinct oc.org_id, c.framework_id from public.org_controls oc join public.controls c on c.id = oc.control_id
on conflict do nothing;

create or replace function public.create_client_workspace(
  p_setup_key uuid, p_name text, p_sector public.organisation_sector,
  p_size public.organisation_size, p_contact_name text, p_contact_email text,
  p_framework_codes text[]
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_org public.organisations;
  v_actor uuid := auth.uid();
begin
  if not exists (select 1 from public.users where id = v_actor and role = 'super_admin' and status = 'active')
     or coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'Active super admin with MFA required' using errcode = '42501';
  end if;
  if p_setup_key is null or length(trim(p_name)) not between 2 and 255
     or length(trim(p_contact_name)) not between 2 and 255
     or length(p_contact_email) > 255 or p_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid organisation details' using errcode = '22023';
  end if;
  if p_framework_codes is null or cardinality(p_framework_codes) <> 1 or p_framework_codes[1] <> 'CE'
     or not exists (select 1 from public.frameworks where code = 'CE' and is_active) then
    raise exception 'Select the available Cyber Essentials framework' using errcode = '22023';
  end if;
  insert into public.organisations(name, sector, size, primary_contact_name, primary_contact_email, created_by, setup_key)
  values (trim(p_name), p_sector, p_size, trim(p_contact_name), lower(trim(p_contact_email)), v_actor, p_setup_key)
  on conflict (setup_key) do nothing returning * into v_org;
  if v_org.id is null then
    select * into v_org from public.organisations where setup_key = p_setup_key and created_by = v_actor;
    if v_org.id is null then raise exception 'Setup request unavailable' using errcode = '42501'; end if;
    if v_org.name <> trim(p_name) or v_org.sector <> p_sector or v_org.size <> p_size
       or v_org.primary_contact_name <> trim(p_contact_name) or v_org.primary_contact_email <> lower(trim(p_contact_email)) then
      raise exception 'This setup request already created a different workspace' using errcode = '22023';
    end if;
    return jsonb_build_object('id', v_org.id, 'name', v_org.name);
  end if;
  insert into public.org_frameworks(org_id, framework_id, selected_by)
  select v_org.id, id, v_actor from public.frameworks where code = any(p_framework_codes) and is_active;
  insert into public.org_controls(org_id, control_id)
  select v_org.id, c.id from public.controls c join public.frameworks f on f.id = c.framework_id
  where f.code = any(p_framework_codes) and f.is_active;
  insert into public.licenses(org_id, managed_by) values (v_org.id, v_actor);
  insert into public.audit_events(org_id, user_id, action, record_type, record_id, details)
  values (v_org.id, v_actor, 'organisation.created', 'organisation', v_org.id,
    jsonb_build_object('frameworks', p_framework_codes));
  return jsonb_build_object('id', v_org.id, 'name', v_org.name);
end;
$$;
revoke all on function public.create_client_workspace(uuid, text, public.organisation_sector, public.organisation_size, text, text, text[]) from public, anon;
grant execute on function public.create_client_workspace(uuid, text, public.organisation_sector, public.organisation_size, text, text, text[]) to authenticated;
-- Service-only invitation ledger; account provisioning never trusts user-editable metadata.
create table if not exists public.client_invitations (
  email text primary key,
  org_id uuid not null references public.organisations(id) on delete cascade,
  full_name text not null,
  role public.user_role not null check (role in ('org_admin', 'org_member', 'auditor')),
  expires_at timestamptz not null,
  sent_at timestamptz,
  accepted_at timestamptz
);
alter table public.client_invitations enable row level security;
revoke all on public.client_invitations from anon, authenticated;
create or replace function public.provision_invited_client()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_invite public.client_invitations;
begin
  select * into v_invite from public.client_invitations
  where email = lower(new.email) and expires_at > now() and accepted_at is null;
  if v_invite.email is not null then
    insert into public.users(id, org_id, email, role, full_name, status)
    values(new.id, v_invite.org_id, lower(new.email), v_invite.role, v_invite.full_name, 'invited');
  end if;
  return new;
end;
$$;
revoke all on function public.provision_invited_client() from public, anon, authenticated;
drop trigger if exists provision_invited_client on auth.users;
create trigger provision_invited_client after insert on auth.users
for each row execute function public.provision_invited_client();
-- An invited or suspended profile has no tenant data access until activation.
create or replace function public.current_user_role()
returns public.user_role language sql stable security definer set search_path = public
as $$ select role from public.users where id = auth.uid() and status = 'active' $$;
create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public
as $$ select org_id from public.users where id = auth.uid() and status = 'active' $$;
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select public.current_user_role() = 'super_admin' and coalesce(auth.jwt()->>'aal', '') = 'aal2' $$;
drop policy if exists users_update on public.users;
create policy users_update on public.users for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.activate_invited_client(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_user public.users; v_invite public.client_invitations;
begin
  select * into v_user from public.users where id = p_user_id for update;
  select * into v_invite from public.client_invitations where email = v_user.email for update;
  if v_user.status <> 'invited' or v_invite.org_id is null or v_invite.org_id <> v_user.org_id
     or v_invite.role <> v_user.role or v_invite.accepted_at is not null or v_invite.expires_at <= now()
     or not exists(select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    raise exception 'Valid verified invitation required' using errcode = '42501';
  end if;
  update public.users set status = 'active' where id = p_user_id;
  update public.client_invitations set accepted_at = now() where email = v_user.email;
  insert into public.audit_events(org_id, user_id, action, record_type, record_id)
  values(v_user.org_id, p_user_id, 'invitation.accepted', 'user', p_user_id);
  return v_user.org_id;
end;
$$;
revoke all on function public.activate_invited_client(uuid) from public, anon, authenticated;
grant execute on function public.activate_invited_client(uuid) to service_role;
grant all on public.client_invitations to service_role;
commit;
