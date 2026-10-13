import type { Summary } from '@/types/api';
import { cn } from '@/lib/utils/cn';

interface SummaryCardProps {
  summary: Summary;
  /** Rendered under the action items list (e.g. an "add to todos" button). */
  actionItemsFooter?: React.ReactNode;
}

const priorityText = {
  high: 'text-destructive',
  medium: 'text-warning',
  low: 'text-success',
};

const priorityBar = {
  high: 'bg-destructive',
  medium: 'bg-warning',
  low: 'bg-success',
};

/** Due dates are ISO when the model resolved one, otherwise its own wording ("Friday", "next week"). */
function formatDue(due: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(due) ? new Date(due).toLocaleDateString() : due;
}

/** The minute: serif reading text, plain headings, action items as a margin-marked list. */
export function SummaryCard({ summary, actionItemsFooter }: SummaryCardProps) {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-2 text-xl font-semibold tracking-tight">Summary</h3>
        <p className="minute whitespace-pre-line text-foreground/90">{summary.summary}</p>
      </section>

      {summary.detailed_summary?.trim() && (
        <section>
          <h3 className="mb-2 text-xl font-semibold tracking-tight">Detailed summary</h3>
          <div className="minute space-y-3 text-foreground/90">
            {summary.detailed_summary
              .trim()
              .split(/\n{2,}/)
              .map((para, index) => (
                <p key={index}>{para}</p>
              ))}
          </div>
        </section>
      )}

      {summary.key_points && summary.key_points.length > 0 && (
        <section>
          <h3 className="mb-3 text-xl font-semibold tracking-tight">Key points</h3>
          <ul className="minute list-disc space-y-2 pl-6 marker:text-primary">
            {summary.key_points.map((point, index) => (
              <li key={index} className="pl-1 text-foreground/90">
                {point}
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.action_items && summary.action_items.length > 0 && (
        <section>
          <h3 className="mb-3 text-xl font-semibold tracking-tight">Action items</h3>
          <ul className="space-y-2">
            {summary.action_items.map((item, index) => (
              <li
                key={index}
                className="relative rounded-md bg-card py-3 pl-5 pr-4"
              >
                <span
                  aria-hidden="true"
                  className={cn('absolute inset-y-2 left-1.5 w-1 rounded-full', priorityBar[item.priority])}
                />
                <p className="minute text-foreground/90">{item.text}</p>
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground tabular">
                  {item.assignee && (
                    <div className="flex gap-1">
                      <dt>Assigned to</dt>
                      <dd className="text-foreground">{item.assignee}</dd>
                    </div>
                  )}
                  {item.due_date && (
                    <div className="flex gap-1">
                      <dt>Due</dt>
                      <dd className="text-foreground">{formatDue(item.due_date)}</dd>
                    </div>
                  )}
                  <div className={cn('font-semibold capitalize', priorityText[item.priority])}>
                    {item.priority} priority
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          {actionItemsFooter}
        </section>
      )}

      {summary.topics && summary.topics.length > 0 && (
        <section>
          <h3 className="mb-3 text-xl font-semibold tracking-tight">Topics</h3>
          <ul className="flex flex-wrap gap-2">
            {summary.topics.map((topic, index) => (
              <li
                key={index}
                className="rounded-sm bg-accent px-2.5 py-1 text-sm text-accent-foreground"
              >
                {topic}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
