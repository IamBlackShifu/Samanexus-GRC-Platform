import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
const moduleRequire = createRequire(import.meta.url);
const source = ts.transpileModule(fs.readFileSync('src/lib/assessment/model.ts', 'utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText;
const modelModule = { exports:{} };
new Function('require','module','exports',source)(moduleRequire,modelModule,modelModule.exports);
const { catalogueSchema, summarise, validateAnswers } = modelModule.exports;
const catalogue = catalogueSchema.parse(JSON.parse(fs.readFileSync('src/lib/assessment/catalogue.json','utf8')));
const ids = { admin:'10000000-0000-4000-8000-000000000001', member:'10000000-0000-4000-8000-000000000002', auditor:'10000000-0000-4000-8000-000000000003', other:'10000000-0000-4000-8000-000000000004', org:'20000000-0000-4000-8000-000000000001', otherOrg:'20000000-0000-4000-8000-000000000002' };
function completed(cloud=true) {
 const answers={};
 for(const question of catalogue.questions) answers[question.reference]={ value:question.type==='text'?'Documented organisation scope':question.type==='choice'?'both':true,note:'' };
 answers['SN-SCOPE-02'].value=cloud;
 return answers;
}
test('PostgreSQL assessment transactions, scoring and tenant isolation', async t => {
 const db = new PGlite();
 try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('aal',current_setting('test.aal',true)) $$;
    grant usage on schema public, auth to authenticated, service_role;
    alter default privileges in schema public grant all on tables to authenticated, service_role;
  `);
  // gen_random_uuid is built into PostgreSQL; the test engine needs no pgcrypto extension.
  await db.exec(fs.readFileSync('db/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
  for(const file of ['db/migrations/001_p1_onboarding.sql','db/migrations/002_p1_assessments.sql']) {
    await db.exec(fs.readFileSync(file,'utf8'));
    await db.exec(fs.readFileSync(file,'utf8'));
  }
  await db.exec(`
   insert into public.organisations(id,name,sector,size,primary_contact_name,primary_contact_email) values
    ('${ids.org}','Test Care','care','micro','Test Admin','test@example.com'),
    ('${ids.otherOrg}','Other Care','care','micro','Other Admin','other@example.com');
   insert into auth.users(id,email,email_confirmed_at) values
    ('${ids.admin}','root@example.com',now()),('${ids.member}','test@example.com',now()),
    ('${ids.auditor}','auditor@example.com',now()),('${ids.other}','other@example.com',now());
   insert into public.users(id,org_id,email,full_name,role,status) values
    ('${ids.admin}',null,'root@example.com','Root Admin','super_admin','active'),
    ('${ids.member}','${ids.org}','test@example.com','Test Member','org_member','active'),
    ('${ids.auditor}','${ids.org}','auditor@example.com','Test Auditor','auditor','active'),
    ('${ids.other}','${ids.otherOrg}','other@example.com','Other Member','org_member','active');
   insert into public.org_frameworks(org_id,framework_id) select '${ids.org}',id from public.frameworks where code='CE';
  `);
  async function actor(id,aal='aal1') {
   await db.exec('reset role');
   await db.query("select set_config('test.uid',$1,false),set_config('test.aal',$2,false)",[id,aal]);
   await db.exec('set role authenticated');
  }
  const scalar=async(sql,args=[]) => (await db.query(sql,args)).rows[0].result;

  await t.test('onboarding creation really is atomic and idempotent in PostgreSQL',async()=>{
   await actor(ids.admin,'aal2');
   const args=['30000000-0000-4000-8000-000000000001','Created Care','care','micro','Created Admin','created@example.com',['CE']];
   const sql='select public.create_client_workspace($1,$2,$3,$4,$5,$6,$7) result';
   const created=await scalar(sql,args);const again=await scalar(sql,args);assert.equal(created.id,again.id);
   assert.equal((await db.query('select count(*)::int count from public.org_frameworks where org_id=$1',[created.id])).rows[0].count,1);
   assert.equal((await db.query('select count(*)::int count from public.licenses where org_id=$1',[created.id])).rows[0].count,1);
   await assert.rejects(scalar(sql,[args[0],'Changed Name',...args.slice(2)]),/different workspace/i);
  });
  let assessment;
  await t.test('start is repeatable and snapshots the published catalogue',async()=>{
   await actor(ids.member);
   assessment=await scalar('select public.start_assessment($1,$2) result',[ids.org,catalogue.version]);
   const again=await scalar('select public.start_assessment($1,$2) result',[ids.org,catalogue.version]);
   assert.equal(assessment.id,again.id);assert.deepEqual(assessment.catalogue,catalogue);
  });
  await t.test('another tenant cannot read or mutate the assessment',async()=>{
   await actor(ids.other);
   assert.equal((await db.query('select id from public.assessments where id=$1',[assessment.id])).rows.length,0);
   await assert.rejects(scalar('select public.save_assessment($1,0,$2,$3,\'draft\') result',[assessment.id,{},catalogue.questions[0].reference]),/access denied/i);
   await assert.rejects(scalar('select public.generate_assessment_remediation($1,0) result',[assessment.id]),/access denied/i);
  });
  await t.test('auditor reads but cannot write; super admin needs MFA',async()=>{
   await actor(ids.auditor);assert.equal((await db.query('select id from public.assessments')).rows.length,1);
   await assert.rejects(scalar('select public.save_assessment($1,0,$2,$3,\'draft\') result',[assessment.id,{},catalogue.questions[0].reference]),/access denied/i);
   await actor(ids.admin);assert.equal((await db.query('select id from public.assessments')).rows.length,0);
   await assert.rejects(scalar('select public.start_assessment($1,$2) result',[ids.org,catalogue.version]),/MFA/i);
  });

  await t.test('invited and suspended members cannot read or mutate assessments',async()=>{
   for(const status of ['invited','suspended']) {
    await db.exec('reset role');await db.query('update public.users set status=$1 where id=$2',[status,ids.member]);
    await actor(ids.member);assert.equal((await db.query('select id from public.assessments')).rows.length,0);
    await assert.rejects(scalar('select public.save_assessment($1,0,$2,$3,\'draft\') result',[assessment.id,{},catalogue.questions[0].reference]),/Active organisation/i);
   }
   await db.exec('reset role');await db.query("update public.users set status='active' where id=$1",[ids.member]);
  });
  await t.test('empty and conditional answers have identical SQL and TypeScript results',async()=>{
   await actor(ids.member);
   for(const answers of [{},{'SN-SCOPE-02':{value:false,note:''}},completed(false),completed(true),{...completed(), 'SN-UPDATE-02':{value:false,note:''}}]) {
    const actual=await scalar('select public.assessment_result($1,$2) result',[catalogue,answers]);
    const expected=summarise(catalogue,answers);
    for(const key of Object.keys(actual)) assert.equal(actual[key],expected[key],key);
   }
  });

  await t.test('portfolio summaries return only the latest visible assessment without answer notes',async()=>{
   await actor(ids.member);
   const rows=(await db.query('select * from public.portfolio_assessment_summaries($1)',[[ids.org,ids.otherOrg]])).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].assessment_id,assessment.id);assert.equal(rows[0].summary.answered,0);assert.equal(rows[0].answers,undefined);
   await actor(ids.other);assert.equal((await db.query('select * from public.portfolio_assessment_summaries($1)',[[ids.org]])).rows.length,0);
   await actor(ids.member);
  });
  await t.test('database independently rejects malformed values, unknown references and incomplete reviews',async()=>{
   const sql="select public.save_assessment($1,0,$2,$3,$4) result";
   for(const answers of [{'unknown':{value:true}}, {'SN-UPDATE-02':{value:'yes'}}, {'SN-SCOPE-01':{value:'ok',note:'x'.repeat(2001)}}, {'SN-SCOPE-01':{value:'ok',note:'😀'.repeat(1001)}}, {'SN-SCOPE-01':{value:'ok',critical:false}}]) {
    await assert.rejects(scalar(sql,[assessment.id,answers,catalogue.questions[0].reference,'draft']),/Invalid answer/i);
   }
   await assert.rejects(scalar(sql,[assessment.id,{},catalogue.questions[0].reference,'reviewed']),/Answer every/i);
   await assert.rejects(db.query("update public.assessments set answers='{}' where id=$1",[assessment.id]),/permission denied/i);
  });
  await t.test('stale revisions cannot overwrite saved answers; pause persists position',async()=>{
   assessment=await scalar('select public.save_assessment($1,0,$2,$3,\'paused\') result',[assessment.id,{'SN-SCOPE-01':{value:'Saved scope',note:''}},'SN-UPDATE-02']);
   assert.equal(assessment.cursor,'SN-UPDATE-02');assert.equal(assessment.status,'paused');assert.equal(assessment.revision,1);
   await assert.rejects(scalar('select public.save_assessment($1,0,$2,$3,\'draft\') result',[assessment.id,{},'SN-SCOPE-01']),/changed/i);
   await assert.rejects(scalar('select public.save_assessment($1,1,$2,$3,\'paused\') result',[assessment.id,{},'SN-SCOPE-01']),/Resume/i);
   assessment=await scalar('select public.save_assessment($1,1,$2,$3,\'draft\') result',[assessment.id,assessment.answers,assessment.cursor]);
  });
  let gapAnswers;
  await t.test('critical gaps remain visible even with a high percentage',async()=>{
   gapAnswers=completed();gapAnswers['SN-UPDATE-02'].value=false;
   const summary=summarise(catalogue,gapAnswers);assert.equal(summary.criticalCount,1);assert.equal(summary.outcome,'critical_gaps');assert(summary.readiness>80);
   assessment=await scalar('select public.save_assessment($1,$2,$3,$4,\'reviewed\') result',[assessment.id,assessment.revision,gapAnswers,'SN-UPDATE-02']);
  });
  let taskId;
  await t.test('generation creates one critical task and retries without duplicates',async()=>{
   const first=await scalar('select public.generate_assessment_remediation($1,$2) result',[assessment.id,assessment.revision]);
   const again=await scalar('select public.generate_assessment_remediation($1,$2) result',[assessment.id,assessment.revision]);
   assert.equal(first.created,1);assert.equal(again.created,0);assert.equal(again.reused,1);
   const tasks=(await db.query('select * from public.tasks where assessment_id=$1',[assessment.id])).rows;
   assert.equal(tasks.length,1);assert.equal(tasks[0].priority,'critical');taskId=tasks[0].id;
   await assert.rejects(db.query("update public.tasks set assessment_gap_state='resolved' where id=$1",[taskId]),/permission denied/i);
  });
  await t.test('fixed gaps retain task history instead of silently completing or deleting work',async()=>{
   await db.query("update public.tasks set description='Human working notes',completion_note='Existing notes',status='in_progress' where id=$1",[taskId]);
   assessment=await scalar('select public.save_assessment($1,$2,$3,$4,\'draft\') result',[assessment.id,assessment.revision,assessment.answers,assessment.cursor]);
   const fixed=completed();
   assessment=await scalar('select public.save_assessment($1,$2,$3,$4,\'reviewed\') result',[assessment.id,assessment.revision,fixed,assessment.cursor]);
   const generated=await scalar('select public.generate_assessment_remediation($1,$2) result',[assessment.id,assessment.revision]);
   assert.equal(generated.resolved,1);
   const task=(await db.query('select * from public.tasks where id=$1',[taskId])).rows[0];
   assert.equal(task.assessment_gap_state,'resolved');assert.equal(task.status,'in_progress');assert.equal(task.description,'Human working notes');assert.equal(task.completion_note,'Existing notes');
   await assert.rejects(scalar('select public.generate_assessment_remediation($1,$2) result',[assessment.id,assessment.revision-1]),/changed/i);
  });

  await t.test('an out-of-scope cloud service removes stale MFA gaps and preserves their task history',async()=>{
   await actor(ids.member);
   assessment=await scalar('select public.save_assessment($1,$2,$3,$4,\'draft\') result',[assessment.id,assessment.revision,assessment.answers,assessment.cursor]);
   const cloudGaps=completed();cloudGaps['SN-ACCESS-02'].value=false;cloudGaps['SN-ACCESS-03'].value=false;
   assessment=await scalar('select public.save_assessment($1,$2,$3,$4,\'reviewed\') result',[assessment.id,assessment.revision,cloudGaps,assessment.cursor]);
   await scalar('select public.generate_assessment_remediation($1,$2) result',[assessment.id,assessment.revision]);
   assessment=await scalar('select public.save_assessment($1,$2,$3,$4,\'draft\') result',[assessment.id,assessment.revision,assessment.answers,assessment.cursor]);
   cloudGaps['SN-SCOPE-02'].value=false;
   assessment=await scalar('select public.save_assessment($1,$2,$3,$4,\'reviewed\') result',[assessment.id,assessment.revision,cloudGaps,assessment.cursor]);
   const result=await scalar('select public.generate_assessment_remediation($1,$2) result',[assessment.id,assessment.revision]);
   assert.equal(result.total,0);assert.equal(result.resolved,2);
   const tasks=(await db.query("select * from public.tasks where assessment_id=$1 and assessment_reference like 'SN-ACCESS-%'",[assessment.id])).rows;
   assert.equal(tasks.length,2);assert(tasks.every(task=>task.assessment_gap_state==='not_applicable'));
  });
  await t.test('published versions cannot change, and invalid catalogue definitions are rejected',async()=>{
   await db.exec('reset role');
   await assert.rejects(db.query('update public.assessment_catalogues set catalogue=$1 where version=$2',[catalogue,catalogue.version]),/new catalogue version/i);
   assert.throws(()=>catalogueSchema.parse({...catalogue,questions:[...catalogue.questions,catalogue.questions[0]]}));
   assert.throws(()=>validateAnswers(catalogue,{'SN-UPDATE-02':{value:'yes'}}));
  });

  await t.test('catalogue helper emits valid SQL, accepts identical retries and refuses changed published content',async()=>{
   await db.exec('reset role');
   const directory=fs.mkdtempSync(path.join(os.tmpdir(),'samanexus-catalogue-'));
   const input=path.join(directory,'catalogue.json');const output=path.join(directory,'catalogue.sql');
   try {
    const version={...catalogue,version:'test-danzell-catalogue-2'};
    fs.writeFileSync(input,JSON.stringify(version));
    const prepare=()=>{const result=spawnSync(process.execPath,['scripts/prepare-assessment-catalogue.mjs',input,'--output',output],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return fs.readFileSync(output,'utf8');};
    const sql=prepare();await db.exec(sql);await db.exec(sql);
    fs.unlinkSync(output);
    version.questions=version.questions.map((question,index)=>index===0?{...question,title:'Changed scope question'}:question);
    fs.writeFileSync(input,JSON.stringify(version));
    const changed=prepare();await assert.rejects(db.exec(changed),/new catalogue version/i);await db.exec('rollback');
   } finally { if(fs.existsSync(input))fs.unlinkSync(input);if(fs.existsSync(output))fs.unlinkSync(output);fs.rmdirSync(directory); }
  });
 } finally { await db.close(); }
});
