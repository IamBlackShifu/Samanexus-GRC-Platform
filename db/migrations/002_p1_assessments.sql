-- Apply after 001_p1_onboarding.sql. Versioned preparation assessments and atomic writes.
begin;
create table if not exists public.assessment_catalogues (
  version text primary key,
  catalogue jsonb not null check (catalogue->>'version' = version and jsonb_typeof(catalogue->'questions') = 'array'),
  published_at timestamptz not null default now()
);
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  catalogue_version text not null references public.assessment_catalogues(version) on delete restrict,
  catalogue jsonb not null,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  cursor text not null default '',
  status text not null default 'draft' check (status in ('draft', 'paused', 'reviewed')),
  revision integer not null default 0 check (revision >= 0),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (org_id, catalogue_version),
  check (catalogue->>'version' = catalogue_version)
);
create index if not exists assessments_org_updated_idx on public.assessments(org_id, updated_at desc);
alter table public.tasks add column if not exists assessment_id uuid references public.assessments(id) on delete restrict;
alter table public.tasks add column if not exists assessment_reference text;
alter table public.tasks add column if not exists assessment_gap_state text
  check (assessment_gap_state in ('open', 'resolved', 'not_applicable'));
create unique index if not exists tasks_assessment_reference_idx on public.tasks(assessment_id, assessment_reference);
alter table public.assessment_catalogues enable row level security;
alter table public.assessments enable row level security;
drop policy if exists assessment_catalogues_read on public.assessment_catalogues;
create policy assessment_catalogues_read on public.assessment_catalogues for select to authenticated
  using (public.current_user_role() is not null);
drop policy if exists assessments_read on public.assessments;
create policy assessments_read on public.assessments for select to authenticated
  using ((public.is_super_admin() or (org_id = public.current_org_id() and public.current_user_role() in ('org_admin', 'org_member', 'auditor')))
    and exists(select 1 from public.organisations o where o.id = assessments.org_id and o.status = 'active'));
revoke all on public.assessments, public.assessment_catalogues from anon, authenticated;
grant select on public.assessments, public.assessment_catalogues to authenticated;

create or replace function public.keep_assessment_catalogue_immutable()
returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Publish a new catalogue version instead of changing an existing version'; end;
$$;
drop trigger if exists keep_assessment_catalogue_immutable on public.assessment_catalogues;
create trigger keep_assessment_catalogue_immutable before update or delete on public.assessment_catalogues
for each row execute function public.keep_assessment_catalogue_immutable();

create or replace function public.assert_assessment_access(p_org_id uuid, p_write boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_user public.users;
begin
  select * into v_user from public.users where id = auth.uid() and status = 'active';
  if v_user.id is null or not exists(select 1 from public.organisations where id = p_org_id and status = 'active') then
    raise exception 'Active organisation access required' using errcode = '42501';
  end if;
  if v_user.role = 'super_admin' then
    if not public.is_super_admin() then raise exception 'MFA required' using errcode = '42501'; end if;
  elsif v_user.org_id <> p_org_id or v_user.role not in ('org_admin', 'org_member', 'auditor') or (p_write and v_user.role = 'auditor') then
    raise exception 'Assessment access denied' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.assessment_answer_state(p_question jsonb, p_answers jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare v_value jsonb; v_dependency jsonb;
begin
  if p_question ? 'when' then
    v_dependency := p_answers->(p_question->'when'->>'reference')->'value';
    if v_dependency is null or v_dependency = 'null'::jsonb or v_dependency = '""'::jsonb then return 'pending_scope'; end if;
    if not exists(select 1 from jsonb_array_elements(p_question->'when'->'values') v where v = v_dependency) then return 'not_applicable'; end if;
  end if;
  v_value := p_answers->(p_question->>'reference')->'value';
  if v_value is null or v_value = 'null'::jsonb or (jsonb_typeof(v_value) = 'string' and length(trim(v_value #>> '{}')) = 0) then return 'unanswered'; end if;
  if p_question->>'type' = 'text' or not (p_question ? 'passValues') then return 'complete'; end if;
  if exists(select 1 from jsonb_array_elements(p_question->'passValues') v where v = v_value) then return 'pass'; end if;
  if (p_question->>'critical')::boolean then return 'critical_gap'; end if;
  return 'gap';
end;
$$;

create or replace function public.assessment_result(p_catalogue jsonb, p_answers jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare q jsonb; s text; v_required int := 0; v_answered int := 0;
  v_scored int := 0; v_satisfied int := 0; v_gaps int := 0; v_critical int := 0;
begin
  for q in select value from jsonb_array_elements(p_catalogue->'questions') loop
    s := public.assessment_answer_state(q, p_answers);
    if s = 'not_applicable' then continue; end if;
    v_required := v_required + 1;
    if s not in ('unanswered', 'pending_scope') then v_answered := v_answered + 1; end if;
    if q ? 'passValues' then v_scored := v_scored + 1; end if;
    if s = 'pass' then v_satisfied := v_satisfied + 1; end if;
    if s in ('gap', 'critical_gap') then v_gaps := v_gaps + 1; end if;
    if s = 'critical_gap' then v_critical := v_critical + 1; end if;
  end loop;
  return jsonb_build_object('required', v_required, 'answered', v_answered, 'unanswered', v_required - v_answered,
    'scored', v_scored, 'satisfied', v_satisfied, 'gapCount', v_gaps, 'criticalCount', v_critical,
    'readiness', case when v_scored = 0 then 0 else floor(100.0 * v_satisfied / v_scored)::integer end,
    'outcome', case when v_critical > 0 then 'critical_gaps' when v_answered < v_required then 'incomplete' when v_gaps > 0 then 'gaps' else 'checks_satisfied' end);
end;
$$;

create or replace function public.start_assessment(p_org_id uuid, p_catalogue_version text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.assessments; c jsonb; v_inserted boolean;
begin
  perform public.assert_assessment_access(p_org_id, true);
  if not exists(select 1 from public.org_frameworks ofr join public.frameworks f on f.id = ofr.framework_id where ofr.org_id = p_org_id and f.code = 'CE' and f.is_active) then
    raise exception 'Select Cyber Essentials for this organisation first' using errcode = '22023';
  end if;
  select catalogue into c from public.assessment_catalogues where version = p_catalogue_version;
  if c is null then raise exception 'Question set unavailable' using errcode = '22023'; end if;
  insert into public.assessments(org_id, catalogue_version, catalogue, created_by, updated_by, cursor)
  values(p_org_id, p_catalogue_version, c, auth.uid(), auth.uid(), c->'questions'->0->>'reference')
  on conflict (org_id, catalogue_version) do nothing returning * into a;
  v_inserted := a.id is not null;
  if not v_inserted then select * into a from public.assessments where org_id = p_org_id and catalogue_version = p_catalogue_version; end if;
  if v_inserted then
    insert into public.audit_events(org_id, user_id, action, record_type, record_id)
    values(p_org_id, auth.uid(), 'assessment.started', 'assessment', a.id);
  end if;
  return to_jsonb(a);
end;
$$;

create or replace function public.portfolio_assessment_summaries(p_org_ids uuid[])
returns table (org_id uuid, assessment_id uuid, status text, updated_at timestamptz, summary jsonb)
language sql stable security invoker set search_path = public as $$
  select latest.org_id, latest.id, latest.status, latest.updated_at,
    public.assessment_result(latest.catalogue, latest.answers)
  from (
    select distinct on (a.org_id) a.* from public.assessments a
    where a.org_id = any(p_org_ids)
    order by a.org_id, a.updated_at desc, a.id
  ) latest
$$;
revoke all on function public.portfolio_assessment_summaries(uuid[]) from public, anon;
grant execute on function public.portfolio_assessment_summaries(uuid[]) to authenticated;

-- Match JavaScript/HTML length limits, including supplementary Unicode characters.
create or replace function public.assessment_text_length(p_text text)
returns integer language sql immutable set search_path = public as $$
  select length(p_text) + (select count(*)::integer from unnest(string_to_array(p_text, null)) chars(character)
    where ascii(character) > 65535)
$$;

create or replace function public.save_assessment(p_id uuid, p_expected_revision integer, p_answers jsonb, p_cursor text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.assessments; q jsonb; item record; v_type text; v_result jsonb; v_previous_status text;
begin
  select * into a from public.assessments where id = p_id for update;
  if a.id is null then raise exception 'Assessment not found' using errcode = 'P0002'; end if;
  perform public.assert_assessment_access(a.org_id, true);
  if p_expected_revision is null or a.revision <> p_expected_revision then raise exception 'Assessment changed; reload before saving' using errcode = '40001'; end if;
  if p_status is null or p_status not in ('draft', 'paused', 'reviewed') or p_answers is null or jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 600000 then
    raise exception 'Invalid assessment details' using errcode = '22023';
  end if;
  if p_cursor is null or not exists(select 1 from jsonb_array_elements(a.catalogue->'questions') x where x->>'reference' = p_cursor) then
    raise exception 'Invalid assessment position' using errcode = '22023';
  end if;
  if a.status = 'reviewed' and (p_status <> 'draft' or p_answers <> a.answers) then
    raise exception 'Reopen the assessment before changing reviewed answers' using errcode = '22023';
  end if;
  if a.status = 'paused' and p_status <> 'draft' and p_answers <> a.answers then
    raise exception 'Resume the assessment before changing paused answers' using errcode = '22023';
  end if;
  for item in select * from jsonb_each(p_answers) loop
    select value into q from jsonb_array_elements(a.catalogue->'questions') x where x->>'reference' = item.key;
    if q is null or jsonb_typeof(item.value) <> 'object' or not (item.value ? 'value')
       or exists(select 1 from jsonb_object_keys(item.value) k where k not in ('value', 'note'))
       or (item.value ? 'note' and (jsonb_typeof(item.value->'note') <> 'string' or public.assessment_text_length(item.value->>'note') > 2000)) then
      raise exception 'Invalid answer structure' using errcode = '22023';
    end if;
    v_type := jsonb_typeof(item.value->'value');
    if v_type = 'null' then continue; end if;
    if (q->>'type' = 'boolean' and v_type <> 'boolean')
       or (q->>'type' = 'text' and (v_type <> 'string' or public.assessment_text_length(item.value->>'value') > 8000))
       or (q->>'type' = 'choice' and not exists(select 1 from jsonb_array_elements(q->'choices') opt where opt->'value' = item.value->'value')) then
      raise exception 'Invalid answer value' using errcode = '22023';
    end if;
  end loop;
  v_result := public.assessment_result(a.catalogue, p_answers);
  if p_status = 'reviewed' and (v_result->>'unanswered')::integer > 0 then
    raise exception 'Answer every applicable question before reviewing results' using errcode = '22023';
  end if;
  v_previous_status := a.status;
  update public.assessments set answers = p_answers, cursor = p_cursor, status = p_status,
    revision = revision + 1, updated_at = now(), updated_by = auth.uid(),
    reviewed_at = case when p_status = 'reviewed' then now() else null end
  where id = p_id returning * into a;
  insert into public.audit_events(org_id, user_id, action, record_type, record_id, details)
  values(a.org_id, auth.uid(), case when p_status <> v_previous_status then 'assessment.' || p_status else 'assessment.saved' end,
    'assessment', a.id, jsonb_build_object('revision', a.revision, 'result', v_result));
  return to_jsonb(a);
end;
$$;

create or replace function public.generate_assessment_remediation(p_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.assessments; q jsonb; v_state text; v_id uuid; v_inserted boolean;
  v_created int := 0; v_reused int := 0; v_resolved int := 0; v_gap_refs text[] := '{}';
begin
  select * into a from public.assessments where id = p_id for update;
  if a.id is null then raise exception 'Assessment not found' using errcode = 'P0002'; end if;
  perform public.assert_assessment_access(a.org_id, true);
  if p_expected_revision is null or a.revision <> p_expected_revision then raise exception 'Assessment changed; reload before generating tasks' using errcode = '40001'; end if;
  if a.status <> 'reviewed' then raise exception 'Review the answers before generating remediation' using errcode = '22023'; end if;
  for q in select value from jsonb_array_elements(a.catalogue->'questions') loop
    v_state := public.assessment_answer_state(q, a.answers);
    if v_state not in ('gap', 'critical_gap') then continue; end if;
    v_gap_refs := array_append(v_gap_refs, q->>'reference');
    insert into public.tasks(org_id, title, description, priority, created_by, assessment_id, assessment_reference, assessment_gap_state)
    values(a.org_id, 'Address ' || lower(q->>'domain') || ' gap (' || coalesce(q->>'sourceReference', q->>'reference') || ')',
      'Assessment check: ' || (q->>'title') || E'\n\n' || (q->>'remediation'), case when v_state = 'critical_gap' then 'critical'::public.task_priority else 'high'::public.task_priority end,
      auth.uid(), a.id, q->>'reference', 'open')
    on conflict (assessment_id, assessment_reference) do update set assessment_gap_state = 'open',
      status = case when tasks.status = 'complete' then 'not_started'::public.task_status else tasks.status end
    returning id, (xmax = 0) into v_id, v_inserted;
    if v_inserted then v_created := v_created + 1; else v_reused := v_reused + 1; end if;
  end loop;
  update public.tasks t set assessment_gap_state = case
    when public.assessment_answer_state((select value from jsonb_array_elements(a.catalogue->'questions') candidate where candidate->>'reference' = t.assessment_reference), a.answers) = 'not_applicable'
    then 'not_applicable' else 'resolved' end
  where assessment_id = a.id and not (assessment_reference = any(v_gap_refs)) and assessment_gap_state = 'open';
  get diagnostics v_resolved = row_count;
  insert into public.audit_events(org_id, user_id, action, record_type, record_id, details)
  values(a.org_id, auth.uid(), 'assessment.remediation_generated', 'assessment', a.id,
    jsonb_build_object('created', v_created, 'reused', v_reused, 'resolved', v_resolved));
  return jsonb_build_object('created', v_created, 'reused', v_reused, 'resolved', v_resolved, 'total', cardinality(v_gap_refs));
end;
$$;
-- Generated links and gap state are controlled by the assessment function, not arbitrary task updates.
revoke insert, update on public.tasks from authenticated;
grant insert (org_id, control_id, title, description, assigned_to, created_by, due_date, priority, status, completion_note, completed_at) on public.tasks to authenticated;
grant update (control_id, title, description, assigned_to, due_date, priority, status, completion_note, completed_at) on public.tasks to authenticated;
revoke all on function public.assert_assessment_access(uuid, boolean) from public, anon, authenticated;
revoke all on function public.start_assessment(uuid, text) from public, anon;
revoke all on function public.save_assessment(uuid, integer, jsonb, text, text) from public, anon;
revoke all on function public.generate_assessment_remediation(uuid, integer) from public, anon;
grant execute on function public.start_assessment(uuid, text), public.save_assessment(uuid, integer, jsonb, text, text), public.generate_assessment_remediation(uuid, integer) to authenticated;

insert into public.assessment_catalogues(version, catalogue)
values ('samanexus-danzell-preparation-2026.1', $catalogue${
  "version": "samanexus-danzell-preparation-2026.1",
  "label": "Cyber Essentials preparation",
  "schemeVersion": "Danzell 2026",
  "kind": "preparation",
  "sourceUrl": "https://iasme.co.uk/cyber-essentials/preview-the-self-assessment-questions-for-cyber-essentials/",
  "limitations": "This Samanexus preparation checklist covers selected technical checks. Complete the official IASME questionnaire with your assessor for certification.",
  "questions": [
    {
      "reference": "SN-SCOPE-01",
      "domain": "Scope",
      "title": "Describe the organisation and assets being assessed.",
      "type": "text",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false
    },
    {
      "reference": "SN-SCOPE-02",
      "domain": "Scope",
      "title": "Does the organisation use cloud services?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false
    },
    {
      "reference": "SN-SCOPE-03",
      "domain": "Scope",
      "title": "List the cloud services used.",
      "type": "text",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "when": {
        "reference": "SN-SCOPE-02",
        "values": [
          true
        ]
      }
    },
    {
      "reference": "SN-FW-01",
      "domain": "Firewalls",
      "title": "Are in-scope internet connections protected by firewalls?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-FW-02",
      "domain": "Firewalls",
      "title": "Have default firewall administrator credentials been changed?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-FW-03",
      "domain": "Firewalls",
      "title": "Are unnecessary inbound firewall rules removed?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-CONFIG-01",
      "domain": "Secure configuration",
      "title": "Is unnecessary software removed or disabled?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-CONFIG-02",
      "domain": "Secure configuration",
      "title": "Are unused accounts removed or disabled?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-CONFIG-03",
      "domain": "Secure configuration",
      "title": "Is unauthorised automatic file execution disabled?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-UPDATE-01",
      "domain": "Security updates",
      "title": "Is in-scope software licensed and supported?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-UPDATE-02",
      "domain": "Security updates",
      "title": "Are high-risk or critical OS and firmware fixes applied within 14 days?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": true,
      "sourceReference": "A6.4",
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-UPDATE-03",
      "domain": "Security updates",
      "title": "Are high-risk or critical application fixes applied within 14 days?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": true,
      "sourceReference": "A6.5",
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-ACCESS-01",
      "domain": "User access",
      "title": "Are administrative tasks performed using separate accounts?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-ACCESS-02",
      "domain": "User access",
      "title": "Is MFA enabled for administrators on cloud services that offer it?",
      "type": "boolean",
      "guidance": "List any cloud services that do not offer MFA in your scope answer and discuss them with your assessor.",
      "critical": true,
      "sourceReference": "A7.16",
      "when": {
        "reference": "SN-SCOPE-02",
        "values": [
          true
        ]
      },
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-ACCESS-03",
      "domain": "User access",
      "title": "Is MFA enabled for users on cloud services that offer it?",
      "type": "boolean",
      "guidance": "List any cloud services that do not offer MFA in your scope answer and discuss them with your assessor.",
      "critical": true,
      "sourceReference": "A7.17",
      "when": {
        "reference": "SN-SCOPE-02",
        "values": [
          true
        ]
      },
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-MALWARE-01",
      "domain": "Malware protection",
      "title": "Which malware protection approach is used?",
      "type": "choice",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "choices": [
        {
          "value": "antimalware",
          "label": "Anti-malware"
        },
        {
          "value": "allowlisting",
          "label": "Application allowlisting"
        },
        {
          "value": "both",
          "label": "Both"
        },
        {
          "value": "none",
          "label": "Neither"
        }
      ],
      "passValues": [
        "antimalware",
        "allowlisting",
        "both"
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-MALWARE-02",
      "domain": "Malware protection",
      "title": "Is anti-malware protection kept current?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "when": {
        "reference": "SN-MALWARE-01",
        "values": [
          "antimalware",
          "both"
        ]
      },
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-MALWARE-03",
      "domain": "Malware protection",
      "title": "Are malicious websites blocked?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "when": {
        "reference": "SN-MALWARE-01",
        "values": [
          "antimalware",
          "both"
        ]
      },
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    },
    {
      "reference": "SN-MALWARE-04",
      "domain": "Malware protection",
      "title": "Are unsigned applications restricted?",
      "type": "boolean",
      "guidance": "Record the current position across your agreed scope. Add a note explaining how you checked it.",
      "critical": false,
      "when": {
        "reference": "SN-MALWARE-01",
        "values": [
          "allowlisting",
          "both"
        ]
      },
      "passValues": [
        true
      ],
      "remediation": "Confirm the gap with your IT lead, make the required change and record how it was verified across the assessment scope."
    }
  ]
}
$catalogue$::jsonb)
on conflict (version) do nothing;
commit;
