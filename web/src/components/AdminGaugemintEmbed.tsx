// Server component (no 'use client'): rendered only for admins, after isAdmin(). `src` is the already-validated
// Gaugemint embed address, a capability URL, so it lives in server-rendered HTML only: never log it, never pass it to client code.
const h2: React.CSSProperties = { fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', opacity: 0.6, margin: '24px 0 8px' };

export default function AdminGaugemintEmbed({ src }: { src: string }) {
  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px 32px', fontSize: 14, lineHeight: 1.45 }}>
      <h2 style={h2}>Website visits (Gaugemint)</h2>
      <p style={{ opacity: 0.7, margin: '0 0 8px' }}>
        Landing-page visits only (not app usage).{' '}
        <a href={src} target="_blank" rel="noopener noreferrer nofollow">Open in a new tab</a>
      </p>
      <iframe
        src={src}
        title="Website visits (Gaugemint)"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        style={{ display: 'block', width: '100%', height: 720, border: '1px solid #8884', borderRadius: 8 }}
      />
    </section>
  );
}
