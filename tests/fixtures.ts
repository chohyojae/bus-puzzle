import { parseRound } from '../src/content/round-schema';
export function dependencyRound(slots = 2) {
  return parseRound({
    schemaVersion: 1,
    id: 'round-test',
    revision: 1,
    title: 'Test',
    order: 1,
    unlockAfter: [],
    platformSlotCount: slots,
    grid: { rows: 2, cols: 2 },
    passengers: ['red', 'red', 'blue', 'blue'],
    vehicles: [
      { id: 'red', color: 'red', row: 0, col: 0, direction: 'right', capacity: 2 },
      { id: 'blue', color: 'blue', row: 0, col: 1, direction: 'up', capacity: 2 },
    ],
    assets: { decoration: './assets/decoration.svg' },
  });
}
export const progress = (count = 1, date = '2026-11-21T00:00:00.000Z') => ({
  cleared: true,
  firstClearedAt: date,
  lastClearedAt: date,
  clearCount: count,
  clearedRevision: 1,
});
