const fs=require('fs');
const path=require('path');
const cwd=path.resolve(__dirname,'..');
const {test}=require('node:test');
const {chromium}=require(path.join(cwd,'node_modules/@playwright/test'));
const ts=require(path.join(cwd,'node_modules/typescript'));
test('multiline brief morph preserves scrolling and lands without a height jump', async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1200,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const css=['styles/tokens.css','styles/home.css','document/documentWorkspace.css','presentation/progressivePptxStage.css'].map(p=>fs.readFileSync(path.join(cwd,'src/renderer',p),'utf8')).join('\n');
 const js=ts.transpileModule(fs.readFileSync(path.join(cwd,'src/renderer/homeEntryTransition.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 await page.setContent(`<style>${css}\nbody{margin:0;background:white}.home-screen{width:720px;margin:70px auto}.home-intake{width:100%}main{position:absolute;left:190px;top:0;width:950px}.pptx-flow-request textarea{display:block;box-sizing:border-box}.home-entry-morph__text{box-sizing:border-box}</style><section class="home-screen"><h1>What will you create today?</h1><form class="home-intake"><textarea class="od-textarea" style="height:180px"></textarea><div class="home-intake__footer"><button>Create</button></div></form></section><main class="document-workspace--pptx" hidden><header class="document-workspace__header"><h1>New slides</h1></header><div class="pptx-flow-host"><div class="progressive-pptx-stage"><div class="pptx-flow-request"><span>Your request</span><textarea readonly rows="2"></textarea></div><div class="pptx-flow-lower"><section class="pptx-flow-step"><h2>Understanding your direction</h2><div style="height:220px;border:1px solid #eee">Searching the web</div><button>Cancel task</button></section></div></div></div></main>`);
 await page.addScriptTag({content:`(()=>{const exports={};${js};window.motion=exports;})();`});
 const result=await page.evaluate(async()=>{
  const brief='请制作一份品牌发布演示。\n\n'+Array.from({length:10},(_,i)=>`${i+1}. 介绍产品故事、核心能力和实际应用场景，保留所有段落与手动换行。`).join('\n');
  const source=document.querySelector('.home-intake textarea');source.value=brief;source.scrollTop=48;
  const entry=window.motion.captureHomeEntryTransition(brief);
  document.querySelector('.home-screen').remove();
  const host=document.querySelector('main');host.hidden=false;const target=host.querySelector('textarea');target.value=brief;
  window.motion.playHomeEntryTransition(host,entry);
  const animations=document.getAnimations();animations.forEach(a=>{a.pause();a.currentTime=0;});
  const viewport=document.querySelector('.home-entry-morph__text');
  if(viewport.textContent!==brief)throw Error('Lost multiline text');
  if(getComputedStyle(viewport).overflow!=='hidden')throw Error('Long text spills into toolbar');
  if(!getComputedStyle(viewport.firstElementChild).transform.includes('-48'))throw Error('Source scroll position not preserved');
  const before={height:target.offsetHeight,scrollHeight:target.scrollHeight};
  if(before.height<before.scrollHeight-1)throw Error('Destination is clipped');
  animations.forEach(a=>{a.currentTime=1100;});
  const mid=document.querySelector('.home-entry-morph').getBoundingClientRect();
  if(!Number.isFinite(mid.height)||mid.height<=entry.rect.height)throw Error('Long brief is not expanding');
  animations.forEach(a=>a.finish());await Promise.resolve();await Promise.resolve();await Promise.resolve();
  if(document.querySelector('.home-entry-morph'))throw Error('Overlay was not cleaned up');
  if(target.closest('.pptx-flow-request').style.visibility)throw Error('Destination remains hidden');
  if(target.offsetHeight!==before.height)throw Error('Destination jumps after animation');
  return {lines:brief.split('\n').length,sourceScroll:entry.textBox.scrollTop,targetHeight:target.offsetHeight,midHeight:Math.round(mid.height)};
 });
 if(errors.length)throw new Error(errors.join('\n'));
 } finally { await browser.close(); }
});
