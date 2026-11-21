import { hasDependencyCycle, solveRound, verifySolution } from '../src/game/domain/solver';
import { required } from '../src/required';
import { readRounds } from './content';

for (const round of await readRounds()) {
  if (hasDependencyCycle(round)) throw new Error(`${round.id}: 출차 의존성 순환`);
  const result = solveRound(round);
  if (result.status !== 'solved' || !verifySolution(round, required(result.solution)))
    throw new Error(`${round.id}: ${result.status}`);
  console.log(
    `${round.id} · ${round.title}: solved (${result.exploredStates} states) ${required(result.solution).join(' → ')}`,
  );
}
