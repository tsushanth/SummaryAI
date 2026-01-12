'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Lightbulb,
  MessageCircleQuestion,
  GitCompare,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { LiveInsight, VerificationStatus } from '@/types/api';

interface AIInsightsPanelProps {
  insights: LiveInsight[];
  groupedInsights: {
    fact_checks: LiveInsight[];
    key_points: LiveInsight[];
    questions: LiveInsight[];
    contradictions: LiveInsight[];
  };
  isLoading: boolean;
}

function getVerificationIcon(status: VerificationStatus | null) {
  switch (status) {
    case 'verified':
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case 'disputed':
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    case 'false':
      return <XCircle className="w-4 h-4 text-red-500" />;
    default:
      return <HelpCircle className="w-4 h-4 text-gray-400" />;
  }
}

function getVerificationLabel(status: VerificationStatus | null) {
  switch (status) {
    case 'verified':
      return 'Verified';
    case 'disputed':
      return 'Disputed';
    case 'false':
      return 'Incorrect';
    default:
      return 'Unverified';
  }
}

interface InsightSectionProps {
  title: string;
  icon: React.ReactNode;
  insights: LiveInsight[];
  defaultOpen?: boolean;
  renderInsight: (insight: LiveInsight) => React.ReactNode;
}

function InsightSection({
  title,
  icon,
  insights,
  defaultOpen = true,
  renderInsight,
}: InsightSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (insights.length === 0) {
    return null;
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-sm">{title}</span>
          <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
            {insights.length}
          </span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {isOpen && (
        <div className="divide-y">
          {insights.map((insight) => (
            <div key={insight.id} className="p-3">
              {renderInsight(insight)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AIInsightsPanel({
  insights,
  groupedInsights,
  isLoading,
}: AIInsightsPanelProps) {
  if (insights.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <Lightbulb className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-sm">No insights yet</p>
        <p className="text-xs mt-1">AI insights will appear as the meeting progresses</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Key Points */}
      <InsightSection
        title="Key Points"
        icon={<Lightbulb className="w-4 h-4 text-amber-500" />}
        insights={groupedInsights.key_points}
        renderInsight={(insight) => (
          <div className="flex gap-2">
            <span className="text-amber-500 mt-0.5">•</span>
            <p className="text-sm text-gray-700">{insight.content}</p>
          </div>
        )}
      />

      {/* Fact Checks */}
      <InsightSection
        title="Fact Checks"
        icon={<CheckCircle className="w-4 h-4 text-green-500" />}
        insights={groupedInsights.fact_checks}
        renderInsight={(insight) => (
          <div className="space-y-1">
            <div className="flex items-start gap-2">
              {getVerificationIcon(insight.verification_status)}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700">{insight.content}</p>
                <span
                  className={cn(
                    'text-xs',
                    insight.verification_status === 'verified' && 'text-green-600',
                    insight.verification_status === 'disputed' && 'text-yellow-600',
                    insight.verification_status === 'false' && 'text-red-600',
                    !insight.verification_status && 'text-gray-500'
                  )}
                >
                  {getVerificationLabel(insight.verification_status)}
                  {insight.confidence &&
                    ` (${Math.round(insight.confidence * 100)}% confidence)`}
                </span>
              </div>
            </div>
            {insight.context && (
              <p className="text-xs text-gray-500 ml-6 italic">"{insight.context}"</p>
            )}
          </div>
        )}
      />

      {/* Suggested Questions */}
      <InsightSection
        title="Suggested Questions"
        icon={<MessageCircleQuestion className="w-4 h-4 text-blue-500" />}
        insights={groupedInsights.questions}
        renderInsight={(insight) => (
          <p className="text-sm text-gray-700">{insight.content}</p>
        )}
      />

      {/* Contradictions / Cross-meeting */}
      <InsightSection
        title="Cross-Meeting Insights"
        icon={<GitCompare className="w-4 h-4 text-purple-500" />}
        insights={groupedInsights.contradictions}
        defaultOpen={groupedInsights.contradictions.length > 0}
        renderInsight={(insight) => (
          <div className="space-y-2">
            <p className="text-sm text-gray-700">{insight.content}</p>
            {insight.related_recording_id && (
              <Link
                href={`/recordings/${insight.related_recording_id}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View related recording
                <ExternalLink className="w-3 h-3" />
              </Link>
            )}
          </div>
        )}
      />

      {/* Loading indicator */}
      {isLoading && insights.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      )}
    </div>
  );
}
