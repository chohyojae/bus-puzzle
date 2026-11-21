import { solveRound } from '../src/game/domain/solver';
import { arg, readRounds } from './content';

const id = arg('round');
const round = (await readRounds()).find((r) => r.id === id);
if (!round) throw new Error('--round=round-001처럼 라운드 ID를 지정해 주세요.');
const max = Number(arg('max-states') ?? 200_000);
if (!Number.isInteger(max) || max < 0) throw new Error('max-states는 0 이상의 정수여야 합니다.');
const result = solveRound(round, max);
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'solved') process.exitCode = 1;
