import Link from 'next/link';
import {
  Mic,
  ArrowUpRight,
  Apple,
  Play,
  Laptop,
  Monitor,
  Globe,
  Check,
} from 'lucide-react';

const PIPELINE = [
  {
    title: 'Capture',
    body: 'Record a standup, a sales call, a lecture, or a phone call in the background — screen locked or not.',
  },
  {
    title: 'Transcribe',
    body: 'Get a speaker-labeled transcript in 36+ languages, detected automatically as people talk.',
  },
  {
    title: 'Summarize',
    body: 'Key points, decisions, and who owns what get pulled out, so you can skim instead of relisten.',
  },
  {
    title: 'Act',
    body: 'Ask the recording a question, export the notes, or hand the action items to your team.',
  },
];

const ALSO_INCLUDED = [
  'Meeting bot that joins Zoom, Teams, and Google Meet from your calendar',
  'Search across every recording you’ve ever made',
  'Chat with a transcript and get answers with citations',
  'Speaker renaming, so "Speaker 2" becomes a name',
];

const PLATFORMS = [
  {
    name: 'iPhone & iPad',
    caption: 'iOS 17+',
    href: 'https://apps.apple.com/us/app/meeting-mind/id6757317991',
    icon: Apple,
  },
  {
    name: 'Android',
    caption: 'Android 10+ · on Google Play',
    href: 'https://play.google.com/store/apps/details?id=com.kreativekoala.meetingmind',
    icon: Play,
  },
  {
    name: 'Mac',
    caption: 'Apple Silicon',
    href: 'https://github.com/tsushanth/SummaryAI/releases',
    icon: Laptop,
  },
  {
    name: 'Windows',
    caption: 'Windows 10+',
    href: 'https://github.com/tsushanth/SummaryAI/releases',
    icon: Monitor,
  },
  {
    name: 'Browser',
    caption: 'No install',
    href: '/auth',
    icon: Globe,
  },
];

const PLANS = [
  {
    name: 'Weekly',
    cadence: '/week',
    was: '$6.99',
    price: '$4.89',
    features: ['Unlimited recording', 'Transcripts & summaries', '36+ languages'],
  },
  {
    name: 'Monthly',
    cadence: '/month',
    was: '$14.99',
    price: '$10.49',
    features: [
      'Unlimited recording',
      'Transcripts & summaries',
      'Ask questions, get cited answers',
      'Meeting bot for Zoom, Teams, Meet',
      'Phone call recording',
    ],
  },
  {
    name: 'Yearly',
    cadence: '/year',
    was: '$69.99',
    price: '$48.99',
    note: 'Works out to $4.08/month',
    highlight: true,
    features: [
      '7-day free trial',
      'Unlimited recording',
      'Transcripts & summaries',
      'Ask questions, get cited answers',
      'Meeting bot for Zoom, Teams, Meet',
      'Phone call recording',
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-ink/10 bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-brand-indigo" strokeWidth={2.25} />
            <span className="font-serif text-lg font-medium tracking-tight">Meeting Mind</span>
          </div>
          <div className="hidden items-center gap-8 text-[15px] text-slate md:flex">
            <a href="#pipeline" className="hover:text-ink">How it works</a>
            <a href="#platforms" className="hover:text-ink">Download</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/auth" className="hidden text-[15px] text-slate hover:text-ink sm:block">
              Sign in
            </Link>
            <Link
              href="/auth"
              className="rounded-full bg-ink px-5 py-2.5 text-[15px] font-medium text-paper transition-colors hover:bg-brand-indigo"
            >
              Start free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
        <div className="grid gap-14 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div>
            <h1 className="font-serif text-[2.75rem] font-medium leading-[1.08] tracking-tight sm:text-6xl">
              Meetings you can skim instead of relive.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-slate">
              Meeting Mind listens in the background, then turns the recording into a
              transcript, a summary, and a list of who owes what.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/auth"
                className="rounded-full bg-brand-indigo px-7 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-ink"
              >
                Start free
              </Link>
              <a
                href="#pipeline"
                className="text-[15px] font-medium text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink"
              >
                See how it works
              </a>
            </div>
            <p className="mt-5 text-sm text-slate">No credit card. 7-day free trial.</p>
          </div>

          {/* The mechanism: a real utterance, distilled */}
          <div className="rounded-2xl border border-ink/10 bg-white/60 p-6 sm:p-8">
            <p className="text-sm text-slate">What gets recorded</p>
            <div className="mt-3 space-y-2 border-l-2 border-ink/10 pl-4 font-serif text-[1.05rem] italic leading-relaxed text-ink/80">
              <p>
                <span className="not-italic text-slate">Priya, 14:02 —</span> so testing
                pushed the launch to Q2, and marketing still needs new assets by Friday.
              </p>
              <p>
                <span className="not-italic text-slate">Dev, 14:03 —</span> and can we get
                the new hire set up before Monday?
              </p>
            </div>

            <p className="mt-8 text-sm text-slate">What you get back</p>
            <ul className="mt-3 space-y-3">
              <li className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-signal" />
                <span className="text-[15px] leading-snug">
                  Launch delayed to Q2, pending test results
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-signal" />
                <span className="text-[15px] leading-snug">
                  Marketing: deliver assets — due Friday
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-signal" />
                <span className="text-[15px] leading-snug">
                  Dev: onboard new hire — due Monday
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section id="pipeline" className="border-t border-ink/10 bg-white/50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-xl">
            <h2 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
              Four steps, no notepad.
            </h2>
            <p className="mt-4 text-lg text-slate">
              The same pipeline runs for a standup, a sales call, or a two-hour lecture.
            </p>
          </div>

          <ol className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2">
            {PIPELINE.map((step, i) => (
              <li key={step.title} className="flex gap-5">
                <span className="font-serif text-3xl font-medium text-ink/20">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-slate">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-16 border-t border-ink/10 pt-10">
            <p className="text-sm font-medium text-slate">Also included</p>
            <ul className="mt-4 grid gap-x-10 gap-y-3 sm:grid-cols-2">
              {ALSO_INCLUDED.map((item) => (
                <li key={item} className="flex gap-3 text-[15px] leading-relaxed">
                  <span className="text-ink/30">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Platforms */}
      <section id="platforms" className="border-t border-ink/10">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
            Wherever you take meetings.
          </h2>
          <p className="mt-4 max-w-xl text-lg text-slate">
            Your recordings sync across every device you sign in on.
          </p>

          <div className="mt-10 divide-y divide-ink/10 border-y border-ink/10">
            {PLATFORMS.map(({ name, caption, href, icon: Icon }) => (
              <a
                key={name}
                href={href}
                target={href.startsWith('http') ? '_blank' : undefined}
                rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="group flex items-center justify-between py-5 transition-colors hover:bg-white/60"
              >
                <span className="flex items-center gap-4">
                  <Icon className="h-5 w-5 text-ink/60" strokeWidth={1.75} />
                  <span className="text-[15px] font-medium">{name}</span>
                  <span className="text-sm text-slate">{caption}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 text-ink/30 transition-colors group-hover:text-brand-indigo" />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-ink/10 bg-white/50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
            One price, wherever you subscribe.
          </h2>
          <p className="mt-4 max-w-xl text-lg text-slate">
            Subscribing here instead of through the app saves you 30%. Cancel anytime.
          </p>

          <div className="mt-12 grid divide-y divide-ink/10 border-y border-ink/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`px-2 py-8 sm:px-8 ${plan.highlight ? 'bg-brand-indigo/5' : ''}`}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  {plan.highlight && (
                    <span className="text-xs font-medium text-brand-indigo">Most popular</span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
                  <span className="text-sm text-slate">{plan.cadence}</span>
                </div>
                <p className="mt-1 text-sm text-slate">
                  <span className="line-through">{plan.was}</span> · save 30%
                </p>
                {plan.note && <p className="mt-1 text-sm text-slate">{plan.note}</p>}
                <ul className="mt-6 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[14px] leading-relaxed text-ink/80">
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-signal" strokeWidth={2.5} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/subscription"
                  className={`mt-8 block rounded-full py-3 text-center text-[15px] font-medium transition-colors ${
                    plan.highlight
                      ? 'bg-brand-indigo text-white hover:bg-ink'
                      : 'bg-ink/5 text-ink hover:bg-ink/10'
                  }`}
                >
                  {plan.highlight ? 'Start free trial' : 'Subscribe'}
                </Link>
              </div>
            ))}
          </div>

          <p className="mt-8 text-sm text-slate">
            Supports 36+ languages, including Spanish, French, German, Japanese, Korean,
            Mandarin, and Hindi, detected automatically.
          </p>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-ink/10 bg-ink">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="font-serif text-3xl font-medium tracking-tight text-paper sm:text-4xl">
            Stop writing down what people say.
          </h2>
          <Link
            href="/auth"
            className="mt-8 inline-block rounded-full bg-brand-lavender px-8 py-3.5 text-[15px] font-medium text-ink transition-colors hover:bg-white"
          >
            Start free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-ink text-paper/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-10 text-sm sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2 text-paper">
            <Mic className="h-4 w-4" />
            <span className="font-serif">Meeting Mind</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="#pipeline" className="hover:text-paper">How it works</a>
            <a href="#pricing" className="hover:text-paper">Pricing</a>
            <Link href="/privacy" className="hover:text-paper">Privacy</Link>
            <Link href="/terms" className="hover:text-paper">Terms</Link>
          </div>
          <p>&copy; {new Date().getFullYear()} Meeting Mind</p>
        </div>
      </footer>
    </div>
  );
}
