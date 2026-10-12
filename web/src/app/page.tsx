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
  Sparkles,
  ListChecks,
  MessageSquareText,
  AudioLines,
  CalendarCheck,
  PhoneCall,
  Plug,
  Languages,
  type LucideIcon,
} from 'lucide-react';

const FEATURES: { title: string; body: string; icon: LucideIcon }[] = [
  {
    title: 'AI summaries',
    body: 'Key points and decisions pulled out of every meeting, so you skim instead of relisten.',
    icon: Sparkles,
  },
  {
    title: 'Action items',
    body: 'Who owes what, and by when, collected into one list you can check off.',
    icon: ListChecks,
  },
  {
    title: 'Ask across meetings',
    body: 'Ask a question of one recording or all of them and get answers with citations.',
    icon: MessageSquareText,
  },
  {
    title: 'Live transcript',
    body: 'Follow along with a speaker-labeled transcript while the meeting is still happening.',
    icon: AudioLines,
  },
  {
    title: 'Calendar auto-join',
    body: 'Connect Google or Outlook and the bot joins your Zoom, Teams, and Meet calls for you.',
    icon: CalendarCheck,
  },
  {
    title: 'Phone call recording',
    body: 'Place calls from the app and get the same transcript and summary afterwards.',
    icon: PhoneCall,
  },
  {
    title: 'Integrations',
    body: 'Export notes and action items to the tools your team already uses.',
    icon: Plug,
  },
  {
    title: '36+ languages',
    body: 'Detected automatically as people talk, with speaker renaming built in.',
    icon: Languages,
  },
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

const DEMO_RESULTS = [
  'Launch delayed to Q2, pending test results',
  'Marketing: deliver assets — due Friday',
  'Dev: onboard new hire — due Monday',
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 rounded-md">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Mic className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            </span>
            <span className="font-serif text-lg font-medium tracking-tight">Meeting Mind</span>
          </Link>
          <div className="hidden items-center gap-8 text-[15px] text-muted-foreground md:flex">
            <a href="#features" className="rounded-sm hover:text-foreground">Features</a>
            <a href="#platforms" className="rounded-sm hover:text-foreground">Download</a>
            <a href="#pricing" className="rounded-sm hover:text-foreground">Pricing</a>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/auth"
              className="hidden rounded-sm text-[15px] text-muted-foreground hover:text-foreground sm:block"
            >
              Sign in
            </Link>
            <Link
              href="/auth"
              className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Start free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-gradient-to-b from-accent to-transparent"
        />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
          <div className="grid gap-14 lg:grid-cols-[1.05fr_1fr] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                AI notes for every meeting and call
              </span>
              <h1 className="mt-6 font-serif text-[2.75rem] font-medium leading-[1.08] tracking-tight sm:text-6xl">
                Meetings you can skim instead of relive.
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
                Meeting Mind listens in the background, then turns the recording into a
                transcript, a summary, and a list of who owes what.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Link
                  href="/auth"
                  className="inline-flex h-12 items-center rounded-full bg-primary px-7 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Start free
                </Link>
                <a
                  href="#features"
                  className="inline-flex h-12 items-center rounded-full border border-input px-6 text-[15px] font-medium text-foreground transition-colors hover:bg-accent"
                >
                  See what it does
                </a>
              </div>
              <p className="mt-5 text-sm text-muted-foreground">No credit card. 7-day free trial.</p>
            </div>

            {/* The mechanism: a real utterance, distilled */}
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
              <p className="text-sm text-muted-foreground">What gets recorded</p>
              <div className="mt-3 space-y-2 border-l-2 border-border pl-4 font-serif text-[1.05rem] italic leading-relaxed text-card-foreground/80">
                <p>
                  <span className="not-italic text-muted-foreground">Priya, 14:02 —</span> so testing
                  pushed the launch to Q2, and marketing still needs new assets by Friday.
                </p>
                <p>
                  <span className="not-italic text-muted-foreground">Dev, 14:03 —</span> and can we get
                  the new hire set up before Monday?
                </p>
              </div>

              <p className="mt-8 text-sm text-muted-foreground">What you get back</p>
              <ul className="mt-3 space-y-3">
                {DEMO_RESULTS.map((line) => (
                  <li key={line} className="flex items-start gap-3">
                    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-success" />
                    <span className="text-[15px] leading-snug">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border bg-muted/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-xl">
            <h2 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
              Everything after &ldquo;let&rsquo;s hop on a call.&rdquo;
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              The same pipeline runs for a standup, a sales call, or a two-hour lecture.
            </p>
          </div>

          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ title, body, icon: Icon }) => (
              <li
                key={title}
                className="rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Platforms */}
      <section id="platforms" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
            Wherever you take meetings.
          </h2>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            Your recordings sync across every device you sign in on.
          </p>

          <div className="mt-10 divide-y divide-border border-y border-border">
            {PLATFORMS.map(({ name, caption, href, icon: Icon }) => (
              <a
                key={name}
                href={href}
                target={href.startsWith('http') ? '_blank' : undefined}
                rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="group flex min-h-14 items-center justify-between px-2 py-4 transition-colors hover:bg-accent/50"
              >
                <span className="flex items-center gap-4">
                  <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                  <span className="text-[15px] font-medium">{name}</span>
                  <span className="text-sm text-muted-foreground">{caption}</span>
                </span>
                <ArrowUpRight
                  className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary"
                  aria-hidden="true"
                />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border bg-muted/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
            One price, wherever you subscribe.
          </h2>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            Subscribing here instead of through the app saves you 30%. Cancel anytime.
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl border p-7 ${
                  plan.highlight ? 'border-primary bg-card ring-1 ring-primary' : 'border-border bg-card'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  {plan.highlight && (
                    <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                      Most popular
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.cadence}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="line-through">{plan.was}</span> · save 30%
                </p>
                {plan.note && <p className="mt-1 text-sm text-muted-foreground">{plan.note}</p>}
                <ul className="mt-6 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[14px] leading-relaxed text-card-foreground/90">
                      <Check
                        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/subscription"
                  className={`mt-8 flex h-11 items-center justify-center rounded-full text-[15px] font-medium transition-colors ${
                    plan.highlight
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                >
                  {plan.highlight ? 'Start free trial' : 'Subscribe'}
                </Link>
              </div>
            ))}
          </div>

          <p className="mt-8 text-sm text-muted-foreground">
            Supports 36+ languages, including Spanish, French, German, Japanese, Korean,
            Mandarin, and Hindi, detected automatically.
          </p>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
            Stop writing down what people say.
          </h2>
          <Link
            href="/auth"
            className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-8 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Start free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-10 text-sm sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2 text-foreground">
            <Mic className="h-4 w-4" aria-hidden="true" />
            <span className="font-serif">Meeting Mind</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="#features" className="rounded-sm hover:text-foreground">Features</a>
            <a href="#pricing" className="rounded-sm hover:text-foreground">Pricing</a>
            <Link href="/privacy" className="rounded-sm hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="rounded-sm hover:text-foreground">Terms</Link>
          </div>
          <p>&copy; {new Date().getFullYear()} Meeting Mind</p>
        </div>
      </footer>
    </div>
  );
}
