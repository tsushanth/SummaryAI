import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GoogleSignIn } from '@/components/auth/GoogleSignIn';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

export default function AuthPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-primary rounded-2xl flex items-center justify-center">
            <svg
              className="w-10 h-10 text-primary-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          </div>
          <CardTitle className="text-2xl">Meeting Mind</CardTitle>
          <CardDescription>
            AI-powered meeting transcription and summarization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Suspense fallback={<div className="h-12 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>}>
            <GoogleSignIn />
          </Suspense>
          <p className="text-xs text-center text-muted-foreground">
            By continuing, you agree to our{' '}
            <Link href="/terms" className="rounded-sm underline underline-offset-2 hover:text-foreground">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="rounded-sm underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
          </p>
        </CardContent>
      </Card>
      <Link href="/" className="rounded-sm text-sm text-muted-foreground hover:text-foreground">
        Back to home
      </Link>
    </div>
  );
}
