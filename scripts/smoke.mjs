import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'stt-electron-test-'));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, STT_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    executablePath: process.env.STT_PACKAGED_APP || undefined,
    args: [
      ...(process.env.STT_PACKAGED_APP ? [] : [resolve('.')]),
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByText('会話を、次の一歩に。')).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace.png' });
  await page.getByRole('button', { name: 'テーマ', exact: true }).click();
  await page.getByLabel('新しいテーマ名').fill('バイオデザイン');
  await page.getByRole('button', { name: 'テーマを作る' }).click();
  await expect(page.getByRole('heading', { name: 'バイオデザイン' })).toBeVisible();
  await page.getByLabel('用語', { exact: true }).fill('全層性壊死');
  await page.getByLabel('読み方', { exact: true }).fill('ぜんそうせいえし');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.getByLabel('背景説明').fill('腸管の虚血・壊死について検討する。');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByText('保存していない変更があります')).not.toBeVisible();
  await page.screenshot({ path: 'test-results/theme.png' });
  await page.getByRole('button', { name: '新しい会議', exact: true }).first().click();
  await page.getByLabel('会議名', { exact: true }).fill('録音テスト');
  await page.getByLabel('テーマ', { exact: true }).selectOption({ label: 'バイオデザイン' });
  await page.getByRole('button', { name: '会議を作成', exact: true }).click();
  await expect(page.getByRole('heading', { name: '録音テスト' })).toBeVisible();
  await page.getByRole('button', { name: '会議名を変更' }).click();
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: '会議名' })
    .fill('録音テスト・修正済み');
  await page.getByRole('dialog').getByRole('button', { name: '確定' }).click();
  await expect(page.getByRole('heading', { name: '録音テスト・修正済み' })).toBeVisible();
  const before = await page.evaluate(() => window.desktop.state());
  expect(before.meetings[0].themeContext.terms[0].word).toBe('全層性壊死');
  expect(before.settings.hasApiKey).toBe(false);
  await page.getByLabel('背景説明').fill('保存ボタンを押さず録音を開始しても背景を保持する');
  // Fake Chromium audio only: never records the user's microphone in this smoke test.
  await page.getByRole('checkbox', { name: 'マイクとMacのシステム音声を録音' }).uncheck();
  await page.getByRole('button', { name: '録音を開始', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止して保存' })).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelector('.recording-clock strong')?.textContent === '00:02',
  );
  await page.getByRole('button', { name: '停止して保存' }).click();
  await expect(page.getByRole('button', { name: '文字起こし・要約を作成' })).toBeVisible();
  const after = await page.evaluate(() => window.desktop.state());
  expect(after.meetings[0].status).toBe('ready');
  expect(after.meetings[0].duration).toBeGreaterThan(1);
  expect(after.meetings[0].context.notes).toBe('保存ボタンを押さず録音を開始しても背景を保持する');
  await expect
    .poll(() => page.locator('audio').evaluate((audio) => audio.readyState))
    .toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/meeting.png' });
  // Reload exercises DB persistence and preload isolation.
  await page.reload();
  await expect(page.getByText('録音テスト・修正済み')).toBeVisible();
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  const interruptedId = await page.evaluate(
    async () =>
      (await window.desktop.createMeeting({ title: '中断テスト', themeId: null, notes: '' })).id,
  );
  await page.getByText('中断テスト', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'マイクとMacのシステム音声を録音' }).uncheck();
  await page.getByRole('button', { name: '録音を開始', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止して保存' })).toBeVisible();
  await page.waitForFunction(
    () => document.querySelector('.recording-clock strong')?.textContent === '00:02',
  );
  await page.reload();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.desktop.state())).meetings.find(
          (m) => m.id === interruptedId,
        )?.status,
    )
    .toBe('error');
  console.log(
    'Electron smoke passed: theme + vocabulary + meeting + fake recording + persistence + isolated renderer.',
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: 'test-results/failure.png' }).catch(() => {});
    console.error(await page.locator('body').innerText());
  }
  throw error;
} finally {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.destroy();
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
  await rm(profile, { recursive: true, force: true });
}
