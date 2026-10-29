import Link from 'next/link';
import { RibbonMark } from '@/components/ui/ribbon-mark';
import {
  ArrowUpRight,
  Sparkles,
  Apple,
  Play,
  Laptop,
  Monitor,
  Globe,
  Check,
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
    caption: 'Android 10+, on Google Play',
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
    features: ['Everything in Free', '36+ languages'],
  },
  {
    name: 'Monthly',
    cadence: '/month',
    was: '$14.99',
    price: '$10.49',
    features: [
      'Everything in Free',
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
      'Everything in Free',
      'Ask questions, get cited answers',
      'Meeting bot for Zoom, Teams, Meet',
      'Phone call recording',
    ],
  },
];

/** A real capture of the app (sample meeting), one image per color scheme. */
function Shot({
  name, width, height, alt, priority, className,
}: { name: string; width: number; height: number; alt: string; priority?: boolean; className?: string }) {
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={`/landing/${name}-dark.webp`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/landing/${name}-light.webp`}
        width={width}
        height={height}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className={className}
      />
    </picture>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav aria-label="Primary" className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 rounded-md">
            <RibbonMark className="h-7 w-7" />
            <span className="text-lg font-semibold tracking-tight">MeetingMind</span>
          </Link>
          <div className="hidden items-center gap-8 text-[15px] text-muted-foreground md:flex">
            <a href="#features" className="rounded-sm hover:text-foreground">Features</a>
            <a href="#platforms" className="rounded-sm hover:text-foreground">Download</a>
            <a href="#pricing" className="rounded-sm hover:text-foreground">Pricing</a>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/auth"
              className="hidden min-h-[44px] items-center rounded-sm text-[15px] text-muted-foreground hover:text-foreground sm:flex"
            >
              Sign in
            </Link>
            <Link
              href="/auth"
              className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Start free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero: the one bold place. A speaker ribbon draws in over a short set of minutes. */}
      <section>
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-20">
          <div className="max-w-3xl">
            <h1 className="text-[2.5rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Meetings you can skim instead of relive.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              MeetingMind listens in the background, then turns the recording into a
              transcript, a summary, and a list of who owes what.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href="/auth"
                className="inline-flex h-12 items-center rounded-md bg-primary px-7 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Start free
              </Link>
              <a
                href="#features"
                className="inline-flex min-h-[44px] items-center rounded-sm text-[15px] font-semibold text-foreground underline decoration-2 underline-offset-4 hover:text-primary"
              >
                See what it does
              </a>
              <p className="text-sm text-muted-foreground">7-day free trial on the yearly plan. Cancel anytime.</p>
            </div>
          </div>

          {/* The real app, captured from a sample meeting */}
          <div className="relative mt-12 pb-2 md:mt-14 md:pb-12">
            <figure className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
              <Shot
                name="app"
                width={2560}
                height={1600}
                className="h-auto w-full"
                alt="A meeting in MeetingMind: a colored timeline of who spoke, the summary on the Summary tab, and Transcript and Q&A tabs"
              />
            </figure>
            <figure className="mx-auto w-[260px] overflow-hidden rounded-[1.25rem] border border-border bg-card md:absolute md:bottom-0 md:right-3 md:mx-0 md:w-[17%] md:min-w-[150px]">
              <Shot
                name="phone"
                width={1170}
                height={2532}
                priority
                className="h-auto w-full"
                alt="The same meeting on a phone"
              />
            </figure>
            <p className="mt-3 text-center text-sm text-muted-foreground md:text-left">A sample meeting in MeetingMind. The people and company are made up.</p>
          </div>

          <div className="mt-16 grid items-center gap-10 lg:mt-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Every action has an owner and a date.</h2>
              <p className="mt-4 max-w-md text-lg leading-relaxed text-muted-foreground">
                MeetingMind picks out who agreed to do what and by when, and lists it with a priority.
                Add the whole list to your todos in one tap.
              </p>
            </div>
            <figure className="overflow-hidden rounded-lg border border-border bg-background p-4 sm:p-6">
              <Shot
                name="actions"
                width={1536}
                height={800}
                className="h-auto w-full"
                alt="Action items from the meeting, each with an owner, a due date and a priority"
              />
            </figure>
          </div>
        </div>
      </section>

      {/* Features: how it runs, before / during / after */}
      <section id="features" className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything after &ldquo;let&rsquo;s hop on a call.&rdquo;
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              The same pipeline runs for a standup, a sales call, or a two-hour lecture.
            </p>
          </div>

          <ul className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ title, body, icon: Icon }, i) => (
              <li key={title} className="border-l-[3px] pl-4" style={{ borderLeftColor: SPEAKER_BARS[i % SPEAKER_BARS.length] }}>
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {title}
                </h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Platforms */}
      <section id="platforms" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
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
                className="group flex min-h-14 items-center justify-between gap-3 px-2 py-4 transition-colors hover:bg-accent/50"
              >
                <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                  <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                  <span className="text-[15px] font-semibold">{name}</span>
                  <span className="text-sm text-muted-foreground">{caption}</span>
                </span>
                <ArrowUpRight
                  className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                  aria-hidden="true"
                />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            One price, wherever you subscribe.
          </h2>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            Recording, transcripts and summaries are free. Pro adds Q&amp;A, the meeting bot and phone call recording.
            Subscribing here instead of through the app saves you 30%. Cancel anytime.
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-lg border p-6 sm:p-7 ${
                  plan.highlight ? 'border-primary bg-background ring-1 ring-primary' : 'border-border bg-background'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  {plan.highlight && (
                    <span className="rounded-sm bg-mark px-2 py-0.5 text-xs font-semibold text-mark-foreground">
                      Most popular
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold tracking-tight tabular">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.cadence}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="line-through">{plan.was}</span> before the 30% web saving
                </p>
                {plan.note && <p className="mt-1 text-sm text-muted-foreground">{plan.note}</p>}
                <ul className="mt-6 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[15px] leading-relaxed text-foreground/90">
                      <Check
                        className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-success"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/subscription"
                  className={`mt-8 flex h-11 items-center justify-center rounded-md text-[15px] font-semibold transition-colors ${
                    plan.highlight
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'border border-input bg-card text-foreground hover:bg-accent'
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
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Stop writing down what people say.
          </h2>
          <Link
            href="/auth"
            className="mt-8 inline-flex h-12 items-center rounded-md bg-primary px-8 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Start free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-10 text-sm sm:flex-row sm:justify-between sm:px-6">
          <div className="flex items-center gap-2 text-foreground">
            <RibbonMark className="h-5 w-5" />
            <span className="font-semibold">MeetingMind</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="#features" className="rounded-sm hover:text-foreground">Features</a>
            <a href="#pricing" className="rounded-sm hover:text-foreground">Pricing</a>
            <Link href="/privacy" className="rounded-sm hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="rounded-sm hover:text-foreground">Terms</Link>
          </div>
          <p>&copy; {new Date().getFullYear()} MeetingMind</p>
        </div>
      </footer>
    </div>
  );
}

const SPEAKER_BARS = ['#4A4DCB', '#0B7A75', '#B4501A', '#A33A5B'];
