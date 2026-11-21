import { describe, expect, it } from 'vitest';
import {
  applyMove,
  createInitialState,
  getGameOutcome,
  getLegalMoves,
  replay,
  resolveBoarding,
} from '../src/game/domain/engine';
import {
  getBlockers,
  getDispatchPath,
  getOccupancy,
  getVehicleFootprint,
} from '../src/game/domain/occupancy';
import { dependencyRound } from './fixtures';

describe('deterministic game engine', () => {
  it('checks the entire outgoing ray and ignores cars in other directions', () => {
    const round = dependencyRound();
    const state = createInitialState(round);
    expect(getBlockers(state, round, 'red')).toEqual(['blue']);
    expect(getBlockers(state, round, 'blue')).toEqual([]);
    expect(getDispatchPath(state, round, 'blue')).toEqual([]);
    expect(getLegalMoves(state, round)).toEqual([{ type: 'dispatch', vehicleId: 'blue' }]);
  });
  it('rejects blocked taps without mutation or history entries', () => {
    const round = dependencyRound(),
      state = createInitialState(round),
      original = structuredClone(state);
    const result = applyMove(state, { type: 'dispatch', vehicleId: 'red' }, round);
    expect(result.rejection).toBe('blocked-path');
    expect(result.nextState).toBe(state);
    expect(state).toEqual(original);
    expect(result.events).toEqual([]);
  });
  it('lets a different colour wait, then boards successive colours and frees slots', () => {
    const round = dependencyRound();
    const first = replay(round, ['blue']);
    expect(first.passengerIndex).toBe(0);
    expect(first.platformSlots[0]?.vehicleId).toBe('blue');
    const result = applyMove(first, { type: 'dispatch', vehicleId: 'red' }, round);
    expect(result.nextState.passengerIndex).toBe(4);
    expect(result.nextState.platformSlots).toEqual([null, null]);
    expect(result.events.filter((e) => e.type === 'passenger-boarded').map((e) => e.vehicleId)).toEqual([
      'red',
      'red',
      'blue',
      'blue',
    ]);
    expect(result.events.at(-1)?.type).toBe('round-won');
    expect(getGameOutcome(result.nextState, round)).toBe('won');
  });
  it('rejects a full platform and classifies the resulting deadlock', () => {
    const round = dependencyRound(1),
      state = replay(round, ['blue']);
    expect(applyMove(state, { type: 'dispatch', vehicleId: 'red' }, round).rejection).toBe('platform-full');
    expect(getGameOutcome(state, round)).toBe('lost');
  });
  it('ignores duplicate dispatch events even while a renderer could still animate', () => {
    const round = dependencyRound(),
      state = replay(round, ['blue']);
    const result = applyMove(state, { type: 'dispatch', vehicleId: 'blue' }, round);
    expect(result.rejection).toBe('not-parked');
    expect(result.nextState).toBe(state);
    expect(state.moveCount).toBe(1);
  });
  it('uses runtime poses rather than initial JSON for collision and footprint', () => {
    const round = dependencyRound(),
      state = createInitialState(round);
    state.vehiclePoseById.blue = { row: 1, col: 1, direction: 'left' };
    expect(getOccupancy(state, round).has('0,1')).toBe(false);
    expect(getBlockers(state, round, 'red')).toEqual([]);
    expect(getVehicleFootprint(state, round, 'blue')).toEqual([{ row: 1, col: 1 }]);
    state.vehiclePoseById.red.direction = 'down';
    state.vehiclePoseById.blue = { row: 1, col: 0, direction: 'up' };
    expect(getBlockers(state, round, 'red')).toEqual(['blue']);
  });
  it('boards older arrivals first even if their slot index is larger', () => {
    const round = dependencyRound();
    round.vehicles[1].color = 'red';
    round.vehicles[1].capacity = 3;
    round.vehicles[0].capacity = 1;
    round.passengers = ['red', 'red', 'red', 'red'];
    const state = createInitialState(round);
    state.parkingVehicleIds = [];
    state.platformSlots = [
      { vehicleId: 'red', boardedCount: 0, arrivalOrder: 7 },
      { vehicleId: 'blue', boardedCount: 0, arrivalOrder: 2 },
    ];
    const result = resolveBoarding(state, round);
    expect(result.events.filter((e) => e.type === 'passenger-boarded').map((e) => e.vehicleId)).toEqual([
      'blue',
      'blue',
      'blue',
      'red',
    ]);
    expect(state.passengerIndex).toBe(0);
    expect(result.nextState.passengerIndex).toBe(4);
  });
  it('does not win merely because the passenger queue is empty', () => {
    const round = dependencyRound(),
      state = createInitialState(round);
    state.passengerIndex = round.passengers.length;
    expect(getGameOutcome(state, round)).not.toBe('won');
  });
  it('replays identical inputs to identical JSON with no render dependency', () => {
    const round = dependencyRound();
    expect(JSON.stringify(replay(round, ['blue', 'red']))).toBe(
      JSON.stringify(replay(round, ['blue', 'red'])),
    );
    expect(() => replay(round, ['red'])).toThrow('잘못된 출차');
  });
});
