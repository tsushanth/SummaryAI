'use client';

import { useEffect, useState, useCallback } from 'react';
import { Link2, X } from 'lucide-react';
import { createShare, listShares, revokeShare, type ShareLink } from '@/lib/api/organize';

/**
 * Public share links for one recording. The full URL is only available right
 * after creation (the server stores a hash), so it is shown once with a Copy button.
 */
export function ShareLinkPanel({ recordingId }: { recordingId: string }) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [expiresDays, setExpiresDays] = useState<string>('7');
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setShares(await listShares(recordingId));
      setLoaded(true);
    } catch {
      setError('Could not load share links');
    }
  }, [recordingId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createShare(recordingId, {
        include_transcript: includeTranscript,
        expires_in_days: expiresDays === 'never' ? null : Number(expiresDays),
      });
      setNewUrl(res.url);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create link');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this link? Anyone using it will lose access immediately.')) return;
    setBusy(true);
    try {
      await revokeShare(recordingId, id);
      await load();
    } catch {
      setError('Failed to revoke link');
    } finally {
      setBusy(false);
    }
  };

  const active = shares.filter(
    (s) => !s.revoked_at && (!s.expires_at || new Date(s.expires_at) > new Date())
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent"
      >
        <Link2 className="w-4 h-4" />
        Share link
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 bg-card border rounded-lg shadow-lg p-4 text-sm space-y-3">
          <p className="text-muted-foreground">
            Anyone with the link can view the summary{includeTranscript ? ' and transcript' : ''}. Revoke at any time.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeTranscript}
              onChange={(e) => setIncludeTranscript(e.target.checked)}
            />
            Include full transcript
          </label>
          <label className="flex items-center gap-2">
            Expires
            <select
              value={expiresDays}
              onChange={(e) => setExpiresDays(e.target.value)}
              className="rounded border border-input bg-card px-2 py-1 text-foreground"
            >
              <option value="1">in 1 day</option>
              <option value="7">in 7 days</option>
              <option value="30">in 30 days</option>
              <option value="never">never</option>
            </select>
          </label>
          <button
            onClick={create}
            disabled={busy}
            className="w-full px-3 py-1.5 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
          >
            Create link
          </button>

          {newUrl && (
            <div className="p-2 bg-muted text-foreground border border-border rounded space-y-1">
              <div className="break-all text-xs select-all">{newUrl}</div>
              <button
                onClick={() =>
                  navigator.clipboard
                    .writeText(newUrl)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                    .catch(() => setError('Copy failed'))
                }
                className="text-xs text-primary hover:underline"
              >
                {copied ? 'Copied' : 'Copy (shown once)'}
              </button>
            </div>
          )}

          {loaded && active.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No active links yet. Links are private until you create one, and you can revoke them at any time.
            </p>
          )}
          {active.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-muted-foreground mb-1">Active links ({active.length})</div>
              <ul className="space-y-1">
                {active.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      {new Date(s.created_at).toLocaleDateString()}
                      {s.include_transcript ? ' · transcript' : ''} · {s.view_count} {s.view_count === 1 ? 'view' : 'views'}
                      {s.expires_at ? ` · expires ${new Date(s.expires_at).toLocaleDateString()}` : ''}
                    </span>
                    <button
                      onClick={() => revoke(s.id)}
                      disabled={busy}
                      title="Revoke"
                      className="p-1 text-destructive hover:bg-destructive/10 rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}
