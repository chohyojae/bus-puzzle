import { zstdCompressSync } from 'node:zlib';
import { expect, it } from 'vitest';
import {
  createDepot,
  dispatchBus,
  recommendBus,
  restoreLeftFirstQueue,
  startSteadyBelt,
  tickDepot,
  tickLiveDepot,
} from '../src/game/depot/logic';
import {
  checkpoint,
  newSession,
  openDepot,
  previousDepotRun,
  resumeSession,
  storeDepotRun,
  undoDispatch,
} from '../src/game/depot/session';
import { exportBackup, parseBackup, readBackupFile } from '../src/storage/import-export';
import { createEmptySave, migrateSave, saveSchema } from '../src/storage/save-schema';

it('이전 속도로 저장한 판을 이어서 플레이하고 다시 열어도 출차와 탑승 기록이 유지된다', () => {
  const session = resumeSession({
    version: 1,
    stageId: 'depot-lighthouse',
    moves: [{ id: 'bus-1', at: 0 }],
    elapsed: 2.37,
  });
  const before = tickDepot(session.game, 1);
  const dispatch = dispatchBus(before, 'bus-3');
  expect(dispatch.reason).toBeUndefined();
  session.previous.push(before);
  session.moves.push({ id: 'bus-3', at: before.elapsed });
  session.game = tickDepot(dispatch.state, 1);

  const saved = saveSchema.parse({ ...createEmptySave(), depotRun: checkpoint(session) });
  expect(saved.depotRun?.fasterPaceFrom).toBe(2.37);
  expect(resumeSession(saved.depotRun)).toEqual(session);
});

it('새 배치로 시작한 뒤에도 이전 배치의 출차 기록을 다시 열 수 있다', () => {
  const save = createEmptySave();
  save.depotRun = { version: 1, stageId: 'depot-lighthouse', elapsed: 2.37, moves: [{ id: 'bus-1', at: 0 }] };
  const original = resumeSession(save.depotRun);
  const updated = openDepot(save);
  expect(updated.game.layout).toBe('compact');
  const saved = saveSchema.parse(storeDepotRun(save, checkpoint(updated)));
  expect(openDepot(saved)).toEqual(updated);
  expect(previousDepotRun(saved)).toEqual(save.depotRun);
  expect(openDepot(saved, 'promenade')).toEqual(original);
  original.game = tickLiveDepot(original.game, 0.5);
  const afterLegacyPlay = storeDepotRun(saved, checkpoint(original));
  expect(openDepot(afterLegacyPlay, 'promenade')).toEqual(original);
  expect(openDepot(afterLegacyPlay)).toEqual(updated);
});

it('한 명씩 탑승하는 도중에 저장한 판을 같은 시각으로 복원한다', () => {
  const session = newSession();
  const id = recommendBus(session.game);
  if (!id) throw new Error('첫 차를 찾을 수 없습니다.');
  const before = session.game;
  const dispatched = dispatchBus(before, id);
  expect(dispatched.reason).toBeUndefined();
  session.game = tickLiveDepot(dispatched.state, 0.56);
  session.previous.push(before);
  session.moves.push({ id, at: before.elapsed });
  const saved = storeDepotRun(createEmptySave(), checkpoint(session));
  expect(openDepot(parseBackup(exportBackup(saved)))).toEqual(session);
});

it.each([1, 2, 3] as const)(
  '이전 차량 구성 v%i의 출차 기록을 복원하고 빈 판부터 대각선 배치를 쓴다',
  (version) => {
    const session = newSession(2);
    const earlier = createDepot(2, 'compact', 'left-first', version);
    const first = dispatchBus(earlier, 'bus-1');
    expect(first.reason).toBeUndefined();
    session.game = tickLiveDepot(first.state, 1.37);
    session.previous = [earlier];
    session.moves = [{ id: 'bus-1', at: 0 }];
    const run = checkpoint(session);
    const data = migrateSave({
      ...createEmptySave(),
      saveSchemaVersion: version === 3 ? 5 : 4,
      depotRun: run,
    });
    expect(earlier.buses.every((bus) => bus.angle % 90 === 0)).toBe(true);
    expect(openDepot(data)).toEqual(session);
    expect(resumeSession(checkpoint(openDepot(data)))).toEqual(session);

    const unplayed = newSession(2);
    expect(unplayed.game.fleetVersion).toBe(4);
    expect(unplayed.game.buses.some((bus) => bus.angle % 90 !== 0)).toBe(true);
    expect(openDepot({ ...data, depotRun: { ...run, moves: [] } })).toEqual(unplayed);
    expect(undoDispatch(session)).toEqual(unplayed);
    unplayed.game = tickLiveDepot(unplayed.game, 1.37);
    expect(resumeSession(checkpoint(unplayed))).toEqual(unplayed);
  },
);

it('진행 중인 구형 차량 판은 탑승 인원을 보존하고 이후부터 왼쪽 줄을 먼저 비운다', () => {
  const before = createDepot(1, 'compact', 'alternating', 1, false);
  const elapsed = 1.6;
  const old = tickDepot(dispatchBus(before, 'bus-1').state, elapsed, { previousBoarding: true });
  const restored = resumeSession({
    version: 1,
    layout: 'compact',
    stageId: 'depot-lighthouse',
    fasterPaceFrom: 0,
    elapsed,
    moves: [{ id: 'bus-1', at: 0 }],
  });
  expect(restored.game).toEqual(startSteadyBelt(restoreLeftFirstQueue(old)));
  expect(restored.game.boardedCount).toBeGreaterThan(0);
  expect(restored.game.fleetVersion).toBe(1);
  const next = dispatchBus(restored.game, 'bus-3');
  expect(next.reason).toBeUndefined();
  restored.moves.push({ id: 'bus-3', at: elapsed });
  restored.previous.push(restored.game);
  restored.game = tickLiveDepot(next.state, 0.8);
  expect(
    resumeSession(saveSchema.parse({ ...createEmptySave(), depotRun: checkpoint(restored) }).depotRun),
  ).toEqual(restored);
});

it('v3 백업의 가속 구간을 복원하고 되돌린 시점부터 일정한 속도로 순환한다', async () => {
  const initial = createDepot(1, 'compact', 'left-first', 2, false);
  const firstMove = { id: 'bus-1', at: 0 };
  const secondMove = { id: 'bus-3', at: 1.554 };
  const elapsed = 1.773;
  const beforeSecond = tickDepot(dispatchBus(initial, firstMove.id).state, secondMove.at, {
    previousBelt: true,
  });
  expect(beforeSecond.entering.length).toBeGreaterThan(0);
  expect(beforeSecond.boardedCount).toBeGreaterThan(0);
  const second = dispatchBus(beforeSecond, secondMove.id);
  expect(second.reason).toBeUndefined();
  const old = tickDepot(second.state, elapsed - secondMove.at, { previousBelt: true });
  const data = {
    ...createEmptySave(),
    saveSchemaVersion: 3,
    depotRun: {
      version: 1,
      layout: 'compact',
      fleetVersion: 2,
      stageId: 'depot-lighthouse',
      moves: [firstMove, secondMove],
      fasterPaceFrom: 0,
      orderedBoardingFrom: 0,
      elapsed,
    },
  };
  const content = JSON.stringify({
    format: 'bus-puzzle-save',
    saveSchemaVersion: 3,
    exportedAt: '2026-11-21T08:00:00Z',
    data,
  });
  const imported = await readBackupFile(new File([zstdCompressSync(content)], 'old.bpz'));
  expect(await readBackupFile(new File([content], 'old.json'))).toEqual(imported);
  expect(imported).toEqual({ ...data, saveSchemaVersion: createEmptySave().saveSchemaVersion });
  const resumed = openDepot(imported);
  expect(resumed.game).toEqual(startSteadyBelt(old));
  expect(checkpoint(resumed).steadyBeltFrom).toBe(elapsed);
  resumed.game = tickLiveDepot(resumed.game, 0.36);
  expect(resumed.game.beltTime - old.beltTime).toBeCloseTo(0.36, 8);
  expect(resumeSession(checkpoint(resumed))).toEqual(resumed);

  const undone = undoDispatch(resumed);
  if (!undone) throw new Error('두 번째 출차를 되돌릴 수 없습니다.');
  expect(undone.game).toEqual(startSteadyBelt(beforeSecond));
  expect(checkpoint(undone).steadyBeltFrom).toBe(secondMove.at);
  expect(undone.moves).toEqual([firstMove]);
  undone.game = tickLiveDepot(undone.game, 0.36);
  expect(undone.game.beltTime - beforeSecond.beltTime).toBeCloseTo(0.36, 8);
  expect(resumeSession(checkpoint(undone))).toEqual(undone);
  expect(undoDispatch(undone)).toEqual(newSession());
});
