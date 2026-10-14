// Validate a locally supplied preparation catalogue and emit an immutable-version SQL insert.
// This helper does not connect to or change a database.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
const moduleRequire=createRequire(import.meta.url);
const [input,flag,output]=process.argv.slice(2);
if(!input || flag!=='--output' || !output) throw new Error('Usage: node scripts/prepare-assessment-catalogue.mjs catalogue.json --output output.sql');
const source=ts.transpileModule(fs.readFileSync(new URL('../src/lib/assessment/model.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const evaluatedModule={exports:{}};
new Function('require','module','exports',source)(moduleRequire,evaluatedModule,evaluatedModule.exports);
const catalogue=evaluatedModule.exports.catalogueSchema.parse(JSON.parse(fs.readFileSync(path.resolve(input),'utf8')));
const body=JSON.stringify(catalogue,null,2);
const delimiter=`sn_${createHash('sha256').update(body).digest('hex')}`;
const sql=`-- Validated immutable preparation catalogue: ${catalogue.version}\nbegin;\ninsert into public.assessment_catalogues(version,catalogue)\nvalues ('${catalogue.version}', $${delimiter}$${body}$${delimiter}$::jsonb)\non conflict (version) do update set catalogue=excluded.catalogue where assessment_catalogues.catalogue is distinct from excluded.catalogue;\ncommit;\n`;
fs.writeFileSync(path.resolve(output),sql,{encoding:'utf8',flag:'wx'});
console.log(`Prepared ${catalogue.questions.length} questions for ${catalogue.version}. Review ${path.resolve(output)} before applying it.`);
