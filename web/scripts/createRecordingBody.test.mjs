// The web app sent `file_size` while the backend requires `file_size_bytes` (zod: "Required"), so POST /api/recordings answered 400
// for every browser recording and upload. Found by the activation harness's synthetic first run on 2026-11-03.
// Run: node --test scripts/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toCreateRecordingBody } from '../src/lib/createRecordingBody.ts';

test('the request body carries file_size_bytes (the field the backend requires) and not file_size', () => {
  const body = toCreateRecordingBody({ title: 'Sync', file_name: 'a.webm', content_type: 'audio/webm', file_size: 12345 });
  assert.equal(body.file_size_bytes, 12345);
  assert.equal('file_size' in body, false);
  assert.equal(body.title, 'Sync');
  assert.equal(body.content_type, 'audio/webm');
});

test('optional fields pass through and undefined ones are omitted', () => {
  const body = toCreateRecordingBody({ title: 'T', file_name: 'a.m4a', content_type: 'audio/mp4', file_size: 9, output_language: 'es' });
  assert.equal(body.output_language, 'es');
  assert.equal('recording_type' in body, false);
});

test('contract: every required field of the backend create schema is produced', () => {
  const src = fs.readFileSync(new URL('../../backend/src/routes/recordings.ts', import.meta.url), 'utf8');
  const schema = src.slice(src.indexOf('const createRecordingSchema'), src.indexOf('const completeUploadSchema'));
  const required = [...schema.matchAll(/^\s{2}(\w+): z\.(?!.*(optional|default))/gm)].map((m) => m[1]);
  assert.ok(required.includes('file_size_bytes') && required.includes('title'), `parsed required fields: ${required}`);
  const body = toCreateRecordingBody({ title: 'T', file_name: 'a.webm', content_type: 'audio/webm', file_size: 1 });
  for (const f of required) assert.ok(f in body, `backend requires '${f}' but the web body has no such field`);
});

test('the create response is read from `upload` (what the backend returns), `upload_info` still accepted', async () => {
  const { normalizeCreateRecordingResponse } = await import('../src/lib/createRecordingBody.ts');
  const info = { url: 'https://x/y', method: 'PUT', headers: { 'Content-Type': 'audio/webm' } };
  assert.deepEqual(normalizeCreateRecordingResponse({ recording: { id: 'r1' }, upload: info }).upload_info, info);
  assert.deepEqual(normalizeCreateRecordingResponse({ recording: { id: 'r1' }, upload_info: info }).upload_info, info);
  assert.throws(() => normalizeCreateRecordingResponse({ recording: { id: 'r1' } }), /upload/i);
});

test('contract: the backend create handler answers with `upload`', () => {
  const src = fs.readFileSync(new URL('../../backend/src/routes/recordings.ts', import.meta.url), 'utf8');
  assert.match(src, /res\.status\(201\)\.json\(\{\s*recording,\s*upload:/);
});
