import { describe, expect, it } from 'vitest';
import { parseRound, validateCatalog } from '../src/content/round-schema';
import { roundDecoration, rounds } from '../src/content/rounds/catalog';
import { createInitialState, replay } from '../src/game/domain/engine';
import { generateRound } from '../src/game/domain/generator';
import { encodeState, hasDependencyCycle, solveRound, verifySolution } from '../src/game/domain/solver';
import { required } from '../src/required';
import { dependencyRound } from './fixtures';

describe('catalog and solver', () => {
  it('discovers JSONs and asset URLs through Vite glob and solves all shipped rounds', () => {
    expect(rounds.length).toBeGreaterThanOrEqual(3);
    for (const round of rounds) {
      expect(roundDecoration(round.id)).toMatch(/decoration.*\.svg|data:image\/svg/);
      const result = solveRound(round);
      expect(result.status).toBe('solved');
      expect(verifySolution(round, required(result.solution))).toBe(true);
    }
  });
  it('refuses unknown mechanics and schema versions instead of silently ignoring them', () => {
    const round = dependencyRound();
    for (const type of ['direction-rotator', 'color-mask', 'tunnel-queue', 'vehicle-conveyor', 'unknown'])
      expect(() => parseRound({ ...round, mechanics: [{ type }] })).toThrow();
    expect(() => parseRound({ ...round, schemaVersion: 2 })).toThrow();
  });
  it('rejects overlap, bad counts, duplicate vehicles and external or escaping asset paths', () => {
    const round = dependencyRound();
    expect(() => parseRound({ ...round, vehicles: [round.vehicles[0], round.vehicles[0]] })).toThrow();
    expect(() => parseRound({ ...round, passengers: ['red'] })).toThrow();
    expect(() =>
      parseRound({ ...round, vehicles: [round.vehicles[0], { ...round.vehicles[1], row: 0, col: 0 }] }),
    ).toThrow('중첩');
    for (const path of [
      '../assets/a.svg',
      'https://example.com/a.svg',
      './assets/../../a.svg',
      './assets/a%2f.svg',
    ])
      expect(() => parseRound({ ...round, assets: { decoration: path } })).toThrow();
  });
  it('sorts order then ID and rejects duplicate IDs, missing unlock references and unlock cycles', () => {
    const a = dependencyRound(),
      b = { ...a, id: 'round-other', order: 0 };
    expect(validateCatalog([a, b]).map((r) => r.id)).toEqual(['round-other', 'round-test']);
    expect(() => validateCatalog([a, a])).toThrow('중복');
    expect(() => validateCatalog([{ ...a, unlockAfter: ['missing'] }])).toThrow('없는');
    expect(() =>
      validateCatalog([
        { ...a, unlockAfter: [b.id] },
        { ...b, unlockAfter: [a.id] },
      ]),
    ).toThrow('순환');
  });
  it('distinguishes a solvable DAG from an unsolvable platform-constrained DAG', () => {
    expect(hasDependencyCycle(dependencyRound(1))).toBe(false);
    expect(solveRound(dependencyRound(1)).status).toBe('unsolvable');
    expect(solveRound(dependencyRound(2)).status).toBe('solved');
  });
  it('rejects a static dependency cycle and distinguishes budget exhaustion', () => {
    const cycle = dependencyRound();
    cycle.vehicles[1].direction = 'left';
    expect(hasDependencyCycle(cycle)).toBe(true);
    expect(solveRound(cycle).status).toBe('unsolvable');
    expect(solveRound(dependencyRound(), 0).status).toBe('inconclusive');
  });
  it('normalizes irrelevant counters but retains current poses, seat counts and relative arrivals', () => {
    const round = dependencyRound(),
      a = replay(round, ['blue']),
      b = structuredClone(a);
    b.moveCount = 50;
    b.logicalTick = 50;
    required(b.platformSlots[0]).arrivalOrder = 30;
    expect(encodeState(a)).toBe(encodeState(b));
    required(b.platformSlots[0]).boardedCount = 1;
    expect(encodeState(a)).not.toBe(encodeState(b));
    required(b.platformSlots[0]).boardedCount = 0;
    b.vehiclePoseById.red.direction = 'down';
    expect(encodeState(a)).not.toBe(encodeState(b));
    const c = createInitialState(round),
      d = structuredClone(c);
    c.platformSlots = [
      { vehicleId: 'red', boardedCount: 0, arrivalOrder: 1 },
      { vehicleId: 'blue', boardedCount: 0, arrivalOrder: 2 },
    ];
    d.platformSlots = [
      { vehicleId: 'red', boardedCount: 0, arrivalOrder: 2 },
      { vehicleId: 'blue', boardedCount: 0, arrivalOrder: 1 },
    ];
    expect(encodeState(c)).not.toBe(encodeState(d));
  });
});

describe('seeded authoring', () => {
  it('produces byte-identical JSON and report with identical seed/options', () => {
    const options = { seed: 24019, id: 'round-generated', difficulty: 'medium' as const };
    expect(JSON.stringify(generateRound(options))).toBe(JSON.stringify(generateRound(options)));
  });
  it('replays insertion witnesses and verifies final solver paths for multiple seeds', () => {
    for (const seed of [1, 2, 7, 42, 100]) {
      const { round, authoring } = generateRound({ seed, id: 'round-generated', difficulty: 'easy' });
      expect(verifySolution(round, authoring.witness)).toBe(true);
      expect(verifySolution(round, required(authoring.solution))).toBe(true);
      expect(authoring.metrics.randomWinRate).toBeGreaterThanOrEqual(0);
      expect(authoring.metrics.randomWinRate).toBeLessThanOrEqual(1);
      expect(hasDependencyCycle(round)).toBe(false);
    }
  });
});
