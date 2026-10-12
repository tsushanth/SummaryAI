import type { Metadata } from 'next';
import { headers } from 'next/headers';

// Public, unauthenticated, read-only view of a shared recording.
// Always rendered on the server at request time so revocation is immediate.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared meeting notes',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

interface SharedPayload {
  recording: {
    title: string;
    created_at: string;
    duration_seconds: number | null;
  };
  summary: {
    summary: string;
    key_points: string[];
    action_items: string[];
    topics: string[];
  } | null;
  transcript: { segments: { speaker: string; text: string; start_time: number }[] } | null;
  expires_at: string | null;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

async function load(token: string): Promise<SharedPayload | null> {
  if (!TOKEN_RE.test(token)) return null;
  try {
    // The API rate-limits per client IP. Server-side, every viewer would otherwise look like this web machine, so
    // forward the viewer IP, authenticated with an optional shared secret (the API ignores it unless it has the same
    // SHARE_PROXY_SECRET set).
    const fwd: Record<string, string> = {};
    const secret = process.env.SHARE_PROXY_SECRET;
    if (secret) {
      const h = headers();
      const ip = h.get('fly-client-ip') || h.get('x-forwarded-for')?.split(',')[0]?.trim();
      if (ip) {
        fwd['x-share-client-ip'] = ip.slice(0, 64);
        fwd['x-share-proxy-secret'] = secret;
      }
    }
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/public/shares/${token}`, {
      cache: 'no-store',
      headers: fwd,
    });
    if (!res.ok) return null;
    return (await res.json()) as SharedPayload;
  } catch {
    return null;
  }
}

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default async function SharedRecordingPage({ params }: { params: { token: string } }) {
  const data = await load(params.token);

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-semibold mb-2">Link unavailable</h1>
          <p className="text-muted-foreground">
            This link is invalid, has expired, or was revoked by its owner.
          </p>
        </div>
      </main>
    );
  }

  const { recording, summary, transcript } = data;

  return (
    <main className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-3xl mx-auto bg-card border rounded-xl shadow-sm p-6 md:p-8 space-y-8">
        <header>
          <h1 className="text-2xl font-bold">{recording.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(recording.created_at).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
            {recording.duration_seconds ? ` · ${mmss(recording.duration_seconds)}` : ''}
          </p>
        </header>

        {summary ? (
          <>
            <section>
              <h2 className="text-lg font-semibold mb-2">Summary</h2>
              <p className="text-foreground/80 leading-relaxed whitespace-pre-wrap">{summary.summary}</p>
            </section>
            {summary.key_points.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-2">Key points</h2>
                <ul className="list-disc pl-5 space-y-1 text-foreground/80">
                  {summary.key_points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>
            )}
            {summary.action_items.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-2">Action items</h2>
                <ul className="list-disc pl-5 space-y-1 text-foreground/80">
                  {summary.action_items.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>
            )}
            {summary.topics.length > 0 && (
              <section className="flex flex-wrap gap-2">
                {summary.topics.map((t, i) => (
                  <span key={i} className="px-3 py-1 bg-accent text-accent-foreground rounded-full text-sm">
                    {t}
                  </span>
                ))}
              </section>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">No summary is available for this recording.</p>
        )}

        {transcript && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Transcript</h2>
            <div className="space-y-3">
              {transcript.segments.map((s, i) => (
                <div key={i}>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">{s.speaker}</span> · {mmss(s.start_time)}
                  </div>
                  <p className="text-foreground/80">{s.text}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="pt-4 border-t text-xs text-muted-foreground">
          Shared with Meeting Mind. This page is read-only.
        </footer>
      </div>
    </main>
  );
}
