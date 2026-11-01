'use client'

import { useEffect } from 'react'
import { reportWebFailure } from '@/components/WebFailureReporter'

// Last-resort boundary (errors in the root layout itself). Must render its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportWebFailure('react_global_error', error)
  }, [error])
  return (
    <html>
      <body style={{ fontFamily: 'sans-serif', padding: 32, textAlign: 'center' }}>
        <h2>Something went wrong</h2>
        <p>The problem has been reported.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  )
}
