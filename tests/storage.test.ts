import 'fake-indexeddb/auto';
import { constants, gzipSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replay } from '../src/game/domain/engine';
import {
  createBackupBlob,
  exportBackup,
  importPreview,
  MAX_BACKUP_BYTES,
  mergeSaves,
  parseBackup,
  readBackupFile,
} from '../src/storage/import-export';
import { SaveConflictError, SaveRepository } from '../src/storage/save-repository';
import { createEmptySave, getResumeProblem, isUnlocked, migrateSave } from '../src/storage/save-schema';
import { dependencyRound, progress } from './fixtures';

const repos: SaveRepository[] = [];
const repo = (name = crypto.randomUUID()) => {
  const repository = new SaveRepository(name);
  repos.push(repository);
  return repository;
};
afterEach(() => {
  for (const r of repos) r.close();
  repos.length = 0;
  vi.unstubAllGlobals();
});

describe('backup and compatibility', () => {
  it('writes real Zstandard and reads Zstandard, older gzip and JSON backups', async () => {
    const data = createEmptySave();
    data.roundProgressById['round-old'] = progress();
    const date = new Date('2026-11-21T00:00:00Z');
    const text = exportBackup(data, date);
    const encoded = await createBackupBlob(data, date);
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);
    expect(zstdDecompressSync(bytes).toString('utf8')).toBe(text);
    expect(bytes.byteLength).toBeLessThan(new TextEncoder().encode(text).byteLength);
    const streamed = zstdCompressSync(text, { params: { [constants.ZSTD_c_contentSizeFlag]: 0 } });
    for (const file of [
      new File([encoded], 'saved.BPZ'),
      new File([streamed], 'streamed.bpz'),
      new File([gzipSync(text)], 'legacy.bpz'),
      new File([text], 'old.json'),
    ])
      await expect(readBackupFile(file)).resolves.toEqual(data);
  });

  it('rejects misleading extensions, invalid envelopes, truncation and checksum errors', async () => {
    const text = exportBackup(createEmptySave());
    await expect(readBackupFile(new File([text], 'wrong.bpz'))).rejects.toThrow('손상');
    await expect(readBackupFile(new File([text], 'wrong.zip'))).rejects.toThrow('BPZ 또는 JSON');
    await expect(readBackupFile(new File([zstdCompressSync('{}')], 'wrong.bpz'))).rejects.toThrow(
      '백업 파일',
    );
    const zstd = zstdCompressSync(text, { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
    await expect(readBackupFile(new File([zstd.subarray(0, -5)], 'truncated.bpz'))).rejects.toThrow('손상');
    zstd[zstd.length - 1] ^= 1;
    await expect(readBackupFile(new File([zstd], 'damaged.bpz'))).rejects.toThrow('손상');
    const gzip = gzipSync(text);
    gzip[gzip.length - 8] ^= 1;
    await expect(readBackupFile(new File([gzip], 'legacy.bpz'))).rejects.toThrow('손상');
  });

  it('bounds compressed input, advertised output and actual expansion without a valid size field', async () => {
    const overLimit = new Uint8Array(MAX_BACKUP_BYTES + 1);
    await expect(readBackupFile(new File([overLimit], 'too-big.bpz'))).rejects.toThrow('2 MiB');
    await expect(readBackupFile(new File([zstdCompressSync(overLimit)], 'expanded.bpz'))).rejects.toThrow(
      '2 MiB',
    );
    const streamed = zstdCompressSync(overLimit, { params: { [constants.ZSTD_c_contentSizeFlag]: 0 } });
    await expect(readBackupFile(new File([streamed], 'streamed.bpz'))).rejects.toThrow(/2 MiB|손상/);
    // A 64-bit declaration must not wrap into the codec's 32-bit WASM allocation.
    const huge = Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0xe0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0);
    await expect(readBackupFile(new File([huge], 'huge.bpz'))).rejects.toThrow('2 MiB');
    const legacy = Uint8Array.from(gzipSync(overLimit));
    await expect(readBackupFile(new File([legacy], 'legacy.bpz'))).rejects.toThrow('2 MiB');
    new DataView(legacy.buffer).setUint32(legacy.length - 4, 10, true);
    await expect(readBackupFile(new File([legacy], 'forged.bpz'))).rejects.toThrow(/2 MiB|손상/);
  });

  it('round-trips progress, complete logical state and settings through JSON', () => {
    const round = dependencyRound(),
      data = createEmptySave();
    data.roundProgressById['round-old'] = progress();
    data.activeRun = {
      roundId: round.id,
      roundRevision: 1,
      gameState: replay(round, ['blue']),
      updatedAt: '2026-11-21T00:00:00.000Z',
    };
    expect(parseBackup(exportBackup(data))).toEqual(data);
    expect(getResumeProblem(data.activeRun, [round])).toBe(null);
  });
  it('merges by stable ID without summing duplicate counts or losing unknown rounds', () => {
    const current = createEmptySave(),
      incoming = createEmptySave();
    current.roundProgressById['round-old'] = progress(3, '2026-11-19T00:00:00.000Z');
    incoming.roundProgressById['round-old'] = progress(2);
    incoming.roundProgressById['round-future'] = progress();
    incoming.settings.soundEnabled = false;
    const merged = mergeSaves(current, incoming);
    expect(merged.roundProgressById['round-old'].clearCount).toBe(3);
    expect(merged.roundProgressById['round-old'].firstClearedAt).toBe('2026-11-19T00:00:00.000Z');
    expect(merged.roundProgressById['round-old'].lastClearedAt).toBe('2026-11-21T00:00:00.000Z');
    expect(merged.roundProgressById['round-future']).toBeDefined();
    expect(merged.settings).toEqual(current.settings);
    expect(importPreview(current, incoming)).toEqual({ cleared: 2, added: 1, conflicts: 1 });
    expect(mergeSaves(current, incoming, { settings: true, activeRun: true }).settings.soundEnabled).toBe(
      false,
    );
  });
  it('keeps current active run unless the player explicitly imports it', () => {
    const current = createEmptySave(),
      incoming = createEmptySave(),
      round = dependencyRound();
    incoming.activeRun = {
      roundId: round.id,
      roundRevision: 1,
      gameState: replay(round, ['blue']),
      updatedAt: new Date().toISOString(),
    };
    expect(mergeSaves(current, incoming).activeRun).toBeNull();
    expect(mergeSaves(current, incoming, { settings: false, activeRun: true }).activeRun).toEqual(
      incoming.activeRun,
    );
  });
  it('keeps progress after rounds are added, reordered, temporarily removed or relocked', () => {
    const save = createEmptySave(),
      round = dependencyRound();
    save.roundProgressById[round.id] = progress();
    expect(isUnlocked({ ...round, order: 999, unlockAfter: ['round-new'] }, save)).toBe(true);
    const restored = parseBackup(exportBackup(save));
    expect(restored.roundProgressById[round.id]).toEqual(progress());
    expect(isUnlocked({ ...round, id: 'round-new', unlockAfter: [round.id] }, restored)).toBe(true);
  });
  it('migrates V1 in memory, rejects failed migrations and never mutates its input', () => {
    const data = createEmptySave(),
      { backupReminderDismissed: _, ...rest } = data;
    void _;
    const v1 = { ...rest, saveSchemaVersion: 1 };
    const before = JSON.stringify(v1);
    expect(migrateSave(v1)).toEqual(data);
    expect(JSON.stringify(v1)).toBe(before);
    expect(() => migrateSave({ ...v1, settings: {} })).toThrow();
    expect(() => migrateSave({ ...data, saveSchemaVersion: 999 })).toThrow('새로운');
  });
  it('rejects malformed JSON, oversized, version-mismatched and future backups', () => {
    expect(() => parseBackup('{')).toThrow('JSON');
    expect(() => parseBackup('a'.repeat(MAX_BACKUP_BYTES + 1))).toThrow('2 MiB');
    const envelope = JSON.parse(exportBackup(createEmptySave()));
    expect(() => parseBackup(JSON.stringify({ ...envelope, saveSchemaVersion: 999 }))).toThrow('새로운');
    expect(() => parseBackup(JSON.stringify({ ...envelope, saveSchemaVersion: 1 }))).toThrow('일치');
    expect(() => parseBackup(JSON.stringify({ ...envelope, format: 'other' }))).toThrow('백업 파일');
  });
  it('validates resumed snapshots by replay and keeps incompatible/unknown active runs for export', () => {
    const round = dependencyRound(),
      save = createEmptySave();
    save.roundProgressById[round.id] = progress();
    const run = {
      roundId: round.id,
      roundRevision: 1,
      gameState: replay(round, ['blue']),
      updatedAt: new Date().toISOString(),
    };
    expect(getResumeProblem(run, [{ ...round, revision: 2 }])).toMatch('업데이트');
    expect(getResumeProblem(run, [])).toMatch('없습니다');
    run.gameState.passengerIndex = 999;
    expect(getResumeProblem(run, [round])).not.toBeNull();
    expect(save.roundProgressById[round.id].cleared).toBe(true);
  });
});

describe('atomic IndexedDB repository', () => {
  it('finishes a reloaded tab’s queued moves without overwriting a newer save from another tab', async () => {
    const entries = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    });
    const name = crypto.randomUUID();
    const firstTab = repo(name);
    const initial = await firstTab.load();
    const firstMove = { ...initial, backupReminderDismissed: true };
    const nextMove = { ...firstMove, settings: { ...initial.settings, soundEnabled: false } };
    firstTab.stage(firstMove);
    firstTab.stage(nextMove);
    await firstTab.write(firstMove);
    firstTab.close();
    const nextPage = repo(name);
    expect(await nextPage.load()).toEqual(nextMove);
    expect(entries.size).toBe(0);

    const otherTab = repo(name);
    await otherTab.load();
    nextPage.stage(initial);
    await otherTab.write(firstMove);
    expect(await repo(name).load()).toEqual(firstMove);
    expect(entries.size).toBe(0);
  });

  it('commits clear records and activeRun cleanup in one save transaction', async () => {
    const name = crypto.randomUUID(),
      a = repo(name),
      data = await a.load();
    data.roundProgressById['round-001'] = progress();
    data.activeRun = null;
    await a.write(data);
    expect(await repo(name).load()).toEqual(data);
  });
  it('rejects stale writes from another tab without overwriting either latest record', async () => {
    const name = crypto.randomUUID(),
      a = repo(name),
      b = repo(name),
      first = await a.load(),
      stale = await b.load();
    first.roundProgressById['round-001'] = progress();
    await a.write(first);
    stale.settings.soundEnabled = false;
    await expect(b.write(stale)).rejects.toBeInstanceOf(SaveConflictError);
    expect(await repo(name).load()).toEqual(first);
  });
  it('preserves committed data when validation or transaction fails', async () => {
    const name = crypto.randomUUID(),
      a = repo(name),
      data = await a.load();
    await a.write(data);
    await expect(a.write({ ...data, saveSchemaVersion: 9 } as unknown as typeof data)).rejects.toThrow();
    a.close();
    await expect(a.write(data)).rejects.toThrow();
    expect(await repo(name).load()).toEqual(data);
  });
  it('protects a future schema from load, writes and explicit recovery', async () => {
    const name = crypto.randomUUID(),
      a = repo(name);
    await a.load();
    a.close();
    const db = await openDB(name, 1),
      future = { ...createEmptySave(), saveSchemaVersion: 999 };
    await db.put('state', { revision: 10, data: future }, 'save');
    db.close();
    const b = repo(name);
    await expect(b.load()).rejects.toThrow('새로운');
    await expect(b.write(createEmptySave())).rejects.toThrow('원본 보호');
    await expect(b.recover(createEmptySave())).rejects.toThrow('새로운 스키마');
    const check = await openDB(name, 1);
    expect((await check.get('state', 'save')).data).toEqual(future);
    check.close();
  });
  it.each([1, createEmptySave().saveSchemaVersion])(
    'archives invalid data of supported version %i before recovery',
    async (version) => {
      const name = crypto.randomUUID(),
        a = repo(name);
      await a.load();
      a.close();
      const db = await openDB(name, 1),
        broken = { saveSchemaVersion: version, settings: {} };
      await db.put('state', { revision: 1, data: broken }, 'save');
      db.close();
      const b = repo(name);
      await expect(b.load()).rejects.toThrow();
      expect(b.rawRecovery).toEqual(broken);
      await b.recover(createEmptySave());
      const check = await openDB(name, 1);
      expect((await check.getAllKeys('state')).some((key) => String(key).startsWith('recovery-'))).toBe(true);
      check.close();
      expect(await repo(name).load()).toEqual(createEmptySave());
    },
  );
});
