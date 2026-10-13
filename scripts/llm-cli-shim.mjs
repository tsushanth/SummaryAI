// Local test shim (see scripts/LOCAL_AI_TESTING.md): speaks the Anthropic Messages API and answers by running the logged-in `claude` CLI
// (subscription, no API key). Tools disabled, empty cwd, no session persistence. Test use only.
import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';

import os from 'os';
import path from 'path';
// Empty scratch directory so the CLI has nothing to read or write.
const CWD = path.join(os.tmpdir(), 'mm-llm-cli-shim-cwd');
fs.mkdirSync(CWD, { recursive: true });
let calls = 0;

function text(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
  return '';
}

function runClaude(system, prompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_BASE_URL; // never route the CLI back into the shim
    const args = ['-p', '--tools', '', '--no-session-persistence', '--output-format', 'text'];
    if (system) args.push('--system-prompt', system);
    const p = spawn('claude', args, { cwd: CWD, env });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`claude exit ${code}: ${err.slice(0, 200)}`))));
    p.stdin.end(prompt);
  });
}

http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404); return res.end('{}'); }
  let body = '';
  for await (const ch of req) body += ch;
  try {
    const j = JSON.parse(body);
    const system = Array.isArray(j.system) ? j.system.map((s) => s.text || '').join('\n') : j.system || '';
    const turns = (j.messages || []).map((m) => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${text(m.content)}`);
    const prompt = turns.length === 1 ? text(j.messages[0].content) : turns.join('\n\n') + '\n\nAssistant:';
    calls++;
    const t0 = Date.now();
    const out = await runClaude(system, prompt);
    console.log(`[shim] call ${calls} ok in ${Date.now() - t0}ms, prompt ${prompt.length} chars -> ${out.length} chars`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_shim_' + calls, type: 'message', role: 'assistant', model: j.model,
      content: [{ type: 'text', text: out }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: Math.ceil(prompt.length / 4), output_tokens: Math.ceil(out.length / 4) },
    }));
  } catch (e) {
    console.log('[shim] error', String(e).slice(0, 200));
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: String(e).slice(0, 200) } }));
  }
}).listen(9099, '127.0.0.1', () => console.log('[shim] listening on 9099'));
