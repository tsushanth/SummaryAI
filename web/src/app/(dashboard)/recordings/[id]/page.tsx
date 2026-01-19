'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useRecording } from '@/hooks/useRecordings';
import { StatusBadge } from '@/components/recordings/StatusBadge';
import { TranscriptViewer } from '@/components/recordings/TranscriptViewer';
import { SummaryCard } from '@/components/recordings/SummaryCard';
import { QAChat } from '@/components/recordings/QAChat';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { formatDuration, formatDate } from '@/lib/utils/audio';
import {
  ArrowLeft,
  Clock,
  FileText,
  Calendar,
  Loader2,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { updateRecording, updateSpeakerNames } from '@/lib/api/recordings';
import { useSubscription } from '@/hooks/useSubscription';
import { PremiumGate } from '@/components/subscription/PremiumGate';

type Tab = 'summary' | 'transcript' | 'qa';

export default function RecordingDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { recording, transcript, summary, audioUrl, isLoading, refresh } =
    useRecording(id);
  const { isSubscribed } = useSubscription();
  const [activeTab, setActiveTab] = useState<Tab>('transcript');
  const [currentTime, setCurrentTime] = useState(0);
  const [isUpdatingSpeakers, setIsUpdatingSpeakers] = useState(false);

  const handleSeek = (time: number) => {
    // This would need to be wired up to the audio player
    setCurrentTime(time);
  };

  const toggleFavorite = async () => {
    if (!recording) return;
    await updateRecording(recording.id, { is_favorite: !recording.is_favorite });
    refresh();
  };

  const handleSpeakerNameChange = async (speakerNames: Record<string, string>) => {
    if (!recording) return;
    setIsUpdatingSpeakers(true);
    try {
      await updateSpeakerNames(recording.id, speakerNames);
      refresh();
    } catch (error) {
      console.error('Failed to update speaker names:', error);
    } finally {
      setIsUpdatingSpeakers(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="p-6">
        <Link
          href="/recordings"
          className="inline-flex items-center text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to recordings
        </Link>
        <div className="text-center py-20">
          <p className="text-gray-500">Recording not found</p>
        </div>
      </div>
    );
  }

  const isProcessing = ['pending', 'uploading', 'uploaded', 'transcribing', 'summarizing'].includes(
    recording.status
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white p-6">
        <Link
          href="/recordings"
          className="inline-flex items-center text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to recordings
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold">{recording.title}</h1>
              <StatusBadge status={recording.status} />
              <button onClick={toggleFavorite}>
                <Star
                  className={cn(
                    'w-5 h-5',
                    recording.is_favorite
                      ? 'text-yellow-500 fill-yellow-500'
                      : 'text-gray-300'
                  )}
                />
              </button>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {formatDuration(recording.duration_seconds)}
              </span>
              {recording.word_count && (
                <span className="flex items-center gap-1">
                  <FileText className="w-4 h-4" />
                  {recording.word_count.toLocaleString()} words
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {formatDate(recording.created_at)}
              </span>
            </div>
          </div>
        </div>

        {/* Processing banner */}
        {isProcessing && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            <span className="text-blue-800">
              {recording.status === 'pending'
                ? 'Waiting for meeting to start...'
                : recording.status === 'transcribing'
                  ? 'Transcribing audio...'
                  : recording.status === 'summarizing'
                    ? 'Generating summary...'
                    : 'Processing...'}
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b bg-white px-6">
        <nav className="flex gap-6">
          {(['transcript', 'summary', 'qa'] as Tab[]).map((tab) => {
            const isPremiumTab = tab === 'summary' || tab === 'qa';
            const showLock = isPremiumTab && !isSubscribed;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'py-3 border-b-2 text-sm font-medium transition-colors capitalize flex items-center gap-1.5',
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                )}
              >
                {tab === 'qa' ? 'Q&A' : tab}
                {showLock && (
                  <span className="text-xs bg-gradient-to-r from-primary to-purple-600 text-white px-1.5 py-0.5 rounded-full">
                    PRO
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'transcript' && (
          <div className="max-w-3xl">
            {transcript ? (
              <TranscriptViewer
                transcript={transcript}
                currentTime={currentTime}
                onSeek={handleSeek}
                onSpeakerNameChange={handleSpeakerNameChange}
                isUpdating={isUpdatingSpeakers}
              />
            ) : (
              <div className="text-center py-10 text-gray-500">
                {isProcessing ? (
                  <p>Transcript will appear here once processing is complete</p>
                ) : (
                  <p>No transcript available</p>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'summary' && (
          <div className="max-w-3xl">
            <PremiumGate feature="aiSummaries" featureLabel="AI Summaries">
              {summary ? (
                <SummaryCard summary={summary} />
              ) : (
                <div className="text-center py-10 text-gray-500">
                  {isProcessing ? (
                    <p>Summary will appear here once processing is complete</p>
                  ) : (
                    <p>No summary available</p>
                  )}
                </div>
              )}
            </PremiumGate>
          </div>
        )}

        {activeTab === 'qa' && (
          <div className="max-w-3xl h-[500px]">
            <PremiumGate feature="qaChat" featureLabel="Q&A Chat">
              <QAChat
                recordingId={recording.id}
                isReady={recording.status === 'completed'}
                onSeek={handleSeek}
              />
            </PremiumGate>
          </div>
        )}
      </div>

      {/* Audio Player */}
      {audioUrl && (
        <div className="border-t p-4 bg-white">
          <div className="max-w-3xl mx-auto">
            <AudioPlayer src={audioUrl} onTimeUpdate={setCurrentTime} />
          </div>
        </div>
      )}
    </div>
  );
}
