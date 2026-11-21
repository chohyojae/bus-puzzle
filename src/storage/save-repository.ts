import { type IDBPDatabase, openDB } from 'idb';
import { createEmptySave, migrateSave, SAVE_VERSION, type SaveData } from './save-schema';

interface Stored {
  revision: number;
  data: unknown;
  writer?: string;
}

interface PendingSave {
  writer: string;
  revision: number;
  data: SaveData;
}

export class SaveConflictError extends Error {
  constructor() {
    super('다른 창에서 저장 데이터가 변경되었습니다. 현재 창의 기록을 내보낸 후 새로고침해 주세요.');
  }
}

export class SaveRepository {
  private db: IDBPDatabase | undefined;
  private revision = 0;
  private channel: BroadcastChannel | undefined;
  private writeLock?: 'conflict' | 'recovery';
  private readonly writer = crypto.getRandomValues(new Uint32Array(4)).join('-');
  private staged: { data: SaveData; encoded: string } | undefined;
  rawRecovery: unknown;
  onExternalChange: (() => void) | undefined;

  constructor(private readonly dbName = 'bus-puzzle') {}

  // A reload can cancel an IndexedDB request that was already acknowledged on screen.
  // Keep its latest snapshot in this tab until the matching transaction commits.
  stage(data: SaveData) {
    if (!this.db || this.writeLock) return;
    try {
      const encoded = JSON.stringify({ writer: this.writer, revision: this.revision, data });
      sessionStorage.setItem(`${this.dbName}:pending`, encoded);
      this.staged = { data, encoded };
    } catch {
      // IndexedDB still works when the session store is disabled or full.
    }
  }

  private readPending(): { save: PendingSave; encoded: string } | undefined {
    try {
      const encoded = sessionStorage.getItem(`${this.dbName}:pending`);
      if (!encoded) return;
      const save = JSON.parse(encoded);
      if (typeof save.writer !== 'string' || !Number.isSafeInteger(save.revision) || save.revision < 0)
        return;
      return { encoded, save: { ...save, data: migrateSave(save.data) } };
    } catch {
      return;
    }
  }

  private clearPending(encoded: string) {
    try {
      const key = `${this.dbName}:pending`;
      if (sessionStorage.getItem(key) === encoded) sessionStorage.removeItem(key);
    } catch {
      // A restricted session store does not change the committed IndexedDB record.
    }
  }

  async load(reducedMotion = false): Promise<SaveData> {
    this.db = await openDB(this.dbName, 1, {
      upgrade(db) {
        db.createObjectStore('state');
      },
      blocking: () => {
        this.db?.close();
        this.writeLock = 'conflict';
        this.onExternalChange?.();
      },
    });
    const pending = this.readPending();
    const tx = this.db.transaction('state', pending ? 'readwrite' : 'readonly');
    const stored = (await tx.store.get('save')) as Stored | undefined;
    this.revision = stored?.revision ?? 0;
    if (typeof BroadcastChannel !== 'undefined' && !this.channel) {
      this.channel = new BroadcastChannel(`${this.dbName}-updates`);
      this.channel.onmessage = () => {
        this.writeLock = 'conflict';
        this.onExternalChange?.();
      };
    }
    this.rawRecovery = stored?.data;
    try {
      let data = stored ? migrateSave(stored.data) : createEmptySave(reducedMotion);
      // A different tab may have committed while this one was closing. Only finish
      // this tab's own queue or a write based on the exact revision we just read.
      if (
        pending &&
        tx.store.put &&
        (pending.save.revision === this.revision || stored?.writer === pending.save.writer)
      ) {
        if (JSON.stringify(data) !== JSON.stringify(pending.save.data)) {
          data = pending.save.data;
          this.revision++;
          await tx.store.put({ revision: this.revision, data, writer: this.writer }, 'save');
          await tx.done;
          this.channel?.postMessage({ revision: this.revision });
        }
      }
      if (pending) this.clearPending(pending.encoded);
      return data;
    } catch (error) {
      this.writeLock = 'recovery';
      throw error;
    }
  }

  async write(data: SaveData): Promise<void> {
    if (this.writeLock === 'conflict') throw new SaveConflictError();
    if (this.writeLock === 'recovery')
      throw new Error('원본 보호를 위해 저장이 중단되었습니다. 원본 백업 후 복구해 주세요.');
    if (!this.db) throw new Error('브라우저 저장소를 사용할 수 없습니다. 현재 기록을 백업해 주세요.');
    const parsed = migrateSave(data);
    const tx = this.db.transaction('state', 'readwrite');
    const stored = (await tx.store.get('save')) as Stored | undefined;
    if ((stored?.revision ?? 0) !== this.revision) {
      this.writeLock = 'conflict';
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new SaveConflictError();
    }
    await tx.store.put({ revision: this.revision + 1, data: parsed, writer: this.writer }, 'save');
    await tx.done;
    this.revision++;
    if (this.staged?.data === data) {
      this.clearPending(this.staged.encoded);
      this.staged = undefined;
    }
    this.channel?.postMessage({ revision: this.revision });
  }

  // User-confirmed recovery retains the original bytes in a separate IndexedDB record.
  async recover(data: SaveData): Promise<void> {
    if (!this.db) throw new Error('저장소가 열리지 않았습니다. 브라우저 저장소 권한을 확인해 주세요.');
    const parsed = migrateSave(data);
    const tx = this.db.transaction('state', 'readwrite');
    const stored = (await tx.store.get('save')) as Stored | undefined;
    const rawVersion =
      stored?.data && typeof stored.data === 'object' && 'saveSchemaVersion' in stored.data
        ? stored.data.saveSchemaVersion
        : 0;
    if (typeof rawVersion === 'number' && rawVersion > SAVE_VERSION) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new Error('더 새로운 스키마는 이 앱에서 교체할 수 없습니다. 앱을 업데이트해 주세요.');
    }
    if (stored) await tx.store.put(stored, `recovery-${Date.now()}`);
    const revision = (stored?.revision ?? 0) + 1;
    await tx.store.put({ revision, data: parsed, writer: this.writer }, 'save');
    await tx.done;
    this.revision = revision;
    this.writeLock = undefined;
    const pending = this.readPending();
    if (pending) this.clearPending(pending.encoded);
    this.staged = undefined;
    this.channel?.postMessage({ revision });
  }

  close() {
    this.channel?.close();
    this.db?.close();
  }
}
