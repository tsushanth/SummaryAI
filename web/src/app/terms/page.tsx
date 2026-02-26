import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service - Meeting Mind',
  description: 'Meeting Mind Terms of Service - Terms and conditions for using the application.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white py-16">
      <div className="max-w-[900px] mx-auto px-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-gray-500 text-sm mb-12">Last updated: February 25, 2026</p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">1. Agreement to Terms</h2>
          <p className="text-gray-600 leading-relaxed">
            By downloading, installing, or using the Meeting Mind mobile application (&quot;App&quot;), you agree to be bound
            by these Terms of Service. If you do not agree, do not use the App.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">2. Description of Service</h2>
          <p className="text-gray-600 mb-3">Meeting Mind uses artificial intelligence to:</p>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li>Transcribe audio recordings with speaker identification</li>
            <li>Generate meeting summaries and action items</li>
            <li>Answer questions about your recordings</li>
            <li>Manage phone calls and call recordings</li>
            <li>Sync with calendar services</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">3. Account Registration</h2>
          <p className="text-gray-600 mb-3">To use certain features, you must create an account. You agree to:</p>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li>Provide accurate and complete information</li>
            <li>Maintain the security of your account credentials</li>
            <li>Notify us immediately of any unauthorized use</li>
            <li>Accept responsibility for all activities under your account</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">4. Subscriptions and Payments</h2>

          <h3 className="text-lg font-medium text-gray-700 mb-3">Free Tier</h3>
          <p className="text-gray-600 mb-4">
            Free users can record up to 10 minutes per recording. Pro features require a paid subscription.
          </p>

          <h3 className="text-lg font-medium text-gray-700 mb-3">Billing</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-2 mb-4">
            <li>Subscriptions are billed in advance on a recurring basis</li>
            <li>Payment is processed through Apple App Store or Google Play Store</li>
            <li>Subscriptions automatically renew unless canceled at least 24 hours before the end of the current period</li>
          </ul>

          <h3 className="text-lg font-medium text-gray-700 mb-3">Refunds</h3>
          <p className="text-gray-600">
            Refunds are handled by Apple or Google according to their respective refund policies.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">5. User Content</h2>
          <p className="text-gray-600 leading-relaxed mb-3">
            You retain ownership of all content you upload, record, or create. By using the App, you grant us
            a limited license to process your content as necessary to provide our services.
          </p>
          <p className="text-gray-600 leading-relaxed">
            You agree not to upload content that infringes on intellectual property rights, contains malware,
            is illegal or defamatory, or violates the privacy of others.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">6. AI Services and Data Processing</h2>
          <p className="text-gray-600 leading-relaxed mb-3">
            Meeting Mind uses cloud-based AI services to provide transcription, summarization, action item extraction,
            and Q&amp;A features. By using these features, you acknowledge and consent to your content being processed
            by the third-party services identified in our{' '}
            <a href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</a>.
            These services include Deepgram (transcription), OpenAI GPT-4 (summaries and Q&amp;A), Twilio (phone calls),
            and Supabase (authentication and storage).
          </p>
          <p className="text-gray-600 leading-relaxed">
            You may revoke this consent at any time in the app&apos;s Settings under Data &amp; Privacy, which will
            prevent the app from sending your data to AI services. Without consent, AI-powered features
            (transcription, summaries, and Q&amp;A) will be unavailable.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">7. Recording Consent</h2>
          <p className="text-gray-600 leading-relaxed">
            You are responsible for complying with all applicable laws regarding the recording of conversations.
            Many jurisdictions require all-party consent before recording. Always ensure you have permission from
            all participants before recording a meeting or phone call.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">8. Acceptable Use</h2>
          <p className="text-gray-600 mb-3">You agree not to:</p>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
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
          <p className="text-gray-600 leading-relaxed">
            Content generated by the App&apos;s AI features (summaries, action items, Q&amp;A responses) is provided
            &quot;as is.&quot; While we strive for accuracy, AI-generated content may contain errors. You should verify
            important information independently.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">10. Disclaimer of Warranties</h2>
          <p className="text-gray-600 leading-relaxed uppercase">
            The App is provided &quot;as is&quot; without warranties of any kind. We do not warrant that the App
            will be uninterrupted, error-free, or secure.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">11. Limitation of Liability</h2>
          <p className="text-gray-600 leading-relaxed uppercase">
            To the maximum extent permitted by law, Kreative Koala shall not be liable for any indirect,
            incidental, special, or consequential damages arising from your use of the App.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">12. Termination</h2>
          <p className="text-gray-600 leading-relaxed">
            We may suspend or terminate your access to the App at any time for violation of these Terms.
            Upon termination, your right to use the App will cease immediately.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">13. Changes to Terms</h2>
          <p className="text-gray-600 leading-relaxed">
            We may update these Terms from time to time. Continued use of the App after changes constitutes
            acceptance of the new Terms.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">14. Governing Law</h2>
          <p className="text-gray-600 leading-relaxed">
            These Terms are governed by the laws of the State of California, United States.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">15. Contact</h2>
          <p className="text-gray-600">
            Questions? Email us at{' '}
            <a href="mailto:legal@kreativekoala.llc" className="text-blue-600 hover:underline">
              legal@kreativekoala.llc
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
