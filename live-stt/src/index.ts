import { consoleAlert, makeWebhookAlert, type AlertHook } from './alerts.js';
import { loadConfig } from './config.js';
import { IngestServer } from './server.js';
import { HttpSink } from './sink/httpSink.js';
import { SupabaseSink } from './sink/supabaseSink.js';
import type { LiveSegment, SegmentSink } from './sink/types.js';
import { SonioxEngine } from './stt/soniox.js';

// Logs carry ids and counts only: never transcript text, tokens, keys or URLs with tokens.
const log = (msg: string, ctx: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...ctx }));

function main(): void {
  const cfg = loadConfig();
  const alert: AlertHook = cfg.alertWebhookUrl ? makeWebhookAlert({ url: cfg.alertWebhookUrl }) : consoleAlert;
  const logSink: SegmentSink = { name: 'log', write: async (b: LiveSegment[]) => { log('segments', { n: b.length }); } };
  const sink: SegmentSink =
    cfg.sink === 'http' ? new HttpSink({ url: cfg.backendSinkUrl!, secret: cfg.backendSinkSecret! })
    : cfg.sink === 'supabase' ? new SupabaseSink({ url: cfg.supabaseUrl!, serviceKey: cfg.supabaseServiceKey! })
    : logSink;
  const server = new IngestServer({
    ingestSecrets: cfg.ingestSecrets,
    controlSecrets: cfg.controlSecrets,
    engine: new SonioxEngine({ apiKey: cfg.sonioxApiKey, model: cfg.sonioxModel, url: cfg.sonioxUrl, authMode: cfg.sonioxAuthMode, endpointDetection: cfg.sonioxEndpointDetection, endpointMaxDelayMs: cfg.sonioxEndpointMaxDelayMs }),
    // fallbackEngine: new ElevenLabsEngine(...)  (interface only in this skeleton; see stt/elevenlabs.ts)
    sink,
    session: cfg.session,
    maxStreams: cfg.maxStreams,
    maxSessions: cfg.maxSessions,
    adminToken: cfg.adminToken,
    alert,
    log,
    trustFlyProxy: cfg.trustFlyProxy,
    recallGraceMs: cfg.recallGraceMs,
  });
  process.on('unhandledRejection', (e) => { server.noteUnhandled(); log('unhandledRejection', { err: (e as Error)?.name ?? 'unknown' }); });
  process.on('uncaughtException', (e) => { log('uncaughtException', { err: e.name }); });
  void server.listen(cfg.port).then((p) => log('listening', { port: p, sink: sink.name, maxStreams: cfg.maxStreams }));
  const shutdown = (sig: string) => { log('shutdown', { sig }); void server.stop().finally(() => process.exit(0)); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
