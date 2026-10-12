'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search } from 'lucide-react';
import { searchRecordings, type SearchResult } from '@/lib/api/organize';
import { formatRelativeDate } from '@/lib/utils/audio';

const MATCH_LABEL: Record<SearchResult['match'], string> = {
  title: 'Title',
  summary: 'Summary',
  transcript: 'Transcript',
};

/** Highlights case-insensitive occurrences of the query without using dangerouslySetInnerHTML. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={key++} className="rounded-sm bg-mark px-0.5 text-mark-foreground">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    i = idx + needle.length;
  }
  return <>{parts}</>;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await searchRecordings(q);
        if (!cancelled) setResults(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="mb-4 text-3xl font-semibold tracking-tight">Search</h1>
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, summaries and transcripts"
          aria-label="Search recordings"
          className="h-12 w-full rounded-md border border-input bg-card pl-9 pr-3 text-base"
        />
      </div>

      {loading && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
      {error && <p className="text-destructive">{error}</p>}
      {results && results.length === 0 && !loading && (
        <p className="text-muted-foreground">No results for &ldquo;{query.trim()}&rdquo;</p>
      )}
      {results && results.length > 0 && (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.recording.id}>
              <Link
                href={`/recordings/${r.recording.id}`}
                className="block rounded-md border border-border bg-card p-4 transition-colors hover:bg-accent"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium truncate">
                    <Highlight text={r.recording.title} query={query} />
                  </span>
                  <span className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatRelativeDate(r.recording.created_at)}
                  </span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{MATCH_LABEL[r.match]} match</div>
                {r.match !== 'title' && (
                  <p className="minute mt-1 text-base text-foreground/80">
                    <Highlight text={r.snippet} query={query} />
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
