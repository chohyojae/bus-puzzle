import { afterEach, expect, it, vi } from 'vitest';
import { startFrameLoop } from '../src/game/render/frame-loop';
import { exportBackup, parseBackup } from '../src/storage/import-export';
import { createEmptySave, type FrameRate, migrateSave } from '../src/storage/save-schema';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('선택한 FPS와 실제 디스플레이 주사율 중 낮은 쪽으로 렌더하고 경과 시간은 보존한다', () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  let callback: FrameRequestCallback | undefined;
  let requestId = 0;
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
    callback = next;
    return ++requestId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    if (id === requestId) callback = undefined;
  });
  for (const display of [60, 90, 120, 144]) {
    for (const target of [60, 90, 120] as const) {
      let frames = 0;
      let elapsed = 0;
      const stop = startFrameLoop(target, (_now, delta) => {
        frames++;
        elapsed += delta;
      });
      for (let i = 1; i <= display * 2; i++) callback?.((i * 1000) / display);
      expect(frames).toBe(Math.min(display, target) * 2);
      expect(elapsed).toBeCloseTo(2000);
      stop();
      expect(callback).toBeUndefined();
    }
  }
});

it('기존 저장과 JSON 백업에서 절전 설정을 60 FPS로 바꾸고 모션·소리·진동 선택을 보존한다', () => {
  const base = createEmptySave();
  for (const version of [1, 2]) {
    for (const mode of ['auto', 'on', 'off']) {
      const { backupReminderDismissed, ...rest } = base;
      const legacy = {
        ...rest,
        ...(version === 2 ? { backupReminderDismissed } : {}),
        saveSchemaVersion: version,
        settings: { soundEnabled: false, hapticsEnabled: true, reducedMotion: true, powerSavingMode: mode },
      };
      const backup = {
        format: 'bus-puzzle-save',
        exportedAt: new Date().toISOString(),
        saveSchemaVersion: version,
        data: legacy,
      };
      const restored = parseBackup(JSON.stringify(backup));
      expect(restored).toEqual(migrateSave(legacy));
      expect(restored.settings).toEqual({
        soundEnabled: false,
        hapticsEnabled: true,
        reducedMotion: true,
        frameRate: 60,
      });
      expect(exportBackup(restored)).not.toContain('powerSavingMode');
    }
  }
  for (const frameRate of [60, 90, 120] as FrameRate[]) {
    const data = createEmptySave();
    data.settings.frameRate = frameRate;
    expect(parseBackup(exportBackup(data))).toEqual(data);
  }
  expect(() => migrateSave({ ...base, settings: { ...base.settings, frameRate: 75 } })).toThrow();
});
