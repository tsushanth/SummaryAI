import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Delete your account - Meeting Mind',
  description: 'How to delete your Meeting Mind account and what happens to your data.',
};

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-background text-foreground py-16">
      <div className="max-w-[900px] mx-auto px-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Delete your Meeting Mind account</h1>
        <p className="text-muted-foreground text-sm mb-12">Last updated: 2026-11-10</p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">In the Android app</h2>
          <ol className="list-decimal list-inside text-muted-foreground space-y-2">
            <li>Open Meeting Mind and go to Settings.</li>
            <li>Tap <strong>Delete Account</strong> and confirm.</li>
          </ol>
          <p className="text-muted-foreground leading-relaxed mt-4">
            The same account is used in the web app, so deleting it in the Android app removes it everywhere.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">By email</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you cannot open the app, email{' '}
            <a href="mailto:privacy@kreativekoala.llc" className="text-primary hover:underline">privacy@kreativekoala.llc</a>{' '}
            from the address you signed up with and ask us to delete your account.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">What is deleted</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            We delete, in this order: your audio, video and export files from storage; the meeting media Recall.ai holds for your
            meeting bot recordings; any phone call recording still held at Twilio; your database records (recordings, transcripts,
            summaries, questions and answers, meetings, bot runs, phone numbers, share links, folders, calendar connections,
            integration settings and profile); and finally your sign-in account. If deleting at one of those providers fails,
            we retry it automatically.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Deletion does not remove data held by other providers under their own terms (for example Deepgram, Soniox,
            Anthropic and Resend), emails already sent, or content already sent to Slack, Notion or a webhook you set up, and it
            does not revoke calendar access you granted in your Google or Microsoft account. See the{' '}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link> for details.
          </p>
        </section>
      </div>
    </div>
  );
}
