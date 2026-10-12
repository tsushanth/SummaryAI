'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useRecording } from '@/hooks/useRecordings';
import { StatusBadge } from '@/components/recordings/StatusBadge';
import { TranscriptViewer } from '@/components/recordings/TranscriptViewer';
import { SummaryCard } from '@/components/recordings/SummaryCard';
import { QAChat } from '@/components/recordings/QAChat';
import { AudioPlayer, type SeekRequest } from '@/components/audio/AudioPlayer';
import { Skeleton } from '@/components/ui/skeleton';
import { ExportMenu } from '@/components/recordings/ExportMenu';
import { ShareLinkPanel } from '@/components/recordings/ShareLinkPanel';
import { RecordingOrganizer } from '@/components/recordings/RecordingOrganizer';
import { SummaryTemplatePanel } from '@/components/recordings/SummaryTemplatePanel';
import { ActionItemsToTodosButton } from '@/components/recordings/ActionItemsToTodosButton';
import { formatDuration, formatDate } from '@/lib/utils/audio';
import {
  ArrowLeft,
  Clock,
  FileText,
  Calendar,
  Loader2,
  Star,
  Globe,
} from 'lucide-react';

// Language code to display name mapping (Deepgram supported languages)
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  hi: 'Hindi',
  ru: 'Russian',
  tr: 'Turkish',
  pl: 'Polish',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  id: 'Indonesian',
  th: 'Thai',
  ar: 'Arabic',
  cs: 'Czech',
  da: 'Danish',
  fi: 'Finnish',
  el: 'Greek',
  he: 'Hebrew',
  hu: 'Hungarian',
  ms: 'Malay',
  no: 'Norwegian',
  ro: 'Romanian',
  sk: 'Slovak',
  sv: 'Swedish',
  ta: 'Tamil',
  te: 'Telugu',
  bn: 'Bengali',
  tl: 'Tagalog',
  'zh-TW': 'Cantonese',
};
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
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null);
  const [isUpdatingSpeakers, setIsUpdatingSpeakers] = useState(false);

  const handleSeek = (time: number) => {
    // Moves the audio player; its timeupdate then keeps currentTime in sync
    setCurrentTime(time);
    setSeekRequest({ time, nonce: Date.now() });
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
      <div role="status" aria-label="Loading recording" className="space-y-4 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
        <span className="sr-only">Loading recording</span>
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="p-6">
        <Link
          href="/recordings"
          className="inline-flex items-center text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to recordings
        </Link>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Recording not found</p>
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
      <div className="border-b border-border bg-card p-6">
        <Link
          href="/recordings"
          className="inline-flex items-center text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to recordings
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold">{recording.title}</h1>
              <StatusBadge status={recording.status} />
              <button
                onClick={toggleFavorite}
                aria-pressed={recording.is_favorite}
                aria-label={recording.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-accent"
              >
                <Star
                  className={cn(
                    'w-5 h-5',
                    recording.is_favorite
                      ? 'text-amber-500 fill-amber-500'
                      : 'text-muted-foreground/60'
                  )}
                />
              </button>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
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
              {recording.language && (
                <span className="flex items-center gap-1">
                  <Globe className="w-4 h-4" />
                  {LANGUAGE_NAMES[recording.language] || recording.language.toUpperCase()}
                </span>
              )}
            </div>
            <RecordingOrganizer recording={recording} onChanged={refresh} />
          </div>
          <div className="flex items-center gap-2">
            <ExportMenu recording={recording} summary={summary} transcript={transcript} />
            <ShareLinkPanel recordingId={recording.id} />
          </div>
        </div>

        {/* Processing banner */}
        {isProcessing && (
          <div className="mt-4 p-3 bg-accent border border-border rounded-lg flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-accent-foreground">
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
      <div className="border-b border-border bg-card px-6">
        <nav className="flex gap-6" role="tablist" aria-label="Recording sections">
          {(['transcript', 'summary', 'qa'] as Tab[]).map((tab) => {
            const isPremiumTab = tab === 'summary' || tab === 'qa';
            const showLock = isPremiumTab && !isSubscribed;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'min-h-[44px] py-3 border-b-2 text-sm font-medium transition-colors capitalize flex items-center gap-1.5',
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {tab === 'qa' ? 'Q&A' : tab}
                {showLock && (
                  <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
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
              <div className="text-center py-10 text-muted-foreground">
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
            <PremiumGate feature="aiSummaries">
              {summary ? (
                <>
                  <SummaryTemplatePanel
                    recordingId={recording.id}
                    currentTemplate={recording.summary_template}
                    onRegenerated={refresh}
                  />
                  <SummaryCard
                    summary={summary}
                    actionItemsFooter={<ActionItemsToTodosButton recordingId={recording.id} />}
                  />
                </>
              ) : (
                <div className="text-center py-10 text-muted-foreground">
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
            <PremiumGate feature="qaChat">
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
        <div className="border-t border-border p-4 bg-card">
          <div className="max-w-3xl mx-auto">
            <AudioPlayer
              src={audioUrl}
              onTimeUpdate={setCurrentTime}
              seekRequest={seekRequest}
            />
          </div>
        </div>
      )}
    </div>
  );
}
