import {test, expect, type Page} from '@playwright/test';
import {copyFile, mkdtemp, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {unzipSync, strFromU8} from 'fflate';
import {openShell, queueFileDialog, openFromDisk} from './support/real-e2e';

async function rename(page: Page, name: string) {
  await page.getByRole('button', {name:'File options',exact:true}).click();
  await page.getByRole('menuitem', {name:'Rename',exact:true}).press('Enter');
  const dialog=page.getByRole('dialog');
  await dialog.locator('input[name=name]').fill(name);
  await dialog.getByRole('button',{name:'Rename',exact:true}).click();
  await expect(dialog).toHaveCount(0);
}
async function xml(file: string, match: RegExp) {
  const entries=unzipSync(await readFile(file));
  return Object.entries(entries).filter(([name])=>match.test(name)).map(([,bytes])=>strFromU8(bytes)).join('\n');
}
for (const ext of ['docx','pptx','xlsx'] as const) test(`N26-01 ${ext}: rename preserves live edits and save/retry`, async({page},info)=>{
  test.setTimeout(150_000);
  const dir=await mkdtemp(path.join(tmpdir(),'officedex-qa26-'));
  const source=path.join(dir,`before.${ext}`);
  await copyFile(path.resolve('e2e/fixtures/qa26',`original.${ext}`),source);
  await openShell(page);
  await queueFileDialog(source);
  await openFromDisk(page);
  const method=ext==='docx'?'SaveDocx':ext==='pptx'?'ExportPptxEditor':'SaveXlsxEditor';
  const tokens = new Set<string>();
  const sessions = new Set<string>();
  page.on('request',request=>{
    if(request.url().includes(`/rpc/${method}`)) {
      const data=request.postDataJSON();
      const input=data?.args?.[0]??data;
      if(input.previewToken)tokens.add(input.previewToken);
      if(input.sessionId)sessions.add(input.sessionId);
    }
  });
  const edit = async(marker: string) => {
    if(ext==='docx') {
      const frame=page.frameLocator('iframe.writer-embed-frame');
      await expect(frame.locator('.writer-document-preview__render-surface')).toBeVisible();
      const input=frame.locator('[data-role=writer-document-input-surface]');
      await input.focus();
      await page.keyboard.type(marker);
    } else if(ext==='pptx') {
      const frame=page.frameLocator('iframe.pptx-embed-frame');
      const notes=frame.getByRole('textbox',{name:'Speaker notes',exact:true});
      await notes.fill(marker);
      // Blur commits speaker notes to the model for automatic save.
      await page.getByRole('button',{name:'File options',exact:true}).focus();
    } else {
      const grid=page.locator('.spreadsheet-canvas__editor');
      await expect(grid.locator('canvas')).toBeVisible();
      await expect(page.locator('.spreadsheet-canvas__loading')).toHaveCount(0);
      const address=grid.getByRole('textbox').first();
      await grid.locator('canvas').click({position:{x:140,y:55}});
      await expect(address).toHaveValue('B2');
      await page.keyboard.type(marker.endsWith('RETRY')?'19':'17');
      await page.keyboard.press('Enter');
    }
  };
  // Readiness before rename is essential: the stale session must already exist.
  if(ext==='docx') await expect(page.frameLocator('iframe.writer-embed-frame').locator('.writer-document-preview__render-surface')).toBeVisible();
  if(ext==='pptx') await expect(page.frameLocator('iframe.pptx-embed-frame').getByRole('textbox',{name:'Speaker notes',exact:true})).toBeVisible();
  if(ext==='xlsx') {
    await expect(page.locator('.spreadsheet-canvas__editor canvas')).toBeVisible();
    await expect(page.locator('.spreadsheet-canvas__loading')).toHaveCount(0);
  }
  await rename(page,`after.${ext}`);
  const renamed=path.join(dir,`after.${ext}`);
  const match=ext==='docx'?/^word\/document.xml$/:ext==='pptx'?/^ppt\/notesSlides\/notesSlide\d+.xml$/:/^xl\/.*\.xml$/;
  const marker=`QA26${ext.toUpperCase()}AUTO`;
  await edit(marker);
  // PPTX autosaves its working snapshot; explicit save exports OOXML.
  if(ext==='pptx') await page.keyboard.press('Meta+s');
  if(ext==='xlsx') await expect.poll(async()=>{
    const content=await xml(renamed,match);
    return content.match(/<c\b[^>]*r="B2"[^>]*>[\s\S]*?<v>([^<]*)<\/v>/)?.[1];
  },{timeout:45_000}).toBe('17');
  else await expect.poll(()=>xml(renamed,match),{timeout:45_000}).toContain(marker);
  expect(await stat(source).catch(()=>null)).toBeNull();
  // Make a real editor change BEFORE the second rename; prevent its writes
  // temporarily to exercise Retry without discarding/recreating the session.
  let refuse=true;
  await page.route(`**/rpc/${method}`,async route=>{
    if(refuse) await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'N26 regression: temporary save failure'})});
    else await route.continue();
  });
  const retried=`QA26${ext.toUpperCase()}RETRY`;
  await edit(retried);
  await page.keyboard.press('Meta+s');
  await expect(page.locator('[data-act=retry-save]')).toBeVisible();
  await rename(page,`final.${ext}`);
  refuse=false;
  await page.locator('[data-act=retry-save]').click();
  const final=path.join(dir,`final.${ext}`);
  if(ext==='xlsx') await expect.poll(async()=>{
    const content=await xml(final,match);
    return content.match(/<c\b[^>]*r="B2"[^>]*>[\s\S]*?<v>([^<]*)<\/v>/)?.[1];
  },{timeout:45_000}).toBe('19');
  else await expect.poll(()=>xml(final,match),{timeout:45_000}).toContain(retried);
  await expect(page.locator('[data-act=retry-save]')).toHaveCount(0);
  expect(await stat(renamed).catch(()=>null)).toBeNull();
  expect(await stat(source).catch(()=>null)).toBeNull();
  expect(tokens.size).toBe(1);
  if(ext!=='docx')expect(sessions.size).toBe(1);
  if(ext==='xlsx')expect(await xml(final,/^xl\/worksheets\/.*\.xml$/)).toContain('SUM(B2:B3)');
  await page.screenshot({path:info.outputPath(`${ext}-renamed-saved.png`)});
});
