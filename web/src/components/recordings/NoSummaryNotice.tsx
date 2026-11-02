import Link from 'next/link';
import { Mic } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import type { SummaryView } from '@/lib/summaryState';

/** Summary tab when there is nothing to summarise: says why, and offers Record again (see lib/summaryState.ts). */
export function NoSummaryNotice({ view }: { view: Exclude<SummaryView, { kind: 'summary' }> }) {
  if (view.kind === 'too_short' || view.kind === 'no_speech' || view.kind === 'failed_upload') {
    return (
      <div role="status" data-testid={`summary-${view.kind}`}>
        <EmptyState
          icon={<Mic />}
          title={view.title}
          message={view.body}
          action={
            <Link href={view.action.href} className={buttonVariants()}>
              {view.action.label}
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div className="py-10 text-muted-foreground">
      <p>{view.body}</p>
    </div>
  );
}
