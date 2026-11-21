import { describe, expect, it } from 'vitest';
import {
  activeQueueSide,
  BELT_LANES,
  bayGeometry,
  beltCapacity,
  busPose,
  createDepot,
  type DepotBus,
  dispatchBus,
  getBlockers,
  isBlindBus,
  LEVEL_COUNT,
  type Point,
  passengerPose,
  queuePoses,
  recommendBus,
  restoreLeftFirstQueue,
  tickDepot,
  tickLiveDepot,
} from '../src/game/depot/logic';

import { resumeSession } from '../src/game/depot/session';

function parkingFootprint(bus: DepotBus) {
  const radians = (bus.angle * Math.PI) / 180;
  const lengthAxis = { x: Math.sin(radians), y: -Math.cos(radians) };
  const widthAxis = { x: Math.cos(radians), y: Math.sin(radians) };
  const corners = [-bus.length / 2, bus.length / 2].flatMap((length) =>
    [-bus.width / 2, bus.width / 2].map((width) => ({
      x: bus.x + length * lengthAxis.x + width * widthAxis.x,
      y: bus.y + length * lengthAxis.y + width * widthAxis.y,
    })),
  );
  return { id: bus.id, axes: [lengthAxis, widthAxis], corners };
}

function footprintsOverlap(a: ReturnType<typeof parkingFootprint>, b: ReturnType<typeof parkingFootprint>) {
  return [...a.axes, ...b.axes].every((axis) => {
    const project = (corner: Point) => corner.x * axis.x + corner.y * axis.y;
    const first = a.corners.map(project);
    const second = b.corners.map(project);
    return Math.max(...first) > Math.min(...second) + 1e-7 && Math.max(...second) > Math.min(...first) + 1e-7;
  });
}

describe('순환 정류장', () => {
  it('차량의 실제 폭과 방향으로 길을 판정하고 앞차가 빠져나간 뒤 길이 열린다', () => {
    const start = createDepot();
    expect(dispatchBus(start, 'bus-17')).toMatchObject({
      reason: 'blocked',
      blockerId: 'bus-1',
      state: start,
    });
    const dispatched = dispatchBus(start, 'bus-1').state;
    expect(getBlockers(dispatched, 'bus-17')).toContain('bus-1');
    const moving = tickDepot(dispatched, 0.09);
    const bus = moving.buses[0];
    const pose = busPose(moving, bus);
    expect(pose.x).toBeLessThan(bus.x);
    expect(pose.y).toBeLessThanOrEqual(bus.y);
    const arrived = tickDepot(moving, 0.37);
    expect(getBlockers(arrived, 'bus-17')).toEqual([]);
    const bay = bayGeometry('compact');
    expect(busPose(arrived, arrived.buses[0])).toEqual({ x: bay.xs[0], y: bay.y, angle: bay.angle });
    expect(start.buses[2].phase).toBe('parked');
  });

  it.each([60, 90, 120])(
    '%iFPS에서 차가 들어와 승객을 태우고 떠나는 동안에도 순환 속도는 일정하다',
    (fps) => {
      const start = createDepot(1, 'compact', 'left-first', 1);
      const straight = tickLiveDepot(start, 0.25);
      const firstPose = passengerPose(start, start.passengers[0]);
      const nextPose = passengerPose(straight, straight.passengers[0]);
      expect(nextPose.x - firstPose.x).toBeCloseTo(86 * 0.25);
      expect(nextPose.y).toBe(firstPose.y);
      const tracked = start.passengers.find((p) => p.color !== start.buses[0].color);
      if (!tracked) throw new Error('승차하지 않고 계속 순환하는 승객이 필요합니다.');
      let idle = straight;
      let active = dispatchBus(straight, 'bus-1').state;
      const phases = new Set([active.buses[0].phase]);
      for (let frame = 1; frame <= 8 * fps; frame++) {
        idle = tickLiveDepot(idle, 1 / fps);
        active = tickLiveDepot(active, 1 / fps);
        phases.add(active.buses[0].phase);
        expect(active.beltTime).toBeCloseTo(0.25 + frame / fps, 8);
        expect(idle.beltTime).toBeCloseTo(active.beltTime, 8);
        const circulating = active.passengers.find((p) => p.id === tracked.id);
        if (!circulating) throw new Error('순환하던 승객이 사라졌습니다.');
        expect(passengerPose(active, circulating)).toEqual(passengerPose(idle, tracked));
      }
      expect(phases).toEqual(new Set(['driving', 'boarding', 'leaving', 'gone']));
      expect(active.boardedCount).toBe(24);
      expect(active.queue.length).toBeLessThan(idle.queue.length);
    },
  );

  it('출차 속도를 유지하면서 같은 차에는 한 명씩 간격을 두고 탄다', () => {
    const initial = createDepot(1, 'compact', 'left-first', 1);
    expect(tickLiveDepot(initial, 300).beltTime).toBe(300);
    const dispatched = dispatchBus(initial, 'bus-1').state;
    const normal = tickDepot(dispatched, 0.2);
    const legacy = tickDepot(dispatched, 0.2, { legacy: true });
    expect(normal.buses[0].traveled / legacy.buses[0].traveled).toBeCloseTo(1.6);
    let state = normal;
    let firstWalk = 0;
    let firstSeat = 0;
    let lastSeat = 0;
    while (state.buses[0].phase !== 'leaving' && state.elapsed < 20) {
      const before = state;
      state = tickDepot(state, 1 / 60);
      if (!firstWalk && state.passengers.some((p) => p.busId === 'bus-1')) firstWalk = state.elapsed;
      if (state.boardedCount > before.boardedCount) {
        expect(state.boardedCount - before.boardedCount).toBe(1);
        if (lastSeat) {
          const gapSeconds = (state.elapsed - lastSeat) / 2.5;
          expect(gapSeconds).toBeGreaterThanOrEqual(0.05 - 1 / 150);
          if (lastSeat === firstSeat) expect(gapSeconds).toBeCloseTo(0.05, 2);
        } else firstSeat = state.elapsed;
        lastSeat = state.elapsed;
      }
    }
    expect(state.buses[0]).toMatchObject({ phase: 'leaving', boarded: 24 });
    expect((firstSeat - firstWalk) / 2.5).toBeCloseTo(0.28, 2);
    expect((lastSeat - firstSeat) / 2.5).toBeGreaterThanOrEqual(1.15 - 1 / 60);
    const from = state.buses[0].traveled;
    const fastExit = tickDepot(state, 0.1);
    const oldExit = tickDepot(state, 0.1, { legacy: true });
    expect((fastExit.buses[0].traveled - from) / (oldExit.buses[0].traveled - from)).toBeCloseTo(1.6);
    expect(fastExit.beltTime - state.beltTime).toBeCloseTo(0.1 / 2.5);

    // A bay with no matching riders does not speed up an otherwise idle belt.
    const wrongColor = dispatchBus(createDepot(3), 'bus-2').state;
    const waiting = tickLiveDepot(wrongColor, 10);
    expect(waiting.buses[1].phase).toBe('boarding');
    expect(waiting.beltTime).toBeCloseTo(10);
    expect(tickLiveDepot(waiting, 1).beltTime - waiting.beltTime).toBeCloseTo(1);
  });

  it('구버전 판에서 속도가 바뀌어도 걷던 사람과 합류 중인 승객이 이어서 움직인다', () => {
    const dispatched = dispatchBus(createDepot(1, 'promenade', 'alternating', 1, false), 'bus-1').state;
    const oldWalk = tickDepot(dispatched, 4.2, { legacy: true });
    const rider = oldWalk.passengers.find((p) => p.busId === 'bus-1');
    if (!rider) throw Error('문까지 걷는 승객이 필요합니다.');
    const next = tickDepot(oldWalk, 1 / 60);
    const nextRider = next.passengers.find((p) => p.id === rider.id);
    if (!nextRider) throw Error('승객이 아직 문까지 걸어가는 중이어야 합니다.');
    expect(nextRider.walking).toBeGreaterThan(rider.walking);
    expect(next.beltTime - oldWalk.beltTime).toBeCloseTo(1 / 60 / 2.5);

    let state = dispatched;
    for (let frame = 0; frame < 900 && !state.entering.length; frame++)
      state = tickDepot(state, 1 / 60, { previousBelt: true });
    const joiningId = state.entering[0]?.id;
    expect(joiningId).toBeDefined();
    let prior = queuePoses(state);
    let merged = false;
    for (let frame = 0; frame < 250; frame++) {
      const before = state;
      state = tickDepot(state, 1 / 60);
      expect(state.beltTime - before.beltTime).toBeCloseTo(1 / 60 / 2.5);
      for (const p of state.passengers) {
        const waiting = prior.find((other) => other.id === p.id);
        if (!waiting) continue;
        const pose = passengerPose(state, p);
        expect(Math.hypot(pose.x - waiting.x, pose.y - waiting.y)).toBeLessThan(5.5);
        expect(p.color).toBe(waiting.color);
        if (p.id === joiningId) merged = true;
      }
      prior = queuePoses(state);
    }
    expect(merged).toBe(true);
  });

  it('기존 산책로 판의 72행 배치와 승객 색 순서가 유지된다', () => {
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const state = createDepot(level, 'promenade');
      expect(state.passengers).toHaveLength(288);
      const poses = state.passengers.map((p) => passengerPose(state, p));
      for (let i = 0; i < poses.length; i++) {
        const current = poses[i];
        const next = poses[(i + BELT_LANES) % poses.length];
        expect(Math.hypot(next.x - current.x, next.y - current.y)).toBeLessThan(14);
        if (i % BELT_LANES !== BELT_LANES - 1) {
          const adjacent = poses[i + 1];
          expect(Math.hypot(adjacent.x - current.x, adjacent.y - current.y)).toBeCloseTo(7.5, 5);
          expect(state.passengers[i + 1].color).toBe(state.passengers[i].color);
        }
      }
    }
    const first = createDepot(1, 'promenade');
    for (const color of ['coral', 'yellow', 'blue']) {
      const riders = first.passengers.filter((person) => person.color === color).length;
      const capacities = first.buses
        .filter((bus) => bus.color === color)
        .map((bus) => bus.capacity)
        .sort((a, b) => b - a);
      expect(riders).toBeGreaterThanOrEqual(capacities[0] + capacities[1]);
    }
  });

  it('새 정류장은 네 명씩 42행만 순환하고, 대기객이 그 네 배 이상이다', () => {
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const state = createDepot(level);
      expect(state.layout).toBe('compact');
      expect(state.passengers).toHaveLength(168);
      expect(state.queue.length).toBeGreaterThanOrEqual(4 * state.passengers.length);
      const poses = state.passengers.map((p) => passengerPose(state, p));
      const rows: { x: number; y: number }[] = [];
      for (let i = 0; i < poses.length; i += BELT_LANES) {
        const near = poses[i];
        const far = poses[i + BELT_LANES - 1];
        expect(Math.hypot(near.x - far.x, near.y - far.y)).toBeCloseTo(31.5, 5);
        rows.push({ x: (near.x + far.x) / 2, y: (near.y + far.y) / 2 });
      }
      for (const [i, p] of rows.entries()) {
        const next = rows[(i + 1) % rows.length];
        expect(Math.hypot(next.x - p.x, next.y - p.y)).toBeLessThan(12);
        expect(p.x).toBeGreaterThanOrEqual(111);
        expect(p.x).toBeLessThanOrEqual(289);
        expect(p.y).toBeGreaterThanOrEqual(177);
        expect(p.y).toBeLessThanOrEqual(252);
      }
      const visible = queuePoses(state);
      expect(visible.length).toBeGreaterThan(state.passengers.length);
      const left = visible.filter((p) => p.side === 'left');
      const right = visible.filter((p) => p.side === 'right');
      expect(left).toHaveLength(100);
      expect(right).toHaveLength(left.length);
      const heads = (feed: typeof visible) =>
        feed
          .filter((_, i) => i % 4 === 0)
          .slice(0, 5)
          .map((p) => p.color);
      expect(left[0].color).not.toBe(right[0].color);
      expect(heads(left)).not.toEqual(heads(right));
      expect(left.slice(0, 16).map((p) => p.id)).toEqual(
        Array.from({ length: 16 }, (_, i) => beltCapacity('compact') + i),
      );
      expect(right[0].id - left[0].id).toBe(4 * Math.round(state.queue.length / 8));
      expect(left.every((p) => p.x < 145)).toBe(true);
      expect(right.every((p) => p.x > 255)).toBe(true);
    }
  });

  it('이전 3색 첫 단계에서 줄에 선 승객은 루프에 들어온 뒤에만 탑승한다', () => {
    const first = createDepot(1, 'compact', 'left-first', 2);
    expect(first.totalPassengers).toBe(1784);
    expect(new Set(first.passengers.map((p) => p.color))).toEqual(new Set(['blue', 'yellow']));
    expect(queuePoses(first).some((p) => p.color === 'coral')).toBe(true);
    let state = first;
    for (const id of [2, 4, 6, 8, 10, 12, 14].map((n) => `bus-${n}`)) state = dispatchBus(state, id).state;
    state = tickDepot(state, 20);
    expect(state.status).toBe('lost');
    expect(state.boardedCount).toBe(0);
    expect(state.queue).toEqual(first.queue);
    expect(queuePoses(state)).toEqual(queuePoses(first));
    const serviced = tickDepot(dispatchBus(first, 'bus-3').state, 12);
    expect(serviced.buses[2]).toMatchObject({ phase: 'gone', boarded: 24 });
  });

  it('새 판의 48인승은 32명에서 기다리며 다음 차가 줄을 비워야 남은 16명이 올라탄다', () => {
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const initial = createDepot(level);
      const models = new Map(initial.buses.map((b) => [b.capacity, [b.length, b.width]]));
      expect(models).toEqual(
        new Map([
          [16, [36, 27]],
          [24, [39, 28]],
          [32, [43, 29]],
          [48, [47, 30]],
        ]),
      );
      const people = [...initial.passengers.map((p) => p.color), ...initial.queue];
      const colors = new Set(people);
      for (const color of colors) {
        const seats = initial.buses
          .filter((b) => b.color === color)
          .reduce((total, bus) => total + bus.capacity, 0);
        expect(people.filter((c) => c === color).length).toBe(seats);
      }
      expect(recommendBus(initial)).toBe('bus-1');
      const partial = tickDepot(dispatchBus(initial, 'bus-1').state, 60);
      expect(partial.buses[0]).toMatchObject({
        capacity: 48,
        phase: 'boarding',
        color: 'blue',
        boarded: 32,
        bay: 0,
      });
      const wait = tickDepot(partial, 300);
      expect(wait.buses[0]).toEqual(partial.buses[0]);
      expect(wait.queue).toEqual(partial.queue);
      const yellow = dispatchBus(wait, 'bus-3');
      expect(yellow.reason).toBeUndefined();
      const served = tickDepot(yellow.state, 60);
      expect(served.buses[0]).toMatchObject({ phase: 'gone', boarded: 48, bay: null });
      expect(served.buses[2].boarded).toBe(served.buses[2].capacity);
      const old = createDepot(level, 'compact', 'alternating', 1);
      expect(old.fleetVersion).toBe(1);
      expect(new Set(old.buses.map((b) => b.capacity))).toEqual(new Set([16, 20, 24]));
      expect(old.totalPassengers).toBe([1156, 1140, 1148][level - 1]);
      expect(tickDepot(dispatchBus(old, 'bus-1').state, 60).buses[0]).toMatchObject({
        phase: 'gone',
        boarded: 24,
      });
    }
  });

  it('승객은 제자리에서 계속 순환하고 색이 맞으면 문까지 걸어가 탑승한다', () => {
    const start = createDepot();
    const idle = tickDepot(start, 86401);
    expect(idle.passengers).toEqual(start.passengers);
    expect(passengerPose(idle, idle.passengers[0])).not.toEqual(passengerPose(start, start.passengers[0]));
    let state = dispatchBus(start, 'bus-3').state;
    let caughtWalking = false;
    for (let frame = 0; frame < 1400 && state.buses[2].phase !== 'gone'; frame++) {
      state = tickDepot(state, 1 / 60);
      for (const p of state.passengers.filter((rider) => rider.busId === 'bus-3')) {
        expect(p.color).toBe('yellow');
        if (p.walking > 0) {
          expect(passengerPose(state, p).y).toBeGreaterThan(p.from.y);
          caughtWalking = true;
        }
      }
      expect(state.buses[2].boarded).toBeLessThanOrEqual(state.buses[2].capacity);
      expect(state.passengers.length + state.queue.length + state.boardedCount).toBe(state.totalPassengers);
    }
    expect(caughtWalking).toBe(true);
    expect(state.buses[2]).toMatchObject({ phase: 'gone', bay: null, boarded: 24 });
  });

  it('벨트가 꽉 차면 통로에서 기다리고, 빈자리가 오면 앞사람부터 걸어서 합류한다', () => {
    const start = createDepot();
    const originalLine = queuePoses(start);
    const capacity = beltCapacity(start.layout);
    expect(originalLine).toHaveLength(200);
    expect(originalLine[0].id).toBe(capacity);
    const originalIds = new Set(originalLine.map((p) => p.id));
    expect(originalIds.size).toBe(originalLine.length);
    const tail = originalLine.filter((p) => p.side === 'left').at(-1);
    if (!tail) throw Error('왼쪽 대기열이 없습니다.');
    expect(queuePoses(tickDepot(start, 86400))).toEqual(originalLine);
    let state = dispatchBus(start, 'bus-1').state;
    let line = originalLine;
    const admitted: number[] = [];
    let tailMoved = false;
    for (let frame = 0; frame < 1000 && admitted.length < 8; frame++) {
      state = tickDepot(state, 1 / 60);
      const nextLine = queuePoses(state);
      for (const p of state.passengers) {
        const last = line.find((person) => person.id === p.id);
        if (!last) continue;
        const pose = passengerPose(state, p);
        expect(Math.hypot(pose.x - last.x, pose.y - last.y)).toBeLessThan(5.5);
        expect(p.color).toBe(last.color);
        expect(nextLine.some((person) => person.id === p.id)).toBe(false);
        admitted.push(p.id);
      }
      const waiting = nextLine.find((p) => p.id === tail.id);
      if (waiting && waiting.y > tail.y + 5) tailMoved = true;
      const occupied = state.passengers.filter((p) => p.busId === null).map((p) => p.carrier);
      expect(new Set(occupied).size).toBe(occupied.length);
      expect(occupied.length).toBeLessThanOrEqual(capacity);
      expect(state.passengers.length + state.queue.length + state.boardedCount).toBe(state.totalPassengers);
      line = nextLine;
    }
    expect(admitted).toEqual(Array.from({ length: 8 }, (_, i) => capacity + i));
    expect(tailMoved).toBe(true);
    expect(line.some((p) => !originalIds.has(p.id))).toBe(true);
  });

  it('기존 출차 기록으로 복원해도 대기열 중간 위치와 벨트 탑승 결과가 일치한다', () => {
    const moves = [{ id: 'bus-1', at: 0 }];
    const saved = { version: 1 as const, stageId: 'depot-lighthouse', moves, elapsed: 10.27 };
    const restored = resumeSession(saved);
    expect(restored.moves).toEqual(moves);
    let live = dispatchBus(createDepot(1, 'promenade'), 'bus-1').state;
    for (let frame = 0; frame < 1000; frame++) live = tickDepot(live, saved.elapsed / 1000, { legacy: true });
    expect(restored.game.entering.length).toBeGreaterThan(0);
    expect(live.entering).toEqual(restored.game.entering);
    expect(live.lineOffset).toEqual(restored.game.lineOffset);
    expect(live.queue).toEqual(restored.game.queue);
    for (const [i, p] of queuePoses(live).entries()) {
      const savedPose = queuePoses(restored.game)[i];
      expect(p.id).toBe(savedPose.id);
      expect(p.x).toBeCloseTo(savedPose.x, 6);
      expect(p.y).toBeCloseTo(savedPose.y, 6);
    }
    const after = tickDepot(restored.game, 4);
    expect(after.passengers).toEqual(tickDepot(live, 4).passengers);
  });

  it.each([1, 3])('%i단계에서 일부 승객을 태워도 일곱 대의 남은 좌석을 채우지 못하면 패배한다', (level) => {
    const start = createDepot(level);
    let state = start;
    for (const id of [2, 4, 6, 8, 10, 12, 14].map((n) => `bus-${n}`)) state = dispatchBus(state, id).state;
    expect(dispatchBus(state, 'bus-1').reason).toBe('full');
    expect(dispatchBus(state, 'bus-2').reason).toBe('unavailable');
    state = tickLiveDepot(state, 12);
    if (level === 1) {
      for (const id of ['bus-16', 'bus-19']) {
        const dispatched = dispatchBus(state, id);
        expect(dispatched.reason).toBeUndefined();
        state = dispatched.state;
      }
    }
    const lost = tickLiveDepot(state, 12);
    expect(lost.status).toBe('lost');
    expect(lost.boardedCount).toBeGreaterThan(0);
    const waiting = lost.buses.filter((b) => b.phase === 'boarding');
    expect(waiting).toHaveLength(7);
    expect(waiting.every((b) => b.boarded < b.capacity)).toBe(true);
    expect(tickDepot(lost, 5)).toBe(lost);
    expect(dispatchBus(lost, 'bus-1').reason).toBe('unavailable');
    expect(createDepot(level)).toEqual(start);
  });

  it('화면 주사율과 저장 기록 재생 간격이 달라도 승차와 정차 상태가 일치한다', () => {
    let live = createDepot();
    let replay = createDepot();
    for (const [id, frames] of [
      ['bus-1', 173],
      ['bus-3', 243],
      ['bus-2', 420],
      ['bus-5', 169],
    ] as const) {
      const action = dispatchBus(live, id);
      expect(action.reason).toBeUndefined();
      live = action.state;
      replay = dispatchBus(replay, id).state;
      for (let frame = 0; frame < frames; frame++) live = tickDepot(live, 1 / 144);
      replay = tickDepot(replay, frames / 144);
      expect(replay.buses).toEqual(live.buses);
      expect(replay.passengers).toEqual(live.passengers);
      expect(replay.queue).toEqual(live.queue);
    }
  });

  it('각 단계에서 차량과 승객이 5·8·10색으로 늘어나고 모든 색이 처음부터 순환한다', () => {
    const first = ['blue', 'yellow', 'coral', 'sky', 'gray'];
    const second = [...first, 'mint', 'orange', 'purple'];
    const palettes = [first, second, [...second, 'indigo', 'white']];
    for (const [i, palette] of palettes.entries()) {
      const state = createDepot(i + 1);
      const people = [...state.passengers.map((p) => p.color), ...state.queue];
      expect(new Set(state.buses.map((b) => b.color))).toEqual(new Set(palette));
      expect(new Set(people)).toEqual(new Set(palette));
      expect(state.buses.every((b) => b.blind === (i === 2))).toBe(true);
      expect(new Set(state.passengers.map((p) => p.color))).toEqual(new Set(palette));
    }
  });

  it.each(['sky', 'gray'])('%s 차량에는 같은 색 승객만 탑승한다', (color) => {
    let state = createDepot();
    const bus = state.buses.find((b) => b.color === color && getBlockers(state, b.id).length === 0);
    if (!bus) throw new Error(`처음에 출차할 수 있는 ${color} 차량이 없습니다.`);
    const otherRiders = state.passengers.filter((p) => p.color !== color).map((p) => p.id);
    state = tickLiveDepot(dispatchBus(state, bus.id).state, 12);
    expect(state.buses.find((b) => b.id === bus.id)?.boarded).toBeGreaterThan(0);
    expect(state.passengers.filter((p) => otherRiders.includes(p.id)).map((p) => p.id)).toEqual(otherRiders);
  });

  it('가장자리 차량이 빠진 후 막혀 있던 검은 차량은 제자리에서 실제 색을 드러낸다', () => {
    const start = createDepot(3);
    const hidden = (s: typeof start, i: number) => isBlindBus(s, s.buses[i - 1]);
    expect(hidden(start, 19)).toBe(true);
    expect(hidden(start, 24)).toBe(true);
    expect(hidden(start, 18)).toBe(false);
    const openOne = tickDepot(dispatchBus(start, 'bus-18').state, 0.5);
    expect(hidden(openOne, 24)).toBe(false);
    expect(hidden(openOne, 19)).toBe(true);
    const openNext = tickDepot(dispatchBus(openOne, 'bus-17').state, 0.5);
    expect(hidden(openNext, 19)).toBe(true);
    const clear = tickDepot(dispatchBus(openNext, 'bus-1').state, 0.5);
    expect(clear.buses[18].phase).toBe('parked');
    expect(hidden(clear, 19)).toBe(false);
    expect(hidden(openNext, 19)).toBe(true);
    const saved = JSON.parse(JSON.stringify(openNext)) as typeof start;
    expect(hidden(tickDepot(dispatchBus(saved, 'bus-1').state, 0.5), 19)).toBe(false);
  });

  it('대각선 진행로의 차량이 모두 빠지면 지붕 방향으로 주차장을 빠져나온다', () => {
    let state = createDepot();
    const target = state.buses[33];
    expect(target.angle).toBe(-45);
    const blockers = ['bus-2', 'bus-3', 'bus-4', 'bus-28'];
    expect(getBlockers(state, target.id)).toEqual(blockers);
    for (const id of blockers) {
      expect(dispatchBus(state, target.id).reason).toBe('blocked');
      const next = dispatchBus(state, id);
      expect(next.reason).toBeUndefined();
      state = tickLiveDepot(next.state, 1);
    }
    const dispatched = dispatchBus(state, target.id);
    expect(dispatched.reason).toBeUndefined();
    state = dispatched.state;
    const parked = state.buses.filter((bus) => bus.phase === 'parked').map(parkingFootprint);
    const firstTurn = state.buses[33].route[1].distance;
    expect(firstTurn).toBeGreaterThan(50);
    while (state.buses[33].traveled < firstTurn) {
      const bus = state.buses[33];
      const pose = busPose(state, bus);
      expect(pose.angle).toBeCloseTo(-45);
      expect(pose.x - target.x).toBeCloseTo(-bus.traveled / Math.sqrt(2));
      expect(pose.y - target.y).toBeCloseTo(-bus.traveled / Math.sqrt(2));
      const footprint = parkingFootprint({ ...bus, ...pose });
      expect(parked.some((other) => footprintsOverlap(footprint, other))).toBe(false);
      state = tickDepot(state, 1 / 60);
    }
  });

  it('직각·대각선 차량의 차체가 겹치지 않으며 승강장은 일곱 곳이다', () => {
    const start = createDepot();
    expect(start.buses).toHaveLength(57);
    for (let l = 1; l <= LEVEL_COUNT; l++) {
      const buses = createDepot(l).buses;
      expect(buses.some((b) => b.angle % 90 === 0)).toBe(true);
      expect(buses.some((b) => b.angle % 90 !== 0)).toBe(true);
      expect(createDepot(l, 'compact', 'left-first', 3).buses.every((b) => b.angle % 90 === 0)).toBe(true);
      const boxes = buses.map(parkingFootprint);
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          expect(footprintsOverlap(a, b), `${l}단계에서 ${a.id}와 ${b.id} 차체가 겹칩니다.`).toBe(false);
        }
      }
    }

    expect(new Set(start.buses.map((bus) => bus.length))).toEqual(new Set([36, 39, 43, 47]));
    expect(start.buses.filter((bus) => getBlockers(start, bus.id).length).length).toBeGreaterThan(15);
    expect(bayGeometry(start.layout)).toEqual({ xs: [41, 94, 147, 200, 253, 306, 359], y: 314, angle: -40 });
    let state = start;
    for (const bus of start.buses.slice(0, 7)) state = dispatchBus(state, bus.id).state;
    expect(new Set(state.buses.filter((bus) => bus.bay !== null).map((bus) => bus.bay)).size).toBe(7);
    expect(dispatchBus(state, 'bus-8').reason).toBe('full');
  });

  it('예전 4행 교대 대기열은 재생 후 차량과 승객 순서를 보존하면서 왼쪽 우선으로 전환한다', () => {
    let old = createDepot(1, 'compact', 'alternating', 1);
    const oldQueue = old.queue;
    const newQueue = createDepot(1, 'compact', 'left-first', 1).queue;
    expect(oldQueue).toEqual(newQueue);
    const initial = queuePoses(old);
    const right = initial.find((p) => p.side === 'right');
    expect(right?.id).toBe(beltCapacity('compact') + 16);
    old = dispatchBus(old, 'bus-1').state;
    for (
      let frame = 0;
      frame < 1000 && (!old.entering.length || old.queue.length === oldQueue.length);
      frame++
    ) {
      old = tickDepot(old, 1 / 60);
    }
    expect(old.entering.length).toBeGreaterThan(0);
    const upgraded = restoreLeftFirstQueue(old);
    expect(upgraded.fleetVersion).toBe(1);
    expect(upgraded.buses).toBe(old.buses);
    expect(upgraded.passengers).toBe(old.passengers);
    expect(upgraded.queue).toBe(old.queue);
    expect(upgraded.elapsed).toBe(old.elapsed);
    expect(upgraded.beltTime).toBe(old.beltTime);
    expect(upgraded.entering).toEqual([]);
    expect(activeQueueSide(upgraded)).toBe('left');
    expect(
      queuePoses(upgraded)
        .filter((p) => p.side === 'right')
        .every((p) => !p.moving),
    ).toBe(true);
    expect(restoreLeftFirstQueue(upgraded)).toBe(upgraded);
    const stillOnBelt = new Set(upgraded.passengers.map((p) => p.id));
    expect(queuePoses(upgraded).every((p) => !stillOnBelt.has(p.id))).toBe(true);
    let state = upgraded;
    for (let frame = 0; frame < 1500 && state.status === 'playing'; frame++) {
      const id = recommendBus(state);
      if (id) state = dispatchBus(state, id).state;
      state = tickDepot(state, 0.25);
    }
    expect(state.status).toBe('won');
  });

  it('세 단계에서 두 줄의 대기 승객 전원이 누락 없이 들어오고 매 프레임 이동이 이어진다', () => {
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      let state = createDepot(level);
      const firstWaitingId = state.passengers.length;
      const entered = new Set<number>();
      const originalRight = queuePoses(state).filter((p) => p.side === 'right');
      const rightHead = originalRight[0].id;
      let rightMovedEarly = false;
      let switches = 0;
      let last = new Map(queuePoses(state).map((p) => [p.id, p]));
      let maxLineStep = 0;
      let maxMergeStep = 0;
      for (let frame = 0; frame < 9000 && state.status === 'playing'; frame++) {
        if (frame % 15 === 0) {
          const id = recommendBus(state);
          if (id) state = dispatchBus(state, id).state;
        }
        const before = state;
        state = tickLiveDepot(state, 1 / 60);
        const current = new Map(queuePoses(state).map((p) => [p.id, p]));
        if (activeQueueSide(before) === 'left' && activeQueueSide(state) === 'right') {
          switches++;
          expect(state.totalPassengers - state.queue.length).toBe(rightHead);
        }
        if (activeQueueSide(state) === 'left') {
          rightMovedEarly ||= originalRight.some((p) => {
            const now = current.get(p.id);
            return !now || now.moving || now.x !== p.x || now.y !== p.y;
          });
        }
        for (const [id, p] of current) {
          const previous = last.get(id);
          if (previous) maxLineStep = Math.max(maxLineStep, Math.hypot(p.x - previous.x, p.y - previous.y));
        }
        const head = state.totalPassengers - before.queue.length;
        for (let id = head; id < state.totalPassengers - state.queue.length; id++) {
          const previous = last.get(id);
          const rider = state.passengers.find((p) => p.id === id);
          if (!previous || !rider) throw Error(`대기 승객 ${id}가 보이지 않는 곳에서 합류했습니다.`);
          const pose = passengerPose(state, rider);
          maxMergeStep = Math.max(maxMergeStep, Math.hypot(previous.x - pose.x, previous.y - pose.y));
          expect(rider.color).toBe(previous.color);
          expect(entered.has(id)).toBe(false);
          entered.add(id);
        }
        last = current;
      }
      expect(state.status).toBe('won');
      expect(entered.size).toBe(state.totalPassengers - firstWaitingId);
      expect(rightMovedEarly).toBe(false);
      expect(switches).toBe(1);
      expect(activeQueueSide(state)).toBeNull();
      expect(maxLineStep).toBeLessThan(7);
      expect(maxMergeStep).toBeLessThan(5.1);
    }
  });

  for (let level = 1; level <= LEVEL_COUNT; level++) {
    it(`${level}단계는 힌트 순서로 모든 승객을 태우고 출발한다`, () => {
      let state = createDepot(level);
      for (let t = 0; t < 360 && state.status === 'playing'; t += 0.25) {
        const id = recommendBus(state);
        if (id) {
          const result = dispatchBus(state, id);
          expect(result.reason).toBeUndefined();
          state = result.state;
        }
        state = tickDepot(state, 0.25);
      }
      expect(state.status).toBe('won');
      expect(state.boardedCount).toBe(state.totalPassengers);
      expect(state.passengers).toHaveLength(0);
      expect(state.buses.every((bus) => bus.phase === 'gone')).toBe(true);
    });
  }
});
