# Samanexus GRC workspace

Next.js 16.4 / React 19 application with Supabase Auth, MFA and tenant-scoped PostgreSQL data. P1 includes client creation, framework selection, invitations, account activation, connected dashboards and a versioned preparation-assessment workflow.

## Local development

```sh
npm install
npm run dev
```

Open http://localhost:3000. Without Supabase configuration the portfolio shows clearly labelled sample clients; onboarding never simulates a successful creation or invitation.

Copy `.env.example` to `.env.local` and configure:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: project URL and public anonymous key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only key for invitations and activation; never prefix this with `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_SITE_URL`: canonical application URL, such as `http://localhost:3000` in development. Use HTTPS in staging/production.

Restart the dev server after changing environment variables.

## Database and first administrator

For a new Supabase project, apply `db/schema.sql`, then `db/migrations/001_p1_onboarding.sql` and `db/migrations/002_p1_assessments.sql`, in that order, in the SQL editor. For an existing installation, apply any missing migrations in order after confirming the foundation schema is present. The migration is rerunnable and does not delete organisations. Existing framework selections are inferred from tracked controls; organisations without tracked controls remain unselected.

Create the first administrator in Supabase Auth using the trusted project dashboard, then insert its profile with an email you control:

```sql
insert into public.users (id, email, full_name, role, status)
select id, lower(email), 'Workspace Administrator', 'super_admin', 'active'
from auth.users where lower(email) = 'admin@example.co.uk';
```

Sign in at `/sign-in`, enrol an authenticator and verify a code. Super admin portfolio access and client creation require an active profile and an AAL2 session. Client activation is reserved for invited users; suspended users cannot enter the workspace.

The migration adds persisted organisation/framework selections, atomic workspace creation, a private invitation ledger, profile provisioning before email delivery and atomic invitation acceptance. User-editable Auth metadata does not assign tenant membership or roles. Normal tenant administrators cannot change user roles directly through the database API.

## Invitation email configuration

Configure a staging SMTP provider, Auth Site URL and allowed redirect URLs for the actual deployment origin and `/account`. Supabase token expiry is controlled by **Email OTP Expiration**; use 3600 seconds. Independently, this app requires activation within one hour of issuing an invitation. A shorter provider expiry takes precedence.

For an explicit confirmation step, use this destination in the Supabase **Invite user** template:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">Accept invitation</a>
```

Use this destination in the **Reset password** template for renewal after a user has verified an invitation but not activated their workspace:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Complete account setup</a>
```

`/account` verifies the token only after the user presses Confirm invitation, removes it from the address bar, sets the password and activates the membership. The provider default fragment redirect is also supported. Do not include third-party analytics or assets on the invitation screen that could capture its URL.

A failed email leaves the organisation saved. Retry from the review step or open the saved client workspace. An already-sent, unexpired invitation is returned without duplicate delivery. Expired invitations can be renewed. An existing account in a different organisation cannot be reassigned by inviting its email address.

## Checks

```sh
npm test
npm run lint
npm run build
```

The tests include API mocks plus a local PostgreSQL engine (PGlite). The database suite executes the foundation schema and both migrations, with minimal Supabase Auth claim/role shims, and checks RLS, atomic creation, stale-save rejection, SQL/TypeScript scoring parity, generated-task reconciliation and catalogue immutability. These tests do not verify hosted Supabase configuration, real Auth tokens or SMTP delivery. The production build checks the installed Next.js Cache Components model; dynamic client pages stream inside Suspense boundaries.

Local Chrome QA covers portfolio/onboarding interactions and the assessment workflow: autosave, pause/resume across reload, critical flags, review, repeated remediation generation and mobile layouts. A separate browser run uses controlled HTTP responses to check edits during slow saves, failed-save retries and conflict recovery. Captures and local browser profiles are ignored in `.artifacts/`.

## Staging verification still required

1. Apply the migration to staging and confirm both active and invited roles have the expected RLS access.
2. Sign in as a super admin with MFA; create a client and confirm organisation, selected framework, licence and audit event are saved together.
3. Retry the same setup request and confirm it returns the original organisation with no duplicate records. Reject altered payloads with that key.
4. Simulate email failure, then retry from the saved workspace. Confirm no second organisation is created.
5. Receive the email, verify the link, set a password and confirm the primary admin can read only its organisation.
6. Confirm expired, reused and cross-organisation invitations are rejected. Test renewal both before and after Auth email confirmation.
7. Test an org member and auditor against another tenant, and confirm invited/suspended profiles cannot read tenant data. Test a super admin before and after MFA verification.
8. Start an assessment, edit during a slow save, pause and sign out. Sign back in and confirm the saved answers/position resume correctly.
9. Open the same assessment in two sessions; confirm conflicting saves cannot silently overwrite answers.
10. Complete preparation answers with a critical gap, review results and generate tasks twice. Confirm one linked critical task exists, then resolve the gap and verify its task history remains.
11. Publish a new question-set version and confirm older assessments retain their catalogue and the new version is selectable.

## Preparation assessments

Apply `002_p1_assessments.sql` after the onboarding migration. An active organisation with Cyber Essentials selected can start its assessment from the client workspace. Org admins and members can edit; auditors can read; super admins require MFA. Invited/suspended users and other tenants cannot access its data.

The bundled `samanexus-danzell-preparation-2026.1` catalogue has 19 original Samanexus preparation checks across scope and the five technical themes. It is a subset, not the complete IASME questionnaire. Its four critical checks reference A6.4, A6.5, A7.16 and A7.17; cloud-MFA wording accounts for service availability. The official catalogue download was inaccessible during implementation, so full content and marking-rule validation remain release work.

Answer and note changes autosave after a short delay. Saves are serialised and use an expected revision. A failed save retains the draft in memory and supports retry/download; a conflict blocks further changes until the user explicitly reloads the saved answers. Internal navigation waits for a successful save, and leaving the tab warns if changes remain unsaved. Live client answers are never stored in browser storage. The clearly labelled `/assessments/preview` uses session storage for demo answers only and is enabled only when Supabase is unconfigured.

The portfolio displays the latest saved assessment progress and critical-gap priorities without returning answer notes in its summary query. Completion and preparation percentages are separate. Applicable unanswered checks remain in the score denominator; conditional checks are excluded only after their scope answer is known. Written answers establish completion and require human interpretation. A critical gap remains visible regardless of percentage. Review requires all applicable answers. Reopen reviewed answers before editing.

Generate remediation from reviewed, saved results. The database recomputes gaps from the immutable catalogue and answers, then creates at most one task per assessment/reference. Repeated requests reuse tasks. Resolved/out-of-scope gaps are tagged separately while retaining task notes, assignments and history; they are removed from the dashboard's open-gap list. A completed task is reopened if its assessment gap is reported again, preserving its existing completion notes and timestamp. Task completion/evidence management belongs to P2.

## Adding a question-set version

Use the structure in `src/lib/assessment/catalogue.json` to prepare a locally supplied catalogue. Use a new version identifier and an HTTPS source URL. References must be unique. Boolean/choice checks have explicit pass values; critical checks require a pass rule and remediation guidance. Text answers are not automatically graded. A condition must refer to an earlier, always-applicable boolean/choice question and use valid answer values. More complex official branching/assessor rules need explicit implementation and validation before release.

```sh
node scripts/prepare-assessment-catalogue.mjs path/to/catalogue.json --output db/migrations/003_question_set.sql
```

The helper validates JSON and writes a new SQL file; it does not contact a database. Applying that file publishes the immutable version. Identical retries are allowed, while changed content under an existing version is rejected. New versions appear in client workspace selection. Existing assessments retain their original snapshots and answers. Acquire the official content through an authorised source and validate its mapped applicability/grading rules before publishing it as a complete preparation catalogue.

## Remaining P1 release work

The full official Danzell catalogue and assessor grading validation remain outstanding, along with hosted Supabase/SMTP end-to-end verification. Cyber Essentials is the only selectable framework in this slice. Other frameworks and CE+ technical verification remain later-phase work. Preparation results never produce a certification outcome.

Current scheme references: [IASME question-set preview](https://iasme.co.uk/cyber-essentials/preview-the-self-assessment-questions-for-cyber-essentials/) and [NCSC resources](https://www.ncsc.gov.uk/cyberessentials/resources). Invitation behaviour follows [Supabase Auth users](https://supabase.com/docs/guides/auth/users) and [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).
