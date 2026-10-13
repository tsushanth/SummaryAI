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
import { TalkTimeCard } from '@/components/recordings/TalkTimeCard';
import { SpeakerTimeline } from '@/components/recordings/VoiceRibbon';
import { useRecordingAnalytics } from '@/hooks/useRecordingAnalytics';

type Tab = 'summary' | 'transcript' | 'qa';

export default function RecordingDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { recording, transcript, summary, audioUrl, isLoading, refresh } =
    useRecording(id);
  const { isSubscribed } = useSubscription();
  const { analytics } = useRecordingAnalytics(
    id,
    recording?.status === 'completed',
    JSON.stringify(transcript?.speaker_names ?? {})
  );
  const [activeTab, setActiveTab] = useState<Tab>('summary');
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
      <div role="status" aria-label="Loading recording" className="space-y-4 p-4 sm:p-8">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-40 w-full" />
        <span className="sr-only">Loading recording</span>
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="p-4 sm:p-8">
        <Link
          href="/recordings"
          className="mb-4 inline-flex min-h-[44px] items-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Back to recordings
        </Link>
        <div className="py-20 text-center">
          <p className="text-muted-foreground">Recording not found</p>
        </div>
      </div>
    );
  }

  const isProcessing = ['pending', 'uploading', 'uploaded', 'transcribing', 'summarizing'].includes(
    recording.status
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header: the heading of the minutes */}
      <div className="border-b border-border bg-card px-4 pb-4 pt-3 sm:px-8">
        <Link
          href="/recordings"
          className="mb-2 inline-flex min-h-[44px] items-center rounded-md text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Back to recordings
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-80">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-3xl font-semibold leading-tight tracking-tight">{recording.title}</h1>
              <StatusBadge status={recording.status} />
              <button
                onClick={toggleFavorite}
                aria-pressed={recording.is_favorite}
                aria-label={recording.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent"
              >
                <Star
                  className={cn(
                    'h-5 w-5',
                    recording.is_favorite ? 'fill-warning text-warning' : 'text-muted-foreground'
                  )}
                  aria-hidden="true"
                />
              </button>
            </div>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground tabular">
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                <dt className="sr-only">Recorded</dt>
                <dd>{formatDate(recording.created_at)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" aria-hidden="true" />
                <dt className="sr-only">Length</dt>
                <dd>{formatDuration(recording.duration_seconds)}</dd>
              </div>
              {recording.word_count ? (
                <div className="flex items-center gap-1.5">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  <dd>{recording.word_count.toLocaleString()}</dd>
                  <dt>words</dt>
                </div>
              ) : null}
              {recording.language && (
                <div className="flex items-center gap-1.5">
                  <Globe className="h-4 w-4" aria-hidden="true" />
                  <dt className="sr-only">Language</dt>
                  <dd>{LANGUAGE_NAMES[recording.language] || recording.language.toUpperCase()}</dd>
                </div>
              )}
            </dl>
            <RecordingOrganizer recording={recording} onChanged={refresh} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu recording={recording} summary={summary} transcript={transcript} audioUrl={audioUrl} />
            <ShareLinkPanel recordingId={recording.id} />
          </div>
        </div>

        {/* Speaker timeline: who spoke when, click to jump */}
        {transcript && transcript.segments.length > 0 && (
          <SpeakerTimeline
            className="mt-4"
            segments={transcript.segments}
            speakerNames={transcript.speaker_names}
            currentTime={currentTime}
            onSeek={handleSeek}
          />
        )}

        {/* Processing banner */}
        {isProcessing && (
          <div role="status" className="mt-4 flex items-center gap-3 rounded-md bg-mark p-3 text-mark-foreground">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span>
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
      <div className="border-b border-border bg-card px-4 sm:px-8">
        <nav className="flex gap-6" role="tablist" aria-label="Recording sections">
          {(['summary', 'transcript', 'qa'] as Tab[]).map((tab) => {
            const isPremiumTab = tab === 'summary' || tab === 'qa';
            const showLock = isPremiumTab && !isSubscribed;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'flex min-h-[44px] items-center gap-1.5 border-b-[3px] py-2 text-sm font-semibold capitalize transition-colors',
                  activeTab === tab
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {tab === 'qa' ? 'Q&A' : tab}
                {showLock && (
                  <span className="rounded-sm bg-mark px-1.5 py-0.5 text-xs font-semibold text-mark-foreground">
                    Pro
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-6 sm:px-8">
        {activeTab === 'transcript' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="min-w-0 max-w-3xl space-y-4">
              {transcript ? (
                <TranscriptViewer
                  transcript={transcript}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  onSpeakerNameChange={handleSpeakerNameChange}
                  isUpdating={isUpdatingSpeakers}
                />
              ) : (
                <div className="py-10 text-muted-foreground">
                  {isProcessing ? (
                    <p>Transcript will appear here once processing is complete.</p>
                  ) : (
                    <p>No transcript available.</p>
                  )}
                </div>
              )}
            </div>
            {analytics && (
              <aside aria-label="Talk time" className="order-first lg:order-none">
                <div className="lg:sticky lg:top-0">
                  <TalkTimeCard analytics={analytics} />
                </div>
              </aside>
            )}
          </div>
        )}

        {activeTab === 'summary' && (
          <div className="max-w-3xl">
            <PremiumGate feature="aiSummaries">
              {summary ? (
                <>
                  <SummaryCard
                    summary={summary}
                    speakerNames={transcript?.speaker_names}
                    actionItemsFooter={<ActionItemsToTodosButton recordingId={recording.id} />}
                  />
                  {/* Style controls come after the content people came to read */}
                  <div className="mt-10">
                    <SummaryTemplatePanel
                      recordingId={recording.id}
                      currentTemplate={recording.summary_template}
                      onRegenerated={refresh}
                    />
                  </div>
                </>
              ) : (
                <div className="py-10 text-muted-foreground">
                  {isProcessing ? (
                    <p>Summary will appear here once processing is complete.</p>
                  ) : (
                    <p>No summary available.</p>
                  )}
                </div>
              )}
            </PremiumGate>
          </div>
        )}

        {activeTab === 'qa' && (
          <div className="h-[500px] max-w-3xl">
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
        <div className="border-t border-border bg-card p-3 sm:p-4">
          <div className="mx-auto max-w-3xl">
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
