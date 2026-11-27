/**
 * What a meeting's bot is doing, in the few states a user (and the AI Coach) cares about. Read from the latest bot run,
 * which the Recall webhooks and reconcilers keep up to date.
 */
import { supabaseAdmin } from '../lib/supabase.js';
import { NOT_ADMITTED_SUB_CODES } from '../lib/recallStatus.js';

export type BotStateName = 'joining' | 'waiting_room' | 'in_call' | 'recording' | 'ended' | 'failed';

export interface MeetingBotState {
  state: BotStateName;
  /** Stable reason code for a failed bot (Recall sub_code or our own). Never a provider's message text. */
  code: string | null;
  /** The bot got into the meeting at some point. */
  joined: boolean;
}

/** Why no more live transcript is coming. */
export type BotEndReason = 'bot_not_admitted' | 'bot_failed' | 'meeting_ended';

export interface BotRunStateColumns {
  status: string;
  recall_status?: string | null;
  joined_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
}

const CODE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

export function deriveBotState(run: BotRunStateColumns): MeetingBotState {
  const joined = !!run.joined_at;
  const of = (state: BotStateName, code: string | null = null): MeetingBotState => ({ state, code, joined });
  if (run.status === 'failed' || run.status === 'cancelled') {
    return of('failed', [run.error_code, run.error_message].find((c) => !!c && CODE.test(c)) ?? null);
  }
  if (run.status === 'processing' || run.status === 'completed' || run.recall_status === 'call_ended' || run.recall_status === 'done') {
    return of('ended');
  }
  if (run.status === 'recording') return of('recording');
  if (run.status === 'in_call') return of('in_call');
  if (run.recall_status === 'in_waiting_room' && !joined) return of('waiting_room');
  return of('joining');
}

/** Null while the bot is still on its way or in the meeting. */
export function botEndReason(bot: MeetingBotState): BotEndReason | null {
  if (bot.state === 'failed') return bot.code && NOT_ADMITTED_SUB_CODES.includes(bot.code) ? 'bot_not_admitted' : 'bot_failed';
  if (bot.state === 'ended') return bot.joined ? 'meeting_ended' : 'bot_failed';
  return null;
}

/** The latest bot run's state, or null when the meeting has no bot run (or it cannot be read). */
export async function getMeetingBotState(meetingId: string): Promise<MeetingBotState | null> {
  const { data, error } = await supabaseAdmin
    .from('bot_runs')
    .select('status, recall_status, joined_at, error_code, error_message')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return deriveBotState(data as BotRunStateColumns);
}
