import { z } from 'zod';

export const colors = ['red', 'blue', 'yellow', 'green'] as const;
export type Color = (typeof colors)[number];
export const directions = ['up', 'right', 'down', 'left'] as const;
export type Direction = (typeof directions)[number];
export const supportedMechanicTypes: readonly string[] = [];
const id = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const asset = z
  .string()
  .regex(/^\.\/assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(svg|png|webp|jpg|jpeg|ogg|mp3)$/);

export const roundSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    revision: z.number().int().min(1),
    title: z.string().min(1).max(80),
    description: z.string().max(240).default('같은 색 승객을 태우고 주차장을 비워보세요.'),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
    order: z.number().int(),
    unlockAfter: z.array(id).max(100),
    platformSlotCount: z.number().int().min(1).max(6),
    grid: z.object({ rows: z.number().int().min(1).max(12), cols: z.number().int().min(1).max(12) }).strict(),
    passengers: z.array(z.enum(colors)).min(1).max(768),
    vehicles: z
      .array(
        z
          .object({
            id,
            color: z.enum(colors),
            row: z.number().int().min(0),
            col: z.number().int().min(0),
            direction: z.enum(directions),
            length: z.literal(1).default(1),
            capacity: z.number().int().min(1).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    assets: z.object({ decoration: asset }).strict(),
    // No mechanic may be silently stripped by the MVP parser.
    mechanics: z.array(z.never()).max(0).default([]),
  })
  .strict();

export type RoundDefinition = z.infer<typeof roundSchema>;

export function parseRound(input: unknown): RoundDefinition {
  const round = roundSchema.parse(input);
  const vehicleIds = new Set<string>();
  const occupied = new Set<string>();
  for (const v of round.vehicles) {
    if (vehicleIds.has(v.id)) throw new Error(`${round.id}: 중복 차량 ID ${v.id}`);
    vehicleIds.add(v.id);
    if (v.row >= round.grid.rows || v.col >= round.grid.cols)
      throw new Error(`${round.id}: 차량 좌표 범위 초과 ${v.id}`);
    const cell = `${v.row},${v.col}`;
    if (occupied.has(cell)) throw new Error(`${round.id}: 차량 중첩 ${cell}`);
    occupied.add(cell);
  }
  for (const color of colors) {
    const seats = round.vehicles.filter((v) => v.color === color).reduce((n, v) => n + v.capacity, 0);
    if (seats !== round.passengers.filter((c) => c === color).length)
      throw new Error(`${round.id}: ${color} 승객 수와 정원이 다릅니다.`);
  }
  return round;
}

export function validateCatalog(rounds: RoundDefinition[]): RoundDefinition[] {
  const byId = new Map(rounds.map((r) => [r.id, r]));
  if (byId.size !== rounds.length) throw new Error('중복 라운드 ID');
  const complete = new Set<string>();
  const visiting = new Set<string>();
  function visit(round: RoundDefinition) {
    if (complete.has(round.id)) return;
    if (visiting.has(round.id)) throw new Error(`순환 해금 조건: ${round.id}`);
    visiting.add(round.id);
    for (const required of round.unlockAfter) {
      const prerequisite = byId.get(required);
      if (!prerequisite) throw new Error(`없는 해금 참조: ${required}`);
      visit(prerequisite);
    }
    visiting.delete(round.id);
    complete.add(round.id);
  }
  rounds.forEach(visit);
  return [...rounds].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'));
}
