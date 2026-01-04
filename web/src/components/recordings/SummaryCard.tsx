import type { Summary } from '@/types/api';
import { CheckCircle, AlertCircle, Tag } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface SummaryCardProps {
  summary: Summary;
}

const priorityColors = {
  high: 'text-red-600',
  medium: 'text-orange-600',
  low: 'text-green-600',
};

export function SummaryCard({ summary }: SummaryCardProps) {
  return (
    <div className="space-y-6">
      {/* Main Summary */}
      <div>
        <h3 className="text-lg font-semibold mb-2">Summary</h3>
        <p className="text-gray-700 leading-relaxed">{summary.summary}</p>
      </div>

      {/* Key Points */}
      {summary.key_points && summary.key_points.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Key Points</h3>
          <ul className="space-y-2">
            {summary.key_points.map((point, index) => (
              <li key={index} className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                <span className="text-gray-700">{point}</span>
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
                className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
              >
                <AlertCircle
                  className={cn(
                    'w-5 h-5 mt-0.5 flex-shrink-0',
                    priorityColors[item.priority]
                  )}
                />
                <div className="flex-1">
                  <p className="text-gray-700">{item.text}</p>
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
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
                className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
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
