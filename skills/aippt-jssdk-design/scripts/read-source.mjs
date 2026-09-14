#!/usr/bin/env node
// Print an authenticated source view for a coding agent's L2 context.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {acceptEvidence,loadPolicy} from './evidence-policy.mjs';

export function sourceView(program, id = "selected-source-id") {
  let omitted=0;
  const lines=program.toString().split('\n').map((line,index)=>{
    if(Buffer.byteLength(line)<=2400)return line;
    omitted++;
    const match=line.match(/^(.*addCustomGeometry\()(\{.*\})(\);.*)$/);
    if(match){
      const geometry=JSON.parse(match[2]);
      for(const key of ['guides','connections','handles'])if(Array.isArray(geometry[key])&&JSON.stringify(geometry[key]).length>1200){geometry[`omitted_${key}_count`]=geometry[key].length;delete geometry[key];}
      for(const p of geometry.paths??[])if(Array.isArray(p.commands)){p.omitted_command_count=p.commands.length;delete p.commands;}
      return `// SOURCE L${index+1}: ${match[1].trim()}${JSON.stringify(geometry)}${match[3]} [path tables omitted; structural excerpt only]`;
    }
    return `// SOURCE L${index+1}: ${line.slice(0,160).trim()} ... [long literal omitted; inspect original if needed]`;
  });
  const references=[...program.toString().matchAll(/^\s*const (s[0-9]+) = slide\.shapes\.addCustomGeometry\((\{[^\n]+\})\);\s*$/gm)].map(m=>`// Exact geometry ${m[1]}: jssdkSourceGeometry(${JSON.stringify(id)}, ${JSON.stringify(m[1])}); apply source fill/line style separately.`).join('\n');
  return references+'\n'+(omitted?`// READ-ONLY SOURCE VIEW: ${omitted} long literal tables omitted after full-program verification. This excerpt is not executable.\n`:'')+lines.join('\n');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const facts=path.resolve(process.argv[2]??'');
  if(!process.argv[2])throw new Error('Usage: read-source.mjs <selected-facts.json>');
  const root=path.resolve(path.dirname(facts),'../..'),workspace=path.resolve(root,'../../..');
  const fact=JSON.parse(fs.readFileSync(facts));
  const stem=facts.slice(0,-5);
  const program=fs.readFileSync(fs.existsSync(stem+'.mjs')?stem+'.mjs':path.resolve(workspace,fact.program));
  const reportBytes=fs.readFileSync(fs.existsSync(stem+'.verification.json')?stem+'.verification.json':path.resolve(workspace,fact.verification));
  const admitted=acceptEvidence({fact,program,reportBytes,policy:loadPolicy(root)});
  process.stdout.write(`// Source: ${fact.program}\n// SHA-256: ${fact.program_sha256}\n// Admission: ${admitted.evidence_class}; raw SSIM ${admitted.raw_ssim}; exact ${admitted.exact_reference}\n`+sourceView(program,fact.id));
}
