import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
const moduleRequire = createRequire(import.meta.url);

function load(file, dependencies = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const evaluatedModule = { exports: {} };
  const resolve = name => name in dependencies ? dependencies[name] : moduleRequire(name);
  new Function('require', 'module', 'exports', source)(resolve, evaluatedModule, evaluatedModule.exports);
  return evaluatedModule.exports;
}
const api = load('src/lib/api.ts');
const onboarding = load('src/lib/onboarding.ts');
const form = { setupKey: 'f9dbba86-914a-45dc-a6f0-0d2d8bfb6472', name: 'Test Organisation', sector: 'care', size: 'micro', primaryContactName: 'Test Admin', primaryContactEmail: ' ADMIN@example.com ', frameworkCodes: ['CE'] };
const request = body => new Request('http://localhost/api/v1/organisations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
function organisationRoute(context) {
  return load('src/app/api/v1/organisations/route.ts', { '@/lib/api': api, '@/lib/supabase/admin': { createSupabaseAdminClient: () => { throw new Error('Unexpected service access during creation'); } }, '@/lib/onboarding': onboarding, '@/lib/auth': { getAuthContext: async () => context, hasSatisfiedMfa: (role, level) => role !== 'super_admin' || level === 'aal2' } });
}
const adminProfile = { id: 'actor', role: 'super_admin', status: 'active' };
test('creation rejects unauthenticated and invited profiles before touching the database', async () => {
  for (const profile of [null, { ...adminProfile, status: 'invited' }]) {
    assert.equal((await organisationRoute({ profile }).POST(request(form))).status, 401);
  }
});
test('creation rejects tenant admins and super admins without MFA', async () => {
  for (const context of [{ profile: { ...adminProfile, role: 'org_admin' } }, { profile: adminProfile, assurance: { currentLevel: 'aal1' } }]) {
    assert.equal((await organisationRoute(context).POST(request(form))).status, 403);
  }
});
test('creation rejects malformed JSON, missing selection and later frameworks', async () => {
  const route = organisationRoute({ profile: adminProfile, assurance: { currentLevel: 'aal2' } });
  for (const body of ['{', { ...form, frameworkCodes: [] }, { ...form, frameworkCodes: ['CE+'] }, { ...form, primaryContactEmail: 'invalid' }]) {
    assert.equal((await route.POST(request(body))).status, 422);
  }
});
test('creation normalises contact details and retries with the same transaction key', async () => {
  const calls = [];
  const route = organisationRoute({ profile: adminProfile, assurance: { currentLevel: 'aal2' }, supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: 'saved-org', name: form.name }, error: null }; } } });
  for (let i = 0; i < 2; i++) {
    const res = await route.POST(request(form));
    assert.equal(res.status, 201); assert.equal((await res.json()).data.id, 'saved-org');
  }
  assert.equal(calls[0].name, 'create_client_workspace');
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].args.p_contact_email, 'admin@example.com');
  assert.deepEqual(calls[0].args.p_framework_codes, ['CE']);
});
function query(result) {
  const chain = { select: () => chain, eq: () => chain, single: async () => result, maybeSingle: async () => result };
  return chain;
}
function inviteRoute({ existing = null, previous = null, profile = adminProfile, org = '48fd577b-3948-47f6-a642-d3fa014fe78b' } = {}) {
  let delivered = 0;
  const context = { profile, assurance: { currentLevel: 'aal2' }, supabase: { from: () => query({ data: { id: org, name: 'Test', status: 'active' }, error: null }) } };
  const admin = { from: table => query({ data: table === 'users' ? existing : previous, error: null }), auth: { admin: { inviteUserByEmail: async () => { delivered++; throw new Error('unexpected delivery'); } } } };
  return { route: load('src/app/api/v1/organisations/[id]/invite/route.ts', { '@/lib/api': api, '@/lib/auth': { getAuthContext: async () => context, hasSatisfiedMfa: () => true }, '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin } }), deliveries: () => delivered, org };
}
test('invitations cannot cross tenant boundaries', async () => {
  const { route, org } = inviteRoute({ profile: { id: 'actor', role: 'org_admin', status: 'active', org_id: 'another-tenant' } });
  assert.equal((await route.POST(request({ email: 'admin@example.com', fullName: 'Test Admin', role: 'org_admin' }), { params: Promise.resolve({ id: org }) })).status, 403);
});
test('invitations never move an existing account to another organisation', async () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  const { route, org, deliveries } = inviteRoute({ existing: { id: 'member', org_id: 'another-tenant', role: 'org_admin', status: 'active' } });
  assert.equal((await route.POST(request({ email: 'admin@example.com', fullName: 'Test Admin', role: 'org_admin' }), { params: Promise.resolve({ id: org }) })).status, 409);
  assert.equal(deliveries(), 0);
});
test('retrying a valid invitation returns its expiry without sending a duplicate email', async () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  const org = '48fd577b-3948-47f6-a642-d3fa014fe78b';
  const expiresAt = new Date(Date.now() + 100000).toISOString();
  const { route, deliveries } = inviteRoute({ previous: { org_id: org, role: 'org_admin', sent_at: new Date().toISOString(), expires_at: expiresAt } });
  const res = await route.POST(request({ email: 'admin@example.com', fullName: 'Test Admin', role: 'org_admin' }), { params: Promise.resolve({ id: org }) });
  assert.equal(res.status, 200); assert.equal((await res.json()).data.alreadySent, true); assert.equal(deliveries(), 0);
});
test('expired activation never changes a password or activates membership', async () => {
  let changed = false;
  const route = load('src/app/api/v1/auth/activate/route.ts', { '@/lib/api': api, '@/lib/auth': { getAuthContext: async () => ({ profile: { id: 'user', status: 'invited', email: 'admin@example.com', org_id: 'org', role: 'org_admin' }, user: { id: 'user', email_confirmed_at: '2026-01-01' }, supabase: { auth: { updateUser: async () => { changed = true; } } } }) }, '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: () => query({ data: { org_id: 'org', role: 'org_admin', expires_at: '2000-01-01', accepted_at: null }, error: null }) }) } });
  assert.equal((await route.POST(request({ password: 'twelve-or-more-characters' }))).status, 410);
  assert.equal(changed, false);
});
