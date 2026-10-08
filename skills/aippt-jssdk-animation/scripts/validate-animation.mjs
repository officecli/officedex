import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

export function validateManifest(manifest, slideCount) {
  assert.equal(manifest.sourceOfTruth, 'native-pptx-timing');
  assert.equal(manifest.autoAdvance, true, 'Native automatic slide advance is required');
  assert.ok(slideCount > 0 && slideCount <= 12, 'Animation v1 supports 1–12 slides');
  assert.equal(manifest.scenes?.length, slideCount, 'One scene per slide is required');
  let end = 0;
  for (const [i, s] of manifest.scenes.entries()) {
    assert.equal(s.slideIndex, i + 1, 'Scene order must match native slide order');
    assert.equal(s.startMs, end, 'Scene times must be contiguous');
    assert.ok(Number.isFinite(s.durationMs) && s.durationMs >= 2000, 'Allow time to read each slide');
    end += s.durationMs;
  }
  assert.ok(end <= 120000, 'Animation v1 supports up to 120 seconds');
  return end;
}

export function validateEntries(entries, durationMs) {
  assert.ok(entries.length >= 1 && entries.length <= 16, 'Each slide needs 1–16 animated content objects');
  const seen = new Set();
  for (const e of entries) {
    assert.ok(!seen.has(e.targetName), `Repeated target: ${e.targetName}`); seen.add(e.targetName);
    assert.equal(e.effectKey, 'Entrance_FadeIn', 'Animation v1 only admits validated fade recipes');
    assert.equal(e.startMode, 'withPrevious', 'Use absolute page-local delays');
    assert.equal(e.repeat, 1); assert.ok(!e.rewind && !e.triggerTargetRef && !e.motionPath);
    assert.ok(Number.isFinite(e.durationMs) && e.durationMs >= 100 && e.durationMs <= 2000);
    assert.ok(Number.isFinite(e.delayMs) && e.delayMs >= 0);
    assert.ok(e.delayMs + e.durationMs + 1000 <= durationMs, 'Keep 1000ms to read after the last animation');
  }
}

function walk(block, fn) { fn(block); for (const c of block.data ?? []) if (c && typeof c === 'object') walk(c, fn); }
function comparable(e) {
  return Object.fromEntries(['targetName','effectKey','startMode','delayMs','durationMs','repeat','rewind','motionPath','motionAutoRotate','optionId'].map(k=>[k,e[k] ?? null]));
}

export async function validateAnimation(root, run) {
  const manifest = JSON.parse(await fs.readFile(path.join(run,'video-manifest.json'),'utf8'));
  const execution = JSON.parse(await fs.readFile(path.join(run,'execution.json'),'utf8'));
  assert.equal(execution.pptxExport,'passed'); assert.equal(execution.strictReimport,'passed');
  const durationMs = validateManifest(manifest, execution.slides);
  const {createJssdkNativeRuntime} = await import(pathToFileURL(path.join(root,'tools/lib/jssdk-native-runtime.mjs')));
  const runtime = await createJssdkNativeRuntime(root);
  try {
    const {AnimationController} = await runtime.server.ssrLoadModule('/packages/presentation-engine/src/capabilities/slideshow/animation-controller.ts');
    const docs = await Promise.all(['generated.mop','reimported.mop'].map(d=>runtime.open(path.join(run,d))));
    const controllers = docs.map(doc=>new AnimationController({getDocument:()=>doc}));
    const frames = [], slides = [];
    for (const [i, scene] of manifest.scenes.entries()) {
      const [before, after] = controllers.map((c,n)=>c.getAnimationEntries(docs[n].slideIds[i]));
      validateEntries(after,scene.durationMs);
      assert.deepEqual(after.map(comparable),before.map(comparable),`Slide ${i+1}: native animation changed on roundtrip`);
      const names = new Map(), refs = new Set(); let transition;
      walk(docs[1].getSlideEntry(docs[1].slideIds[i]).block,b=>{
        if(b.type==='transition')transition=b.attrs;
        if(b.type==='shape'||b.type==='group') {
          refs.add(b.attrs?.logicalId);
          if(b.attrs?.name)names.set(b.attrs.name,(names.get(b.attrs.name)??0)+1);
        }
      });
      assert.equal(transition?.advanceAfter,scene.durationMs,`Slide ${i+1}: native advance time`);
      assert.equal(transition?.advanceOnClick,false);
      for(const e of after) { assert.ok(refs.has(e.targetRef),'Missing native animation target'); assert.equal(names.get(e.targetName),1,'Animation target names must be unique'); }
      const times=[...new Set([0,scene.durationMs-1,...after.flatMap(e=>[Math.max(0,e.delayMs-1),e.delayMs+Math.floor(e.durationMs/2),e.delayMs+e.durationMs+30])])].sort((a,b)=>a-b);
      const firstFrame=frames.length;
      frames.push(...times.map(timestampMs=>({slideIndex:i+1,timestampMs})));
      slides.push({slideIndex:i+1,firstFrame,frameCount:times.length,entries:after.map(comparable)});
    }
    const layout=await runtime.render(path.join(run,'reimported.mop'),manifest.scenes.map(s=>s.slideIndex),path.join(run,'animation-layout'),960);
    assert.deepEqual(layout.errors,[],'Native layout errors');
    assert.ok(layout.outputs.every(o=>(o.textLayout??[]).every(t=>!t.overflow)),'Native text overflow after roundtrip');
    const render=await runtime.renderFrames(path.join(run,'reimported.mop'),frames,path.join(run,'animation-preview'),960);
    assert.deepEqual(render.errors,[],'Native playback errors');
    assert.equal(render.outputs.length,frames.length);
    const hashes = await Promise.all(frames.map(async (_,i)=>createHash('sha256').update(await fs.readFile(path.join(run,'animation-preview',`frame-${String(i).padStart(5,'0')}.png`))).digest('hex')));
    for(const s of slides) assert.ok(new Set(hashes.slice(s.firstFrame,s.firstFrame+s.frameCount)).size>1,`Slide ${s.slideIndex}: no visible animation in native playback`);
    const report={contract:'jssdk-animation/v1',status:'passed',durationMs,slides,frameCount:frames.length,frames,pptxExport:'passed',strictReimport:'passed',nativeTimingEquivalent:true,renderErrors:render.errors,textOverflows:0,officeDesktopVerified:false};
    await fs.writeFile(path.join(run,'animation-validation.json'),JSON.stringify(report,null,2)+'\n');
    return report;
  } finally {await runtime.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(await fs.realpath(process.argv[1])).href) {
  const [root,run]=process.argv.slice(2);
  if(!root||!run)throw new Error('Usage: validate-animation.mjs <presentation-root> <run-dir>');
  const result=await validateAnimation(path.resolve(root),path.resolve(run));
  console.log(JSON.stringify({status:result.status,slides:result.slides.length,frames:result.frameCount}));
}
