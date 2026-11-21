import { readFile } from 'node:fs/promises';
import { zstdDecompressSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';

const classicEntry = './?classic=1';

async function openRoundOne(page: Page) {
  await page.goto(classicEntry);
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '어디로 출발할까요?' })).toBeVisible();
  await expect(page.getByRole('button', { name: '이전 라운드를 클리어해 주세요' }).first()).toBeDisabled();
  await page.getByRole('button', { name: '플레이', exact: true }).first().click();
  await expect(page.locator('canvas')).toBeVisible();
}
async function dispatch(page: Page, id: string) {
  await page.getByRole('button', { name: new RegExp(`버스 ${id},`) }).click();
}

test('home → rounds → rapid distinct dispatch → delayed win → next round → save restoration', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openRoundOne(page);
  for (const id of ['red-1', 'blue-1', 'green-1', 'yellow-1']) await dispatch(page, id);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '모두 탔어요. 출발!' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '다음 라운드', exact: true }).click();
  await expect(page.getByRole('heading', { name: '길을 열어주세요', exact: true })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await dispatch(page, 'red-1');
  await expect(page.getByText('앞에 다른 버스가 있어요. 길을 먼저 열어주세요.')).toBeVisible();
  await dispatch(page, 'blue-1');
  await expect(page.getByRole('button', { name: /버스 blue-1,/ })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '하던 라운드 이어하기' }).click();
  await expect(page.getByRole('heading', { name: '길을 열어주세요', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /버스 blue-1,/ })).toHaveCount(0);
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '계속하기', exact: true }).click();
  await page.getByRole('button', { name: '한 수 되돌리기', exact: true }).click();
  await expect(page.getByRole('button', { name: /버스 blue-1,/ })).toBeVisible();
  await page.getByRole('button', { name: '라운드 목록으로', exact: true }).first().click();
  await expect(page.getByText('클리어', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('settings export → import preview → merge, malformed input and explicit replacement', async ({
  page,
  context,
}) => {
  await page.goto(classicEntry);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const sound = page.getByRole('checkbox', { name: /효과음/ });
  const fps = page.getByRole('combobox', { name: '프레임 레이트' });
  await sound.uncheck();
  await fps.selectOption('90');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '저장 데이터 내보내기', exact: true }).click();
  const backup = await downloaded;
  expect(backup.suggestedFilename()).toMatch(/^bus-puzzle-save-\d{4}-\d{2}-\d{2}\.bpz$/);
  const file = {
    name: backup.suggestedFilename(),
    mimeType: 'application/octet-stream',
    buffer: await readFile(await backup.path()),
  };
  expect(JSON.parse(zstdDecompressSync(file.buffer).toString('utf8')).data.settings.frameRate).toBe(90);
  await sound.check();
  await fps.selectOption('120');
  await page.getByLabel('저장 데이터 가져오기', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('heading', { name: '백업 확인' })).toBeVisible();
  await page.getByRole('button', { name: '기록 병합', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(sound).toBeChecked();
  await expect(fps).toHaveValue('120');
  await page
    .getByLabel('저장 데이터 가져오기', { exact: true })
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.getByText('올바른 JSON 파일이 아닙니다.')).toBeVisible();
  await page.getByLabel('저장 데이터 가져오기', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('button', { name: '백업으로 완전히 교체', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '기존 설정과 모든 기록이 교체되는 것을 확인했습니다.' }).check();
  await page.getByRole('button', { name: '백업으로 완전히 교체', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(sound).not.toBeChecked();
  await expect(fps).toHaveValue('90');
});

test('subpath assets, service worker precache and offline reload support all screens', async ({
  page,
  context,
}) => {
  const missing: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(classicEntry);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A first-install prompt-mode worker controls the page on the next navigation.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    return href ? await fetch(href).then((r) => r.json()) : null;
  });
  expect(manifest.scope).toBe(process.env.E2E_BASE_PATH ?? '/bus-puzzle/');
  expect(manifest.start_url).toBe(process.env.E2E_BASE_PATH ?? '/bus-puzzle/');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '작은 버스, 즐거운 출발.' })).toBeVisible();
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await page.getByRole('button', { name: '플레이', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  for (const id of ['red-1', 'blue-1', 'green-1', 'yellow-1']) await dispatch(page, id);
  await expect(page.getByRole('heading', { name: '모두 탔어요. 출발!' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('dialog').getByRole('button', { name: '라운드 목록으로' }).click();
  await page.getByRole('button', { name: '설정 열기' }).click();
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await expect(page.getByText('클리어', { exact: true })).toBeVisible();
  expect(missing).toEqual([]);
});

test('another tab cannot silently overwrite this tab’s active game', async ({ page, context }) => {
  await openRoundOne(page);
  const second = await context.newPage();
  await second.goto(classicEntry);
  await second.getByRole('button', { name: '설정', exact: true }).click();
  await second.getByRole('checkbox', { name: /효과음/ }).uncheck();
  await expect(page.getByRole('alert')).toContainText('다른 창');
  await expect(page.getByRole('button', { name: /버스 red-1,/ })).toBeDisabled();
  await second.close();
});
