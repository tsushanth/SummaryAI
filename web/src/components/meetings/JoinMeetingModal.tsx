'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Link as LinkIcon, Loader2, Calendar, Clock } from 'lucide-react';
import { getTranscriptionLanguages, setDefaultTranscriptionLanguage } from '@/lib/api/meetings';
import { languageChoiceHint, normalizeChoice } from '@/lib/transcriptionLanguages';
import { LanguageSelect } from './LanguageSelect';
import { CoachJoinOption } from '@/components/coaching/CoachJoinOption';
import { useCoachingCredits } from '@/hooks/useCoaching';
import { COACH_PERSONA } from '@/lib/coaching/messages';
import { getDefaultDateTime, zoomLinkWarning } from '@/lib/meetingLink';
import type { CreateMeetingRequest, JoinMeetingRequest } from '@/types/api';

interface JoinMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateMeetingRequest, options: { coachWanted: boolean }) => Promise<{ warning?: string } | void>;
  /** Send the bot immediately (POST /api/meetings/join). `coachPersona` is set when AI Coach is switched on. */
  onJoinNow: (data: JoinMeetingRequest, options: { coachPersona: string | null }) => Promise<unknown>;
  isSubmitting: boolean;
  isJoining: boolean;
}

function detectPlatform(url: string): string | null {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('zoom.us') || lowerUrl.includes('zoomgov.com')) {
    return 'Zoom';
  }
  if (lowerUrl.includes('meet.google.com')) {
    return 'Google Meet';
  }
  if (lowerUrl.includes('teams.microsoft.com') || lowerUrl.includes('teams.live.com')) {
    return 'Microsoft Teams';
  }
  if (lowerUrl.includes('webex.com')) {
    return 'Webex';
  }
  return null;
}

// A link copied from a meeting app's address bar or "copy joining info" often has no scheme
// ("meet.google.com/abc-defg-hij"). Add https:// so it validates and joins the same way.
function normalizeMeetingUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^/\s]+\.[^/\s]+:\d+/.test(trimmed)) return trimmed;
  return /^[^\s/]+\.[^\s/]+/.test(trimmed) ? `https://${trimmed}` : trimmed;
}

function isValidMeetingUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

export function JoinMeetingModal({
  isOpen,
  onClose,
  onSubmit,
  onJoinNow,
  isSubmitting,
  isJoining,
}: JoinMeetingModalProps) {
  // The page mounts this form when it is opened, so these are the defaults for now, not for when the page loaded.
  const [defaults] = useState(() => getDefaultDateTime());
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [autoJoin, setAutoJoin] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = untouched: follow the saved default (which may still be loading). A pick in this form overrides it.
  const [pickedLanguage, setPickedLanguage] = useState<string | null>(null);
  const { data: languages, mutate: refreshLanguages } = useSWR(isOpen ? 'transcription-languages' : null, getTranscriptionLanguages, {
    revalidateOnFocus: false,
  });
  const savedDefault = normalizeChoice(languages?.default_language);
  const language = pickedLanguage ?? savedDefault;
  const [coachChecked, setCoachChecked] = useState(false);
  const credits = useCoachingCredits();
  const coachOn = coachChecked && (credits.balance ?? 0) > 0;

  if (!isOpen) return null;

  const normalizedUrl = normalizeMeetingUrl(url);
  const isValidUrl = isValidMeetingUrl(normalizedUrl);
  const detectedPlatform = isValidUrl ? detectPlatform(normalizedUrl) : null;
  const linkWarning = isValidUrl ? zoomLinkWarning(normalizedUrl) : null;
  const isValidForm = isValidUrl && title.trim().length > 0 && date && time;
  const isBusy = isSubmitting || isJoining;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isValidUrl) {
      setError('Please enter a valid meeting URL');
      return;
    }

    if (!title.trim()) {
      setError('Please enter a meeting title');
      return;
    }

    if (!date || !time) {
      setError('Please enter the meeting date and time');
      return;
    }

    try {
      const scheduled_start = new Date(`${date}T${time}`).toISOString();
      await onSubmit(
        {
          title: title.trim(),
          join_url: normalizedUrl,
          scheduled_start,
          auto_join: autoJoin,
          transcription_language: language,
        },
        { coachWanted: coachOn }
      );
      rememberLanguage();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add meeting');
    }
  };

  // Remember the choice as the default for the next meeting (best effort: the meeting itself is already added).
  const rememberLanguage = () => {
    if (language !== savedDefault) {
      setDefaultTranscriptionLanguage(language).then(() => refreshLanguages(), () => undefined);
    }
  };

  // Needs only the link: no title, date or time. The backend applies the same monthly allowance as a scheduled join.
  const handleJoinNow = async () => {
    setError(null);
    if (!isValidUrl) {
      setError('Please enter a valid meeting URL');
      return;
    }
    try {
      await onJoinNow(
        {
          join_url: normalizedUrl,
          ...(title.trim() ? { title: title.trim() } : {}),
          transcription_language: language,
        },
        { coachPersona: coachOn ? COACH_PERSONA.key : null }
      );
      rememberLanguage();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send the bot');
    }
  };

  // The form is unmounted on close, so there is nothing to reset.
  const handleClose = onClose;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
      />
      <div className="relative bg-card rounded-lg shadow-xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add Meeting</h2>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-accent rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground/90 mb-1">
                Meeting Title
              </label>
              <Input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setError(null);
                }}
                placeholder="Team Standup"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/90 mb-1">
                Meeting URL
              </label>
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError(null);
                  }}
                  placeholder="https://zoom.us/j/..."
                  className="pl-10"
                />
              </div>
              {detectedPlatform && (
                <p className="text-sm text-success mt-1">
                  Detected: {detectedPlatform}
                </p>
              )}
              {linkWarning && (
                <p role="alert" className="mt-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                  {linkWarning}
                </p>
              )}
              {url.trim() && !isValidUrl && (
                <p className="text-sm text-destructive mt-1">
                  That does not look like a full meeting link. Paste the whole link, for example https://meet.google.com/abc-defg-hij
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground/90 mb-1">
                  Date
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setError(null);
                    }}
                    className="pl-10"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/90 mb-1">
                  Time
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => {
                      setTime(e.target.value);
                      setError(null);
                    }}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>

            <LanguageSelect
              label="Spoken language"
              value={language}
              onChange={(c) => { setPickedLanguage(c); setError(null); }}
              description={
                languageChoiceHint(language, languages?.live) ??
                (language === 'auto' ? 'Detected automatically. Choose a language if everyone speaks the same one.' : 'Remembered as your default for new meetings.')
              }
            />

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoJoin"
                checked={autoJoin}
                onChange={(e) => setAutoJoin(e.target.checked)}
                className="rounded border-input"
              />
              <label htmlFor="autoJoin" className="text-sm text-foreground/90">
                Auto-record this meeting
              </label>
            </div>

            <CoachJoinOption
              checked={coachChecked}
              onChange={setCoachChecked}
              balance={credits.balance}
              failed={credits.failed}
              onReload={credits.reload}
              delayedCaptions={!!languages?.live?.english_only_low_latency && language !== 'auto' && language !== 'en'}
            />

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <p className="text-xs text-muted-foreground">
              Supported platforms: Zoom, Google Meet, Microsoft Teams, Webex
            </p>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Join now sends the bot immediately and ignores the date and time.
          </p>

          <div className="flex flex-wrap justify-end gap-3 mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isBusy}
            >
              Cancel
            </Button>
            {/* With AI Coach on, "Join now" is the action that starts it, so it takes the primary style. */}
            <Button type="button" variant={coachOn ? 'default' : 'outline'} onClick={handleJoinNow} disabled={!isValidUrl || isBusy}>
              {isJoining ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending bot...
                </>
              ) : (
                'Join now'
              )}
            </Button>
            <Button type="submit" variant={coachOn ? 'outline' : 'default'} disabled={!isValidForm || isBusy}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Meeting'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
