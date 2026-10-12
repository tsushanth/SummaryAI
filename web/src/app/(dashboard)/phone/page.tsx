'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Mic,
  MicOff,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getPhoneCalls } from '@/lib/api/phone';
import { cn } from '@/lib/utils/cn';
import type { PhoneCall as PhoneCallType, PhoneCallStatus } from '@/types/api';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatPhoneNumber(phone: string): string {
  // Simple US formatting
  if (phone.startsWith('+1') && phone.length === 12) {
    return `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
  }
  return phone;
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const callDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  let dayLabel = '';
  if (callDate.getTime() === today.getTime()) {
    dayLabel = 'Today';
  } else if (callDate.getTime() === yesterday.getTime()) {
    dayLabel = 'Yesterday';
  } else {
    dayLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const timeLabel = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dayLabel} ${timeLabel}`;
}

function getStatusBadge(status: PhoneCallStatus) {
  switch (status) {
    case 'completed':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-success/15 text-success flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          Completed
        </span>
      );
    case 'in_progress':
    case 'recording':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-accent text-accent-foreground flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          {status === 'recording' ? 'Recording' : 'In Progress'}
        </span>
      );
    case 'ringing':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 flex items-center gap-1">
          <Phone className="w-3 h-3" />
          Ringing
        </span>
      );
    case 'failed':
    case 'busy':
    case 'no_answer':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-destructive/10 text-destructive flex items-center gap-1">
          <XCircle className="w-3 h-3" />
          {status === 'busy' ? 'Busy' : status === 'no_answer' ? 'No Answer' : 'Failed'}
        </span>
      );
    case 'cancelled':
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-secondary text-foreground/90">
          Cancelled
        </span>
      );
    default:
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-secondary text-foreground/90">
          {status}
        </span>
      );
  }
}

function PhoneCallCard({ call }: { call: PhoneCallType }) {
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-1 p-2 bg-secondary rounded-full">
            <PhoneOutgoing className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-medium">
              {call.to_name || formatPhoneNumber(call.to_number)}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">
                {formatPhoneNumber(call.to_number)}
              </span>
              {call.to_name && (
                <>
                  <span className="text-muted-foreground/60">|</span>
                  <span className="text-sm text-muted-foreground">
                    From: {formatPhoneNumber(call.from_number)}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              {getStatusBadge(call.status)}
              {call.recording_duration && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(call.recording_duration)}
                </span>
              )}
              {call.is_recording && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <Mic className="w-3 h-3 animate-pulse" />
                  Recording
                </span>
              )}
              {call.recording_id && (
                <Link
                  href={`/recordings/${call.recording_id}`}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  View Recording
                  <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="text-right">
          <span className="text-sm text-muted-foreground">
            {formatDateTime(call.started_at || call.created_at)}
          </span>
        </div>
      </div>
    </Card>
  );
}

export default function PhoneCallsPage() {
  const { data, error, isLoading } = useSWR(
    'phone-calls',
    () => getPhoneCalls(50, 0),
    { refreshInterval: 10000 } // Refresh every 10 seconds
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <AlertCircle className="w-12 h-12 mb-4 opacity-30" />
        <p>Failed to load phone calls</p>
      </div>
    );
  }

  const calls = data?.calls || [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Phone Calls</h1>
          <p className="text-muted-foreground mt-1">
            View your recorded phone call transcriptions
          </p>
        </div>
        <Link href="/phone/settings">
          <Button variant="outline">
            <Phone className="w-4 h-4 mr-2" />
            Phone Settings
          </Button>
        </Link>
      </div>

      {calls.length === 0 ? (
        <Card className="p-12 flex flex-col items-center justify-center">
          <PhoneCall className="w-16 h-16 text-muted-foreground/60 mb-4" />
          <h3 className="text-lg font-medium text-foreground/90 mb-2">No phone calls yet</h3>
          <p className="text-muted-foreground text-center max-w-md mb-4">
            Make calls through the Meeting Mind mobile app to record and transcribe your phone conversations.
          </p>
          <Link href="/phone/settings">
            <Button>
              <Phone className="w-4 h-4 mr-2" />
              Set Up Phone
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-3">
          {calls.map((call) => (
            <PhoneCallCard key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}
