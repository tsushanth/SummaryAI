import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - Meeting Mind',
  description: 'Meeting Mind Privacy Policy - How we collect, use, and protect your information.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground py-16">
      <div className="max-w-[900px] mx-auto px-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground text-sm mb-12">Last updated: 2026-11-03</p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Introduction</h2>
          <p className="text-muted-foreground leading-relaxed">
            Kreative Koala (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates the Meeting Mind Android app and
            web app (meetingmind.org). This Privacy Policy explains how we collect, use, and protect your information.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Information We Collect</h2>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Information You Provide</h3>
          <ul className="list-disc list-inside text-muted-foreground mb-4 space-y-2">
            <li><strong>Account Information:</strong> Email address and password (stored securely via Supabase authentication). If you sign in with Google, your Google account email and name.</li>
            <li><strong>Content:</strong> Audio you record or upload, audio of phone calls you place through the app, the recording of a meeting our bot joins at your request (audio, and video where the meeting platform provides it), and the transcripts, summaries, action items, and questions and answers generated from them.</li>
            <li><strong>Calendar information, if you connect a calendar:</strong> the meeting link, start and end time, time zone, and an event identifier.</li>
            <li><strong>Phone numbers, if you use the phone feature:</strong> your verified number and the number you call, with call times and duration.</li>
            <li><strong>Sharing and email:</strong> the settings of any share link you create and the recipient addresses you enter when you email a summary.</li>
          </ul>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Information Collected Automatically</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li><strong>Analytics (Android):</strong> app usage events and device identifiers collected through Firebase Analytics.</li>
            <li><strong>Error reports:</strong> error details, app version, device make and model, operating system version, and an account identifier.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">How We Use Your Information</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li>Provide the app&apos;s functionality</li>
            <li>Transcribe your audio recordings using AI speech-to-text services</li>
            <li>Generate AI-powered summaries, action items, and Q&amp;A from your transcripts</li>
            <li>Join meetings and place calls that you ask for</li>
            <li>Send account emails and emails you ask us to send</li>
            <li>Fix errors and understand how Android features are used</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Third-Party Services</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Meeting Mind uses the following third-party services to provide its features.
          </p>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Audio Transcription</h3>
          <ul className="list-disc list-inside text-muted-foreground mb-4 space-y-2">
            <li><strong>Deepgram</strong> (deepgram.com) &mdash; receives your audio and converts speech to text with speaker identification and timestamps</li>
            <li><strong>Soniox</strong> (soniox.com) &mdash; may also receive your audio and convert speech to text, when we use Soniox as the transcription provider or run it alongside Deepgram to compare results. Deepgram remains a transcription provider while it is in use, including as a fallback.</li>
          </ul>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">AI Summaries &amp; Q&amp;A</h3>
          <ul className="list-disc list-inside text-muted-foreground mb-4 space-y-2">
            <li><strong>Anthropic</strong> (anthropic.com) &mdash; receives transcript text and your questions, and generates summaries, action items, answers, follow-up drafts and live insights using Claude models</li>
          </ul>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Meeting Bot</h3>
          <ul className="list-disc list-inside text-muted-foreground mb-4 space-y-2">
            <li><strong>Recall.ai</strong> (recall.ai) &mdash; runs the bot that joins meetings you request, records them and live-transcribes them. The live transcript of a meeting may instead be produced by Soniox from the meeting audio streamed from Recall.ai.</li>
          </ul>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Phone Calls</h3>
          <ul className="list-disc list-inside text-muted-foreground mb-4 space-y-2">
            <li><strong>Twilio</strong> (twilio.com) &mdash; phone number verification, calling infrastructure and call recording</li>
          </ul>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Authentication &amp; Storage</h3>
          <ul className="list-disc list-inside text-muted-foreground mb-4 space-y-2">
            <li><strong>Supabase</strong> (supabase.com) &mdash; provides authentication, database, and file storage services</li>
          </ul>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Email</h3>
          <ul className="list-disc list-inside text-muted-foreground mb-4 space-y-2">
            <li><strong>Resend</strong> (resend.com) &mdash; delivers emails you ask us to send, such as a recording summary</li>
          </ul>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Analytics, Sign-in and Calendar</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li><strong>Google Firebase Analytics</strong> &mdash; usage analytics in the Android app</li>
            <li><strong>Google and Microsoft</strong> &mdash; Google sign-in, and read-only calendar access if you connect Google Calendar or Outlook</li>
            <li><strong>Slack, Notion or a webhook you set up</strong> &mdash; receive a recording&apos;s title, summary and action items only if you turn on that integration</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Data Storage and Security</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li>Your account, records and audio files are stored with Supabase</li>
            <li>All data transmission is encrypted using HTTPS/TLS</li>
            <li>Calendar access tokens and integration secrets are additionally encrypted by us</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Data Sharing</h2>
          <p className="text-muted-foreground mb-3">We do not sell your personal information. We share data with:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li><strong>The service providers listed above,</strong> for the purposes described there.</li>
            <li><strong>Legal Requirements:</strong> When required by law</li>
            <li><strong>Business Transfers:</strong> In connection with a merger or acquisition</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Your Rights</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Delete:</strong> Delete recordings, or delete your account and its data (see Data Retention below)</li>
            <li><strong>Export:</strong> Export your transcripts and summaries from the web app</li>
            <li><strong>Other controls:</strong> Revoke share links, disconnect your calendar, and remove integrations</li>
          </ul>
          <p className="text-muted-foreground mt-4">
            To exercise these rights, contact us at{' '}
            <a href="mailto:privacy@kreativekoala.llc" className="text-primary hover:underline">
              privacy@kreativekoala.llc
            </a>
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Data Retention</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li>We keep your recordings, transcripts, summaries and questions until you delete them or delete your account.</li>
            <li>
              When you delete your account, we delete, in this order: your audio, video and export files from storage;
              the meeting media Recall.ai holds for your meeting bot recordings; any phone call recording still held at Twilio;
              your database records (recordings, transcripts, summaries, questions and answers, meetings, bot runs, phone
              numbers, share links, folders, calendar connections, integration settings and profile); and finally your sign-in account.
            </li>
            <li>If deleting at one of those providers fails, your account is still deleted and we retry that deletion automatically.</li>
            <li>Account deletion does not delete data held by other providers (for example Deepgram, Soniox, Anthropic and Resend), emails already sent, or content already sent to Slack, Notion or a webhook you set up, and it does not revoke calendar access you granted in your Google or Microsoft account. Those providers keep data under their own terms.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Children&apos;s Privacy</h2>
          <p className="text-muted-foreground leading-relaxed">
            The App is not intended for children under 13. We do not knowingly collect information from children under 13.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Changes to This Policy</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Contact Us</h2>
          <p className="text-muted-foreground">
            Questions? Email us at{' '}
            <a href="mailto:privacy@kreativekoala.llc" className="text-primary hover:underline">
              privacy@kreativekoala.llc
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
