import type { RoundDefinition } from '../../content/round-schema';
import { required } from '../../required';
import { applyMove, createInitialState, getGameOutcome, getLegalMoves, replay } from './engine';
import { getBlockers } from './occupancy';
import type { GameState } from './types';

export type SolveStatus = 'solved' | 'unsolvable' | 'inconclusive';
type SolveBranch =
  | { status: 'solved'; solution: string[] }
  | { status: 'unsolvable' | 'inconclusive'; solution?: never };
export type SolveResult = SolveBranch & { exploredStates: number };

export function encodeState(state: GameState): string {
  const arrivals = state.platformSlots.flatMap((v) => (v ? [v.arrivalOrder] : [])).sort((a, b) => a - b);
  return JSON.stringify({
    parking: [...state.parkingVehicleIds].sort(),
    poses: Object.entries(state.vehiclePoseById).sort(([a], [b]) => a.localeCompare(b)),
    slots: state.platformSlots.map((v) =>
      v ? [v.vehicleId, v.boardedCount, arrivals.indexOf(v.arrivalOrder)] : null,
    ),
    passenger: state.passengerIndex,
    mechanics: state.mechanicState,
    // Revealed information and logicalTick must enter the key if future rules make them affect legal actions.
  });
}

export function hasDependencyCycle(round: RoundDefinition): boolean {
  const initial = createInitialState(round);
  const edges = new Map(round.vehicles.map((v) => [v.id, getBlockers(initial, round, v.id)]));
  const visiting = new Set<string>(),
    done = new Set<string>();
  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    if (required(edges.get(id)).some(visit)) return true;
    visiting.delete(id);
    done.add(id);
    return false;
  }
  return round.vehicles.some((v) => visit(v.id));
}

export function solveRound(
  round: RoundDefinition,
  maxStates = 200_000,
  startState = createInitialState(round),
  maxMs = 10_000,
): SolveResult {
  const dead = new Set<string>();
  const deadline = performance.now() + maxMs;
  let exploredStates = 0;
  function dfs(state: GameState): SolveBranch {
    const outcome = getGameOutcome(state, round);
    if (outcome === 'won') return { status: 'solved', solution: [] };
    if (outcome === 'lost') return { status: 'unsolvable' };
    const key = encodeState(state);
    if (dead.has(key)) return { status: 'unsolvable' };
    if (exploredStates >= maxStates || performance.now() >= deadline) return { status: 'inconclusive' };
    exploredStates++;
    let incomplete = false;
    for (const move of getLegalMoves(state, round)) {
      const result = dfs(applyMove(state, move, round).nextState);
      if (result.status === 'solved')
        return { status: 'solved', solution: [move.vehicleId, ...required(result.solution)] };
      if (result.status === 'inconclusive') incomplete = true;
    }
    if (incomplete) return { status: 'inconclusive' };
    dead.add(key);
    return { status: 'unsolvable' };
  }
  const result = dfs(startState);
  if (result.status === 'solved') {
    let verified = startState;
    for (const vehicleId of required(result.solution))
      verified = applyMove(verified, { type: 'dispatch', vehicleId }, round).nextState;
    if (getGameOutcome(verified, round) !== 'won') throw new Error('Solver 재생 검증 실패');
  }
  return { ...result, exploredStates };
}

export function verifySolution(round: RoundDefinition, solution: string[]): boolean {
  return getGameOutcome(replay(round, solution), round) === 'won';
}
