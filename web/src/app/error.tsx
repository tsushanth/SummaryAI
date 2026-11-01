'use client'

import { useEffect } from 'react'
import { reportWebFailure } from '@/components/WebFailureReporter'

// A render error caught by Next's boundary never reaches window.onerror, so report it here.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportWebFailure('react_render_error', error)
  }, [error])
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="mt-2 text-sm text-muted-foreground">The problem has been reported. Try again, or reload the page.</p>
      <button onClick={reset} className="mt-4 rounded-md border px-4 py-2 text-sm">Try again</button>
    </div>
  )
}
