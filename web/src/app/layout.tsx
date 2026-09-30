import type { Metadata } from 'next';
import { Inter, Fraunces } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/auth/AuthProvider';
import WebFailureReporter from '@/components/WebFailureReporter'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
// Display serif for the marketing site's headlines — the dashboard keeps using Inter alone.
const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz', 'SOFT', 'WONK'],
  variable: '--font-serif',
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
    <html lang="en">
      <body className={`${inter.variable} ${fraunces.variable} font-sans`}>
        <WebFailureReporter />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
