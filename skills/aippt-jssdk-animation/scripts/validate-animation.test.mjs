import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateManifest,validateEntries} from './validate-animation.mjs';
const entry={targetName:'body',effectKey:'Entrance_FadeIn',startMode:'withPrevious',delayMs:300,durationMs:600,repeat:1,rewind:false};
test('CLI invoked through a symlink runs validation instead of silently succeeding',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'animation-cli-'));
 try {
  await fs.copyFile(new URL('./validate-animation.mjs',import.meta.url),path.join(dir,'validator.mjs'));
  await fs.symlink(path.join(dir,'validator.mjs'),path.join(dir,'linked.mjs'));
  const result=spawnSync(process.execPath,[path.join(dir,'linked.mjs')],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Usage: validate-animation/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('reject static, interactive, repeated and unreadably short native timelines',()=>{
 assert.doesNotThrow(()=>validateEntries([entry],5000));
 for(const entries of [[],[entry,entry],[{...entry,startMode:'onClick'}],[{...entry,durationMs:NaN}],[{...entry,effectKey:'Unknown'}],[{...entry,delayMs:4500}]]) assert.throws(()=>validateEntries(entries,5000));
});
test('scene order and native automatic advance must form a contiguous bounded deck',()=>{
 const m={sourceOfTruth:'native-pptx-timing',autoAdvance:true,scenes:[{slideIndex:1,startMs:0,durationMs:5000}]};
 assert.equal(validateManifest(m,1),5000);
 assert.throws(()=>validateManifest({...m,autoAdvance:false},1));
 assert.throws(()=>validateManifest({...m,scenes:[{...m.scenes[0],slideIndex:2}]},1));
 assert.throws(()=>validateManifest({...m,scenes:[{...m.scenes[0],startMs:1000}]},1));
});
