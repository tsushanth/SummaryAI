'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowLeft,
  Video,
  Calendar,
  Clock,
  Radio,
  FileText,
  Lightbulb,
  Loader2,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getMeeting } from '@/lib/api/meetings';
import { useLiveMeeting } from '@/hooks/useLiveTranscript';
import { LiveTranscriptViewer } from '@/components/meetings/LiveTranscriptViewer';
import { AIInsightsPanel } from '@/components/meetings/AIInsightsPanel';
import { cn } from '@/lib/utils/cn';
import type { Meeting, MeetingStatus, MeetingPlatform } from '@/types/api';

type Tab = 'transcript' | 'insights';

function getPlatformIcon(platform: MeetingPlatform) {
  switch (platform) {
    case 'zoom':
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#2D8CFF">
          <path d="M4.585 15.868v-4.192c0-.943.774-1.708 1.73-1.708h6.27c.943 0 1.708.774 1.708 1.73v4.17c0 .943-.774 1.708-1.73 1.708H6.293c-.943 0-1.708-.774-1.708-1.73v.022zm11.088 0l3.818 2.698c.342.24.8.01.8-.402v-8.476c0-.41-.458-.642-.8-.402l-3.818 2.698v3.884z" />
        </svg>
      );
    case 'google_meet':
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#00832d" d="M12.447 10.74v2.52l3.278 3.278V8.462z" />
          <path fill="#0066da" d="M17.5 17.538l-1.775-1.775V8.237L17.5 6.462v11.076z" />
          <path fill="#e94235" d="M17.5 6.462l-5.053 5.053 3.278-3.278z" />
          <path fill="#2684fc" d="M6.5 17.538V6.462L12.447 12.41V17.538H6.5z" />
          <path fill="#00ac47" d="M12.447 6.462v4.278L6.5 4.793V6.462h5.947z" />
        </svg>
      );
    case 'teams':
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5059C9">
          <path d="M19.19 8.77l-5.53 3.2v6.4l5.53-3.2V8.77zm-7.38-4.23c0-1.14-.93-2.07-2.07-2.07s-2.07.93-2.07 2.07.93 2.07 2.07 2.07 2.07-.93 2.07-2.07zm2.77 0c0-1.14.93-2.07 2.07-2.07 1.14 0 2.07.93 2.07 2.07s-.93 2.07-2.07 2.07c-1.14 0-2.07-.93-2.07-2.07zm-7.38 15.23V9.7H4v10.07h3.2z" />
        </svg>
      );
    default:
      return <Video className="w-5 h-5 text-gray-500" />;
  }
}

function getStatusBadge(status: MeetingStatus) {
  switch (status) {
    case 'bot_in_meeting':
      return (
        <span className="px-3 py-1 text-sm rounded-full bg-red-100 text-red-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Live Recording
        </span>
      );
    case 'bot_joining':
      return (
        <span className="px-3 py-1 text-sm rounded-full bg-yellow-100 text-yellow-700 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Bot Joining
        </span>
      );
    case 'completed':
      return (
        <span className="px-3 py-1 text-sm rounded-full bg-green-100 text-green-700">
          Completed
        </span>
      );
    case 'failed':
      return (
        <span className="px-3 py-1 text-sm rounded-full bg-red-100 text-red-700">
          Failed
        </span>
      );
    default:
      return (
        <span className="px-3 py-1 text-sm rounded-full bg-blue-100 text-blue-700">
          {status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
        </span>
      );
  }
}

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function MeetingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [activeTab, setActiveTab] = useState<Tab>('transcript');
  const [isLiveEnabled, setIsLiveEnabled] = useState(true);

  // Fetch meeting details
  const {
    data: meeting,
    error: meetingError,
    isLoading: isMeetingLoading,
    mutate: refreshMeeting,
  } = useSWR(
    id ? ['meeting', id] : null,
    () => getMeeting(id),
    {
      refreshInterval: (data) => {
        // Poll more frequently when meeting is active
        if (data?.status === 'bot_in_meeting' || data?.status === 'bot_joining') {
          return 5000;
        }
        return 30000;
      },
    }
  );

  // Check if meeting is currently recording
  const isLive = meeting?.status === 'bot_in_meeting';

  // Fetch live transcript and insights
  const { transcript, insights, isLoading: isLiveDataLoading } = useLiveMeeting(
    id,
    isLive && isLiveEnabled
  );

  if (isMeetingLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (meetingError || !meeting) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <p>Meeting not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.back()}>
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white p-4">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </div>

        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-gray-100 rounded-lg">
              {getPlatformIcon(meeting.platform)}
            </div>
            <div>
              <h1 className="text-xl font-semibold">{meeting.title}</h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {formatDateTime(meeting.scheduled_start)}
                </span>
                {isLive && (
                  <span className="flex items-center gap-1 text-red-600">
                    <Radio className="w-4 h-4 animate-pulse" />
                    Live
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {getStatusBadge(meeting.status)}
            {meeting.recording_id && (
              <Link href={`/recordings/${meeting.recording_id}`}>
                <Button variant="outline" size="sm">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Recording
                </Button>
              </Link>
            )}
            <Button variant="ghost" size="sm" onClick={() => refreshMeeting()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Live toggle and tabs */}
      {isLive && (
        <div className="border-b bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Tab buttons */}
              <button
                onClick={() => setActiveTab('transcript')}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeTab === 'transcript'
                    ? 'bg-white shadow text-primary'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <FileText className="w-4 h-4" />
                Live Transcript
              </button>
              <button
                onClick={() => setActiveTab('insights')}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeTab === 'insights'
                    ? 'bg-white shadow text-primary'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <Lightbulb className="w-4 h-4" />
                AI Insights
                {insights.insights.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-primary text-white">
                    {insights.insights.length}
                  </span>
                )}
              </button>
            </div>

            {/* Live toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-600">Live updates</span>
              <button
                onClick={() => setIsLiveEnabled(!isLiveEnabled)}
                className={cn(
                  'relative w-10 h-6 rounded-full transition-colors',
                  isLiveEnabled ? 'bg-primary' : 'bg-gray-300'
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                    isLiveEnabled ? 'translate-x-4' : 'translate-x-0'
                  )}
                />
              </button>
            </label>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLive ? (
          <div className="max-w-4xl mx-auto">
            {activeTab === 'transcript' && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Radio className="w-4 h-4 text-red-500 animate-pulse" />
                    Live Transcript
                  </h2>
                  <span className="text-sm text-gray-500">
                    {transcript.segments.length} segments
                  </span>
                </div>
                <LiveTranscriptViewer
                  segments={transcript.segments}
                  isLoading={transcript.isLoading}
                />
              </Card>
            )}

            {activeTab === 'insights' && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    AI Insights
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => insights.refresh()}
                    disabled={insights.isLoading}
                  >
                    <RefreshCw
                      className={cn('w-4 h-4', insights.isLoading && 'animate-spin')}
                    />
                  </Button>
                </div>
                <AIInsightsPanel
                  insights={insights.insights}
                  groupedInsights={insights.groupedInsights}
                  isLoading={insights.isLoading}
                />
              </Card>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <Video className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">Meeting not active</p>
            <p className="text-sm mt-2">
              {meeting.status === 'completed'
                ? 'This meeting has ended.'
                : meeting.status === 'bot_joining'
                ? 'Bot is joining the meeting...'
                : 'Live transcript will appear when the meeting starts.'}
            </p>
            {meeting.recording_id && (
              <Link href={`/recordings/${meeting.recording_id}`} className="mt-4">
                <Button>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Recording & Transcript
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
