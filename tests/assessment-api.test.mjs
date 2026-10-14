import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
const moduleRequire=createRequire(import.meta.url);
function load(file,deps={}) {
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const evaluatedModule={exports:{}};
 new Function('require','module','exports',source)(name=>name in deps?deps[name]:moduleRequire(name),evaluatedModule,evaluatedModule.exports);
 return evaluatedModule.exports;
}
const api=load('src/lib/api.ts');
const model=load('src/lib/assessment/model.ts');
const catalogue=model.catalogueSchema.parse(JSON.parse(fs.readFileSync('src/lib/assessment/catalogue.json','utf8')));
const org='20000000-0000-4000-8000-000000000001';
const id='40000000-0000-4000-8000-000000000001';
const params={params:Promise.resolve({id})};
const assessment={id,org_id:org,catalogue_version:catalogue.version,catalogue,answers:{},cursor:catalogue.questions[0].reference,status:'draft',revision:3,updated_at:new Date().toISOString(),reviewed_at:null};
const body=value=>new Request('http://localhost/api/v1/assessments/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
function route(file,context) {
 const auth={getAuthContext:async()=>context,hasSatisfiedMfa:(role,level)=>role!=='super_admin'||level==='aal2'};
 const server=load('src/lib/assessment/server.ts',{'@/lib/auth':auth,'@/lib/api':api,'@/lib/assessment/model':model});
 return load(file,{'@/lib/auth':auth,'@/lib/api':api,'@/lib/assessment/server':server,'@/lib/assessment/model':model,'@/lib/assessment/catalogue.json':catalogue});
}
const member={id:'member',org_id:org,role:'org_member',status:'active'};
function database(record=assessment) {
 const calls=[];
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:record,error:null})};
 return {calls,from:()=>query,rpc:async(name,args)=>{calls.push({name,args});return {data:{...assessment,...args.answers},error:null};}};
}
test('assessment writes reject inactive accounts, auditors and super admins without MFA before querying data',async()=>{
 for(const profile of [null,{...member,status:'invited'},{...member,status:'suspended'},{...member,role:'auditor'},{...member,role:'super_admin'}]) {
  const context={profile,assurance:{currentLevel:'aal1'},supabase:{from:()=>{throw new Error('Unexpected data access');},rpc:()=>{throw new Error('Unexpected mutation');}}};
  const patch=await route('src/app/api/v1/assessments/[id]/route.ts',context).PATCH(body({}),params);
  assert([401,403].includes(patch.status));
  const generate=await route('src/app/api/v1/assessments/[id]/remediation/route.ts',context).POST(body({expectedRevision:3}),params);
  assert([401,403].includes(generate.status));
 }
});
test('scoped API guard refuses an assessment returned for another tenant',async()=>{
 const db=database({...assessment,org_id:'20000000-0000-4000-8000-000000000002'});
 const result=await route('src/app/api/v1/assessments/[id]/route.ts',{profile:member,supabase:db}).PATCH(body({expectedRevision:3,answers:{},cursor:assessment.cursor,status:'draft'}),params);
 assert.equal(result.status,403);assert.equal(db.calls.length,0);
});
test('stale API saves and fabricated scoring metadata cannot reach the save function',async()=>{
 for(const update of [{expectedRevision:2,answers:{}},{expectedRevision:3,answers:{'SN-UPDATE-02':{value:false,critical:false}}},{expectedRevision:3,answers:{'SN-MALWARE-01':{value:'unsupported-option'}}}]) {
  const db=database();
  const result=await route('src/app/api/v1/assessments/[id]/route.ts',{profile:member,supabase:db}).PATCH(body({...update,cursor:assessment.cursor,status:'draft'}),params);
  assert([409,422].includes(result.status));assert.equal(db.calls.length,0);
 }
});
test('review cannot be finalised with unanswered questions',async()=>{
 const db=database();const result=await route('src/app/api/v1/assessments/[id]/route.ts',{profile:member,supabase:db}).PATCH(body({expectedRevision:3,answers:{},cursor:assessment.cursor,status:'reviewed'}),params);
 assert.equal(result.status,422);assert.equal(db.calls.length,0);
});
test('remediation request cannot supply a different tenant or task data',async()=>{
 const db=database();const result=await route('src/app/api/v1/assessments/[id]/remediation/route.ts',{profile:member,supabase:db}).POST(body({expectedRevision:3,orgId:'another',tasks:[]}),params);
 assert.equal(result.status,422);assert.equal(db.calls.length,0);
});
test('remediation forwards only the saved assessment ID and expected revision',async()=>{
 const calls=[];const context={profile:member,supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:{created:1,reused:0,resolved:0,total:1},error:null};}}};
 const result=await route('src/app/api/v1/assessments/[id]/remediation/route.ts',context).POST(body({expectedRevision:3}),params);
 assert.equal(result.status,200);assert.deepEqual(calls,[{name:'generate_assessment_remediation',args:{p_id:id,p_expected_revision:3}}]);
});
