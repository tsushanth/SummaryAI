import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.NODE_ENV = 'development'; // config rejects 'test'
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';
process.env.RECALL_API_KEY = 'recall-test-key';

const ORIGINAL = process.env.MEETING_BOT_ANNOUNCE;

async function loadRecall(flag?: string) {
  vi.resetModules();
  if (flag === undefined) delete process.env.MEETING_BOT_ANNOUNCE;
  else process.env.MEETING_BOT_ANNOUNCE = flag;
  return import('../src/services/recallService.js');
}

let sent: any[] = [];
beforeEach(() => {
  sent = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'bot_1', status: 'ready', meeting_url: 'x' }), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (ORIGINAL === undefined) delete process.env.MEETING_BOT_ANNOUNCE;
  else process.env.MEETING_BOT_ANNOUNCE = ORIGINAL;
});

describe('bot join announcement (MEETING_BOT_ANNOUNCE)', () => {
  it('is OFF by default: no chat field is sent to Recall', async () => {
    const { RecallService } = await loadRecall(undefined);
    await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('chat');
  });

  it('is OFF when set to false', async () => {
    const { RecallService } = await loadRecall('false');
    await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1' });
    expect(sent[0]).not.toHaveProperty('chat');
  });

  it('when true, sends chat.on_bot_join to everyone with the neutral wording', async () => {
    const { RecallService } = await loadRecall('true');
    await RecallService.createBot({ meeting_url: 'https://meet.google.com/abc-defg-hij' });
    expect(sent[0].chat).toEqual({
      on_bot_join: {
        send_to: 'everyone',
        message: 'MeetingMind is recording this meeting to make notes for the host. Tell the host if you do not want to be recorded.',
      },
    });
  });

  it('keeps the rest of the payload unchanged when enabled', async () => {
    const { RecallService } = await loadRecall('true');
    await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1', bot_name: 'Custom' });
    expect(sent[0].meeting_url).toBe('https://zoom.us/j/1');
    expect(sent[0].bot_name).toBe('Custom');
    expect(sent[0].recording_config).toBeDefined();
  });

  it('announcement is plain ASCII, fits Google Meet 500 char limit, and has no em dash', async () => {
    const { BOT_ANNOUNCEMENT_MESSAGE } = await loadRecall('true');
    expect(BOT_ANNOUNCEMENT_MESSAGE).toMatch(/^[\x20-\x7E]+$/);
    expect(BOT_ANNOUNCEMENT_MESSAGE.length).toBeLessThanOrEqual(500);
  });

  it('rejects an invalid flag value at config load rather than silently enabling', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadRecall('yes')).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalled();
  });
});
