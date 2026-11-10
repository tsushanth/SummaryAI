'use client';

import { useEffect, useState } from 'react';
import { Loader2, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { setLiveLanguage } from '@/lib/api/meetings';
import { languageDisplayName, liveLanguageHelp, normalizeChoice } from '@/lib/transcriptionLanguages';
import type { LiveLanguageState } from '@/types/api';
import { LanguageSelect } from './LanguageSelect';

interface Props {
  meetingId: string;
  /** From GET /api/meetings/:id (live_language). */
  state: LiveLanguageState | undefined;
  /** Refetch the meeting after a successful change. */
  onChanged: () => void;
}

/**
 * "Change language" for a meeting that is being recorded. Disabled, with the reason as text, when the live provider cannot switch
 * languages mid-meeting (today's Recall transcript) or the meeting is not live.
 */
export function LiveLanguageControl({ meetingId, state, onChanged }: Props) {
  const current = normalizeChoice(state?.language);
  const [choice, setChoice] = useState(current);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  // Follow the server value (another tab, or the change we just made).
  useEffect(() => setChoice(current), [current]);

  const canChange = !!state?.can_change;
  const help = liveLanguageHelp(state);
  const dirty = choice !== current;

  const apply = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await setLiveLanguage(meetingId, choice);
      setNotice(
        r.live_applied
          ? { kind: 'ok', text: `Live transcript switched to ${languageDisplayName(r.language)}.` }
          : { kind: 'warn', text: r.message ?? 'Saved for the final transcript, but the live transcript could not be switched right now.' }
      );
      onChanged();
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not change the language. Try again.' });
      setChoice(current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Languages className="hidden h-5 w-5 text-muted-foreground sm:block mb-2" aria-hidden="true" />
      <LanguageSelect
        label="Transcript language"
        value={choice}
        onChange={(c) => { setChoice(c); setNotice(null); }}
        disabled={!canChange || busy}
        description={help}
        className="min-w-[14rem]"
      />
      <Button type="button" size="sm" onClick={apply} disabled={!canChange || busy || !dirty} className="mb-[1.35rem]">
        {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Changing...</> : 'Change language'}
      </Button>
      <div role="status" aria-live="polite" className="basis-full text-sm">
        {notice && (
          <p className={notice.kind === 'error' ? 'text-destructive' : notice.kind === 'warn' ? 'text-amber-800 dark:text-amber-300' : 'text-success'}>
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
}
