import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { homeComposer, openShell, queueFileDialog, hostControl, attachHostReport } from './support/real-e2e';

// Opt-in live model check; deterministic service/UI/disk regressions run in the
// cumulative gate. This uses the exact tester prompt and real hosted Modify.
test('N27-01 original attachment prompt produces one saved original and Undo', async ({page},info) => {
  test.skip(process.env.OFFICEDEX_QA27_LIVE !== '1', 'requires a live OfficeDex model session');
  test.setTimeout(180_000);
  const dir = await mkdtemp(path.join(tmpdir(),'officedex-qa27-'));
  const source = path.join(dir,'OD27-attachment.docx');
  const parts = unzipSync(new Uint8Array(await readFile('e2e/fixtures/qa27/approved.docx')));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('Gamma approved.','Gamma pending.'));
  const before = zipSync(parts); await writeFile(source,before);
  const methods:string[] = [];
  page.on('request',r=>{if(r.url().includes('/rpc/')) methods.push(r.url().split('/rpc/')[1]);});
  await openShell(page);
  await queueFileDialog(source);
  await page.locator('.dx-home-composer [data-act=context]').click();
  await page.locator('[data-act=add-picker]').click();
  await expect(page.locator('.dx-home-composer .dx-reference-label')).toHaveText('OD27-attachment.docx');
  await homeComposer(page).fill(await readFile('e2e/fixtures/qa27/prompt.txt','utf8'));
  await homeComposer(page).press('Enter');
  const card=page.locator('.dx-agent-run:visible').last();
  await expect(card).toHaveAttribute('data-status','completed',{timeout:120_000});
  await expect(card.locator('.dx-agent-result')).toHaveCount(1);
  await expect(card.locator('.dx-agent-result')).toContainText('OD27-attachment.docx');
  await expect(card.locator('.dx-agent-result')).toContainText('Changes applied');
  expect(methods.filter(m=>m==='Modify')).toHaveLength(1);
  expect(methods.filter(m=>m==='Generate')).toHaveLength(0);
  const xml=strFromU8(unzipSync(new Uint8Array(await readFile(source)))['word/document.xml']);
  expect(xml).toContain('Gamma approved.');expect(xml).toContain('Delta unchanged.');expect(xml).not.toContain('Gamma pending.');
  await page.screenshot({path:info.outputPath('one-result.png')});
  await card.locator('[data-act=undo-task]').click();
  await expect.poll(async()=>Buffer.compare(Buffer.from(before),await readFile(source))).toBe(0);
  await expect(card.locator('.dx-agent-result')).toHaveCount(1);
  // Apply again through Review, then open the card's actual source result.
  await card.locator('.dx-agent-run-actions [data-act=review-task]').click();
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(card.locator('.dx-agent-result')).toContainText('Changes applied');
  await card.locator('.dx-agent-result').click();
  await expect(page.getByRole('tab',{name:'OD27-attachment',exact:true})).toBeVisible();
  await expect(page.getByRole('tab').filter({hasText:'.modified'})).toHaveCount(0);
  const documents=await hostControl<{ok:boolean,result:{items:{filePath:string}[]}}>('/rpc/ListDocuments',{method:'POST',body:JSON.stringify({limit:200})});
  expect(documents.result.items.filter(d=>d.filePath.includes('.officedex-proposal-'))).toEqual([]);
  expect(documents.result.items.filter(d=>d.filePath===source)).toHaveLength(1);
  await attachHostReport(info);
});
