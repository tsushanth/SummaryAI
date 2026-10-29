'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Link as LinkIcon, Loader2, Calendar, Clock } from 'lucide-react';
import type { CreateMeetingRequest } from '@/types/api';

interface JoinMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateMeetingRequest) => Promise<{ warning?: string } | void>;
  isSubmitting: boolean;
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

function getDefaultDateTime(): { date: string; time: string } {
  const now = new Date();
  // Round up to next 15 minutes
  const minutes = Math.ceil(now.getMinutes() / 15) * 15;
  now.setMinutes(minutes, 0, 0);

  // Local date and time. toISOString() is UTC, so in the evening (PT) it gave tomorrow's date.
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return { date, time };
}

export function JoinMeetingModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: JoinMeetingModalProps) {
  const defaults = getDefaultDateTime();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [autoJoin, setAutoJoin] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const normalizedUrl = normalizeMeetingUrl(url);
  const isValidUrl = isValidMeetingUrl(normalizedUrl);
  const detectedPlatform = isValidUrl ? detectPlatform(normalizedUrl) : null;
  const isValidForm = isValidUrl && title.trim().length > 0 && date && time;

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
      await onSubmit({
        title: title.trim(),
        join_url: normalizedUrl,
        scheduled_start,
        auto_join: autoJoin,
      });
      // Reset form
      setUrl('');
      setTitle('');
      const newDefaults = getDefaultDateTime();
      setDate(newDefaults.date);
      setTime(newDefaults.time);
      setAutoJoin(true);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add meeting');
    }
  };

  const handleClose = () => {
    setUrl('');
    setTitle('');
    const newDefaults = getDefaultDateTime();
    setDate(newDefaults.date);
    setTime(newDefaults.time);
    setAutoJoin(true);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
      />
      <div className="relative bg-card rounded-lg shadow-xl w-full max-w-md p-6">
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

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <p className="text-xs text-muted-foreground">
              Supported platforms: Zoom, Google Meet, Microsoft Teams, Webex
            </p>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isValidForm || isSubmitting}>
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
