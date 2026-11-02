// Unit tests for the browser-recording persistence helper (IndexedDB itself is exercised only in a browser;
// these use the in-memory store with the same interface). Run: node --test scripts/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryStore,
  savePending,
  listPending,
  discardPending,
  discardPendingAndStale,
  uploadWithPersistence,
  shouldBlockUnload,
  newPendingId,
} from '../src/lib/pendingUpload.ts';

const blob = () => new Blob(['audio-bytes'], { type: 'audio/webm' });
const entry = (over = {}) => ({
  id: 'p1',
  title: 'Weekly sync',
  blob: blob(),
  fileName: 'recording-1.webm',
  contentType: 'audio/webm',
  fileSize: 11,
  createdAt: 1000,
  ...over,
});
const okDeps = (calls, over = {}) => ({
  create: async (req) => {
    calls.push(['create', req.title, req.file_name, req.file_size]);
    return { recordingId: 'rec-9', uploadInfo: { url: 'https://u', method: 'PUT', headers: {} } };
  },
  upload: async () => calls.push(['upload']),
  complete: async (id) => calls.push(['complete', id]),
  discardStale: async (id) => calls.push(['discardStale', id]),
  ...over,
});

test('the chosen summary language is passed to the create request, and omitted when not chosen', async () => {
  const seen = [];
  const deps = okDeps([], { create: async (req) => { seen.push(req); return { recordingId: 'r', uploadInfo: { url: 'u', method: 'PUT', headers: {} } }; } });
  await uploadWithPersistence(createMemoryStore(), entry({ outputLanguage: 'fr' }), deps);
  await uploadWithPersistence(createMemoryStore(), entry(), deps);
  assert.equal(seen[0].output_language, 'fr');
  assert.equal('output_language' in seen[1], false);
});

test('save then list returns newest first and keeps the blob', async () => {
  const store = createMemoryStore();
  await savePending(store, entry({ id: 'a', createdAt: 1 }));
  await savePending(store, entry({ id: 'b', createdAt: 2 }));
  const list = await listPending(store);
  assert.deepEqual(list.map((e) => e.id), ['b', 'a']);
  assert.equal(list[0].blob.size, 11);
});

test('saving again with the same id replaces the entry (title edits)', async () => {
  const store = createMemoryStore();
  await savePending(store, entry({ title: 'Old' }));
  await savePending(store, entry({ title: 'New' }));
  const list = await listPending(store);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'New');
});

test('the blob is stored BEFORE any network call and removed only after completeUpload succeeds', async () => {
  const store = createMemoryStore();
  const order = [];
  const deps = okDeps(order, {
    create: async () => {
      order.push(['create', (await listPending(store)).length]); // entry already persisted here
      return { recordingId: 'rec-9', uploadInfo: { url: 'u', method: 'PUT', headers: {} } };
    },
    complete: async () => {
      order.push(['complete', (await listPending(store)).length]); // still persisted during complete
    },
  });
  const res = await uploadWithPersistence(store, entry(), deps);
  assert.deepEqual(res, { recordingId: 'rec-9' });
  assert.deepEqual(order, [['create', 1], ['upload'], ['complete', 1]]);
  assert.equal((await listPending(store)).length, 0);
});

test('failure at create keeps the blob for a retry', async () => {
  const store = createMemoryStore();
  const calls = [];
  await assert.rejects(
    uploadWithPersistence(store, entry(), okDeps(calls, { create: async () => { throw new Error('offline'); } })),
    /offline/
  );
  const left = await listPending(store);
  assert.equal(left.length, 1);
  assert.equal(left[0].recordingId, undefined);
});

test('failure during the signed-URL upload keeps the blob and remembers the half-created recording id', async () => {
  const store = createMemoryStore();
  const calls = [];
  await assert.rejects(
    uploadWithPersistence(store, entry(), okDeps(calls, { upload: async () => { throw new Error('Upload failed'); } })),
    /Upload failed/
  );
  const left = await listPending(store);
  assert.equal(left.length, 1);
  assert.equal(left[0].recordingId, 'rec-9');
  assert.equal(left[0].blob.size, 11);
});

test('failure at completeUpload keeps the blob (the audio may not be processed yet)', async () => {
  const store = createMemoryStore();
  await assert.rejects(
    uploadWithPersistence(store, entry(), okDeps([], { complete: async () => { throw new Error('boom'); } })),
    /boom/
  );
  assert.equal((await listPending(store)).length, 1);
});

test('a retry creates a fresh recording and discards the stale half-created one afterwards', async () => {
  const store = createMemoryStore();
  const calls = [];
  await savePending(store, entry({ recordingId: 'stale-1' }));
  const res = await uploadWithPersistence(store, entry({ recordingId: 'stale-1' }), okDeps(calls));
  assert.equal(res.recordingId, 'rec-9');
  assert.deepEqual(calls.map((c) => c[0]), ['create', 'upload', 'complete', 'discardStale']);
  assert.deepEqual(calls.at(-1), ['discardStale', 'stale-1']);
  assert.equal((await listPending(store)).length, 0);
});

test('a failing stale-recording cleanup does not fail an otherwise successful upload', async () => {
  const store = createMemoryStore();
  const res = await uploadWithPersistence(store, entry({ recordingId: 'stale-1' }), okDeps([], { discardStale: async () => { throw new Error('404'); } }));
  assert.equal(res.recordingId, 'rec-9');
  assert.equal((await listPending(store)).length, 0);
});

test('a storage failure (quota, private mode) does not block the upload itself', async () => {
  const broken = { put: async () => { throw new Error('QuotaExceeded'); }, getAll: async () => [], delete: async () => {} };
  const calls = [];
  const res = await uploadWithPersistence(broken, entry(), okDeps(calls));
  assert.equal(res.recordingId, 'rec-9');
  assert.deepEqual(calls.map((c) => c[0]), ['create', 'upload', 'complete']);
});

test('discard removes one entry', async () => {
  const store = createMemoryStore();
  await savePending(store, entry({ id: 'a' }));
  await savePending(store, entry({ id: 'b' }));
  await discardPending(store, 'a');
  assert.deepEqual((await listPending(store)).map((e) => e.id), ['b']);
});

test('leaving the page is blocked while recording, paused, or uploading, not otherwise', () => {
  assert.equal(shouldBlockUnload({ isRecording: true, isPaused: false, isSubmitting: false }), true);
  assert.equal(shouldBlockUnload({ isRecording: true, isPaused: true, isSubmitting: false }), true);
  assert.equal(shouldBlockUnload({ isRecording: false, isPaused: false, isSubmitting: true }), true);
  assert.equal(shouldBlockUnload({ isRecording: false, isPaused: false, isSubmitting: false }), false);
});

test('ids are unique strings', () => {
  const a = newPendingId();
  const b = newPendingId();
  assert.equal(typeof a, 'string');
  assert.notEqual(a, b);
});

test('discarding an entry also removes the half-created recording row, and tolerates that cleanup failing', async () => {
  const store = createMemoryStore();
  await savePending(store, entry({ id: 'a', recordingId: 'rec-half' }));
  await savePending(store, entry({ id: 'b' }));
  const deleted = [];
  assert.equal(await discardPendingAndStale(store, { id: 'a', recordingId: 'rec-half' }, async (id) => deleted.push(id)), true);
  assert.deepEqual(deleted, ['rec-half']);
  assert.equal(await discardPendingAndStale(store, { id: 'b' }, async (id) => deleted.push(id)), false);
  assert.deepEqual(deleted, ['rec-half']); // nothing to delete for an entry that never reached the backend
  await savePending(store, entry({ id: 'c', recordingId: 'gone' }));
  assert.equal(await discardPendingAndStale(store, { id: 'c', recordingId: 'gone' }, async () => { throw new Error('404'); }), false);
  assert.equal((await listPending(store)).length, 0);
});
