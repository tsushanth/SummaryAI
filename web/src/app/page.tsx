import Link from 'next/link';
import {
  Mic,
  FileText,
  Brain,
  Phone,
  Calendar,
  CheckCircle,
  ArrowRight,
  Apple,
  Play,
  Monitor,
  Smartphone,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                <Mic className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl">Meeting Mind</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-gray-600 hover:text-gray-900 text-sm font-medium">
                Features
              </a>
              <a href="#platforms" className="text-gray-600 hover:text-gray-900 text-sm font-medium">
                Download
              </a>
              <a href="#pricing" className="text-gray-600 hover:text-gray-900 text-sm font-medium">
                Pricing
              </a>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/auth"
                className="text-gray-600 hover:text-gray-900 text-sm font-medium"
              >
                Sign In
              </Link>
              <Link
                href="/auth"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Get Started Free
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              AI-Powered Meeting Intelligence
            </div>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-gray-900 tracking-tight mb-6">
              Never miss a detail in your{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                meetings
              </span>
            </h1>
            <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
              Meeting Mind automatically records, transcribes, and summarizes your meetings,
              phone calls, and lectures. Get AI-powered insights and never take notes again.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/auth"
                className="w-full sm:w-auto bg-blue-600 text-white px-8 py-4 rounded-xl text-lg font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                Start Free Trial
                <ArrowRight className="w-5 h-5" />
              </Link>
              <a
                href="#platforms"
                className="w-full sm:w-auto bg-gray-100 text-gray-900 px-8 py-4 rounded-xl text-lg font-semibold hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
              >
                Download App
              </a>
            </div>
            <p className="text-sm text-gray-500 mt-4">
              No credit card required. 7-day free trial.
            </p>
          </div>

          {/* Hero Image/Mockup */}
          <div className="mt-16 relative">
            <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent z-10 pointer-events-none"></div>
            <div className="bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl p-8 shadow-2xl">
              <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                <div className="bg-gray-100 px-4 py-3 flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-400"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                    <div className="w-3 h-3 rounded-full bg-green-400"></div>
                  </div>
                  <div className="flex-1 text-center text-sm text-gray-500">Meeting Mind</div>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Mic className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">Weekly Team Standup</div>
                      <div className="text-sm text-gray-500">45 min recorded</div>
                      <div className="mt-2 bg-green-50 text-green-700 text-sm px-3 py-1 rounded-full inline-block">
                        Transcribed & Summarized
                      </div>
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm font-medium text-gray-700 mb-2">Key Points</div>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Product launch delayed to Q2 due to testing requirements
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Marketing team needs updated assets by Friday
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        New hire onboarding starts next Monday
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Everything you need to capture meetings
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Powerful features designed to help you focus on the conversation, not on taking notes.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-6">
                <Mic className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Background Recording
              </h3>
              <p className="text-gray-600">
                Record meetings, lectures, and conversations in the background. Works even with your screen locked.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-8">
              <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center mb-6">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Instant Transcription
              </h3>
              <p className="text-gray-600">
                Get accurate transcripts in 36+ languages with automatic language detection, speaker identification, and timestamps.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-8">
              <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center mb-6">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                AI Summaries
              </h3>
              <p className="text-gray-600">
                Automatically extract key points, action items, and decisions from every meeting.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-8">
              <div className="w-12 h-12 bg-orange-600 rounded-xl flex items-center justify-center mb-6">
                <Phone className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Phone Call Recording
              </h3>
              <p className="text-gray-600">
                Record and transcribe phone calls automatically. Never miss important details from client calls.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="bg-gradient-to-br from-cyan-50 to-sky-50 rounded-2xl p-8">
              <div className="w-12 h-12 bg-cyan-600 rounded-xl flex items-center justify-center mb-6">
                <Calendar className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Meeting Bot
              </h3>
              <p className="text-gray-600">
                Auto-join and record Zoom, Teams, and Google Meet calls from your calendar.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="bg-gradient-to-br from-rose-50 to-red-50 rounded-2xl p-8">
              <div className="w-12 h-12 bg-rose-600 rounded-xl flex items-center justify-center mb-6">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Ask Questions
              </h3>
              <p className="text-gray-600">
                Chat with your recordings. Ask questions and get instant answers with citations.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Download Platforms Section */}
      <section id="platforms" className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Available on all your devices
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Download Meeting Mind on your phone, tablet, or desktop. Your recordings sync across all devices.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* iOS */}
            <a
              href="https://apps.apple.com/us/app/meeting-mind/id6757317991"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100 flex flex-col items-center text-center"
            >
              <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center mb-4">
                <Apple className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">iPhone & iPad</h3>
              <p className="text-sm text-gray-500 mb-4">iOS 17+</p>
              <span className="text-blue-600 font-medium text-sm flex items-center gap-1">
                Download on App Store
                <ArrowRight className="w-4 h-4" />
              </span>
            </a>

            {/* Android */}
            <a
              href="https://play.google.com/store/apps/details?id=com.kreativekoala.summaryai"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100 flex flex-col items-center text-center relative"
            >
              <div className="absolute -top-2 -right-2 bg-amber-400 text-amber-900 text-xs font-bold px-2 py-0.5 rounded-full">
                Coming Soon
              </div>
              <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center mb-4">
                <Play className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Android</h3>
              <p className="text-sm text-gray-500 mb-4">Android 10+</p>
              <span className="text-blue-600 font-medium text-sm flex items-center gap-1">
                Get on Google Play
                <ArrowRight className="w-4 h-4" />
              </span>
            </a>

            {/* macOS */}
            <a
              href="https://github.com/tsushanth/SummaryAI/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100 flex flex-col items-center text-center"
            >
              <div className="w-16 h-16 bg-gray-700 rounded-2xl flex items-center justify-center mb-4">
                <Apple className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">macOS</h3>
              <p className="text-sm text-gray-500 mb-4">Apple Silicon</p>
              <span className="text-blue-600 font-medium text-sm flex items-center gap-1">
                Download for Mac
                <ArrowRight className="w-4 h-4" />
              </span>
            </a>

            {/* Windows */}
            <a
              href="https://github.com/tsushanth/SummaryAI/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100 flex flex-col items-center text-center"
            >
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4">
                <Monitor className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Windows</h3>
              <p className="text-sm text-gray-500 mb-4">Windows 10+</p>
              <span className="text-blue-600 font-medium text-sm flex items-center gap-1">
                Download for Windows
                <ArrowRight className="w-4 h-4" />
              </span>
            </a>
          </div>

          {/* Web App CTA */}
          <div className="mt-12 text-center">
            <p className="text-gray-600 mb-4">Or use Meeting Mind directly in your browser</p>
            <Link
              href="/auth"
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-gray-800 transition-colors"
            >
              <Smartphone className="w-5 h-5" />
              Open Web App
            </Link>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2 rounded-full text-sm font-medium mb-4">
              Save 30% vs App Store
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Simple, transparent pricing
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Subscribe on web and save 30% compared to App Store prices. Cancel anytime.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Weekly Plan */}
            <div className="bg-white rounded-2xl p-8 border border-gray-200 relative">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Weekly</h3>
              <div className="text-sm text-gray-500 mb-1">
                <span className="line-through">$6.99</span>
                <span className="text-green-600 ml-2">Save 30%</span>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-gray-900">$4.89</span>
                <span className="text-gray-500">/week</span>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  Unlimited recording
                </li>
                <li className="flex items-start gap-2 text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  AI transcription & summaries
                </li>
                <li className="flex items-start gap-2 text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  36+ language support
                </li>
              </ul>
              <Link
                href="/subscription"
                className="block w-full text-center bg-gray-100 text-gray-900 px-6 py-3 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                Subscribe Now
              </Link>
            </div>

            {/* Monthly Plan */}
            <div className="bg-white rounded-2xl p-8 border border-gray-200 relative">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Monthly</h3>
              <div className="text-sm text-gray-500 mb-1">
                <span className="line-through">$14.99</span>
                <span className="text-green-600 ml-2">Save 30%</span>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold text-gray-900">$10.49</span>
                <span className="text-gray-500">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2 text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  Unlimited recording
                </li>
                <li className="flex items-start gap-2 text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  AI transcription & summaries
                </li>
                <li className="flex items-start gap-2 text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  Q&A with your recordings
                </li>
                <li className="flex items-start gap-2 text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  Meeting bot for Zoom/Teams/Meet
                </li>
                <li className="flex items-start gap-2 text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  Phone call recording
                </li>
              </ul>
              <Link
                href="/subscription"
                className="block w-full text-center bg-gray-100 text-gray-900 px-6 py-3 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                Subscribe Now
              </Link>
            </div>

            {/* Annual Plan */}
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl p-8 text-white relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-900 text-xs font-bold px-3 py-1 rounded-full">
                BEST VALUE
              </div>
              <h3 className="text-lg font-semibold mb-2">Yearly</h3>
              <div className="text-sm text-blue-200 mb-1">
                <span className="line-through">$69.99</span>
                <span className="text-green-300 ml-2">Save 30%</span>
              </div>
              <div className="mb-2">
                <span className="text-4xl font-bold">$48.99</span>
                <span className="text-blue-200">/year</span>
              </div>
              <div className="text-sm text-blue-200 mb-6">
                Just $4.08/month
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-blue-200 mt-0.5 flex-shrink-0" />
                  7-day free trial
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-blue-200 mt-0.5 flex-shrink-0" />
                  Unlimited recording
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-blue-200 mt-0.5 flex-shrink-0" />
                  AI transcription & summaries
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-blue-200 mt-0.5 flex-shrink-0" />
                  Q&A with your recordings
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-blue-200 mt-0.5 flex-shrink-0" />
                  Meeting bot for Zoom/Teams/Meet
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-blue-200 mt-0.5 flex-shrink-0" />
                  Phone call recording
                </li>
              </ul>
              <Link
                href="/subscription"
                className="block w-full text-center bg-white text-blue-600 px-6 py-3 rounded-xl font-medium hover:bg-blue-50 transition-colors"
              >
                Start Free Trial
              </Link>
            </div>
          </div>

          {/* Language Support Note */}
          <div className="mt-12 text-center">
            <p className="text-gray-500 text-sm">
              🌍 Supports 36+ languages including English, Spanish, French, German, Japanese, Korean, Chinese, Hindi, and more with automatic detection
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-blue-600 to-indigo-700">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Ready to transform how you capture meetings?
          </h2>
          <p className="text-xl text-blue-100 mb-10">
            Join thousands of professionals who never miss a detail.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth"
              className="w-full sm:w-auto bg-white text-blue-600 px-8 py-4 rounded-xl text-lg font-semibold hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
            >
              Get Started Free
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                  <Mic className="w-5 h-5 text-white" />
                </div>
                <span className="font-bold text-xl text-white">Meeting Mind</span>
              </div>
              <p className="text-sm">
                AI-powered meeting transcription and summarization for professionals.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#platforms" className="hover:text-white transition-colors">Download</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-sm text-center">
            <p>&copy; {new Date().getFullYear()} Meeting Mind. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
