import type { Summary } from '@/types/api';
import { CheckCircle, AlertCircle, Tag } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface SummaryCardProps {
  summary: Summary;
}

const priorityColors = {
  high: 'text-destructive',
  medium: 'text-amber-700 dark:text-amber-300',
  low: 'text-success',
};

export function SummaryCard({ summary }: SummaryCardProps) {
  return (
    <div className="space-y-6">
      {/* Main Summary */}
      <div>
        <h3 className="text-lg font-semibold mb-2">Summary</h3>
        <p className="text-foreground/90 leading-relaxed">{summary.summary}</p>
      </div>

      {/* Key Points */}
      {summary.key_points && summary.key_points.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Key Points</h3>
          <ul className="space-y-2">
            {summary.key_points.map((point, index) => (
              <li key={index} className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
                <span className="text-foreground/90">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Items */}
      {summary.action_items && summary.action_items.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Action Items</h3>
          <ul className="space-y-3">
            {summary.action_items.map((item, index) => (
              <li
                key={index}
                className="flex items-start gap-3 p-3 bg-muted rounded-lg"
              >
                <AlertCircle
                  className={cn(
                    'w-5 h-5 mt-0.5 flex-shrink-0',
                    priorityColors[item.priority]
                  )}
                />
                <div className="flex-1">
                  <p className="text-foreground/90">{item.text}</p>
                  <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                    {item.assignee && <span>Assigned to: {item.assignee}</span>}
                    {item.due_date && (
                      <span>
                        Due: {new Date(item.due_date).toLocaleDateString()}
                      </span>
                    )}
                    <span
                      className={cn(
                        'capitalize font-medium',
                        priorityColors[item.priority]
                      )}
                    >
                      {item.priority} priority
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Topics */}
      {summary.topics && summary.topics.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Topics</h3>
          <div className="flex flex-wrap gap-2">
            {summary.topics.map((topic, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 px-3 py-1 bg-accent text-accent-foreground rounded-full text-sm"
              >
                <Tag className="w-3 h-3" />
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
