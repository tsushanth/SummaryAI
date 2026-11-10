import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));

import { makeWorld, answerOf, deferred, OWNER, GUEST } from './world.js';
import { INTRO_TEXT } from '../../src/services/voiceAssistant/tts.js';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

describe('speaks only when addressed', () => {
  it('stays silent for ordinary conversation, including a mid-sentence mention of the product', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Okay so the launch is on Friday and we need the deck ready.');
    await w.say(GUEST, 'I read that we should use Meeting Mind for the notes after this call.');
    await w.say(OWNER, 'What does Meeting Mind cost these days anyway?');
    await w.session.whenIdle();
    expect(w.plays).toHaveLength(0);
    expect(w.asked).toHaveLength(0);
    expect(w.types()).not.toContain('wake');
  });

  it('answers a question that opens with the wake phrase, with a cue first and the answer after', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    expect(w.asked).toEqual([{ question: 'what did we decide about the launch date?', allowHistory: true, speakerName: 'Alex Owner' }]);
    expect(w.spokenTexts()).toEqual(['Let me check.', 'You decided to ship on Friday.']);
    expect(w.types()).toEqual(expect.arrayContaining(['wake', 'question', 'cue', 'answered']));
  });

  it('accepts a greeting and speech-to-text variants of the wake phrase', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Hey meeting mined, summarize the discussion so far please');
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(1);
  });

  it('wake phrase alone waits for the same speaker\'s next utterance, and only theirs, within 12 seconds', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind');
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(0);
    await w.say(GUEST, 'what is the budget for this project');
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(0); // someone else talking is not the question
    await w.say(OWNER, 'what is the budget for this project');
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(1);
    // expired window
    const w2 = makeWorld();
    await w2.say(OWNER, 'Meeting Mind');
    w2.advance(13_000);
    await w2.say(OWNER, 'what is the budget for this project');
    await w2.session.whenIdle();
    expect(w2.asked).toHaveLength(0);
  });

  it('a stop word after the wake phrase is not a question', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind, never mind');
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(0);
    expect(w.plays).toHaveLength(0);
  });

  it('never speaks while off: the kill switch and mode off are honoured on the very next event', async () => {
    const w = makeWorld({ VOICE_ASSISTANT_KILL: '1' });
    await w.say(OWNER, 'Meeting Mind, what did we decide about pricing?');
    await w.session.whenIdle();
    expect(w.plays).toHaveLength(0);
    expect(w.asked).toHaveLength(0);
    const off = makeWorld({ VOICE_ASSISTANT_MODE: 'off' });
    await off.say(OWNER, 'Meeting Mind, what did we decide about pricing?');
    await off.session.whenIdle();
    expect(off.plays).toHaveLength(0);
  });

  it('kill switch flipped mid-meeting silences a bot that is speaking', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    expect(w.plays).toHaveLength(2);
    w.cfgEnv.VOICE_ASSISTANT_KILL = '1';
    await w.say(GUEST, 'anything at all');
    expect(w.stops).toHaveLength(1);
    await w.say(OWNER, 'Meeting Mind, and what about the budget?');
    await w.session.whenIdle();
    expect(w.plays).toHaveLength(2);
  });
});

describe('barge-in', () => {
  it('someone talking over the answer (3+ words) stops the audio at once', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    expect(w.session.isSpeaking).toBe(true);
    w.advance(500);
    await w.say(GUEST, 'sorry can I jump in here', true); // partial transcript: reacts before the sentence finishes
    expect(w.stops).toHaveLength(1);
    expect(w.session.isSpeaking).toBe(false);
    expect(w.events.find((e) => e.type === 'barge_in')?.detail).toBe('speaking');
  });

  it('the asker finishing their own long question (a second segment right after) does not cancel it; another person does', async () => {
    const gate = deferred<ReturnType<typeof answerOf>>();
    const w = makeWorld({}, { answer: () => gate.promise });
    await w.say(OWNER, 'Meeting Mind, what did we decide in the last two meetings');
    await new Promise((r) => setImmediate(r));
    w.advance(1000);
    await w.say(OWNER, 'about the pricing and the launch date');
    expect(w.stops).toHaveLength(0);
    expect(w.events.some((e) => e.type === 'barge_in')).toBe(false);
    w.advance(100);
    await w.say(GUEST, 'hold on I have something to add');
    expect(w.events.some((e) => e.type === 'barge_in')).toBe(true);
    gate.resolve(answerOf('late'));
    await w.session.whenIdle();
  });

  it('a stop word stops the audio, even a single word', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    await w.say(OWNER, 'stop');
    expect(w.stops).toHaveLength(1);
  });

  it('one or two background words do not stop it', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    await w.say(GUEST, 'mm hmm', true);
    expect(w.stops).toHaveLength(0);
  });

  it('a failing stop request is recorded as a play failure', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    w.failStop = true;
    await w.say(OWNER, 'stop talking');
    expect(w.events.some((e) => e.type === 'failed' && e.failure === 'play' && e.detail === 'stop')).toBe(true);
  });

  it('interrupting while it is still thinking drops the answer instead of speaking it', async () => {
    const gate = deferred<ReturnType<typeof answerOf>>();
    const w = makeWorld({}, { answer: () => gate.promise });
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await new Promise((r) => setImmediate(r));
    w.advance(2000); // the short cue has finished: only the thinking is going on
    await w.say(OWNER, 'never mind');
    gate.resolve(answerOf('You decided to ship on Friday.'));
    await w.session.whenIdle();
    expect(w.spokenTexts()).toEqual(['Let me check.']); // the cue only
    expect(w.types()).toContain('stale_dropped');
    expect(w.events.find((e) => e.type === 'barge_in')?.detail).toBe('thinking');
  });
});

describe('stale answers', () => {
  it('a new question while thinking supersedes the old one: only the newest is spoken', async () => {
    const first = deferred<ReturnType<typeof answerOf>>();
    let n = 0;
    const w = makeWorld({}, { answer: (input) => (++n === 1 ? first.promise : Promise.resolve(answerOf(`Answer to: ${input.question}`))) });
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await new Promise((r) => setImmediate(r));
    await w.say(OWNER, 'Meeting Mind, who owns the budget for this quarter?');
    await new Promise((r) => setTimeout(r, 10)); // the newer question is answered while the old one is still thinking
    expect(w.spokenTexts()).toContain('Answer to: who owns the budget for this quarter?');
    first.resolve(answerOf('OLD ANSWER'));
    await w.session.whenIdle();
    expect(w.spokenTexts()).not.toContain('OLD ANSWER');
    expect(w.spokenTexts()).toContain('Answer to: who owns the budget for this quarter?');
  });

  it('an answer that arrives after the stale window is dropped', async () => {
    const slow = deferred<ReturnType<typeof answerOf>>();
    const w = makeWorld({ VOICE_ASSISTANT_STALE_MS: '10000' }, { answer: () => slow.promise });
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await new Promise((r) => setImmediate(r));
    w.advance(11_000);
    slow.resolve(answerOf('Too late.'));
    await w.session.whenIdle();
    expect(w.spokenTexts()).toEqual(['Let me check.']);
    expect(w.events.find((e) => e.type === 'stale_dropped')?.detail).toBe('age');
  });
});

describe('echo guard: the bot never answers its own voice', () => {
  it('ignores the transcript of its own answer, even one that starts with the wake phrase', async () => {
    const w = makeWorld({}, { answer: async () => answerOf('Meeting Mind says the launch is on Friday and the budget is approved.') });
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    const spoken = w.spokenTexts()[1]!;
    expect(spoken.toLowerCase()).not.toContain('meeting mind'); // wake phrase is stripped from speech
    const before = w.plays.length;
    // Recall transcribes the bot's voice under some participant label, with small recognition differences.
    w.advance(4000);
    await w.say(GUEST, `Meeting Mind ${spoken.replace(/^I /, '')}`);
    await w.say({ name: 'Meeting Mind' }, spoken);
    await w.session.whenIdle();
    expect(w.plays).toHaveLength(before);
    expect(w.asked).toHaveLength(1);
    expect(w.events.filter((e) => e.type === 'echo_suppressed').length).toBeGreaterThanOrEqual(1);
  });

  it('ignores the echo of its intro, which contains the wake phrase', async () => {
    const w = makeWorld({}, { introPlayed: true });
    await w.say(GUEST, INTRO_TEXT.replace(/^Hi, this is /, ''));
    await w.say(GUEST, `Meeting Mind I'm recording this meeting to ask me something say Meeting Mind then your question`);
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(0);
    expect(w.plays).toHaveLength(0);
  });

  it('ignores the echo of the "Let me check" cue', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    await w.say(GUEST, 'Let me check.');
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(1);
    expect(w.events.some((e) => e.type === 'echo_suppressed')).toBe(true);
  });

  it('a person repeating the same question 60+ seconds later is still answered', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    w.advance(120_000);
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(2);
  });

  it('rapid-fire self-triggering shuts the assistant off for the meeting', async () => {
    const w = makeWorld();
    for (let i = 0; i < 4; i++) {
      await w.say(OWNER, `Meeting Mind, question number ${i} about something different entirely ${'x'.repeat(i)}`);
      await w.session.whenIdle();
      w.advance(1000);
    }
    expect(w.session.disabledReason).toBe('rapid_fire');
    const n = w.plays.length;
    await w.say(OWNER, 'Meeting Mind, are you still there with another long question');
    await w.session.whenIdle();
    expect(w.plays).toHaveLength(n);
  });
});

describe('caps', () => {
  it('per-meeting cap: stops answering and says so once', async () => {
    const w = makeWorld({ VOICE_ASSISTANT_MAX_QUESTIONS_PER_MEETING: '2' });
    for (let i = 0; i < 4; i++) {
      await w.say(OWNER, `Meeting Mind, tell me about topic ${['alpha', 'bravo', 'charlie', 'delta'][i]} in detail`);
      await w.session.whenIdle();
      w.advance(30_000);
    }
    expect(w.asked).toHaveLength(2);
    expect(w.spokenTexts().filter((t) => t.includes('question limit'))).toHaveLength(1);
    expect(w.events.filter((e) => e.type === 'cap_hit' && e.detail === 'meeting')).toHaveLength(2);
  });

  it('per-user daily cap counts across meetings (shared metrics) and stops the next meeting\'s question', async () => {
    const w = makeWorld({ VOICE_ASSISTANT_MAX_QUESTIONS_PER_USER_DAY: '2' });
    for (let i = 0; i < 3; i++) {
      await w.say(OWNER, `Meeting Mind, tell me about topic ${['alpha', 'bravo', 'charlie'][i]} in detail`);
      await w.session.whenIdle();
      w.advance(30_000);
    }
    expect(w.asked).toHaveLength(2);
    expect(w.events.some((e) => e.type === 'cap_hit' && e.detail === 'user_day')).toBe(true);
  });

  it('daily spend breaker: silent, no LLM call, alert raised', async () => {
    const w = makeWorld({ VOICE_ASSISTANT_DAILY_SPEND_CAP_USD: '0.002' });
    await w.say(OWNER, 'Meeting Mind, tell me about topic alpha in detail');
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(1);
    w.advance(30_000);
    await w.say(OWNER, 'Meeting Mind, tell me about topic bravo in detail');
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(1); // 0.0023 spent >= 0.002 cap: the second question never reaches the LLM
    expect(w.events.some((e) => e.type === 'cap_hit' && e.detail === 'spend')).toBe(true);
    expect(w.alerts.some(([, c]) => c === 'DAILY_SPEND_CAP_REACHED')).toBe(true);
    expect(w.spokenTexts().filter((t) => t.includes('limit'))).toHaveLength(0);
  });

  it('hard cap on the spoken answer length', async () => {
    const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is quite long.`).join(' ');
    const w = makeWorld({ VOICE_ASSISTANT_MAX_ANSWER_CHARS: '120' }, { answer: async () => answerOf(long) });
    await w.say(OWNER, 'Meeting Mind, summarize everything we discussed today');
    await w.session.whenIdle();
    expect(w.spokenTexts()[1]!.length).toBeLessThanOrEqual(120);
  });
});

describe('past meetings are for the account owner only', () => {
  it('a guest\'s question is answered without history; the owner\'s question gets history', async () => {
    const w = makeWorld();
    await w.say(GUEST, 'Meeting Mind, what did we talk about in last week\'s call?');
    await w.session.whenIdle();
    w.advance(30_000);
    await w.say(OWNER, 'Meeting Mind, what did we talk about in last week\'s call?');
    await w.session.whenIdle();
    expect(w.asked.map((a) => a.allowHistory)).toEqual([false, true]);
    expect(w.events.filter((e) => e.type === 'history_denied')).toHaveLength(1);
  });

  it('history policy off / owner_email', async () => {
    const off = makeWorld({ VOICE_ASSISTANT_HISTORY_POLICY: 'off' });
    await off.say(OWNER, 'Meeting Mind, what did we talk about last week?');
    await off.session.whenIdle();
    expect(off.asked[0]!.allowHistory).toBe(false);
    const emailOnly = makeWorld({ VOICE_ASSISTANT_HISTORY_POLICY: 'owner_email' });
    await emailOnly.say({ name: OWNER.name, email: null }, 'Meeting Mind, what did we talk about last week?');
    await emailOnly.session.whenIdle();
    expect(emailOnly.asked[0]!.allowHistory).toBe(false);
    emailOnly.advance(30_000);
    await emailOnly.say({ name: 'Someone', email: OWNER.email }, 'Meeting Mind, what did we talk about last week?');
    await emailOnly.session.whenIdle();
    expect(emailOnly.asked[1]!.allowHistory).toBe(true);
  });
});

describe('failures and metrics', () => {
  it('records time to first audio and answer time from the question being received', async () => {
    const w = makeWorld({}, { answer: async (input) => { w.advance(1500); return answerOf('Friday.'); } });
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    const a = w.events.find((e) => e.type === 'answered')!;
    expect(a.ttfaMs).toBe(0); // the cue was accepted in the same tick
    expect(a.answerMs).toBeGreaterThanOrEqual(1500);
    expect(a.llmUsd).toBeGreaterThan(0);
    expect(a.ttsUsd).toBeGreaterThan(0);
    expect(a.found).toBe(true);
  });

  it('counts "no answer found"', async () => {
    const w = makeWorld({}, { answer: async () => answerOf("I don't see that in your meetings.", { found: false }) });
    await w.say(OWNER, 'Meeting Mind, what did the investor say about equity?');
    await w.session.whenIdle();
    expect(w.metrics.today().noAnswer).toBe(1);
  });

  it('LLM failure after the cue: failure recorded and a short apology is spoken instead of silence', async () => {
    const w = makeWorld({}, { answer: async () => { throw new Error('boom'); } });
    await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await w.session.whenIdle();
    expect(w.metrics.today().failures.llm).toBe(1);
    expect(w.spokenTexts().at(-1)).toMatch(/Sorry/);
  });

  it('TTS failure and Recall playback failure are separate failure types', async () => {
    const tts = makeWorld();
    tts.synthFails = true;
    await tts.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    await tts.session.whenIdle();
    expect(tts.metrics.today().failures.tts).toBe(1);
    const play = makeWorld();
    await play.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
    play.failPlay = true; // cue already played; now the answer playback breaks. New question:
    play.advance(30_000);
    await play.say(OWNER, 'Meeting Mind, and what about the budget for it?');
    await play.session.whenIdle();
    expect(play.metrics.today().failures.play).toBeGreaterThanOrEqual(1);
  });

  it('a failure rate above the threshold raises one alert', async () => {
    const w = makeWorld({ VOICE_ASSISTANT_FAILURE_ALERT_MIN_ATTEMPTS: '3', VOICE_ASSISTANT_FAILURE_ALERT_RATE: '0.5', VOICE_ASSISTANT_MAX_QUESTIONS_PER_MEETING: '50' }, { answer: async () => { throw new Error('boom'); } });
    for (let i = 0; i < 3; i++) {
      await w.say(OWNER, `Meeting Mind, question ${i} about ${['alpha', 'bravo', 'charlie'][i]} please`);
      await w.session.whenIdle();
      w.advance(60_000);
    }
    expect(w.alerts.some(([f, c]) => f === 'voice_assistant' && c === 'FAILURE_RATE_HIGH')).toBe(true);
  });

  it('no transcript or answer text ever appears in an event', async () => {
    const w = makeWorld();
    await w.say(OWNER, 'Meeting Mind, what did we decide about the secretproject launch date?');
    await w.session.whenIdle();
    expect(JSON.stringify(w.events)).not.toMatch(/secretproject|ship on Friday|Alex|Gina/);
  });
});
