'use client';

import { Mic, Square, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WaveformVisualizer } from './WaveformVisualizer';
import { formatDuration } from '@/lib/utils/audio';

interface AudioRecorderProps {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function AudioRecorder({
  isRecording,
  isPaused,
  duration,
  error,
  onStart,
  onStop,
  onPause,
  onResume,
}: AudioRecorderProps) {
  return (
    <div className="space-y-4">
      <WaveformVisualizer isRecording={isRecording} isPaused={isPaused} />

      <div className="flex items-center justify-center gap-4">
        {!isRecording ? (
          <Button onClick={onStart} size="lg" className="gap-2">
            <Mic className="h-5 w-5" />
            Start Recording
          </Button>
        ) : (
          <>
            <Button
              onClick={isPaused ? onResume : onPause}
              variant="outline"
              size="lg"
              className="gap-2"
            >
              {isPaused ? (
                <>
                  <Play className="h-5 w-5" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="h-5 w-5" />
                  Pause
                </>
              )}
            </Button>
            <Button onClick={onStop} variant="destructive" size="lg" className="gap-2">
              <Square className="h-5 w-5" />
              Stop
            </Button>
          </>
        )}
      </div>

      {isRecording && (
        <div className="text-center">
          <p className="text-2xl font-mono font-semibold text-gray-900">
            {formatDuration(duration)}
          </p>
          <p className="text-sm text-gray-500">
            {isPaused ? 'Paused' : 'Recording...'}
          </p>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}
