import { z } from 'zod';
import type { RoundDefinition } from '../content/round-schema';
import { replay } from '../game/domain/engine';
import { encodeState } from '../game/domain/solver';

export const SAVE_VERSION = 5;
const safeKey = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const timestamp = z.string().datetime();
const pose = z
  .object({
    row: z.number().int().min(0).max(11),
    col: z.number().int().min(0).max(11),
    direction: z.enum(['up', 'right', 'down', 'left']),
  })
  .strict();
export const gameStateSchema = z
  .object({
    engineVersion: z.literal(1),
    parkingVehicleIds: z.array(safeKey).max(64),
    vehiclePoseById: z.record(safeKey, pose),
    platformSlots: z
      .array(
        z
          .object({
            vehicleId: safeKey,
            boardedCount: z.number().int().min(0).max(12),
            arrivalOrder: z.number().int().min(0).max(64),
          })
          .strict()
          .nullable(),
      )
      .max(6),
    passengerIndex: z.number().int().min(0).max(768),
    moveCount: z.number().int().min(0).max(64),
    nextArrivalOrder: z.number().int().min(0).max(64),
    dispatchHistory: z.array(safeKey).max(64),
    logicalTick: z.number().int().min(0).max(64),
    mechanicState: z.record(
      safeKey,
      z.record(safeKey, z.union([z.number().finite(), z.string().max(100), z.boolean()])),
    ),
    revealedVehicleIds: z.array(safeKey).max(64),
  })
  .strict();

const frameRateSchema = z.union([z.literal(60), z.literal(90), z.literal(120)]);
export type FrameRate = z.infer<typeof frameRateSchema>;
export const settingsSchema = z
  .object({
    soundEnabled: z.boolean(),
    hapticsEnabled: z.boolean(),
    frameRate: frameRateSchema,
    reducedMotion: z.boolean(),
  })
  .strict();
const previousSettings = settingsSchema
  .omit({ frameRate: true })
  .extend({
    powerSavingMode: z.enum(['auto', 'on', 'off']),
  })
  .transform(({ soundEnabled, hapticsEnabled, reducedMotion }) => ({
    soundEnabled,
    hapticsEnabled,
    reducedMotion,
    frameRate: 60 as const,
  }));
export type Settings = z.infer<typeof settingsSchema>;
export const progressSchema = z
  .object({
    cleared: z.boolean(),
    firstClearedAt: timestamp,
    lastClearedAt: timestamp,
    clearCount: z.number().int().min(1).max(1_000_000),
    clearedRevision: z.number().int().min(1),
  })
  .strict()
  .refine((p) => p.firstClearedAt <= p.lastClearedAt, '클리어 시점 순서 오류');
export const activeRunSchema = z
  .object({
    roundId: safeKey,
    roundRevision: z.number().int().min(1),
    gameState: gameStateSchema,
    updatedAt: timestamp,
  })
  .strict();
const depotRunSchema = z
  .object({
    version: z.literal(1),
    layout: z.enum(['compact', 'promenade']).optional(),
    fleetVersion: z.literal([1, 2, 3, 4]).optional(),
    stageId: safeKey,
    elapsed: z.number().finite().nonnegative().max(315_360_000),
    fasterPaceFrom: z.number().finite().nonnegative().optional(),
    orderedBoardingFrom: z.number().finite().nonnegative().optional(),
    steadyBeltFrom: z.number().finite().nonnegative().optional(),
    moves: z.array(z.object({ id: safeKey, at: z.number().finite().nonnegative() }).strict()).max(64),
  })
  .strict()
  .refine((run) => {
    const steadyBelt = run.steadyBeltFrom ?? run.elapsed;
    const orderedBoarding = run.orderedBoardingFrom ?? steadyBelt;
    return (
      (run.fasterPaceFrom ?? 0) <= orderedBoarding &&
      orderedBoarding <= steadyBelt &&
      steadyBelt <= run.elapsed &&
      run.moves.every(
        (move, index) => move.at <= run.elapsed && (index === 0 || move.at >= run.moves[index - 1].at),
      )
    );
  }, '출차 기록의 시간이 맞지 않습니다.');
export type DepotRun = z.infer<typeof depotRunSchema>;
export const saveSchema = z
  .object({
    saveSchemaVersion: z.literal(SAVE_VERSION),
    settings: settingsSchema,
    roundProgressById: z.record(safeKey, progressSchema),
    activeRun: activeRunSchema.nullable(),
    depotRun: depotRunSchema.nullish(),
    promenadeRun: depotRunSchema.nullish(),
    backupReminderDismissed: z.boolean(),
  })
  .strict();
export type SaveData = z.infer<typeof saveSchema>;
export type ActiveRun = z.infer<typeof activeRunSchema>;

export function createEmptySave(reducedMotion = false): SaveData {
  return {
    saveSchemaVersion: SAVE_VERSION,
    settings: { soundEnabled: true, hapticsEnabled: false, frameRate: 60, reducedMotion },
    roundProgressById: {},
    activeRun: null,
    backupReminderDismissed: false,
  };
}

export function migrateSave(input: unknown): SaveData {
  if (!input || typeof input !== 'object' || !('saveSchemaVersion' in input))
    throw new Error('저장 데이터 형식을 확인할 수 없습니다.');
  const version = input.saveSchemaVersion;
  if (typeof version !== 'number' || version > SAVE_VERSION)
    throw new Error('더 새로운 버전의 저장 데이터입니다. 앱을 업데이트해 주세요.');
  if (version === 1 || version === 2) {
    const previous = saveSchema.extend({
      saveSchemaVersion: z.literal(version),
      settings: z.union([previousSettings, settingsSchema]),
    });
    const parsed =
      version === 1
        ? { ...previous.omit({ backupReminderDismissed: true }).parse(input), backupReminderDismissed: false }
        : previous.parse(input);
    return { ...parsed, saveSchemaVersion: SAVE_VERSION };
  }
  if (version === 3 || version === 4) {
    const parsed = saveSchema.extend({ saveSchemaVersion: z.literal(version) }).parse(input);
    return { ...parsed, saveSchemaVersion: SAVE_VERSION };
  }
  return saveSchema.parse(input);
}

export function getResumeProblem(run: ActiveRun, rounds: RoundDefinition[]): string | null {
  const round = rounds.find((r) => r.id === run.roundId);
  if (!round) return '현재 버전에는 이 라운드가 없습니다. 기록은 보관 중이며 백업으로 내보낼 수 있습니다.';
  if (round.revision !== run.roundRevision)
    return '라운드가 업데이트되어 처음부터 시작해야 합니다. 클리어 기록은 유지됩니다.';
  try {
    const expected = replay(round, run.gameState.dispatchHistory);
    if (
      encodeState(expected) !== encodeState(run.gameState) ||
      JSON.stringify(expected) !== JSON.stringify(run.gameState)
    ) {
      return '진행 상태를 검증하지 못했습니다. 백업을 내보낸 후 라운드를 다시 시작해 주세요.';
    }
  } catch {
    return '진행 기록에 유효하지 않은 이동이 있습니다. 라운드를 다시 시작해 주세요.';
  }
  return null;
}

export function isUnlocked(round: RoundDefinition, save: SaveData) {
  return (
    !!save.roundProgressById[round.id]?.cleared ||
    round.unlockAfter.every((id) => save.roundProgressById[id]?.cleared)
  );
}
