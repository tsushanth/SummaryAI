// The admin "Website visits" embed: URL validator and the rule that the capability URL stays server-side. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateGaugemintEmbedUrl as v } from '../src/lib/gaugemintEmbed.ts';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde'; // fake, 43 chars
assert.equal(TOKEN.length, 43);
const OK = `https://guagemint.com/embed/${TOKEN}`;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('a valid embed URL is accepted and returned normalised', () => {
  assert.equal(v(OK), OK);
  assert.equal(v(`  ${OK}\n`), OK, 'surrounding whitespace from a pasted secret is tolerated');
  assert.equal(v(`https://GUAGEMINT.com/embed/${TOKEN}`), OK, 'host case is normalised');
});

test('the host from GAUGEMINT_URL is also allowed, nothing else is', () => {
  const other = `https://stats.example.com/embed/${TOKEN}`;
  assert.equal(v(other), null);
  assert.equal(v(other, 'https://stats.example.com'), other);
  assert.equal(v(other, 'https://stats.example.com/'), other);
  assert.equal(v(OK, 'https://stats.example.com'), OK, 'the default host still works');
  assert.equal(v(other, 'http://stats.example.com'), null, 'an http GAUGEMINT_URL is not trusted');
  assert.equal(v(other, 'not a url'), null);
  assert.equal(v(other, ''), null);
});

test('wrong hosts are rejected', () => {
  for (const host of ['evil.com', 'guagemint.com.evil.com', 'evilguagemint.com', 'www.guagemint.com', 'gaugemint.com', 'guagemint.com.', 'localhost']) {
    assert.equal(v(`https://${host}/embed/${TOKEN}`), null, host);
  }
  assert.equal(v(`https://guagemint.com@evil.com/embed/${TOKEN}`), null);
  assert.equal(v(`https://evil.com\\@guagemint.com/embed/${TOKEN}`), null);
  assert.equal(v(`//guagemint.com/embed/${TOKEN}`), null);
});

test('only https is accepted', () => {
  for (const p of ['http', 'ftp', 'javascript', 'data']) assert.equal(v(`${p}://guagemint.com/embed/${TOKEN}`), null, p);
  assert.equal(v(`javascript:alert(1)//guagemint.com/embed/${TOKEN}`), null);
  assert.equal(v(`guagemint.com/embed/${TOKEN}`), null);
});

test('only /embed/<token> is accepted as the path', () => {
  for (const path of ['', '/', '/embed', '/embed/', '/share/' + TOKEN, '/app', `/embed/${TOKEN}/extra`, `/embed/${TOKEN}/`,
    `/x/embed/${TOKEN}`, '/embed/short', `/embed/${TOKEN}A`, `/embed/${TOKEN.slice(1)}`, `/embed/${TOKEN.slice(0, 40)}%2f..`,
    `/embed/${TOKEN.slice(0, 42)}!`, `/embed/${TOKEN.slice(0, 42)}.`]) {
    assert.equal(v(`https://guagemint.com${path}`), null, path);
  }
});

test('dot-segments are normalised away, never passed through', () => {
  assert.equal(v(`https://guagemint.com/embed/../embed/${TOKEN}`), OK);
  assert.equal(v(`https://guagemint.com/x/../../embed/${TOKEN}`), OK);
});

test('userinfo and ports are rejected', () => {
  assert.equal(v(`https://user@guagemint.com/embed/${TOKEN}`), null);
  assert.equal(v(`https://user:pw@guagemint.com/embed/${TOKEN}`), null);
  assert.equal(v(`https://:pw@guagemint.com/embed/${TOKEN}`), null);
  assert.equal(v(`https://guagemint.com:8443/embed/${TOKEN}`), null);
});

test('query: only theme=light|dark and period=<code> pass; anything else is rejected; the fragment is rejected', () => {
  assert.equal(v(`${OK}?theme=dark`), `${OK}?theme=dark`);
  assert.equal(v(`${OK}?theme=light&period=30d`), `${OK}?theme=light&period=30d`);
  assert.equal(v(`${OK}?`), OK);
  for (const q of ['?theme=pink', '?theme=', '?x=1', '?theme=dark&x=1', '?theme=dark&theme=light', '?period=', '?period=a/b', '?period=<script>', '?period=123456789',
    '?next=https://evil.com']) {
    assert.equal(v(OK + q), null, q);
  }
  assert.equal(v(`${OK}#x`), null);
  assert.equal(v(`${OK}?theme=dark#x`), null);
  assert.equal(v(`${OK}#`), null);
});

test('empty and non-string input is rejected', () => {
  for (const x of ['', '   ', '\n', undefined, null, 0, {}, []]) assert.equal(v(x), null, String(x));
  assert.equal(v('https://'), null);
  assert.equal(v('not a url'), null);
  assert.equal(v(OK + 'a'.repeat(600)), null);
});

test('the capability URL never reaches client JS: server-only env, no NEXT_PUBLIC_GAUGEMINT, no client component', () => {
  const page = read('../src/app/admin/page.tsx');
  const section = read('../src/components/AdminGaugemintEmbed.tsx');
  for (const [name, src] of [['page', page], ['section', section], ['validator', read('../src/lib/gaugemintEmbed.ts')]]) {
    assert.doesNotMatch(src, /NEXT_PUBLIC_GAUGEMINT/, `${name} must not use NEXT_PUBLIC_GAUGEMINT*`);
    assert.doesNotMatch(src, /^\s*['"]use client['"]/m, `${name} must be server-rendered`);
    assert.doesNotMatch(src, /console\.(log|info|warn|error|debug)/, `${name} must not log`);
  }
  assert.match(page, /process\.env\.GAUGEMINT_EMBED_URL/);
  assert.match(page, /AdminGaugemintEmbed/);
  // the embed must sit after the admin check
  assert.ok(page.indexOf('notFound()') < page.indexOf('process.env.GAUGEMINT_EMBED_URL'), 'env is read only after the isAdmin check');
  assert.ok(page.indexOf('isAdmin()') < page.indexOf('process.env.GAUGEMINT_EMBED_URL'));
  // the validated src is used, not the raw env value
  assert.doesNotMatch(section, /process\.env/);
  assert.match(section, /sandbox="allow-scripts allow-same-origin"/);
  assert.match(section, /referrerPolicy="no-referrer"/);
  assert.match(section, /loading="lazy"/);
});
