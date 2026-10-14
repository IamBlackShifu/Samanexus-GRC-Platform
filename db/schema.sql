create extension if not exists pgcrypto;

create type public.organisation_sector as enum ('care', 'professional_services', 'charity', 'other');
create type public.organisation_size as enum ('micro', 'small', 'medium');
create type public.organisation_status as enum ('active', 'archived', 'suspended');
create type public.subscription_tier as enum ('basic', 'silver', 'gold');
create type public.user_role as enum ('super_admin', 'org_admin', 'org_member', 'auditor');
create type public.user_status as enum ('active', 'invited', 'suspended');
create type public.control_status as enum ('not_started', 'in_progress', 'implemented', 'not_applicable');
create type public.task_priority as enum ('critical', 'high', 'medium', 'low');
create type public.task_status as enum ('not_started', 'in_progress', 'complete', 'blocked');
create type public.license_status as enum ('trial', 'active', 'past_due', 'cancelled', 'expired');

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name varchar(255) not null,
  sector public.organisation_sector not null,
  size public.organisation_size not null,
  primary_contact_name varchar(255) not null,
  primary_contact_email varchar(255) not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  status public.organisation_status not null default 'active',
  subscription_tier public.subscription_tier not null default 'basic'
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references public.organisations(id) on delete restrict,
  email varchar(255) not null unique,
  role public.user_role not null default 'org_member',
  full_name varchar(255) not null,
  mfa_enabled boolean not null default false,
  last_login timestamptz,
  status public.user_status not null default 'invited',
  created_at timestamptz not null default now(),
  constraint non_admin_must_have_org check (role = 'super_admin' or org_id is not null)
);

alter table public.organisations
  add constraint organisations_created_by_fkey foreign key (created_by) references public.users(id) on delete set null;

create table public.frameworks (
  id uuid primary key default gen_random_uuid(),
  code varchar(50) not null unique,
  name varchar(255) not null,
  version varchar(50) not null,
  is_active boolean not null default true,
  description text not null
);

create table public.controls (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid not null references public.frameworks(id) on delete cascade,
  reference varchar(100) not null,
  domain varchar(255) not null,
  title varchar(500) not null,
  description text not null,
  is_auto_fail boolean not null default false,
  weight integer not null default 1 check (weight between 1 and 10),
  guidance text not null,
  unique (framework_id, reference)
);

create table public.org_controls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  control_id uuid not null references public.controls(id) on delete cascade,
  status public.control_status not null default 'not_started',
  applicability_justification text,
  completion_date date,
  last_reviewed timestamptz,
  reviewed_by uuid references public.users(id) on delete set null,
  notes text,
  unique (org_id, control_id),
  constraint not_applicable_requires_justification check (status <> 'not_applicable' or nullif(trim(applicability_justification), '') is not null)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  control_id uuid references public.controls(id) on delete set null,
  title varchar(500) not null,
  description text not null default '',
  assigned_to uuid references public.users(id) on delete set null,
  created_by uuid not null references public.users(id) on delete restrict,
  due_date date,
  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'not_started',
  completion_note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint completed_tasks_require_note check (status <> 'complete' or nullif(trim(completion_note), '') is not null)
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  control_id uuid not null references public.controls(id) on delete restrict,
  task_id uuid references public.tasks(id) on delete set null,
  file_name varchar(500) not null,
  file_type varchar(50) not null,
  file_size integer not null check (file_size between 1 and 52428800),
  storage_key varchar(1000) not null unique,
  uploaded_by uuid not null references public.users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  expiry_date date,
  version integer not null default 1 check (version > 0),
  superseded_by uuid references public.evidence(id) on delete restrict,
  description text not null default ''
);

create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  framework_id uuid not null references public.frameworks(id) on delete restrict,
  certification_body varchar(255) not null,
  certificate_number varchar(255) not null,
  issued_date date not null,
  expiry_date date not null,
  certificate_file_id uuid references public.evidence(id) on delete set null,
  status varchar(20) not null default 'active' check (status in ('active', 'expired', 'withdrawn'))
);

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organisations(id) on delete cascade,
  tier public.subscription_tier not null default 'basic',
  status public.license_status not null default 'trial',
  seat_limit integer not null default 5 check (seat_limit > 0),
  starts_at date not null default current_date,
  ends_at date,
  external_reference varchar(255),
  managed_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint license_dates_valid check (ends_at is null or ends_at >= starts_at)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organisations(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  action varchar(100) not null,
  record_type varchar(100) not null,
  record_id uuid,
  ip_address inet,
  user_agent text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index users_org_id_idx on public.users(org_id);
create index controls_framework_id_idx on public.controls(framework_id);
create index org_controls_org_id_idx on public.org_controls(org_id);
create index tasks_org_status_idx on public.tasks(org_id, status);
create index evidence_org_id_idx on public.evidence(org_id);
create index certifications_expiry_idx on public.certifications(expiry_date);
create index licenses_status_ends_idx on public.licenses(status, ends_at);
create index audit_events_org_created_idx on public.audit_events(org_id, created_at desc);

create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.users where id = auth.uid() $$;

create or replace function public.current_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select org_id from public.users where id = auth.uid() $$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.current_user_role() = 'super_admin' $$;

alter table public.organisations enable row level security;
alter table public.users enable row level security;
alter table public.frameworks enable row level security;
alter table public.controls enable row level security;
alter table public.org_controls enable row level security;
alter table public.tasks enable row level security;
alter table public.evidence enable row level security;
alter table public.certifications enable row level security;
alter table public.licenses enable row level security;
alter table public.audit_events enable row level security;

create policy organisations_select on public.organisations for select to authenticated
  using (public.is_super_admin() or id = public.current_org_id());
create policy organisations_insert on public.organisations for insert to authenticated
  with check (public.is_super_admin());
create policy organisations_update on public.organisations for update to authenticated
  using (public.is_super_admin() or (id = public.current_org_id() and public.current_user_role() = 'org_admin'))
  with check (public.is_super_admin() or id = public.current_org_id());

create policy users_select on public.users for select to authenticated
  using (public.is_super_admin() or org_id = public.current_org_id() or id = auth.uid());
create policy users_update on public.users for update to authenticated
  using (public.is_super_admin() or (org_id = public.current_org_id() and public.current_user_role() = 'org_admin'))
  with check (public.is_super_admin() or org_id = public.current_org_id());

create policy frameworks_read on public.frameworks for select to authenticated using (is_active = true or public.is_super_admin());
create policy controls_read on public.controls for select to authenticated using (true);
create policy org_controls_tenant on public.org_controls for all to authenticated
  using (public.is_super_admin() or org_id = public.current_org_id())
  with check (public.is_super_admin() or org_id = public.current_org_id());
create policy tasks_tenant on public.tasks for all to authenticated
  using (public.is_super_admin() or org_id = public.current_org_id())
  with check (public.is_super_admin() or org_id = public.current_org_id());
create policy evidence_tenant on public.evidence for all to authenticated
  using (public.is_super_admin() or org_id = public.current_org_id())
  with check (public.is_super_admin() or org_id = public.current_org_id());
create policy certifications_tenant on public.certifications for all to authenticated
  using (public.is_super_admin() or org_id = public.current_org_id())
  with check (public.is_super_admin() or org_id = public.current_org_id());
create policy licenses_read on public.licenses for select to authenticated
  using (public.is_super_admin() or org_id = public.current_org_id());
create policy licenses_manage on public.licenses for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
create policy audit_events_read on public.audit_events for select to authenticated
  using (public.is_super_admin() or org_id = public.current_org_id());
create policy audit_events_insert on public.audit_events for insert to authenticated
  with check (user_id = auth.uid() and (public.is_super_admin() or org_id = public.current_org_id()));

revoke update, delete on public.audit_events from authenticated;