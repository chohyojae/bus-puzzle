import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseRound, validateCatalog } from '../src/content/round-schema';
import { solveRound } from '../src/game/domain/solver';
import { readRounds } from './content';

const original = await readRounds();
const measurements = [];
for (const count of [3, 30, 100]) {
  const directory = await mkdtemp(join(tmpdir(), 'bus-puzzle-content-'));
  try {
    for (const path of ['src', 'public', 'LICENSE.txt', 'package.json', 'index.html', 'vite.config.ts'])
      await cp(resolve(path), join(directory, path), { recursive: true });
    await symlink(resolve('node_modules'), join(directory, 'node_modules'));
    const rounds = [...original];
    for (let i = original.length; i < count; i++) {
      const round = parseRound({
        ...original[i % original.length],
        id: `round-benchmark-${i}`,
        order: i + 100,
        unlockAfter: [],
      });
      rounds.push(round);
      const folder = join(directory, 'src/content/rounds', round.id);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'round.json'), JSON.stringify(round));
      await cp(
        resolve(`src/content/rounds/${original[i % original.length].id}/assets`),
        join(folder, 'assets'),
        { recursive: true },
      );
    }
    validateCatalog(rounds);
    for (const round of rounds)
      if (solveRound(round).status !== 'solved') throw new Error(`Benchmark round invalid: ${round.id}`);
    const started = performance.now();
    const child = Bun.spawn([process.execPath, 'node_modules/vite/bin/vite.js', 'build'], {
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${out}\n${err}`);
    let bytes = 0,
      gzipBytes = 0;
    for (const file of await readdir(join(directory, 'dist/assets'))) {
      const buffer = await readFile(join(directory, 'dist/assets', file));
      bytes += buffer.length;
      gzipBytes += gzipSync(buffer).length;
    }
    measurements.push({
      rounds: count,
      assetBytes: bytes,
      assetGzipBytes: gzipBytes,
      buildMs: Math.round(performance.now() - started),
      precache: out.match(/precache\s+[^\n]+/)?.[0],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
console.log(
  JSON.stringify(
    {
      note: 'Synthetic catalog expansion using copies of the three shipped round layouts. Build times include PWA generation; these are not device load timings.',
      measurements,
    },
    null,
    2,
  ),
);
