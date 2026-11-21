import type { RoundDefinition } from '../../content/round-schema';
import { required } from '../../required';
import { getBlockers } from './occupancy';
import type { GameEvent, GameState, Move, MoveRejection, Outcome, TransitionResult } from './types';

export function createInitialState(round: RoundDefinition): GameState {
  return {
    engineVersion: 1,
    parkingVehicleIds: round.vehicles.map((v) => v.id),
    vehiclePoseById: Object.fromEntries(
      round.vehicles.map((v) => [v.id, { row: v.row, col: v.col, direction: v.direction }]),
    ),
    platformSlots: Array.from({ length: round.platformSlotCount }, () => null),
    passengerIndex: 0,
    moveCount: 0,
    nextArrivalOrder: 0,
    dispatchHistory: [],
    logicalTick: 0,
    mechanicState: {},
    revealedVehicleIds: round.vehicles.map((v) => v.id),
  };
}

export function canDispatch(
  state: GameState,
  round: RoundDefinition,
  vehicleId: string,
): MoveRejection | null {
  if (!state.parkingVehicleIds.includes(vehicleId)) return 'not-parked';
  if (getBlockers(state, round, vehicleId).length) return 'blocked-path';
  if (!state.platformSlots.includes(null)) return 'platform-full';
  return null;
}

export function getLegalMoves(state: GameState, round: RoundDefinition): Move[] {
  return state.parkingVehicleIds
    .filter((id) => canDispatch(state, round, id) === null)
    .map((vehicleId) => ({ type: 'dispatch', vehicleId }));
}

export function getGameOutcome(state: GameState, round: RoundDefinition): Outcome {
  if (
    state.passengerIndex === round.passengers.length &&
    state.parkingVehicleIds.length === 0 &&
    state.platformSlots.every((v) => v === null)
  )
    return 'won';
  // Future rules must include wait/tick as legal actions before declaring a deadlock.
  return getLegalMoves(state, round).length ? 'playing' : 'lost';
}

function boardInto(nextState: GameState, round: RoundDefinition, events: GameEvent[]) {
  const definitions = new Map(round.vehicles.map((v) => [v.id, v]));
  while (nextState.passengerIndex < round.passengers.length) {
    const color = round.passengers[nextState.passengerIndex];
    const eligible = nextState.platformSlots
      .flatMap((v, slotIndex) =>
        v && definitions.get(v.vehicleId)?.color === color ? [{ v, slotIndex }] : [],
      )
      .sort((a, b) => a.v.arrivalOrder - b.v.arrivalOrder || a.slotIndex - b.slotIndex);
    const match = eligible[0];
    if (!match) break;
    const { v, slotIndex } = match;
    v.boardedCount++;
    events.push({
      type: 'passenger-boarded',
      vehicleId: v.vehicleId,
      passengerIndex: nextState.passengerIndex,
      boardedCount: v.boardedCount,
      slotIndex,
    });
    nextState.passengerIndex++;
    if (v.boardedCount === required(definitions.get(v.vehicleId)).capacity) {
      nextState.platformSlots[slotIndex] = null;
      events.push({ type: 'vehicle-departed', vehicleId: v.vehicleId, slotIndex });
    }
  }
}

export function resolveBoarding(state: GameState, round: RoundDefinition): TransitionResult {
  const nextState = structuredClone(state);
  const events: GameEvent[] = [];
  boardInto(nextState, round, events);
  return { nextState, events };
}

export function applyMove(state: GameState, move: Move, round: RoundDefinition): TransitionResult {
  const rejection = canDispatch(state, round, move.vehicleId);
  if (rejection) return { nextState: state, events: [], rejection };
  if (getGameOutcome(state, round) !== 'playing')
    return { nextState: state, events: [], rejection: 'round-finished' };
  const nextState = structuredClone(state);
  const slotIndex = nextState.platformSlots.indexOf(null);
  nextState.parkingVehicleIds = nextState.parkingVehicleIds.filter((id) => id !== move.vehicleId);
  nextState.platformSlots[slotIndex] = {
    vehicleId: move.vehicleId,
    boardedCount: 0,
    arrivalOrder: nextState.nextArrivalOrder++,
  };
  nextState.moveCount++;
  nextState.logicalTick++;
  nextState.dispatchHistory.push(move.vehicleId);
  const events: GameEvent[] = [{ type: 'vehicle-dispatched', vehicleId: move.vehicleId, slotIndex }];
  boardInto(nextState, round, events);
  const outcome = getGameOutcome(nextState, round);
  if (outcome !== 'playing') events.push({ type: outcome === 'won' ? 'round-won' : 'round-lost' });
  return { nextState, events };
}

export function replay(round: RoundDefinition, vehicleIds: string[]): GameState {
  let state = createInitialState(round);
  for (const vehicleId of vehicleIds) {
    const transition = applyMove(state, { type: 'dispatch', vehicleId }, round);
    if (transition.rejection) throw new Error(`잘못된 출차 기록: ${vehicleId} (${transition.rejection})`);
    state = transition.nextState;
  }
  return state;
}
