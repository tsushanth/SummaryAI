'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { askQuestion, getQuestionHistory } from '@/lib/api/questions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { QAItem } from '@/types/api';
import { Send, Loader2, User, Sparkles, Clock } from 'lucide-react';
import { formatDuration } from '@/lib/utils/audio';
import { cn } from '@/lib/utils/cn';

interface QAChatProps {
  recordingId: string;
  isReady: boolean;
  onSeek?: (time: number) => void;
}

export function QAChat({ recordingId, isReady, onSeek }: QAChatProps) {
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);

  const { data, mutate } = useSWR(
    recordingId ? ['qa-history', recordingId] : null,
    () => getQuestionHistory(recordingId)
  );

  const questions = data?.questions ?? [];

  const handleAsk = async () => {
    if (!question.trim() || isAsking) return;

    setIsAsking(true);
    try {
      const response = await askQuestion(recordingId, question.trim());
      mutate();
      setQuestion('');
    } catch (error) {
      console.error('Failed to ask question:', error);
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat messages */}
      <div className="flex-1 overflow-auto space-y-4 pb-4">
        {questions.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">Ask questions about this recording</p>
            <p className="text-sm mt-1">
              The AI will answer based on the transcript content
            </p>
          </div>
        ) : (
          [...questions].reverse().map((qa) => (
            <QAMessage key={qa.id} qa={qa} onSeek={onSeek} />
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border pt-4">
        {!isReady ? (
          <p className="text-sm text-muted-foreground text-center py-2">
            Q&A will be available after transcription is complete
          </p>
        ) : (
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question about this recording..."
              onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
              disabled={isAsking}
            />
            <Button onClick={handleAsk} disabled={!question.trim() || isAsking}>
              {isAsking ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function QAMessage({
  qa,
  onSeek,
}: {
  qa: QAItem;
  onSeek?: (time: number) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Question */}
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-accent">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 rounded-md bg-accent p-3">
          <p className="text-foreground">{qa.question}</p>
        </div>
      </div>

      {/* Answer */}
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-accent">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 rounded-md border border-border bg-card p-3">
          <p className="minute whitespace-pre-wrap text-foreground">{qa.answer}</p>

          {/* Citations */}
          {qa.citations && qa.citations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs font-medium text-muted-foreground mb-2">Sources:</p>
              <div className="space-y-1">
                {qa.citations.map((citation, index) => (
                  <button
                    key={index}
                    onClick={() => onSeek?.(citation.timestamp)}
                    className="flex min-h-[32px] items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Clock className="w-3 h-3" />
                    <span>{formatDuration(citation.timestamp)}</span>
                    <span className="text-muted-foreground truncate max-w-xs">
                      {citation.text.substring(0, 50)}...
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Confidence */}
          {qa.confidence !== null && (
            <div className="mt-2">
              <span
                className={cn(
                  'rounded-sm px-2 py-0.5 text-xs font-medium',
                  qa.confidence >= 0.8
                    ? 'bg-success/15 text-success'
                    : qa.confidence >= 0.5
                      ? 'bg-mark text-mark-foreground'
                      : 'bg-secondary text-muted-foreground'
                )}
              >
                {qa.confidence >= 0.8
                  ? 'High confidence'
                  : qa.confidence >= 0.5
                    ? 'Medium confidence'
                    : 'Low confidence'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
