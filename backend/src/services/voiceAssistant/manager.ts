/**
 * Registry of live assistant sessions, one per Recall bot, plus the production wiring of each session's dependencies.
 *
 * The user a session acts for is read from `bot_runs` (server side) by the Recall bot id. Nothing in the webhook body (names,
 * emails, text) can change which user's data is used: it only decides whether the speaker looks like the account owner.
 *
 * State is in memory and the backend runs a single Fly machine (fly.toml, one app machine). After a restart a session is rebuilt
 * from the next event (live lines are re-seeded from live_transcripts); an answer in flight at that moment is simply lost.
 */
import { reportAlert } from '../../lib/alerts.js';
import { RecallService } from '../recallService.js';
import type { RecallTranscriptWebhookPayload } from '../../types/meetings.js';
import { createAnswerer, type AnswerFn } from './agent.js';
import { decideEnabled, type VoiceAssistantConfig } from './config.js';
import { supabaseVoiceData, type VoiceData } from './data.js';
import { getConfig, lookupBotRun, loadVoicePreference, loadOwnerIdentity, loadLiveSeed, phraseAudio, synth, voiceMetrics, type BotContext } from './runtime.js';
import type { VoiceMetrics } from './metrics.js';
import { VoiceSession, type SessionDeps } from './session.js';
import type { SpeechAudio, Synthesize } from './tts.js';
import { isOwnerSpeaker, type OwnerIdentity, type Speaker } from './wake.js';

export const BOT_NAME = 'Meeting Mind';
const IDLE_MS = 30 * 60_000;
const NEGATIVE_CACHE_MS = 5 * 60_000;


/** Everything the manager needs from the outside. Production implementations below; tests pass fakes. */
export interface ManagerDeps {
  getConfig: () => VoiceAssistantConfig;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  lookupBot: (recallBotId: string) => Promise<BotContext | null>;
  loadPreference: (userId: string) => Promise<boolean | undefined>;
  loadOwner: (userId: string) => Promise<OwnerIdentity>;
  loadSeed: (meetingId: string, userId: string) => Promise<Array<{ at: number; speaker: string; text: string }>>;
  dataFor: (userId: string) => VoiceData;
  answerer: AnswerFn;
  synth: Synthesize;
  phrase: (text: string) => Promise<SpeechAudio>;
  play: (recallBotId: string, b64: string) => Promise<void>;
  stop: (recallBotId: string) => Promise<void>;
  metrics: VoiceMetrics;
}

interface Entry { session: VoiceSession; ctx: BotContext; owner: OwnerIdentity; ownerName: string | null; preference: boolean | undefined }

export class VoiceAssistantManager {
  private sessions = new Map<string, Entry>();
  private creating = new Map<string, Promise<Entry | null>>();
  private negative = new Map<string, number>();
  private lastSweep = 0;

  constructor(private readonly d: ManagerDeps) {}

  get sessionCount(): number { return this.sessions.size; }
  session(recallBotId: string): VoiceSession | undefined { return this.sessions.get(recallBotId)?.session; }

  /** One Recall transcript.data / transcript.partial_data event. Returns quickly; answering runs in the background. */
  async handle(payload: RecallTranscriptWebhookPayload): Promise<{ handled: boolean; reason?: string }> {
    const cfg = this.d.getConfig();
    if (cfg.killed || cfg.mode === 'off') return { handled: false, reason: cfg.killed ? 'killed' : 'mode_off' };
    const botId = payload?.data?.bot?.id;
    const t = payload?.data?.data;
    if ((payload?.event !== 'transcript.data' && payload?.event !== 'transcript.partial_data') || !botId || !t) return { handled: false, reason: 'bad_event' };
    this.sweep();

    const entry = await this.entryFor(botId);
    if (!entry) return { handled: false, reason: 'not_enabled' };

    const text = (t.words ?? []).map((w) => w.text).join(' ');
    const speaker: Speaker = { name: t.participant?.name ?? null, email: t.participant?.email ?? null, isHost: !!t.participant?.is_host };
    await entry.session.onTranscript({ speaker, text, partial: payload.event === 'transcript.partial_data' });
    return { handled: true };
  }

  private async entryFor(botId: string): Promise<Entry | null> {
    const hit = this.sessions.get(botId);
    if (hit) return hit;
    const neg = this.negative.get(botId);
    if (neg && this.d.now() - neg < NEGATIVE_CACHE_MS) return null;
    let p = this.creating.get(botId);
    if (!p) {
      p = this.create(botId).finally(() => this.creating.delete(botId));
      this.creating.set(botId, p);
    }
    return p;
  }

  private async create(botId: string): Promise<Entry | null> {
    try {
      const ctx = await this.d.lookupBot(botId);
      if (!ctx) { this.negative.set(botId, this.d.now()); return null; }
      const preference = await this.d.loadPreference(ctx.userId);
      const decision = decideEnabled(this.d.getConfig(), ctx.userId, preference);
      if (!decision.enabled) { this.negative.set(botId, this.d.now()); return null; }

      const [owner, seed] = await Promise.all([this.d.loadOwner(ctx.userId), this.d.loadSeed(ctx.meetingId, ctx.userId)]);
      const data = this.d.dataFor(ctx.userId); // bound to the bot run's user, nothing else
      const ownerName = owner.names[0] ?? null;
      const entry: Entry = { ctx, owner, ownerName, preference, session: null as unknown as VoiceSession };
      const deps: SessionDeps = {
        userId: ctx.userId,
        meetingId: ctx.meetingId,
        botName: BOT_NAME,
        cfg: this.d.getConfig,
        now: this.d.now,
        sleep: this.d.sleep,
        enabled: () => decideEnabled(this.d.getConfig(), ctx.userId, preference).enabled,
        isOwner: (s) => isOwnerSpeaker(s, owner, false),
        isOwnerEmailMatch: (s) => isOwnerSpeaker(s, owner, true),
        answer: (input) => this.d.answerer({ ...input, ownerName, data }),
        synth: this.d.synth,
        phrase: this.d.phrase,
        play: (b64) => this.d.play(botId, b64),
        stop: () => this.d.stop(botId),
        metrics: this.d.metrics,
        introPlayed: this.d.getConfig().intro,
      };
      entry.session = new VoiceSession(deps);
      entry.session.seed(seed);
      this.sessions.set(botId, entry);
      return entry;
    } catch (err) {
      reportAlert('voice_assistant', 'SESSION_INIT_FAILED', { reason: String((err as Error)?.message ?? err).slice(0, 60) });
      this.negative.set(botId, this.d.now());
      return null;
    }
  }

  /** Drop sessions that have been idle for 30 minutes (the meeting is over). */
  sweep(): void {
    const now = this.d.now();
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [id, e] of this.sessions) if (now - e.session.lastEventAt > IDLE_MS) this.sessions.delete(id);
    for (const [id, at] of this.negative) if (now - at > NEGATIVE_CACHE_MS) this.negative.delete(id);
  }

  end(recallBotId: string): void { this.sessions.delete(recallBotId); this.negative.delete(recallBotId); }
}

let singleton: VoiceAssistantManager | null = null;
export function getVoiceAssistantManager(): VoiceAssistantManager {
  if (!singleton) {
    singleton = new VoiceAssistantManager({
      getConfig,
      now: Date.now,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      lookupBot: lookupBotRun,
      loadPreference: loadVoicePreference,
      loadOwner: loadOwnerIdentity,
      loadSeed: loadLiveSeed,
      dataFor: (userId) => supabaseVoiceData(userId),
      answerer: createAnswerer(getConfig),
      synth,
      phrase: phraseAudio,
      play: (botId, b64) => RecallService.outputAudio(botId, b64),
      stop: (botId) => RecallService.stopOutputAudio(botId),
      metrics: voiceMetrics,
    });
  }
  return singleton;
}
