import { mkdir, writeFile } from 'node:fs/promises';
import { parseRound, type RoundDefinition } from '../src/content/round-schema';
import { generateRound } from '../src/game/domain/generator';

const vehicle = (id: string, color: string, row: number, col: number, direction: string) => ({
  id,
  color,
  row,
  col,
  direction,
  capacity: 2,
});
const common = {
  schemaVersion: 1,
  revision: 1,
  assets: { decoration: './assets/decoration.svg' },
  mechanics: [],
  platformSlotCount: 2,
};
const first = parseRound({
  ...common,
  id: 'round-001',
  order: 10,
  title: '첫 출발',
  description: '화살표 방향으로 출발! 같은 색 승객을 태워보세요.',
  difficulty: 'easy',
  unlockAfter: [],
  grid: { rows: 3, cols: 4 },
  vehicles: [
    vehicle('red-1', 'red', 0, 0, 'up'),
    vehicle('blue-1', 'blue', 0, 2, 'up'),
    vehicle('yellow-1', 'yellow', 2, 1, 'down'),
    vehicle('green-1', 'green', 2, 3, 'down'),
  ],
  passengers: ['red', 'red', 'blue', 'blue', 'green', 'green', 'yellow', 'yellow'],
});
const second = parseRound({
  ...common,
  id: 'round-002',
  order: 20,
  title: '길을 열어주세요',
  description: '앞을 막은 버스부터 보내고, 플랫폼 자리를 활용해 보세요.',
  difficulty: 'easy',
  unlockAfter: ['round-001'],
  grid: { rows: 4, cols: 4 },
  vehicles: [
    vehicle('red-1', 'red', 1, 0, 'right'),
    vehicle('blue-1', 'blue', 1, 3, 'up'),
    vehicle('yellow-1', 'yellow', 3, 1, 'up'),
    vehicle('green-1', 'green', 0, 1, 'right'),
    vehicle('red-2', 'red', 2, 2, 'down'),
    vehicle('blue-2', 'blue', 3, 3, 'right'),
  ],
  passengers: [
    'red',
    'red',
    'blue',
    'blue',
    'green',
    'green',
    'yellow',
    'yellow',
    'red',
    'red',
    'blue',
    'blue',
  ],
});
const generated = generateRound({ seed: 24019, id: 'round-003', difficulty: 'medium', count: 9 });
const third: RoundDefinition = {
  ...generated.round,
  title: '조금 더 신중하게',
  description: '승객 순서를 먼저 살펴보세요. 빈자리 하나가 중요해요.',
  order: 30,
  platformSlotCount: 3,
  unlockAfter: ['round-002'],
};
for (const round of [first, second, third]) {
  const directory = `src/content/rounds/${round.id}`;
  await mkdir(`${directory}/assets`, { recursive: true });
  await writeFile(`${directory}/round.json`, `${JSON.stringify(round, null, 2)}\n`);
  const colors = { red: '#ff7f7c', blue: '#65bbf5', yellow: '#f8cb5c', green: '#65e4b6' };
  const width = 240,
    height = 150,
    cell = Math.min(42, 180 / round.grid.cols, 110 / round.grid.rows);
  const art = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 240 150"><title>라운드 주차장</title><rect x="15" y="8" width="210" height="134" rx="18" fill="#243750"/>${round.vehicles.map((v) => `<g transform="translate(${38 + v.col * cell} ${24 + v.row * cell})"><rect width="${cell * 0.73}" height="${cell * 0.8}" rx="6" fill="${colors[v.color]}"/><rect x="5" y="4" width="${cell * 0.73 - 10}" height="6" rx="2" fill="#173048"/></g>`).join('')}</svg>`;
  await writeFile(`${directory}/assets/decoration.svg`, art);
}
await writeFile(
  'src/content/rounds/round-003/authoring.json',
  `${JSON.stringify(generated.authoring, null, 2)}\n`,
);
