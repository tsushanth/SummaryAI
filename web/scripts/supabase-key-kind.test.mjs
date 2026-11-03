import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The browser key baked into the bundle must be the new-style publishable key so the legacy anon/service_role
// JWTs can be disabled without breaking login. A legacy JWT starts with "eyJ".
const read = (f) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');

for (const file of ['fly.toml', 'deploy.sh', 'cloudbuild.yaml']) {
  test(`${file}: NEXT_PUBLIC_SUPABASE_ANON_KEY is an sb_publishable_ key`, () => {
    const m = read(file).match(/NEXT_PUBLIC_SUPABASE_ANON_KEY['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
    assert.ok(m, `no NEXT_PUBLIC_SUPABASE_ANON_KEY value in ${file}`);
    assert.match(m[1], /^sb_publishable_[A-Za-z0-9_-]+$/);
  });
}
