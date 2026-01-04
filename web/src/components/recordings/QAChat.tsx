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
          <div className="text-center py-10 text-gray-500">
            <Sparkles className="w-12 h-12 mx-auto mb-3 text-gray-300" />
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
      <div className="border-t pt-4">
        {!isReady ? (
          <p className="text-sm text-gray-500 text-center py-2">
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
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-blue-600" />
        </div>
        <div className="flex-1 bg-blue-50 rounded-lg p-3">
          <p className="text-gray-800">{qa.question}</p>
        </div>
      </div>

      {/* Answer */}
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-purple-600" />
        </div>
        <div className="flex-1 bg-white border rounded-lg p-3">
          <p className="text-gray-800 whitespace-pre-wrap">{qa.answer}</p>

          {/* Citations */}
          {qa.citations && qa.citations.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs font-medium text-gray-500 mb-2">Sources:</p>
              <div className="space-y-1">
                {qa.citations.map((citation, index) => (
                  <button
                    key={index}
                    onClick={() => onSeek?.(citation.timestamp)}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                  >
                    <Clock className="w-3 h-3" />
                    <span>{formatDuration(citation.timestamp)}</span>
                    <span className="text-gray-500 truncate max-w-xs">
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
                  'text-xs px-2 py-0.5 rounded',
                  qa.confidence >= 0.8
                    ? 'bg-green-100 text-green-700'
                    : qa.confidence >= 0.5
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-gray-100 text-gray-600'
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
