/**
 * Accuracy + latency eval for the in-meeting voice assistant's answering step.
 *
 * Runs the PRODUCTION answerer (src/services/voiceAssistant/agent.ts, same prompt, same tools, same model setting) against an
 * in-memory snapshot of one user's meetings instead of Supabase, so retrieval quality and think time can be measured without a
 * database or a live meeting. The Supabase data layer (data.ts) is covered separately by test/voiceAssistant/isolation.test.ts.
 *
 * Nothing about a snapshot or the questions is committed: both are local files whose paths are passed in. Real meetings are private,
 * and this repo is public. The detailed per-question results (which contain answers) go to --out, never to stdout.
 *
 *   ANTHROPIC_API_KEY=... [DEEPGRAM_API_KEY=... for --tts] \
 *   SUPABASE_URL=https://x.supabase.co SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x \
 *   npx tsx scripts/voiceAssistantEval.mts --snapshot <meetings.json> --questions <questions.json> \
 *        [--demo <meetings.demo.json>] [--cap 2] [--out <results.json>] [--tts] [--model <id>]
 *
 * snapshot/demo: { meetings: [{ id, title, date, minutes, summary, detailedSummary, keyPoints, actionItems, topics, transcript }] }
 * questions:     [{ id, q, expect, kind: 'answerable'|'negative', src: [<index in snapshot, as mNN>], followupOf? }]
 * --demo restricts the "user's meetings" to the demo file and keeps only the questions whose source meetings are in it (plus all
 * negative questions), which is the scenario of a user with a small history.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { VoiceData } from '../src/services/voiceAssistant/data.js';

// The backend sources are CommonJS under tsx; load them with dynamic imports and unwrap `default` when present.
const load = async (p: string): Promise<any> => { const m: any = await import(p); return m.createAnswerer || m.loadVoiceAssistantConfig || m.searchWindows || m.createSynthesizer ? m : m.default; };
const { createAnswerer } = await load('../src/services/voiceAssistant/agent.js');
const { loadVoiceAssistantConfig } = await load('../src/services/voiceAssistant/config.js');
const { searchWindows } = await load('../src/services/voiceAssistant/data.js');
const { createSynthesizer } = await load('../src/services/voiceAssistant/tts.js');

const argv = process.argv.slice(2);
const opt = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const snapshotPath = opt('snapshot');
const questionsPath = opt('questions');
if (!snapshotPath || !questionsPath) { console.error('need --snapshot and --questions'); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error('set ANTHROPIC_API_KEY'); process.exit(1); }
const CAP = Number(opt('cap') ?? '2');
if (opt('model')) process.env.VOICE_ASSISTANT_MODEL = opt('model');
const WITH_TTS = argv.includes('--tts');

interface Meeting { id?: string; title: string; date: string; minutes: number; summary?: string; detailedSummary?: string; keyPoints?: unknown; actionItems?: unknown; topics?: unknown; transcript: string }
interface Question { id: string; q: string; expect: string; kind: 'answerable' | 'negative'; src?: string[]; followupOf?: string }

const full: Meeting[] = JSON.parse(readFileSync(snapshotPath, 'utf8')).meetings;
const protoKey = (i: number) => `m${String(i + 1).padStart(2, '0')}`; // the prototype's keys, used by questions.json `src`
const demo: Meeting[] | null = opt('demo') ? JSON.parse(readFileSync(opt('demo')!, 'utf8')).meetings : null;
const pool = demo ?? full;
const oneLine = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Production-style keys: most recent first.
const ordered = [...pool].sort((a, b) => (a.date < b.date ? 1 : -1));
const keyOf = new Map(ordered.map((m, i) => [m, `m${String(i + 1).padStart(2, '0')}`]));
const data: VoiceData = {
  index: async () => ordered.map((m) => ({ key: keyOf.get(m)!, date: m.date.slice(0, 10), minutes: m.minutes, title: oneLine(m.title, 80), summaryStart: oneLine(m.summary, 150) })),
  search: async (query, limit = 6) => searchWindows(ordered.map((m) => ({ key: keyOf.get(m)!, date: m.date.slice(0, 10), title: m.title, text: m.transcript })), query, limit),
  list: async ({ from, to, query, minMinutes }) => ordered
    .filter((m) => (!from || m.date.slice(0, 10) >= from) && (!to || m.date.slice(0, 10) <= to) && (!minMinutes || m.minutes >= minMinutes) && (!query || `${m.title} ${m.summary} ${m.transcript}`.toLowerCase().includes(query.toLowerCase())))
    .map((m) => ({ meeting: keyOf.get(m)!, date: m.date.slice(0, 10), minutes: m.minutes, title: m.title, summary: oneLine(m.summary, 200) })),
  get: async (key, { section = 'summary', offset = 0 } = {}) => {
    const m = ordered.find((x) => keyOf.get(x) === key);
    if (!m) return { error: `no meeting ${key}` };
    if (section === 'transcript') { const off = Math.max(0, offset); return { meeting: key, date: m.date.slice(0, 10), title: m.title, offset: off, text: m.transcript.slice(off, off + 6000), nextOffset: off + 6000 < m.transcript.length ? off + 6000 : null, totalChars: m.transcript.length }; }
    return { meeting: key, date: m.date.slice(0, 10), title: m.title, minutes: m.minutes, summary: m.summary, detailedSummary: m.detailedSummary, keyPoints: m.keyPoints, actionItems: m.actionItems, topics: m.topics };
  },
};

let questions: Question[] = JSON.parse(readFileSync(questionsPath, 'utf8'));
if (demo) {
  const demoIds = new Set(demo.map((m) => m.id).filter(Boolean));
  const inDemo = (k: string) => { const i = Number(k.slice(1)) - 1; const id = full[i]?.id; return !!id && demoIds.has(id); };
  questions = questions.filter((q) => q.kind === 'negative' || (q.src ?? []).every(inDemo));
}

const cfg = () => loadVoiceAssistantConfig(process.env);
const answer = createAnswerer(cfg);
const synth = WITH_TTS ? createSynthesizer(cfg) : null;
const JUDGE = 'claude-haiku-4-5-20251001';
let spent = 0;

async function judge(q: Question, text: string): Promise<{ covers_key_facts: boolean; invents_or_contradicts: boolean; declines_properly: boolean } | null> {
  const evidence = (q.src ?? []).map((k) => { const m = full[Number(k.slice(1)) - 1]; return m ? `--- MEETING ${k} (${m.date.slice(0, 10)}, "${m.title}") ---\nSUMMARY: ${m.summary}\nTRANSCRIPT: ${m.transcript.slice(0, 60000)}` : ''; }).join('\n') || '(no source meetings: nothing in the data supports specifics for this question)';
  const sys = `You grade a spoken answer from a meeting-history assistant. You get the QUESTION, the EXPECTED key facts (written from a summary; they may be incomplete), the ANSWER, and EVIDENCE (the source meeting text). Reply with ONE JSON object: {"covers_key_facts": true|false, "invents_or_contradicts": true|false, "declines_properly": true|false}.
covers_key_facts: the answer contains the key facts in EXPECTED (paraphrase is fine; for lists, all or nearly all items; extra detail is fine). invents_or_contradicts: the answer states something contradicted by or absent from EVIDENCE (a detail that IS supported by the evidence is NOT an invention; for NOT IN DATA questions, any claimed decision or statement the evidence does not support counts; misattributing who said something counts). declines_properly: for NOT IN DATA questions, the answer clearly says it does not find this in the meetings; for answerable questions set false.`;
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: JUDGE, max_tokens: 300, system: sys, messages: [{ role: 'user', content: `QUESTION: ${q.q}\nKIND: ${q.kind}\nEXPECTED: ${q.expect}\nANSWER: ${text}\n\nEVIDENCE:\n${evidence}` }] }) });
  const b: any = await r.json();
  const u = b.usage ?? {};
  spent += ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1e6;
  const m = /\{[\s\S]*\}/.exec(b.content?.[0]?.text ?? '');
  try { return JSON.parse(m![0]); } catch { return null; }
}

const recentByQuestion = new Map<string, Array<{ q: string; a: string }>>();
const out: any[] = [];
let pass = 0;
for (const q of questions) {
  if (spent >= CAP) { console.log(`spend cap $${CAP} reached, stopping`); break; }
  const recent = q.followupOf ? [...(recentByQuestion.get(q.followupOf) ?? [])] : [];
  const t0 = Date.now();
  let res;
  try {
    res = await answer({ question: q.q, speakerName: 'Owner', allowHistory: true, ownerName: null, data, liveText: () => '(nothing said yet)', recent });
  } catch (e) { out.push({ id: q.id, error: String((e as Error).message).slice(0, 80) }); console.log(`ERROR ${q.id}`); continue; }
  const thinkMs = Date.now() - t0;
  spent += res.usd;
  let ttsMs = 0;
  if (synth) { try { const s = await synth(res.text.slice(0, 450)); ttsMs = s.ms; spent += s.usd; } catch { ttsMs = -1; } }
  recentByQuestion.set(q.id, [...recent, { q: q.q, a: res.text }]);
  const j = await judge(q, res.text);
  const ok = !!j && (q.kind === 'negative' ? j.declines_properly && !j.invents_or_contradicts : j.covers_key_facts && !j.invents_or_contradicts);
  if (ok) pass++;
  out.push({ id: q.id, kind: q.kind, pass: ok, thinkMs, ttsMs, tools: res.tools, found: res.found, usd: res.usd, answer: res.text, judge: j });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${q.id.padEnd(20)} think ${String(thinkMs).padStart(5)}ms tools=${res.tools.length}${synth ? ` tts ${ttsMs}ms` : ''}`);
}
const ok = out.filter((x) => !x.error);
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] : null; };
const think = ok.map((x) => x.thinkMs);
const total = ok.filter((x) => x.ttsMs >= 0).map((x) => x.thinkMs + x.ttsMs);
console.log(`\n${demo ? 'DEMO snapshot' : 'FULL snapshot'}: ${pass}/${ok.length} pass (${out.length - ok.length} errors); model ${process.env.VOICE_ASSISTANT_MODE ?? ''}${cfg().model ?? 'summary model'}`);
console.log(`think time (LLM tool loop, real network): p50 ${pct(think, 50)}ms p95 ${pct(think, 95)}ms${synth ? `; think+TTS p50 ${pct(total, 50)}ms p95 ${pct(total, 95)}ms` : ''}`);
console.log(`answerable ${ok.filter((x) => x.kind === 'answerable' && x.pass).length}/${ok.filter((x) => x.kind === 'answerable').length}, negative ${ok.filter((x) => x.kind === 'negative' && x.pass).length}/${ok.filter((x) => x.kind === 'negative').length}; mean tool calls ${(ok.reduce((a, x) => a + x.tools.length, 0) / Math.max(ok.length, 1)).toFixed(1)}; mean answer cost $${(ok.reduce((a, x) => a + x.usd, 0) / Math.max(ok.length, 1)).toFixed(4)}; total spend incl. judge $${spent.toFixed(3)}`);
if (opt('out')) writeFileSync(opt('out')!, JSON.stringify({ questions: out }, null, 1));
