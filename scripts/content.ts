import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseRound, validateCatalog } from '../src/content/round-schema';

export async function readRounds(root = resolve('src/content/rounds')) {
  const entries = await readdir(root, { withFileTypes: true });
  const rounds = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name, 'round.json');
    const round = parseRound(JSON.parse(await readFile(path, 'utf8')));
    if (round.id !== entry.name) throw new Error(`폴더명과 ID 불일치: ${entry.name} / ${round.id}`);
    for (const asset of Object.values(round.assets)) await access(join(dirname(path), asset));
    rounds.push(round);
  }
  if (!rounds.length) throw new Error('라운드가 없습니다.');
  return validateCatalog(rounds);
}

export function arg(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
