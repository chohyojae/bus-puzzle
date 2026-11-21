import { colors, directions, parseRound, type RoundDefinition } from '../../content/round-schema';
import { required } from '../../required';
import { applyMove, createInitialState, getGameOutcome, getLegalMoves } from './engine';
import { directionDelta } from './occupancy';
import { solveRound, verifySolution } from './solver';

export const GENERATOR_VERSION = 1;
export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export interface GenerateOptions {
  seed: number;
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  count?: number;
}

export function generateRound(options: GenerateOptions) {
  const rng = seededRandom(options.seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];
  const count = options.count ?? { easy: 6, medium: 9, hard: 12 }[options.difficulty];
  if (!Number.isInteger(count) || count < 2 || count > 20) throw new Error('차량 수는 2~20이어야 합니다.');
  const size = Math.max(4, Math.ceil(Math.sqrt(count * 1.8)));
  const vehicles: RoundDefinition['vehicles'] = [];
  const occupied = new Set<string>();
  for (let i = 0; i < count; i++) {
    const candidates: { row: number; col: number; direction: (typeof directions)[number] }[] = [];
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++) {
        if (occupied.has(`${row},${col}`)) continue;
        for (const direction of directions) {
          const [dr, dc] = directionDelta[direction];
          let r = row + dr,
            c = col + dc,
            clear = true;
          while (r >= 0 && c >= 0 && r < size && c < size) {
            if (occupied.has(`${r},${c}`)) {
              clear = false;
              break;
            }
            r += dr;
            c += dc;
          }
          if (clear) candidates.push({ row, col, direction });
        }
      }
    if (!candidates.length) throw new Error('역순 배치 후보 없음');
    const pose = pick(candidates);
    occupied.add(`${pose.row},${pose.col}`);
    vehicles.push({
      id: `bus-${String(i + 1).padStart(2, '0')}`,
      ...pose,
      length: 1,
      color: pick(colors),
      capacity: 2 + Math.floor(rng() * 2),
    });
  }
  const witness = [...vehicles].reverse().map((v) => v.id);
  const platformSlotCount = options.difficulty === 'hard' ? 2 : 3;
  // Fill a virtual platform, then drain one FIFO colour group before admitting more cars.
  const waiting: typeof vehicles = [];
  const passengers: RoundDefinition['passengers'] = [];
  const drain = () => {
    const vehicle = waiting.splice(Math.floor(rng() * waiting.length), 1)[0];
    passengers.push(...Array.from({ length: vehicle.capacity }, () => vehicle.color));
  };
  for (const id of witness) {
    if (waiting.length === platformSlotCount) drain();
    waiting.push(required(vehicles.find((v) => v.id === id)));
  }
  while (waiting.length) drain();
  const round = parseRound({
    schemaVersion: 1,
    id: options.id,
    revision: 1,
    title: '새로운 정류장',
    description: '다음 승객의 색과 출차 순서를 함께 생각해 보세요.',
    difficulty: options.difficulty,
    order: 100,
    unlockAfter: [],
    platformSlotCount,
    grid: { rows: size, cols: size },
    passengers,
    vehicles,
    assets: { decoration: './assets/decoration.svg' },
    mechanics: [],
  });
  if (!verifySolution(round, witness)) throw new Error('생성 후보의 witness 재생 실패');
  const solved = solveRound(round);
  if (solved.status !== 'solved') throw new Error(`생성 후보 거부: ${solved.status}`);
  return {
    round,
    authoring: {
      seed: options.seed,
      generatorVersion: GENERATOR_VERSION,
      difficulty: options.difficulty,
      witness,
      ...solved,
      metrics: evaluateDifficulty(round, required(solved.solution), options.seed),
    },
  };
}

export function evaluateDifficulty(round: RoundDefinition, solution: string[], seed: number) {
  let state = createInitialState(round),
    choices = 0,
    traps = 0,
    evaluated = 0,
    inconclusive = 0,
    pressure = 0;
  for (const vehicleId of solution) {
    const moves = getLegalMoves(state, round);
    if (moves.length > 1) choices++;
    for (const move of moves) {
      const child = applyMove(state, move, round).nextState;
      const result = solveRound(round, 2_000, child, 1_000);
      if (result.status === 'unsolvable') traps++;
      if (result.status === 'inconclusive') inconclusive++;
      else evaluated++;
    }
    const transition = applyMove(state, { type: 'dispatch', vehicleId }, round);
    // Occupancy immediately on arrival, before automatic boarding.
    if (state.platformSlots.filter(Boolean).length + 1 === round.platformSlotCount) pressure++;
    state = transition.nextState;
  }
  const rng = seededRandom(seed);
  let wins = 0;
  for (let i = 0; i < 40; i++) {
    let play = createInitialState(round);
    while (getGameOutcome(play, round) === 'playing') {
      const moves = getLegalMoves(play, round);
      play = applyMove(play, moves[Math.floor(rng() * moves.length)], round).nextState;
    }
    if (getGameOutcome(play, round) === 'won') wins++;
  }
  return {
    trapRatio: evaluated ? traps / evaluated : 0,
    inconclusiveBranches: inconclusive,
    choiceStates: choices,
    platformPressure: pressure,
    randomWinRate: wins / 40,
  };
}
