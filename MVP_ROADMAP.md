# Samanexus MVP roadmap

This is the working priority order for the Phase 1 MVP. The dashboard is the first thin slice: it gives us the product vocabulary and the main admin workflow before data services are connected.

## P0 - Foundation and trust

- [x] Next.js application shell and responsive admin workspace
- [x] Portfolio overview with client progress, RAG status, and renewals
- [x] Priority-work surface for the next actions
- [x] PostgreSQL schema for organisations, users, frameworks, controls, tasks, evidence, certifications, licenses, and audit events
- [x] Authentication and role model: `super_admin`, `org_admin`, `org_member`, `auditor`
- [x] Tenant-scoped queries and database-level RLS
- [x] API envelope, validation, pagination, MFA guard, and initial audit event boundary
- [x] Super admin tenant invitations and license management endpoints

## P1 - First usable compliance workflow

- [x] Create an organisation and send a time-limited invitation (implementation; live delivery verification pending)
- [x] Client onboarding and framework selection (Cyber Essentials; live database verification pending)
- [x] Versioned Cyber Essentials assessment data model and question runner (preparation catalogue)
- [ ] Full official IASME Danzell catalogue, branching rules and assessor grading validation
- [x] Autosave, pause/resume, preparation scoring, and critical auto-fail flags
- [x] Generate remediation tasks from assessment gaps (idempotent and tenant-scoped)
- [x] Client dashboard data contract backed by live organisation data

### P1 implementation progress - 13 October 2026

The first slice connects client creation, Cyber Essentials selection, a trial licence, invitation delivery, account activation, and the portfolio/client dashboards. Organisation creation is transactional and accepts a stable setup key for safe retries. Invitations have a one-hour application deadline and the provider token may expire sooner. An invitation failure preserves the organisation; the client workspace can check or renew the invitation. Invited users are provisioned from a service-only ledger and tenant access starts after activation.

The dashboard uses live clients when Supabase is configured and explicitly labelled sample data otherwise. Navigation, typography, semantic tables, status labels, mobile layout, form validation and focus handling have been refreshed. Setup status is separate from assessment readiness and certification.

Validation: production build, TypeScript, API regression tests and local Chrome interaction/mobile checks. The API tests mock Supabase; the SQL migration and email delivery still need staging verification with project credentials. Setup instructions and a staging checklist are in `README.md`.

The assessment workflow is now implemented with a 19-check Samanexus preparation catalogue. It is explicitly labelled as a subset; the full official IASME catalogue and assessor grading validation remain unchecked. No certification result is inferred from preparation percentages.

Assessment features now include:

- Immutable question-set versions and per-organisation assessment snapshots.
- Conditional questions for cloud use and malware protection, section navigation and supporting notes.
- Serialised autosave, saved position, pause/resume, review/reopen, failed-save retry and conflict recovery with draft download.
- Separate completion, satisfied-check percentage, gap count and critical flags. Unanswered applicable checks remain in the denominator.
- Critical mappings for Danzell A6.4, A6.5, A7.16 and A7.17, with cloud-MFA availability qualified in the question wording.
- Remediation generation from reviewed answers, with a unique task per assessment/question. Fixed and out-of-scope gaps retain task history and existing notes/assignments.
- Portfolio progress and critical-gap priorities, client dashboard assessment cards, published-version selection and an isolated browser-tab preview at `/assessments/preview` when Supabase is unconfigured.

The new `002_p1_assessments.sql` migration has been executed locally using PGlite with Supabase Auth claim/role shims. Tests cover RLS, active/inactive users, MFA guards, stale saves, malformed answers, scoring parity, critical flags, task reconciliation and immutable catalogue imports. Chrome checks cover preview pause/resume across reload, question completion, review, repeatable task creation, mobile layouts and controlled HTTP tests for slow saves, failures and conflicts. Hosted Supabase, real MFA tokens and SMTP still require staging verification.

Next P1 release work: acquire and map the full official Danzell question set, validate its complete applicability/marking rules with an assessor, then verify the combined workflow against hosted Supabase. P2 task management and evidence remain separate milestones.

## P2 - Evidence and follow-through

- [ ] Task manager with assignment, comments, filters, Kanban, and list views
- [ ] Completion notes and evidence links on tasks
- [ ] Private evidence storage with signed upload/download URLs
- [ ] Evidence metadata, control links, expiry dates, and immutable version history
- [ ] Immutable searchable audit trail

## P3 - Keep clients moving

- [ ] Certification and renewal records
- [ ] Renewal reminders at 90, 60, 30, and 14 days
- [ ] In-app notification centre and notification preferences
- [ ] Email delivery and staging verification
- [ ] Playwright coverage for onboarding, assessment, task completion, and evidence upload

## Explicitly later

- Phase 2: ISO 27001, ISO 9001, UK GDPR, policy library, risk register, reporting, and PDF export
- Phase 3: CQC, NIS 2, SSO, shareable reports, and advanced analytics
- Phase 4: Claude assistant and optional mobile app

## Foundation choices and remaining deployment decisions

- Implemented: Supabase Auth with MFA, Supabase PostgreSQL/RLS and Next.js Route Handlers.
- Still to choose/configure: evidence storage (AWS S3 or Cloudflare R2), production hosting and the staging SMTP provider.
- CE+ technical verification remains a later workflow; this slice supports Cyber Essentials preparation only.