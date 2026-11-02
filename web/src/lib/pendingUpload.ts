/**
 * Keeps a finished browser recording in IndexedDB until the upload has fully succeeded, so a failed upload, a
 * closed tab or a reload does not lose the audio. The logic works against a small store interface so it can be
 * unit-tested with the in-memory store (scripts/pendingUpload.test.mjs); the browser uses `createIndexedDbStore`.
 *
 * No imports from the app: node loads this file directly in tests.
 */

export interface PendingUpload {
  id: string;
  title: string;
  blob: Blob;
  fileName: string;
  contentType: string;
  fileSize: number;
  /** ms since epoch */
  createdAt: number;
  /** Set once the backend created a recording row for this attempt (may be half-uploaded). */
  recordingId?: string;
}

export interface PendingUploadStore {
  put(entry: PendingUpload): Promise<void>;
  getAll(): Promise<PendingUpload[]>;
  delete(id: string): Promise<void>;
}

export function newPendingId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createMemoryStore(): PendingUploadStore {
  const map = new Map<string, PendingUpload>();
  return {
    async put(entry) {
      map.set(entry.id, entry);
    },
    async getAll() {
      return Array.from(map.values());
    },
    async delete(id) {
      map.delete(id);
    },
  };
}

const DB_NAME = 'meetingmind-pending-uploads';
const STORE = 'uploads';

/** Browser store. Rejects when IndexedDB is unavailable (private mode, old browser); callers treat that as best-effort. */
export function createIndexedDbStore(): PendingUploadStore {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
    });

  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      });
    } finally {
      db.close();
    }
  };

  return {
    async put(entry) {
      await run('readwrite', (s) => s.put(entry));
    },
    async getAll() {
      return run('readonly', (s) => s.getAll() as IDBRequest<PendingUpload[]>);
    },
    async delete(id) {
      await run('readwrite', (s) => s.delete(id));
    },
  };
}

export async function savePending(store: PendingUploadStore, entry: PendingUpload): Promise<void> {
  await store.put(entry);
}

/** Newest first. */
export async function listPending(store: PendingUploadStore): Promise<PendingUpload[]> {
  const all = await store.getAll();
  return [...all].sort((a, b) => b.createdAt - a.createdAt);
}

export async function discardPending(store: PendingUploadStore, id: string): Promise<void> {
  await store.delete(id);
}

/**
 * Discard a saved recording on purpose: drop the local copy, and best-effort remove the half-created recording row
 * an earlier failed attempt may have left in the list. Returns whether a stale row was removed.
 */
export async function discardPendingAndStale(
  store: PendingUploadStore,
  entry: Pick<PendingUpload, 'id' | 'recordingId'>,
  deleteStale: (recordingId: string) => Promise<unknown>
): Promise<boolean> {
  await store.delete(entry.id);
  if (!entry.recordingId) return false;
  try {
    await deleteStale(entry.recordingId);
    return true;
  } catch {
    return false;
  }
}

export interface UploadDeps {
  create(req: {
    title: string;
    file_name: string;
    content_type: string;
    file_size: number;
  }): Promise<{ recordingId: string; uploadInfo: { url: string; method: string; headers: Record<string, string> } }>;
  upload(
    uploadInfo: { url: string; method: string; headers: Record<string, string> },
    file: File | Blob,
    onProgress?: (percent: number) => void
  ): Promise<void>;
  complete(recordingId: string): Promise<unknown>;
  /** Best-effort removal of a recording row left behind by an earlier failed attempt. */
  discardStale?(recordingId: string): Promise<unknown>;
  onProgress?: (percent: number) => void;
}

/**
 * Create the recording, upload the audio and complete the upload, keeping the blob in `store` the whole time.
 * The entry is written before any network call and removed only after `complete` succeeds; any failure leaves it
 * for a retry and rethrows. Storage errors never block the upload itself.
 */
export async function uploadWithPersistence(
  store: PendingUploadStore,
  entry: PendingUpload,
  deps: UploadDeps
): Promise<{ recordingId: string }> {
  const staleId = entry.recordingId;
  await store.put(entry).catch(() => {});

  const created = await deps.create({
    title: entry.title,
    file_name: entry.fileName,
    content_type: entry.contentType,
    file_size: entry.fileSize,
  });
  // Remember the row we just created: if the upload fails, the next attempt cleans it up.
  await store.put({ ...entry, recordingId: created.recordingId }).catch(() => {});

  await deps.upload(created.uploadInfo, entry.blob, deps.onProgress);
  await deps.complete(created.recordingId);
  await store.delete(entry.id).catch(() => {});

  if (staleId && staleId !== created.recordingId && deps.discardStale) {
    try {
      await deps.discardStale(staleId);
    } catch {
      // Cleanup only; the new recording is already safe.
    }
  }
  return { recordingId: created.recordingId };
}

/** True while leaving the page would lose audio that is not yet safely stored. */
export function shouldBlockUnload(state: { isRecording: boolean; isPaused: boolean; isSubmitting: boolean }): boolean {
  return state.isRecording || state.isPaused || state.isSubmitting;
}
