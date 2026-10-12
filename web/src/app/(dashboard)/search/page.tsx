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
      <mark key={key++} className="bg-amber-500/30 text-foreground rounded px-0.5">
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
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-4">Search</h1>
      <div className="relative mb-6">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, summaries and transcripts"
          className="w-full border rounded-lg pl-9 pr-3 py-2 bg-card"
        />
      </div>

      {loading && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
      {error && <p className="text-destructive">{error}</p>}
      {results && results.length === 0 && !loading && (
        <p className="text-muted-foreground">No results for &ldquo;{query.trim()}&rdquo;</p>
      )}
      {results && results.length > 0 && (
        <ul className="space-y-3">
          {results.map((r) => (
            <li key={r.recording.id}>
              <Link
                href={`/recordings/${r.recording.id}`}
                className="block bg-card border rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium truncate">
                    <Highlight text={r.recording.title} query={query} />
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatRelativeDate(r.recording.created_at)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{MATCH_LABEL[r.match]} match</div>
                {r.match !== 'title' && (
                  <p className="text-sm text-foreground/80 mt-1">
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
