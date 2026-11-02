import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service - Meeting Mind',
  description: 'Meeting Mind Terms of Service - Terms and conditions for using the application.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground py-16">
      <div className="max-w-[900px] mx-auto px-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground text-sm mb-12">Last updated: February 25, 2026</p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">1. Agreement to Terms</h2>
          <p className="text-muted-foreground leading-relaxed">
            By downloading, installing, or using the Meeting Mind mobile application (&quot;App&quot;), you agree to be bound
            by these Terms of Service. If you do not agree, do not use the App.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">2. Description of Service</h2>
          <p className="text-muted-foreground mb-3">Meeting Mind uses artificial intelligence to:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li>Transcribe audio recordings with speaker identification</li>
            <li>Generate meeting summaries and action items</li>
            <li>Answer questions about your recordings</li>
            <li>Manage phone calls and call recordings</li>
            <li>Sync with calendar services</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">3. Account Registration</h2>
          <p className="text-muted-foreground mb-3">To use certain features, you must create an account. You agree to:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li>Provide accurate and complete information</li>
            <li>Maintain the security of your account credentials</li>
            <li>Notify us immediately of any unauthorized use</li>
            <li>Accept responsibility for all activities under your account</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">4. Subscriptions and Payments</h2>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Free Tier</h3>
          <p className="text-muted-foreground mb-4">
            MeetingMind is free, with all features included, subject to per-file size and length limits and fair use.
            Some accounts that subscribed before MeetingMind became free may still have a paid subscription;
            those continue to bill under the Billing terms below until cancelled.
          </p>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Billing</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
            <li>Subscriptions are billed in advance on a recurring basis</li>
            <li>Payment is processed through Apple App Store or Google Play Store</li>
            <li>Subscriptions automatically renew unless canceled at least 24 hours before the end of the current period</li>
          </ul>

          <h3 className="text-lg font-medium text-foreground/80 mb-3">Refunds</h3>
          <p className="text-muted-foreground">
            Refunds are handled by Apple or Google according to their respective refund policies.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">5. User Content</h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            You retain ownership of all content you upload, record, or create. By using the App, you grant us
            a limited license to process your content as necessary to provide our services.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            You agree not to upload content that infringes on intellectual property rights, contains malware,
            is illegal or defamatory, or violates the privacy of others.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">6. Third-Party Services and Data Processing</h2>
          <p className="text-muted-foreground leading-relaxed">
            Meeting Mind uses third-party services to provide transcription, summaries, Q&amp;A, meeting recording and calling.
            These include Deepgram (transcription), Anthropic (summaries and Q&amp;A), Recall.ai (meeting bot), Twilio (phone calls)
            and Supabase (accounts and storage), described in our{' '}
            <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.
            By using these features you direct us to send your content to those services for that purpose. If you do not want
            your content processed this way, do not use the features that need it, or delete your account.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">7. Recording Consent</h2>
          <p className="text-muted-foreground leading-relaxed">
            You are responsible for telling the people you record and for following all laws that apply to recording,
            including laws that require every participant&apos;s consent. This applies to the meeting bot, phone call
            recording and microphone recording. The meeting bot appears in the meeting as a participant named
            &quot;Meeting Mind.&quot; You agree not to use Meeting Mind to record anyone in a way that breaks the law or the rules
            of the meeting platform. We may suspend accounts that do.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">8. Acceptable Use</h2>
          <p className="text-muted-foreground mb-3">You agree not to:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-2">
            <li>Use the App for any unlawful purpose</li>
            <li>Attempt to gain unauthorized access to the App or its systems</li>
            <li>Interfere with or disrupt the App&apos;s functionality</li>
            <li>Reverse engineer or attempt to extract source code</li>
            <li>Share your account credentials with others</li>
            <li>Record conversations without proper consent from all parties</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">9. AI-Generated Content</h2>
          <p className="text-muted-foreground leading-relaxed">
            Content generated by the App&apos;s AI features (summaries, action items, Q&amp;A responses) is provided
            &quot;as is.&quot; While we strive for accuracy, AI-generated content may contain errors. You should verify
            important information independently.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">10. Disclaimer of Warranties</h2>
          <p className="text-muted-foreground leading-relaxed uppercase">
            The App is provided &quot;as is&quot; without warranties of any kind. We do not warrant that the App
            will be uninterrupted, error-free, or secure.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">11. Limitation of Liability</h2>
          <p className="text-muted-foreground leading-relaxed uppercase">
            To the maximum extent permitted by law, Kreative Koala shall not be liable for any indirect,
            incidental, special, or consequential damages arising from your use of the App.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">12. Termination</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may suspend or terminate your access to the App at any time for violation of these Terms.
            Upon termination, your right to use the App will cease immediately.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">13. Changes to Terms</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may update these Terms from time to time. Continued use of the App after changes constitutes
            acceptance of the new Terms.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">14. Governing Law</h2>
          <p className="text-muted-foreground leading-relaxed">
            These Terms are governed by the laws of the State of California, United States.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">15. Contact</h2>
          <p className="text-muted-foreground">
            Questions? Email us at{' '}
            <a href="mailto:legal@kreativekoala.llc" className="text-primary hover:underline">
              legal@kreativekoala.llc
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
