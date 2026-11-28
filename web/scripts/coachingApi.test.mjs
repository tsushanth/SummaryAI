// The AI Coach client: server-sent events over fetch, and the shapes of backend/src/routes/coaching.ts. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCoachingApi, createSseParser, parseCoachingFrame, CoachingApiError } from '../src/lib/coaching/api.ts';

const frames = (chunks) => {
  const seen = [];
  const feed = createSseParser((f) => seen.push(f));
  chunks.forEach(feed);
  return seen;
};

test('frames survive any chunking, CRLF line ends, comments and multi-line data', () => {
  const wire = ': heartbeat\n\nevent: insight\ndata: {"a":\ndata: 1}\n\n: heartbeat\n\nevent: ended\r\ndata: {}\r\n\r\ndata: bare\n\n';
  const expected = [
    { event: 'insight', data: '{"a":\n1}' },
    { event: 'ended', data: '{}' },
    { event: 'message', data: 'bare' },
  ];
  assert.deepEqual(frames([wire]), expected);
  assert.deepEqual(frames([...wire]), expected);
});

test('a frame is not delivered before its closing blank line', () => {
  assert.deepEqual(frames(['event: insight\ndata: {}\n']), []);
});

test('only well-formed insight and ended frames become events', () => {
  assert.equal(parseCoachingFrame({ event: 'insight', data: '{broken' }), null);
  assert.equal(parseCoachingFrame({ event: 'insight', data: '{"text":"no id"}' }), null);
  assert.equal(parseCoachingFrame({ event: 'other', data: '{}' }), null);
  assert.deepEqual(parseCoachingFrame({ event: 'ended', data: '{"reason":"no_speech","refunded":true}' }), {
    type: 'ended', reason: 'no_speech', refunded: true,
  });
  assert.deepEqual(parseCoachingFrame({ event: 'ended', data: '{}' }), { type: 'ended', reason: null, refunded: false });
});

/** A throwaway backend; `handler` answers every request. */
async function withServer(handler, run) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ baseUrl, seen });
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const apiFor = (baseUrl, over = {}) => createCoachingApi({ baseUrl, getToken: async () => 'tok', ...over });

test('each call uses the backend paths and bodies, with the Authorization header', async () => {
  await withServer(
    (req, res) => {
      if (req.url.endsWith('/credits/claim-free')) return json(res, 200, { granted: true, balance: 2 });
      if (req.url.endsWith('/credits')) return json(res, 200, { balance: 2, by_source: { free: 2 } });
      if (req.url.endsWith('/sessions')) return json(res, 201, { session_id: 's1', persona: 'sales_discovery', resumed: false });
      if (req.url.endsWith('/end')) return json(res, 200, { ended: true, refunded: true });
      return json(res, 200, { session: null, insights: [] });
    },
    async ({ baseUrl, seen }) => {
      const api = apiFor(baseUrl);
      await api.claimFreeCredits();
      assert.equal(await api.getCredits(), 2);
      assert.deepEqual(await api.startSession('rec-1', 'sales_discovery'), { sessionId: 's1' });
      assert.deepEqual(await api.endSession('s1'), { refunded: true });
      assert.deepEqual(await api.latestSession('rec-1'), { session: null, insights: [] });
      assert.deepEqual(seen.map((r) => `${r.method} ${r.url}`), [
        'POST /api/coaching/credits/claim-free',
        'GET /api/coaching/credits',
        'POST /api/coaching/sessions',
        'POST /api/coaching/sessions/s1/end',
        'GET /api/coaching/recordings/rec-1/session',
      ]);
      assert.ok(seen.every((r) => r.headers.authorization === 'Bearer tok'));
      assert.deepEqual(JSON.parse(seen[2].body), { recording_id: 'rec-1', persona: 'sales_discovery' });
    }
  );
});

test('a refusal keeps its status and body; only a 5xx is reported, without ids', async () => {
  const reported = [];
  await withServer(
    (req, res) =>
      req.url.endsWith('/sessions')
        ? json(res, 409, { error: 'meeting_not_live', end_reason: 'bot_failed' })
        : json(res, 503, {}),
    async ({ baseUrl }) => {
      const api = apiFor(baseUrl, { onServerError: (path, status) => reported.push([path, status]) });
      await assert.rejects(api.startSession('r', 'p'), (e) => e.status === 409 && e.body.end_reason === 'bot_failed');
      assert.deepEqual(reported, []);
      await assert.rejects(api.endSession('11111111-2222-3333-4444-555555555555'), (e) => e.status === 503);
      assert.deepEqual(reported, [['/api/coaching/sessions/:id/end', 503]]);
    }
  );
});

test('without a token nothing is sent and the failure is not a refusal', async () => {
  await withServer(
    (req, res) => json(res, 200, { balance: 1 }),
    async ({ baseUrl, seen }) => {
      for (const getToken of [async () => null, async () => { throw new Error('offline'); }]) {
        const api = apiFor(baseUrl, { getToken });
        await assert.rejects(api.getCredits(), (e) => e instanceof CoachingApiError && e.status === 0);
        await assert.rejects(api.streamSession('s1', () => {}, new AbortController().signal), (e) => e.status === 0);
      }
      assert.equal(seen.length, 0);
    }
  );
});

test('an unreachable server, a request that hangs and a 200 that is not JSON are all status 0', async () => {
  await assert.rejects(apiFor('http://127.0.0.1:1').getCredits(), (e) => e.status === 0);
  await withServer(
    (req, res) => {
      if (req.url.endsWith('/credits')) return; // never answered
      res.writeHead(200);
      res.end('<html>');
    },
    async ({ baseUrl }) => {
      await assert.rejects(apiFor(baseUrl, { requestTimeoutMs: 50 }).getCredits(), (e) => e.status === 0);
      await assert.rejects(apiFor(baseUrl).latestSession('r'), (e) => e.status === 0);
    }
  );
});

test('the stream sends the Authorization header and delivers events, including text split inside a character', async () => {
  const tip = { id: 't1', session_id: 's1', type: 'question', text: 'Ask about Zürich — now', urgency: 'now', transcript_offset_seconds: 5, emitted_at: 'x' };
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const wire = Buffer.from(`: heartbeat\n\nevent: insight\ndata: ${JSON.stringify(tip)}\n\nevent: ended\ndata: {"reason":"meeting_ended","refunded":false}\n\n`);
      const cut = wire.indexOf(Buffer.from('ü')) + 1; // between the two bytes of "ü"
      res.write(wire.subarray(0, cut));
      setTimeout(() => res.end(wire.subarray(cut)), 20);
    },
    async ({ baseUrl, seen }) => {
      const events = [];
      await apiFor(baseUrl).streamSession('s1', (e) => events.push(e), new AbortController().signal);
      assert.equal(seen[0].url, '/api/coaching/sessions/s1/stream');
      assert.equal(seen[0].headers.authorization, 'Bearer tok');
      assert.deepEqual(events, [
        { type: 'connected' },
        { type: 'tip', insight: tip },
        { type: 'ended', reason: 'meeting_ended', refunded: false },
      ]);
    }
  );
});

test('a refused stream rejects with its status', async () => {
  await withServer(
    (req, res) => json(res, 400, { error: { code: 'BAD_REQUEST' } }),
    async ({ baseUrl }) => {
      await assert.rejects(apiFor(baseUrl).streamSession('s1', () => {}, new AbortController().signal), (e) => e.status === 400);
    }
  );
});

test('a stream that goes silent is given up on; heartbeats keep it open', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      let beats = 0;
      const timer = setInterval(() => (++beats > 8 ? clearInterval(timer) : res.write(': heartbeat\n\n')), 30);
      res.on('close', () => clearInterval(timer));
    },
    async ({ baseUrl }) => {
      const started = Date.now();
      await assert.rejects(
        apiFor(baseUrl, { idleTimeoutMs: 150 }).streamSession('s1', () => {}, new AbortController().signal),
        (e) => e.status === 0
      );
      assert.ok(Date.now() - started >= 350, 'heartbeats held the stream open past the idle limit');
    }
  );
});

test('aborting closes the connection', async () => {
  let closed;
  const serverSawClose = new Promise((r) => (closed = r));
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': heartbeat\n\n');
      res.on('close', closed);
    },
    async ({ baseUrl }) => {
      const abort = new AbortController();
      const reading = apiFor(baseUrl).streamSession('s1', (e) => e.type === 'connected' && setTimeout(() => abort.abort(), 10), abort.signal);
      await assert.rejects(reading);
      await serverSawClose;
    }
  );
});
