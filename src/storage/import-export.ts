import { z } from 'zod';
import { required } from '../required';
import { migrateSave, SAVE_VERSION, type SaveData } from './save-schema';

export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
export function exportBackup(data: SaveData, date = new Date()): string {
  return JSON.stringify(
    {
      format: 'bus-puzzle-save',
      saveSchemaVersion: SAVE_VERSION,
      exportedAt: date.toISOString(),
      data: data.saveSchemaVersion === SAVE_VERSION ? data : migrateSave(data),
    },
    null,
    2,
  );
}

export function parseBackup(text: string): SaveData {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES)
    throw new Error('백업 파일은 2 MiB 이하여야 합니다.');
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('올바른 JSON 파일이 아닙니다.');
  }
  const envelope = z
    .object({
      format: z.literal('bus-puzzle-save'),
      saveSchemaVersion: z.number().int(),
      exportedAt: z.string().datetime(),
      data: z.unknown(),
    })
    .strict()
    .safeParse(input);
  if (!envelope.success) throw new Error('Bus Puzzle 백업 파일이 아닙니다.');
  const { saveSchemaVersion, data } = envelope.data;
  if (saveSchemaVersion > SAVE_VERSION)
    throw new Error('더 새로운 앱에서 만든 백업입니다. 앱을 업데이트해 주세요.');
  if (
    !data ||
    typeof data !== 'object' ||
    !('saveSchemaVersion' in data) ||
    data.saveSchemaVersion !== saveSchemaVersion
  )
    throw new Error('백업의 스키마 버전이 일치하지 않습니다.');
  return migrateSave(data);
}

function checkBackupSize(bytes: number) {
  if (bytes > MAX_BACKUP_BYTES) throw new RangeError('백업 파일은 압축 전후 모두 2 MiB 이하여야 합니다.');
}

type ZstdCodec = typeof import('@bokuweb/zstd-wasm');
let codecReady: Promise<ZstdCodec> | undefined;

function loadZstd() {
  codecReady ??= import('@bokuweb/zstd-wasm')
    .then(async (codec) => {
      await codec.init();
      return codec;
    })
    .catch((error) => {
      codecReady = undefined;
      throw error;
    });
  return codecReady;
}

async function compressBackup(source: Uint8Array): Promise<Blob> {
  const codec = await loadZstd();
  const compressed = Uint8Array.from(codec.compress(source, 3));
  return new Blob([compressed], { type: 'application/octet-stream' });
}

export async function createBackupBlob(data: SaveData, date = new Date()): Promise<Blob> {
  const source = new TextEncoder().encode(exportBackup(data, date));
  checkBackupSize(source.byteLength);
  const blob = await compressBackup(source);
  checkBackupSize(blob.size);
  return blob;
}

function checkZstdFrame(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6 || view.getUint32(0) !== 0x28b52ffd || (bytes[4] & 0x08) !== 0)
    throw new Error('잘못된 Zstandard 프레임입니다.');
  // RFC 8878 §3.1.1.4. The codec allocates its output buffer using this field.
  // Frames without a content size use the explicit destination limit passed below.
  const descriptor = bytes[4];
  const singleSegment = (descriptor & 0x20) !== 0;
  const sizeBytes = [singleSegment ? 1 : 0, 2, 4, 8][descriptor >>> 6];
  const dictionaryBytes = [0, 1, 2, 4][descriptor & 3];
  const offset = 5 + (singleSegment ? 0 : 1) + dictionaryBytes;
  if (bytes.length < offset + sizeBytes + 3) throw new Error('불완전한 Zstandard 프레임입니다.');
  let declaredSize = 0;
  for (let i = sizeBytes - 1; i >= 0; i--) declaredSize = declaredSize * 256 + bytes[offset + i];
  checkBackupSize(declaredSize + (sizeBytes === 2 ? 256 : 0));
}

async function decodeBackupText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      checkBackupSize(bytes);
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function decompressLegacyGzip(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8)
    throw new Error('Gzip 헤더가 올바르지 않습니다.');
  const advertisedSize = new DataView(bytes.buffer).getUint32(bytes.length - 4, true);
  checkBackupSize(advertisedSize);
  // A corrupt trailer can underreport the size. Feeding small chunks also bounds
  // the output a decompressor can allocate before the real byte-count check runs.
  let offset = 0;
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      const part = bytes.subarray(offset, offset + 2048);
      controller.enqueue(part);
      offset += part.byteLength;
      if (offset === bytes.length) controller.close();
    },
  });
  return source.pipeThrough(new DecompressionStream('gzip'));
}

export async function readBackupFile(file: File): Promise<SaveData> {
  checkBackupSize(file.size);
  const compressed = /\.bpz$/i.test(file.name);
  if (!compressed && !/\.json$/i.test(file.name)) throw new Error('BPZ 또는 JSON 백업 파일을 선택해 주세요.');
  let text: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (compressed && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      text = await decodeBackupText(decompressLegacyGzip(bytes));
    } else {
      if (compressed) checkZstdFrame(bytes);
      const raw = compressed
        ? (await loadZstd()).decompress(bytes, { defaultHeapSize: MAX_BACKUP_BYTES })
        : bytes;
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    }
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw new Error(compressed ? 'BPZ 백업 파일이 손상되었습니다.' : '올바른 UTF-8 JSON 파일이 아닙니다.');
  }
  return parseBackup(text);
}

export function mergeSaves(
  current: SaveData,
  incoming: SaveData,
  options = { settings: false, activeRun: false },
): SaveData {
  const merged = structuredClone(current);
  for (const [id, record] of Object.entries(incoming.roundProgressById)) {
    const existing = merged.roundProgressById[id];
    merged.roundProgressById[id] = existing
      ? {
          cleared: existing.cleared || record.cleared,
          firstClearedAt: [existing.firstClearedAt, record.firstClearedAt].sort()[0],
          lastClearedAt: required([existing.lastClearedAt, record.lastClearedAt].sort().at(-1)),
          clearCount: Math.max(existing.clearCount, record.clearCount),
          clearedRevision: Math.max(existing.clearedRevision, record.clearedRevision),
        }
      : structuredClone(record);
  }
  if (options.settings) merged.settings = structuredClone(incoming.settings);
  if (options.activeRun) {
    merged.activeRun = structuredClone(incoming.activeRun);
    merged.depotRun = structuredClone(incoming.depotRun);
    merged.promenadeRun = structuredClone(incoming.promenadeRun);
  }
  return merged;
}

export function importPreview(current: SaveData, incoming: SaveData) {
  const ids = Object.keys(incoming.roundProgressById);
  return {
    cleared: ids.filter((id) => incoming.roundProgressById[id].cleared).length,
    added: ids.filter((id) => !current.roundProgressById[id]).length,
    conflicts: ids.filter(
      (id) =>
        current.roundProgressById[id] &&
        JSON.stringify(current.roundProgressById[id]) !== JSON.stringify(incoming.roundProgressById[id]),
    ).length,
  };
}

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadBackup(data: SaveData) {
  const date = new Date();
  const blob = await createBackupBlob(data, date);
  downloadFile(blob, `bus-puzzle-save-${date.toISOString().slice(0, 10)}.bpz`);
}

export async function downloadRecoveryBackup(raw: unknown) {
  const original = new TextEncoder().encode(JSON.stringify(raw, null, 2));
  const blob = await compressBackup(original);
  downloadFile(blob, `bus-puzzle-recovery-${new Date().toISOString().slice(0, 10)}.bpz`);
}
