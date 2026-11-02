import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - Meeting Mind',
  description: 'Meeting Mind Privacy Policy - what we collect, who processes it, and your choices.',
};

const PROVIDERS: { name: string; gets: string; why: string }[] = [
  { name: 'Supabase', gets: 'Account data, database records, audio files', why: 'Authentication, database and file storage' },
  { name: 'Deepgram', gets: 'Audio of your recordings', why: 'Speech-to-text and speaker identification' },
  { name: 'Anthropic', gets: 'Transcript text and your questions about your recordings', why: 'Summaries, action items, Q&A, follow-up drafts and live insights (Claude models)' },
  { name: 'Recall.ai', gets: 'Meeting audio and video, the meeting link, the bot name', why: 'The meeting bot that joins, records and live-transcribes meetings you request' },
  { name: 'Twilio', gets: 'Phone numbers and call audio', why: 'Phone number verification, calling and call recording' },
  { name: 'Google and Microsoft', gets: 'The read-only calendar access you grant; Google sign-in', why: 'Calendar sync and sign-in' },
  { name: 'Resend', gets: 'Recipient addresses and summary content you choose to email', why: 'Delivering emails you ask us to send' },
  { name: 'Google (Firebase Analytics, Google Play)', gets: 'Android usage events, device identifiers, purchase status', why: 'Analytics, app distribution and billing' },
  { name: 'Stripe, RevenueCat, Google Play', gets: 'Subscription status (earlier subscribers only)', why: 'Billing' },
  { name: 'Slack, Notion or a webhook you set up', gets: 'Recording title, summary and action items', why: 'Integrations you turn on yourself' },
  { name: 'Cloudflare (our error reporter)', gets: 'Error details, app version, device model, an account identifier', why: 'Finding and fixing bugs' },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground py-16">
      <div className="max-w-[900px] mx-auto px-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground text-sm mb-12">Last updated: [DATE OF PUBLICATION]</p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">1. Who we are</h2>
          <p className="text-muted-foreground leading-relaxed">
            Meeting Mind is operated by Kreative Koala Solutions LLC, 5900 Balcones Drive, Ste 100, Austin, TX 78731, USA
            (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). Meeting Mind is an Android app and a web app (meetingmind.org)
            that records, transcribes and summarizes meetings, phone calls and in-person conversations.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">2. What we collect</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li><strong>Account:</strong> your email address and a password handled by our authentication provider (we never see it in plain text). If you use Google sign-in, your Google account email and name.</li>
            <li><strong>Your recordings:</strong> audio you record with your device microphone, audio you upload, audio of phone calls you place through the app, and the recording of a meeting our bot joins at your request. For bot meetings the recording may include video where the meeting platform provides it.</li>
            <li><strong>What we generate from them:</strong> transcripts (with speaker labels and timestamps), summaries, action items, and your questions and our answers.</li>
            <li><strong>Calendar data, if you connect Google Calendar or Outlook:</strong> read-only. We store the meeting link, start and end time, time zone and an event identifier. We do not store event titles, descriptions or attendee lists. Calendar data is used only to join and schedule meetings you choose and is never sent to our AI providers.</li>
            <li><strong>Phone numbers, if you use the phone feature:</strong> your verified number and the number you call, with call times and duration.</li>
            <li><strong>Usage and device data:</strong> on Android, analytics events (such as screens viewed and features used) through Firebase Analytics, and technical error reports (error message, app version, device make and model, Android version, and an account identifier that is not your email).</li>
            <li><strong>Sharing and email:</strong> the settings of any share link you create, and the recipient addresses you enter when you email a summary.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">3. How we use it</h2>
          <p className="text-muted-foreground leading-relaxed">
            To record, transcribe, summarize and answer questions about your recordings; to join meetings and place calls
            you ask for; to sync your account across Android and web; to fix errors and understand how features are used;
            and to send service messages. We do not sell your personal information and we do not use your content for advertising.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">4. Who processes your data</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            We use these service providers. Each receives only what it needs for the purpose shown, and each handles data under its own terms.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-muted-foreground">
              <thead>
                <tr className="border-b border-border text-foreground">
                  <th className="py-2 pr-4 font-semibold">Provider</th>
                  <th className="py-2 pr-4 font-semibold">What it receives</th>
                  <th className="py-2 font-semibold">Why</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDERS.map((p) => (
                  <tr key={p.name} className="border-b border-border align-top">
                    <td className="py-2 pr-4 font-medium text-foreground">{p.name}</td>
                    <td className="py-2 pr-4">{p.gets}</td>
                    <td className="py-2">{p.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground leading-relaxed mt-4">
            We also disclose information when the law requires it, and in connection with a merger or acquisition.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">5. Recording other people</h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            When you use the meeting bot, phone recording or your microphone to record, you are responsible for telling the
            people you record and for following the consent and wiretapping laws that apply to you and to them. Many places
            require every participant&apos;s consent. The meeting bot joins as a visible participant named &quot;Meeting Mind.&quot;
            For phone calls, the other party hears a recording notice when they answer.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            If you were recorded by someone using Meeting Mind and want your data removed, email{' '}
            <a href="mailto:privacy@kreativekoala.llc" className="text-primary hover:underline">privacy@kreativekoala.llc</a>.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">6. Storage, security and retention</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li>We keep your recordings, transcripts, summaries and questions until you delete them or delete your account. There is no automatic purge.</li>
            <li>Deleting a recording removes its audio file, transcript and summary from our systems.</li>
            <li>Deleting your account removes your account and its records from our database. To make sure a recording&apos;s audio file is removed, delete the recording before you delete your account.</li>
            <li>Phone call recordings are deleted from Twilio after we store them.</li>
            <li>Data in transit is encrypted with HTTPS/TLS. Calendar access tokens and integration secrets are additionally encrypted by us.</li>
            <li>Our providers keep data under their own retention terms.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">7. Your choices and rights</h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            You can delete recordings, delete your account, export your transcripts and summaries, revoke share links,
            disconnect your calendar, turn auto-join off for any meeting, and remove integrations.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Depending on where you live, you may also have the right to access, correct, delete or port your personal data,
            or to object to its processing. To use these rights, email{' '}
            <a href="mailto:privacy@kreativekoala.llc" className="text-primary hover:underline">privacy@kreativekoala.llc</a>.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">8. Children</h2>
          <p className="text-muted-foreground leading-relaxed">
            Meeting Mind is not intended for children under 13. We do not knowingly collect information from children under 13.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">9. Changes to this policy</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may update this policy from time to time. Changes will be posted on this page with an updated date.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">10. Contact us</h2>
          <p className="text-muted-foreground">
            Questions? Email us at{' '}
            <a href="mailto:privacy@kreativekoala.llc" className="text-primary hover:underline">privacy@kreativekoala.llc</a>
          </p>
        </section>
      </div>
    </div>
  );
}
