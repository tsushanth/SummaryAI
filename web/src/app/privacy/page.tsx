import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - Meeting Mind',
  description: 'Meeting Mind Privacy Policy - How we collect, use, and protect your information.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white py-16">
      <div className="max-w-[900px] mx-auto px-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-gray-500 text-sm mb-12">Last updated: February 25, 2026</p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Introduction</h2>
          <p className="text-gray-600 leading-relaxed">
            Kreative Koala (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates the Meeting Mind mobile application.
            This Privacy Policy explains how we collect, use, and protect your information.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Information We Collect</h2>

          <h3 className="text-lg font-medium text-gray-700 mb-3">Information You Provide</h3>
          <ul className="list-disc list-inside text-gray-600 mb-4 space-y-2">
            <li><strong>Account Information:</strong> Email address and password (stored securely via Supabase authentication)</li>
            <li><strong>Content:</strong> Audio recordings, meeting transcripts, and any content you create</li>
            <li><strong>Preferences:</strong> Your app settings and customization choices</li>
          </ul>

          <h3 className="text-lg font-medium text-gray-700 mb-3">Information Collected Automatically</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li><strong>Usage Data:</strong> Features accessed, time spent, and interaction patterns</li>
            <li><strong>Device Information:</strong> Device type, operating system, and unique identifiers</li>
            <li><strong>Analytics:</strong> App performance and user experience data (via Firebase Analytics)</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">How We Use Your Information</h2>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li>Provide and improve the App&apos;s functionality</li>
            <li>Transcribe your audio recordings using AI speech-to-text services</li>
            <li>Generate AI-powered summaries, action items, and Q&amp;A from your transcripts</li>
            <li>Personalize your experience</li>
            <li>Send updates, security alerts, and support messages</li>
            <li>Analyze usage patterns to improve the App</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Third-Party AI Services</h2>
          <p className="text-gray-600 leading-relaxed mb-4">
            Meeting Mind uses the following third-party AI services to provide its features.
            The app asks for your explicit consent before sending any data to these services.
          </p>

          <h3 className="text-lg font-medium text-gray-700 mb-3">Audio Transcription</h3>
          <p className="text-gray-600 mb-2">When you record or upload audio, it is sent to:</p>
          <ul className="list-disc list-inside text-gray-600 mb-4 space-y-2">
            <li><strong>Deepgram</strong> (deepgram.com) &mdash; converts speech to text with speaker identification and timestamps</li>
          </ul>

          <h3 className="text-lg font-medium text-gray-700 mb-3">AI Summaries &amp; Q&amp;A</h3>
          <p className="text-gray-600 mb-2">When you generate summaries, action items, or ask questions about your recordings, the transcribed text is sent to:</p>
          <ul className="list-disc list-inside text-gray-600 mb-4 space-y-2">
            <li><strong>OpenAI GPT-4</strong> (openai.com) &mdash; generates summaries, extracts action items, and answers questions about your recordings. Data sent via the API is not used for model training.</li>
          </ul>

          <h3 className="text-lg font-medium text-gray-700 mb-3">Phone Calls</h3>
          <p className="text-gray-600 mb-2">When using the phone feature:</p>
          <ul className="list-disc list-inside text-gray-600 mb-4 space-y-2">
            <li><strong>Twilio</strong> (twilio.com) &mdash; VoIP calling infrastructure and call recording</li>
          </ul>

          <h3 className="text-lg font-medium text-gray-700 mb-3">Authentication &amp; Storage</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li><strong>Supabase</strong> (supabase.com) &mdash; provides authentication, database, and file storage services</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Data Storage and Security</h2>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li>User authentication via Supabase with encryption at rest and in transit</li>
            <li>Audio files stored securely in cloud storage</li>
            <li>All data transmission encrypted using HTTPS/TLS</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Data Sharing</h2>
          <p className="text-gray-600 mb-3">We do not sell your personal information. We share data with:</p>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li><strong>Deepgram:</strong> Your audio recordings are sent for speech-to-text transcription.</li>
            <li><strong>OpenAI:</strong> Your transcribed text is sent for AI-powered summaries and Q&amp;A. OpenAI&apos;s API data usage policy prohibits use of API data for model training.</li>
            <li><strong>Twilio:</strong> Phone call audio when using the phone feature.</li>
            <li><strong>Supabase:</strong> Your account information and files are stored with encryption at rest and in transit.</li>
            <li><strong>Legal Requirements:</strong> When required by law</li>
            <li><strong>Business Transfers:</strong> In connection with a merger or acquisition</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Your Rights</h2>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Delete:</strong> Request deletion of your account and data</li>
            <li><strong>Export:</strong> Export your recordings, transcripts, and summaries</li>
            <li><strong>Revoke consent:</strong> Revoke AI data sharing consent at any time in the app&apos;s Settings</li>
            <li><strong>Opt-out:</strong> Disable analytics and non-essential data collection</li>
          </ul>
          <p className="text-gray-600 mt-4">
            To exercise these rights, contact us at{' '}
            <a href="mailto:privacy@kreativekoala.llc" className="text-blue-600 hover:underline">
              privacy@kreativekoala.llc
            </a>
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Data Retention</h2>
          <p className="text-gray-600 leading-relaxed">
            We retain your data while your account is active. When you delete your account,
            we delete your data within 30 days, except where retention is required by law.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Children&apos;s Privacy</h2>
          <p className="text-gray-600 leading-relaxed">
            The App is not intended for children under 13. We do not knowingly collect information from children under 13.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Changes to This Policy</h2>
          <p className="text-gray-600 leading-relaxed">
            We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Contact Us</h2>
          <p className="text-gray-600">
            Questions? Email us at{' '}
            <a href="mailto:privacy@kreativekoala.llc" className="text-blue-600 hover:underline">
              privacy@kreativekoala.llc
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
