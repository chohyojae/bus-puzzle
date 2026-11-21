import { expect, type Page, test } from '@playwright/test';
import { createDepot, getBlockers } from '../../src/game/depot/logic';
import { exportBackup } from '../../src/storage/import-export';
import { createEmptySave } from '../../src/storage/save-schema';

const bus = (page: Page, id: number) => page.locator(`[data-vehicle-id="bus-${id}"]`);
const tapBus = (page: Page, id: number) => bus(page, id).locator('.vehicle-hit').click();
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function openWithPausedClock(page: Page) {
  // Freeze time before the first navigation so dispatch and reload cannot race an animation frame.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.goto('./');
  await waitForGame(page);
}

async function advanceGame(page: Page, durationMs: number) {
  // The game caps delayed render frames at 200 ms and integrates each physics step in between.
  for (let elapsed = 0; elapsed < durationMs; elapsed += 160) {
    await page.clock.fastForward(Math.min(160, durationMs - elapsed));
  }
}

async function advanceUntil(page: Page, reached: () => Promise<boolean>, withinMs = 2_000, stepMs = 80) {
  if (await reached()) return;
  for (let elapsed = 0; elapsed < withinMs; elapsed += stepMs) {
    await page.clock.fastForward(Math.min(stepMs, withinMs - elapsed));
    if (await reached()) return;
  }
  throw new Error(`The expected animation state was not reached within ${withinMs} ms of game time.`);
}

async function waitForGame(page: Page) {
  // React can schedule its initial lazy-screen reveal after navigation.
  await expect
    .poll(
      async () => {
        await page.clock.fastForward(160);
        return page.getByTestId('passenger-count').isVisible();
      },
      { timeout: 10_000, intervals: [25, 50, 100] },
    )
    .toBe(true);
}

async function restoreThirdStop(page: Page) {
  const save = createEmptySave();
  save.depotRun = { version: 1, stageId: 'depot-sunset', layout: 'compact', elapsed: 0, moves: [] };
  await button(page, '일시정지').click();
  await button(page, '설정').click();
  await page.getByLabel('저장 데이터 가져오기', { exact: true }).setInputFiles({
    name: 'depot-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exportBackup(save)),
  });
  await page.getByRole('checkbox', { name: '진행 중 라운드 가져오기' }).check();
  await button(page, '기록 병합').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await button(page, '게임으로').click();
  await expect(button(page, '3단계 · 단계 선택')).toBeVisible();
}

test('the depot opens directly, the belt moves, and a blocked bus stays in its place', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto('./');
  const board = page.getByRole('application', { name: '해안 정류장', exact: true });
  await expect(board).toBeVisible();
  await expect(board.locator(':scope > title')).toHaveCount(0);
  await expect(page.locator('[data-bay-index]')).toHaveCount(7);
  for (const [color, label] of [
    ['sky', '하늘색'],
    ['gray', '회색'],
  ]) {
    const parked = board.getByRole('button', { name: new RegExp(`${label} \\d+인승 버스 출차$`) }).first();
    await expect(parked).toHaveAttribute('data-color', color);
    await expect(board.locator(`[data-passenger-id] use[href="#walker-${color}"]`).first()).toBeVisible();
  }
  for (const seats of [16, 24, 32, 48]) {
    const parked = page.getByRole('button', { name: new RegExp(` ${seats}인승 버스 출차$`) }).first();
    await expect(parked).toBeVisible();
    await expect(parked).toHaveAttribute('data-capacity', String(seats));
    await expect(parked.locator('.depot-roof-seats')).toBeVisible();
    await expect(parked.locator('.depot-roof-seats')).toHaveText(String(seats));
  }
  const walker = page.locator('[data-passenger-id]').first();
  await expect(walker).toHaveAttribute('transform', /translate/);
  const initialPose = await walker.getAttribute('transform');
  await expect.poll(() => walker.getAttribute('transform')).not.toBe(initialPose);
  await tapBus(page, 17);
  await expect(bus(page, 17)).toHaveAttribute('data-phase', 'parked');
  await expect(bus(page, 17)).toHaveClass(/rejected/);

  await button(page, '일시정지').click();
  const stoppedPose = await walker.getAttribute('transform');
  await page.clock.runFor(600);
  await expect(walker).toHaveAttribute('transform', stoppedPose ?? '');
  await button(page, '계속하기').click();
  await expect.poll(() => walker.getAttribute('transform')).not.toBe(stoppedPose);
  await button(page, '일시정지').click();
  await button(page, '게임 방법').click();
  await expect(page.getByRole('dialog', { name: '게임 방법' })).toBeVisible();
  await button(page, '게임으로').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await button(page, '힌트').click();
  await expect(bus(page, 1)).toHaveClass(/suggested/);
  expect(errors).toEqual([]);
});

test('a tapped bus drives, its progress survives immediate reload, and restart resets the yard', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openWithPausedClock(page);
  const remaining = page.getByTestId('passenger-count');
  await expect(remaining).toBeVisible();
  const initialCount = (await remaining.textContent()) ?? '';
  await tapBus(page, 1);
  await expect(bus(page, 1)).toHaveAttribute('data-phase', 'driving');
  await page.reload();
  await waitForGame(page);
  await expect(bus(page, 1)).toHaveAttribute('data-phase', /driving|boarding|leaving/);
  await advanceUntil(page, async () => (await remaining.textContent()) !== initialCount, 16_000);
  await expect(remaining).not.toHaveText(initialCount);
  await tapBus(page, 3);
  await advanceUntil(page, async () => (await bus(page, 1).count()) === 0, 16_000);
  await expect(bus(page, 1)).toHaveCount(0);
  await button(page, '다시 시작').click();
  await page.getByRole('dialog').getByRole('button', { name: '처음부터 시작' }).click();
  await expect(remaining).toHaveText(initialCount);
  await expect(bus(page, 1)).toHaveAttribute('data-phase', 'parked');
});

test('a diagonally parked bus leaves along its roof arrow', async ({ page }) => {
  const level = createDepot();
  const diagonal = level.buses.find((b) => b.angle % 90 !== 0 && getBlockers(level, b.id).length === 0);
  if (!diagonal) throw new Error('처음 출차할 수 있는 대각선 차량이 없습니다.');
  await openWithPausedClock(page);
  const vehicle = page.locator(`[data-vehicle-id="${diagonal.id}"]`);
  await expect(vehicle).toHaveAttribute('data-phase', 'parked');
  const renderPose = () =>
    vehicle.evaluate((element) => {
      const car = (element as SVGGraphicsElement).getCTM();
      const arrow = element.querySelector<SVGGraphicsElement>('[data-bus-art] > path')?.getCTM();
      if (!car || !arrow) throw new Error('차량과 지붕 화살표가 표시되어야 합니다.');
      const length = Math.hypot(arrow.a, arrow.b);
      return { x: car.e, y: car.f, dx: arrow.a / length, dy: arrow.b / length };
    });
  const start = await renderPose();
  const radians = (diagonal.angle * Math.PI) / 180;
  expect(start.dx).toBeCloseTo(Math.sin(radians), 4);
  expect(start.dy).toBeCloseTo(-Math.cos(radians), 4);
  await vehicle.locator('.vehicle-hit').click();
  // Only the first straight segment follows the roof arrow. Sample one display frame at a time.
  await advanceUntil(
    page,
    async () => {
      const pose = await renderPose();
      return Math.hypot(pose.x - start.x, pose.y - start.y) > 1;
    },
    160,
    16,
  );
  await expect(vehicle).toHaveAttribute('data-phase', 'driving');
  const moved = await renderPose();
  const dx = moved.x - start.x;
  const dy = moved.y - start.y;
  expect((dx * start.dx + dy * start.dy) / Math.hypot(dx, dy)).toBeGreaterThan(0.99);
});

test('a seat opening admits the left rider while the right queue stays in place', async ({ page }) => {
  test.setTimeout(60_000);
  await openWithPausedClock(page);
  const waiting = page.getByLabel('승객 대기 통로');
  await expect(waiting).toBeVisible();
  const leads: number[] = [];
  for (const side of ['left', 'right']) {
    const riders = waiting.locator(`[data-queue-side="${side}"] [data-queue-passenger-id]`);
    await expect(riders.first()).toBeVisible();
    leads.push(
      await riders.evaluateAll((people) =>
        Math.min(...people.map((person) => Number(person.getAttribute('data-queue-passenger-id')))),
      ),
    );
  }
  await button(page, '일시정지').click();
  const [leftId, rightId] = leads;
  const first = waiting.locator(`[data-queue-passenger-id="${leftId}"]`);
  const right = waiting.locator(`[data-queue-side="right"] [data-queue-passenger-id="${rightId}"]`);
  await expect(first).toHaveAttribute('transform', /translate/);
  const pose = await first.getAttribute('transform');
  const rightPose = await right.getAttribute('transform');
  const count = page.getByTestId('passenger-count');
  const initial = Number(await count.textContent());
  const waitingSize = await waiting.locator('[data-queue-passenger-id]').count();
  const onLoop = await page.locator('[data-passenger-id]').count();
  expect(onLoop).toBeGreaterThan(0);
  expect(onLoop / initial).toBeLessThanOrEqual(0.25);
  expect(waitingSize).toBeGreaterThan(onLoop);
  for (const id of leads) await expect(page.locator(`[data-passenger-id="${id}"]`)).toHaveCount(0);
  await page.clock.fastForward(800);
  await expect(first).toHaveAttribute('transform', pose ?? '');
  await button(page, '계속하기').click();
  await tapBus(page, 1);
  const occupancy = page.locator('.depot-load text');
  await advanceUntil(page, async () => (await occupancy.count()) > 0);
  await expect(occupancy).toHaveText(/^\d+\/\d+$/);
  const seats = Number((await occupancy.textContent())?.split('/')[1]);
  expect(seats).toBeGreaterThan(0);
  const admitted = page.locator(`[data-passenger-id="${leftId}"]`);
  await advanceUntil(page, async () => (await admitted.count()) === 1, 9_600);
  await expect(first).toHaveCount(0);
  await expect(admitted).toBeVisible();
  await advanceGame(page, 18_000);
  await expect(right).toHaveAttribute('transform', rightPose ?? '');
  await expect(page.locator(`[data-passenger-id="${rightId}"]`)).toHaveCount(0);
  await expect(bus(page, 1)).toHaveAttribute('data-phase', 'boarding');
  await expect(occupancy).toHaveText(`32/${seats}`);
  expect(seats).toBe(48);
  await expect(count).toHaveText(String(initial - 32));
  await tapBus(page, 3);
  await advanceUntil(page, async () => (await bus(page, 1).getAttribute('data-phase')) === 'leaving', 19_200);
  await advanceGame(page, 2_000);
  await expect(bus(page, 1)).toHaveCount(0);
});

test('all passengers board, and the next stop is playable after refresh', async ({ page }) => {
  test.setTimeout(90_000);
  await openWithPausedClock(page);
  const hint = button(page, '힌트');
  await expect(hint).toBeVisible();
  const queueOrder = await page.getByLabel('해안 정류장', { exact: true }).evaluateHandle((board) => {
    const left = board.querySelector('[data-queue-side="left"]');
    const right = board.querySelector('[data-queue-side="right"]');
    const loop = board.querySelector('[aria-label="정류장을 순환하는 승객"]');
    if (!left || !right || !loop) throw new Error('Both waiting aisles and the loop must be visible.');
    const rightIds = new Set([...right.children].map((p) => p.getAttribute('data-queue-passenger-id')));
    const front = String(Math.min(...[...rightIds].map(Number)));
    const head = right.querySelector(`[data-queue-passenger-id="${front}"]`);
    if (!head) throw new Error('The right queue must have a front passenger.');
    const startingPose = head.getAttribute('transform');
    let movedEarly = false;
    let admittedAfterLeft = false;
    const observe = new MutationObserver(() => {
      if (left.childElementCount) {
        movedEarly ||=
          head.getAttribute('transform') !== startingPose ||
          right.childElementCount !== rightIds.size ||
          [...right.children].some((p) => !rightIds.has(p.getAttribute('data-queue-passenger-id')));
      } else if (loop.querySelector(`[data-passenger-id="${front}"]`)) admittedAfterLeft = true;
    });
    for (const group of [left, right, loop]) observe.observe(group, { childList: true });
    observe.observe(head, { attributes: true, attributeFilter: ['transform'] });
    return {
      finish() {
        observe.disconnect();
        return { movedEarly, admittedAfterLeft };
      },
    };
  });
  const original = await page.locator('[data-phase="parked"]').count();
  let sent = 0;
  let waiting = 0;
  while (sent < original && waiting < 15_000) {
    await hint.click();
    const marked = page.locator('[data-phase="parked"].suggested');
    const id = (await marked.count()) ? await marked.getAttribute('data-vehicle-id') : null;
    if (id) {
      const vehicle = page.locator(`[data-vehicle-id="${id}"]`);
      await vehicle.locator('.vehicle-hit').click();
      await expect(vehicle).toHaveAttribute('data-phase', 'driving');
      sent++;
      waiting = 0;
    } else {
      waiting += 500;
    }
    await advanceGame(page, 500);
  }
  expect(sent).toBe(original);
  await advanceGame(page, 8_000);
  await expect(page.getByTestId('passenger-count')).toHaveText('0');
  await expect(page.locator('[data-vehicle-id]')).toHaveCount(0);
  expect(await queueOrder.evaluate((order) => order.finish())).toEqual({
    movedEarly: false,
    admittedAfterLeft: true,
  });
  await page.getByRole('dialog').getByRole('button', { name: '다음 단계' }).click();
  await expect(button(page, '2단계 · 단계 선택')).toBeVisible();
  await page.clock.resume();
  await page.reload();
  await expect(button(page, '2단계 · 단계 선택')).toBeVisible();
  await expect(bus(page, 1)).toHaveAttribute('data-phase', 'parked');
});

for (const stage of [1, 3]) {
  test(`a full platform can lose stage ${stage}, then undo lets another bus leave`, async ({ page }) => {
    await openWithPausedClock(page);
    if (stage === 3) await restoreThirdStop(page);
    await expect(bus(page, 2).locator('.vehicle-hit')).toBeVisible();
    const ids = [2, 4, 6, 8, 10, 12, 14];
    for (const id of ids) {
      await tapBus(page, id);
      await expect(bus(page, id)).toHaveAttribute('data-phase', 'driving');
    }
    // Two small vehicles can fill from the opening crowd on the first stage.
    await advanceGame(page, 12_000);
    if (stage === 1) {
      for (const id of [16, 19]) {
        await tapBus(page, id);
        await expect(bus(page, id)).toHaveAttribute('data-phase', 'driving');
      }
      await advanceGame(page, 5_000);
    }
    const result = page.getByRole('dialog', { name: '승강장이 꽉 찼어요' });
    await expect(result).toBeVisible({ timeout: 10_000 });
    await result.getByRole('button', { name: '한 수 되돌리기' }).click();
    await expect(result).not.toBeVisible();
    await expect(bus(page, stage === 1 ? 19 : 14)).toHaveAttribute('data-phase', 'parked');
    await tapBus(page, 1);
    await expect(bus(page, 1)).toHaveAttribute('data-phase', 'driving');
  });
}

test('an installed depot can be relaunched and played offline', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('해안 정류장', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: /^파란색 (?:16|24|32|48)인승 버스 출차$/ })
    .first()
    .click();
  await expect(bus(page, 1)).toHaveAttribute('data-phase', 'boarding');
  await expect(page.locator('.depot-load text')).toHaveText('32/48', { timeout: 8_000 });
});

test('a restored advanced stop reveals a parked blind bus as soon as its exit clears', async ({ page }) => {
  await openWithPausedClock(page);
  await restoreThirdStop(page);
  await expect(bus(page, 19)).toHaveAttribute('data-color', 'blind');
  await expect(bus(page, 24)).toHaveAttribute('data-color', 'blind');
  await tapBus(page, 18);
  // The parked bus reveals before its blocker even reaches the platform.
  await advanceUntil(page, async () => (await bus(page, 24).getAttribute('data-color')) !== 'blind');
  await expect(bus(page, 24)).toHaveAttribute('data-color', 'orange');
  await expect(bus(page, 18)).toHaveAttribute('data-phase', 'driving');
  await expect(bus(page, 24)).toHaveAttribute('data-phase', 'parked');
  await expect(bus(page, 19)).toHaveAttribute('data-color', 'blind');
  await tapBus(page, 17);
  await expect(bus(page, 17)).toHaveAttribute('data-phase', 'driving');
  await expect(bus(page, 19)).toHaveAttribute('data-color', 'blind');
  await tapBus(page, 1);
  await advanceUntil(page, async () => (await bus(page, 19).getAttribute('data-color')) !== 'blind');
  await expect(bus(page, 19)).toHaveAttribute('data-color', 'gray');
  await expect(bus(page, 19)).toHaveAccessibleName(/^회색 \d+인승 버스 출차$/);
  await expect(bus(page, 19)).toHaveAttribute('data-phase', 'parked');
});
