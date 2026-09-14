#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {acceptEvidence,loadPolicy} from './evidence-policy.mjs';
export const geometryDeclaration=/^\s*const (s[0-9]+) = slide\.shapes\.addCustomGeometry\((\{[^\n]+\})\);\s*$/gm;
const reference=/jssdkSourceGeometry\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
export function expandSourceGeometry(source, plan, root) {
 const refs=[...source.matchAll(reference)];
 const required=[];
 for(const slide of plan.slides??[])for(const [id,shapes] of Object.entries(slide.required_geometry??{}))for(const shape of shapes){required.push(`Slide ${slide.slide}: preserve ${slide.variant_selected} using jssdkSourceGeometry("${id}", "${shape}")`);refs.push(['',id,shape]);}
 if(required.length&&!source.includes('jssdkSourceGeometry'))throw Error(required.join('\n'));
 if(!source.includes('jssdkSourceGeometry'))return source;
 if(!refs.length||source.includes('function jssdkSourceGeometry')||source.includes('const jssdkSourceGeometry'))throw Error('Use literal source geometry references; do not define the reserved helper');
 const policy=loadPolicy(root),allowed=new Map();
 for(const slide of plan.slides??[])for(const entry of slide.source_evidence??[]) {
  if(typeof entry==='string')allowed.set(path.basename(entry,'.json'),path.resolve(root,entry));
  else allowed.set(entry.id,entry.facts);
 }
 const catalog={};
 for(const [,id,shape] of refs) {
  const facts=allowed.get(id);if(!facts)throw Error(`Unselected source: ${id}`);
  const relative=path.relative(root,path.resolve(facts));if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Facts outside selected catalog');
  const fact=JSON.parse(fs.readFileSync(facts)),stem=facts.slice(0,-5),workspace=path.resolve(root,'../../..');
  const program=fs.readFileSync(fs.existsSync(stem+'.mjs')?stem+'.mjs':path.resolve(workspace,fact.program));
  const reportBytes=fs.readFileSync(fs.existsSync(stem+'.verification.json')?stem+'.verification.json':path.resolve(workspace,fact.verification));
  acceptEvidence({fact,program,reportBytes,policy,id});
  const match=[...program.toString().matchAll(geometryDeclaration)].find(m=>m[1]===shape);
  if(!match)throw Error(`Missing source geometry: ${id}/${shape}`);
  (catalog[id]??={})[shape]=JSON.parse(match[2]);
 }
 return '// Native geometry copied from selected hash-verified JSSDK sources.\nconst __verifiedJssdkGeometry = '+JSON.stringify(catalog)+';\nfunction jssdkSourceGeometry(id, shape) { const g = __verifiedJssdkGeometry[id]?.[shape]; if (!g) throw new Error("Unselected source geometry: "+id+"/"+shape); return JSON.parse(JSON.stringify(g)); }\n'+source;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [input,plan,output,root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')]=process.argv.slice(2);
 if(!input||!plan||!output)throw Error('Usage: expand-source-geometry.mjs draft.mjs generation-plan.json generated.mjs [catalog-root]');
 fs.writeFileSync(output,expandSourceGeometry(fs.readFileSync(input,'utf8'),JSON.parse(fs.readFileSync(plan)),path.resolve(root)));
 console.log(output);
}
