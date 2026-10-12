import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFile, copyFile, writeFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { openShell, queueFileDialog, hostControl, answerPendingQuestion, outlineGate, attachHostReport } from './support/real-e2e';

test('real template import and both generation modes', async ({ page }, info) => {
  test.setTimeout(15 * 60_000);
  const source = path.resolve(process.env.OFFICEDEX_TEMPLATE_FIXTURE || '../officedex-landingpage/public/media/examples/OfficeDex-Product-Overview.pptx');
  await openShell(page);
  await page.getByRole('button', { name: 'My PPT templates' }).click();
  await queueFileDialog(source);
  await page.getByRole('button', { name: 'Import PPT template', exact: true }).click();
  const selected = page.locator('.dx-ppt-template-row input:checked');
  await expect(selected).toBeChecked({ timeout: 180_000 });
  await page.screenshot({ path: info.outputPath('template-imported.png') });
  const catalogue = await page.evaluate(() => JSON.parse(localStorage.getItem('officedex:pptx-template-assets:v1') || '{}'));
  const template = catalogue.templates[0];
  expect(template.status).toBe('ready');
  expect(template.pageCount).toBeGreaterThan(0);
  for (const rel of ['source.mop/content.json', 'template-facts.json', 'skill/handbook.json']) {
    expect((await readFile(path.join(template.localAssetDir, rel))).length).toBeGreaterThan(0);
  }
  await info.attach('template-catalogue', { body: JSON.stringify(catalogue, null, 2), contentType: 'application/json' });
  const outputs: unknown[] = [];
  for (const mode of ['fast', 'plan'] as const) {
    if (mode === 'plan') {
      await page.getByRole('button', { name: 'OfficeDex Home', exact: true }).click();
      await page.getByRole('button', { name: 'My PPT templates' }).click();
      await page.locator(`.dx-ppt-template-row input[value="${template.id}"]`).check();
    }
    await page.getByLabel('Presentation brief', { exact: true }).fill(`请使用所选模板制作恰好 3 页中文演示文稿，主题为「模板体验验收 ${mode}」，分别介绍模板导入、品牌一致性、设计团队反馈。不要联网，不要生成图片。所有内容都围绕这三个主题，不要保留模板的原始示例正文。`);
    await page.getByLabel(mode === 'plan' ? 'Advanced · Review the plan first' : 'Simple · Generate directly', { exact: true }).check();
    await page.getByRole('button', { name: 'Generate PPT from selected template' }).click();
    await expect(page.locator('#dx-modal')).toHaveCount(0);
    let reviewed = false;
    let task: any;
    const deadline = Date.now() + 6 * 60_000;
    while (Date.now() < deadline) {
      const history = await hostControl<{result: any[]}>('/rpc/GetTaskHistory', { method: 'POST', body: '20' });
      const entry = history.result.find((item: any) => item.events?.some((event: any) => JSON.stringify(event.payload).includes(`模板体验验收 ${mode}`)));
      task = entry ? { id: entry.taskId, status: entry.events.some((event: any) => event.type === 'task.failed') ? 'failed' : entry.events.some((event: any) => event.type === 'task.completed') ? 'completed' : 'running', events: entry.events } : undefined;
      if (task?.status === 'failed') throw new Error(JSON.stringify(task.events.find((event: any) => event.type === 'task.failed')));
      if (task?.status === 'completed') break;
      if (await outlineGate(page).isVisible().catch(() => false)) {
        expect(mode).toBe('plan');
        const titles = outlineGate(page).locator('ol.dx-agent-outline input');
        await expect(titles).toHaveCount(3);
        await titles.nth(1).fill('设计团队确认的品牌一致性');
        await page.screenshot({ path: info.outputPath('template-outline-review.png') });
        await outlineGate(page).locator('button[type=submit]').click();
        reviewed = true;
      } else await answerPendingQuestion(page);
      await page.waitForTimeout(1000);
    }
    expect(task?.status, JSON.stringify(task)).toBe('completed');
    expect(reviewed).toBe(mode === 'plan');
    const docs = await hostControl<{result:{items: {filePath:string; currentArtifactTaskId?:string}[]}}>('/rpc/ListDocuments', { method: 'POST', body: '{"limit":200}' });
    const document = docs.result.items.find(item => item.currentArtifactTaskId === task.id);
    expect(document, JSON.stringify(docs.result)).toBeTruthy();
    const bytes = await readFile(document!.filePath);
    const parts = unzipSync(bytes);
    const slides = Object.keys(parts).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slides).toHaveLength(3);
    const text = slides.map(name => strFromU8(parts[name])).join('\n');
    expect(text).toMatch(/模板|品牌|设计团队/);
    if (mode === 'plan') expect(text).toContain('设计团队确认的品牌一致性');
    await copyFile(document!.filePath, info.outputPath(`template-${mode}.pptx`));
    await expect(page.locator('.pptx-embed-frame')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/Unable to open this presentation/i)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`template-${mode}-completed.png`) });
    outputs.push({ mode, taskId: task.id, filePath: document!.filePath, bytes: bytes.length, slides: slides.length, reviewed });
  }
  await writeFile(info.outputPath('template-results.json'), JSON.stringify(outputs, null, 2));
  await attachHostReport(info);
});
