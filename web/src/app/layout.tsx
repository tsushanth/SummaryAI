import type { Metadata } from 'next';
import { Schibsted_Grotesk, Newsreader } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/auth/AuthProvider';
import WebFailureReporter from '@/components/WebFailureReporter'

// UI + headings: a grotesk with newsroom roots. Reading text (summaries, transcripts): a text serif.
const sans = Schibsted_Grotesk({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const serif = Newsreader({
  subsets: ['latin'],
  axes: ['opsz'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  adjustFontFallback: false,
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Meeting Mind',
  description: 'AI-powered meeting transcription and summarization',
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Follow the OS color scheme before first paint (dashboard tokens switch on .dark) */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark')}}catch(e){}",
          }}
        />
      </head>
      <body className={`${sans.variable} ${serif.variable} font-sans`}>
        <WebFailureReporter />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
