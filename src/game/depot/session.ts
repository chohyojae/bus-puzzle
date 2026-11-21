import type { DepotRun, SaveData } from '../../storage/save-schema';
import {
  CURRENT_FLEET_VERSION,
  createDepot,
  type DepotLayout,
  type DepotState,
  dispatchBus,
  restoreLeftFirstQueue,
  startSteadyBelt,
  tickDepot,
} from './logic';
import { stops } from './stages';

export interface DepotSession {
  game: DepotState;
  moves: DepotRun['moves'];
  previous: DepotState[];
  fasterPaceFrom: number;
  orderedBoardingFrom: number;
}

export function newSession(level = 1, layout: DepotLayout = 'compact'): DepotSession {
  return {
    game: createDepot(level, layout),
    moves: [],
    previous: [],
    fasterPaceFrom: 0,
    orderedBoardingFrom: 0,
  };
}

export function previousDepotRun(save: SaveData) {
  return (
    save.promenadeRun ??
    (save.depotRun?.moves.length && save.depotRun.layout !== 'compact' ? save.depotRun : null)
  );
}

export function openDepot(save: SaveData, layout: DepotLayout = 'compact'): DepotSession {
  if (layout === 'promenade') return resumeSession(previousDepotRun(save));
  const run = save.depotRun;
  if (!run || run.layout === 'compact') return resumeSession(run);
  return newSession(Math.max(1, stops.findIndex((stop) => stop.id === run.stageId) + 1));
}

export function storeDepotRun(save: SaveData, run: DepotRun): SaveData {
  if (run.layout === 'promenade') return { ...save, promenadeRun: run };
  const previous = previousDepotRun(save);
  return previous ? { ...save, promenadeRun: previous, depotRun: run } : { ...save, depotRun: run };
}

export function resumeSession(saved: DepotRun | null | undefined): DepotSession {
  if (!saved) return newSession();
  const index = stops.findIndex((stage) => stage.id === saved.stageId);
  if (index === -1) return newSession();
  const layout = saved.layout ?? 'promenade';
  if (!saved.moves.length && layout === 'compact' && saved.fleetVersion !== CURRENT_FLEET_VERSION) {
    return newSession(index + 1, layout);
  }
  const steadyBeltFrom = saved.steadyBeltFrom ?? saved.elapsed;
  const orderedBoardingFrom = saved.orderedBoardingFrom ?? steadyBeltFrom;
  const session: DepotSession = {
    game: createDepot(
      index + 1,
      layout,
      orderedBoardingFrom > 0 ? 'alternating' : 'left-first',
      saved.fleetVersion ?? 1,
      steadyBeltFrom === 0,
    ),
    moves: [],
    previous: [],
    fasterPaceFrom: saved.fasterPaceFrom ?? orderedBoardingFrom,
    orderedBoardingFrom,
  };
  // Replay each move with the driving, boarding and belt speeds in use when it was recorded.
  function advanceTo(target: number) {
    let state = session.game;
    const oldPaceEnd = Math.min(target, session.fasterPaceFrom);
    if (oldPaceEnd > state.elapsed) state = tickDepot(state, oldPaceEnd - state.elapsed, { legacy: true });
    const oldBoardingEnd = Math.min(target, orderedBoardingFrom);
    if (oldBoardingEnd > state.elapsed)
      state = tickDepot(state, oldBoardingEnd - state.elapsed, { previousBoarding: true });
    if (target >= orderedBoardingFrom) state = restoreLeftFirstQueue(state);
    const oldBeltEnd = Math.min(target, steadyBeltFrom);
    if (oldBeltEnd > state.elapsed)
      state = tickDepot(state, oldBeltEnd - state.elapsed, { previousBelt: true });
    if (target < steadyBeltFrom) return state;
    return tickDepot(startSteadyBelt(state), target - state.elapsed);
  }
  for (const move of saved.moves) {
    const before = advanceTo(move.at);
    const result = dispatchBus(before, move.id);
    if (result.reason) return newSession(index + 1, session.game.layout);
    session.previous.push(startSteadyBelt(restoreLeftFirstQueue(before)));
    session.moves.push(move);
    session.game = result.state;
  }
  session.game = advanceTo(saved.elapsed);
  return session;
}

export function undoDispatch(session: DepotSession): DepotSession | undefined {
  const last = session.previous.at(-1);
  if (!last || session.game.status === 'won') return;
  if (session.moves.length === 1 && last.layout === 'compact' && last.fleetVersion !== CURRENT_FLEET_VERSION)
    return newSession(last.level);
  return {
    game: startSteadyBelt(last),
    moves: session.moves.slice(0, -1),
    previous: session.previous.slice(0, -1),
    fasterPaceFrom: Math.min(session.fasterPaceFrom, last.elapsed),
    orderedBoardingFrom: Math.min(session.orderedBoardingFrom, last.elapsed),
  };
}

export function checkpoint(session: DepotSession): DepotRun {
  return {
    version: 1,
    layout: session.game.layout,
    fleetVersion: session.game.fleetVersion,
    stageId: stops[session.game.level - 1].id,
    elapsed: session.game.elapsed,
    fasterPaceFrom: session.fasterPaceFrom,
    orderedBoardingFrom: session.orderedBoardingFrom,
    steadyBeltFrom: session.game.steadyBelt?.elapsed ?? session.game.elapsed,
    moves: session.moves,
  };
}
