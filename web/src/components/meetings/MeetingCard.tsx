'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Video, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { Meeting, MeetingPlatform, MeetingStatus } from '@/types/api';
import Link from 'next/link';

interface MeetingCardProps {
  meeting: Meeting;
  onToggleAutoJoin: (id: string, autoJoin: boolean) => Promise<void>;
  isUpdating: boolean;
}

function getPlatformIcon(platform: MeetingPlatform) {
  switch (platform) {
    case 'zoom':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#2D8CFF">
          <path d="M4.585 15.868v-4.192c0-.943.774-1.708 1.73-1.708h6.27c.943 0 1.708.774 1.708 1.73v4.17c0 .943-.774 1.708-1.73 1.708H6.293c-.943 0-1.708-.774-1.708-1.73v.022zm11.088 0l3.818 2.698c.342.24.8.01.8-.402v-8.476c0-.41-.458-.642-.8-.402l-3.818 2.698v3.884z" />
        </svg>
      );
    case 'google_meet':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path fill="#00832d" d="M12.447 10.74v2.52l3.278 3.278V8.462z" />
          <path fill="#0066da" d="M17.5 17.538l-1.775-1.775V8.237L17.5 6.462v11.076z" />
          <path fill="#e94235" d="M17.5 6.462l-5.053 5.053 3.278-3.278z" />
          <path fill="#2684fc" d="M6.5 17.538V6.462L12.447 12.41V17.538H6.5z" />
          <path fill="#00ac47" d="M12.447 6.462v4.278L6.5 4.793V6.462h5.947z" />
        </svg>
      );
    case 'teams':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#5059C9">
          <path d="M19.19 8.77l-5.53 3.2v6.4l5.53-3.2V8.77zm-7.38-4.23c0-1.14-.93-2.07-2.07-2.07s-2.07.93-2.07 2.07.93 2.07 2.07 2.07 2.07-.93 2.07-2.07zm2.77 0c0-1.14.93-2.07 2.07-2.07 1.14 0 2.07.93 2.07 2.07s-.93 2.07-2.07 2.07c-1.14 0-2.07-.93-2.07-2.07zm-7.38 15.23V9.7H4v10.07h3.2z" />
        </svg>
      );
    case 'webex':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#00CF64">
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
    default:
      return <Video className="w-4 h-4 text-gray-500" />;
  }
}

function getPlatformLabel(platform: MeetingPlatform) {
  switch (platform) {
    case 'zoom':
      return 'Zoom';
    case 'google_meet':
      return 'Google Meet';
    case 'teams':
      return 'Teams';
    case 'webex':
      return 'Webex';
    default:
      return 'Meeting';
  }
}

function getStatusBadge(status: MeetingStatus) {
  switch (status) {
    case 'scheduled':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
          Scheduled
        </span>
      );
    case 'bot_queued':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Queued
        </span>
      );
    case 'bot_joining':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Joining
        </span>
      );
    case 'bot_in_meeting':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Recording
        </span>
      );
    case 'completed':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
          Completed
        </span>
      );
    case 'failed':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">
          Failed
        </span>
      );
    case 'cancelled':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">
          Cancelled
        </span>
      );
  }
}

function formatMeetingTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const meetingDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  let dayLabel = '';
  if (meetingDate.getTime() === today.getTime()) {
    dayLabel = 'Today';
  } else if (meetingDate.getTime() === tomorrow.getTime()) {
    dayLabel = 'Tomorrow';
  } else {
    dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  const timeLabel = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dayLabel} ${timeLabel}`;
}

export function MeetingCard({
  meeting,
  onToggleAutoJoin,
  isUpdating,
}: MeetingCardProps) {
  const handleToggle = async () => {
    await onToggleAutoJoin(meeting.id, !meeting.auto_join);
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-1">{getPlatformIcon(meeting.platform)}</div>
          <div>
            <h3 className="font-medium">{meeting.title}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-gray-500">
                {getPlatformLabel(meeting.platform)}
              </span>
              <span className="text-gray-300">|</span>
              <span className="text-sm text-gray-500">
                {formatMeetingTime(meeting.scheduled_start)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              {getStatusBadge(meeting.status)}
              {meeting.recording_id && (
                <Link
                  href={`/recordings/${meeting.recording_id}`}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  View Recording
                  <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-gray-600">Auto-record</span>
            <button
              onClick={handleToggle}
              disabled={isUpdating || meeting.status === 'completed' || meeting.status === 'cancelled'}
              className={cn(
                'relative w-10 h-6 rounded-full transition-colors',
                meeting.auto_join ? 'bg-primary' : 'bg-gray-300',
                (isUpdating || meeting.status === 'completed' || meeting.status === 'cancelled') && 'opacity-50 cursor-not-allowed'
              )}
            >
              <span
                className={cn(
                  'absolute top-1 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                  meeting.auto_join ? 'translate-x-4' : 'translate-x-0'
                )}
              />
            </button>
          </label>
        </div>
      </div>
    </Card>
  );
}
