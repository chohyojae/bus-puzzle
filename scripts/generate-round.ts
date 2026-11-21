import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateRound } from '../src/game/domain/generator';
import { arg } from './content';

const id = arg('id');
const seed = Number(arg('seed'));
const difficulty = arg('difficulty') ?? 'medium';
if (
  !id ||
  !/^round-[a-z0-9-]+$/.test(id) ||
  !Number.isSafeInteger(seed) ||
  !['easy', 'medium', 'hard'].includes(difficulty)
) {
  throw new Error('--seed=24019 --difficulty=medium --id=round-004를 지정해 주세요.');
}
const generated = generateRound({ seed, id, difficulty: difficulty as 'easy' | 'medium' | 'hard' });
const directory = join('src/content/rounds', id);
// Non-recursive creation intentionally refuses to overwrite a released ID.
await mkdir(directory);
await mkdir(join(directory, 'assets'));
await writeFile(join(directory, 'round.json'), `${JSON.stringify(generated.round, null, 2)}\n`);
await writeFile(join(directory, 'authoring.json'), `${JSON.stringify(generated.authoring, null, 2)}\n`);
await writeFile(
  join(directory, 'assets/decoration.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><title>라운드 주차장</title><rect x="8" y="12" width="184" height="76" rx="20" fill="#24344e"/><path d="M24 50h152" stroke="#8294ae" stroke-width="4" stroke-dasharray="8 10"/><rect x="70" y="28" width="60" height="44" rx="12" fill="#64e4b6"/><rect x="112" y="36" width="9" height="28" rx="3" fill="#18283f"/></svg>\n',
);
console.log(JSON.stringify(generated.authoring, null, 2));
