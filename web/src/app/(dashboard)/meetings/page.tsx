'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Link as LinkIcon, Calendar, Loader2, RefreshCw } from 'lucide-react';
import {
  useCalendarConnections,
  useConnectCalendar,
  useDisconnectCalendar,
  useSyncCalendars,
} from '@/hooks/useCalendar';
import { useMeetings, useCreateMeeting, useUpdateMeeting } from '@/hooks/useMeetings';
import { CalendarConnectionCard } from '@/components/meetings/CalendarConnectionCard';
import { ConnectCalendarButton } from '@/components/meetings/ConnectCalendarButton';
import { MeetingCard } from '@/components/meetings/MeetingCard';
import { JoinMeetingModal } from '@/components/meetings/JoinMeetingModal';
import type { CreateMeetingRequest } from '@/types/api';

export default function MeetingsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Calendar hooks
  const { connections, isLoading: isLoadingConnections } = useCalendarConnections();
  const { connect, isConnecting } = useConnectCalendar();
  const { disconnect, isDisconnecting } = useDisconnectCalendar();
  const { sync, isSyncing } = useSyncCalendars();

  // Meetings hooks
  const { meetings, isLoading: isLoadingMeetings, refresh: refreshMeetings } = useMeetings();
  const { create, isCreating } = useCreateMeeting();
  const { update, isUpdating } = useUpdateMeeting();

  const hasGoogleConnection = connections.some((c) => c.provider === 'google');
  const hasMicrosoftConnection = connections.some((c) => c.provider === 'microsoft');

  const handleAddMeeting = async (data: CreateMeetingRequest) => {
    await create(data);
  };

  const handleToggleAutoJoin = async (id: string, autoJoin: boolean) => {
    await update(id, { auto_join: autoJoin });
  };

  const handleDisconnect = async (provider: 'google' | 'microsoft') => {
    await disconnect(provider);
    // Refresh meetings list since backend deletes calendar-sourced meetings on disconnect
    refreshMeetings();
  };

  const upcomingMeetings = meetings.filter(
    (m) => m.status !== 'completed' && m.status !== 'cancelled'
  );
  const pastMeetings = meetings.filter(
    (m) => m.status === 'completed' || m.status === 'cancelled'
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Meetings</h1>
          <p className="text-gray-500">
            Manage calendar connections and upcoming meetings
          </p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <LinkIcon className="w-4 h-4 mr-2" />
          Join via Link
        </Button>
      </div>

      {/* Calendar Connections Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Connected Calendars</h2>
          {connections.length > 0 && (
            <Button variant="outline" size="sm" onClick={sync} disabled={isSyncing}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              Sync All
            </Button>
          )}
        </div>

        {isLoadingConnections ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : connections.length === 0 ? (
          <Card className="p-6 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-6 h-6 text-gray-400" />
            </div>
            <h3 className="font-medium mb-2">No calendars connected</h3>
            <p className="text-sm text-gray-500 mb-4">
              Connect your calendar to automatically sync meetings
            </p>
            <div className="flex justify-center gap-3">
              <ConnectCalendarButton
                provider="google"
                onConnect={connect}
                isConnecting={isConnecting}
              />
              <ConnectCalendarButton
                provider="microsoft"
                onConnect={connect}
                isConnecting={isConnecting}
              />
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {connections.map((connection) => (
              <CalendarConnectionCard
                key={connection.id}
                connection={connection}
                onSync={sync}
                onDisconnect={() => handleDisconnect(connection.provider)}
                isSyncing={isSyncing}
                isDisconnecting={isDisconnecting}
              />
            ))}
            <div className="flex gap-3 mt-3">
              {!hasGoogleConnection && (
                <ConnectCalendarButton
                  provider="google"
                  onConnect={connect}
                  isConnecting={isConnecting}
                />
              )}
              {!hasMicrosoftConnection && (
                <ConnectCalendarButton
                  provider="microsoft"
                  onConnect={connect}
                  isConnecting={isConnecting}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Upcoming Meetings Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Upcoming Meetings</h2>
          <Button variant="ghost" size="sm" onClick={() => refreshMeetings()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {isLoadingMeetings ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : upcomingMeetings.length === 0 ? (
          <Card className="p-6 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-6 h-6 text-gray-400" />
            </div>
            <h3 className="font-medium mb-2">No upcoming meetings</h3>
            <p className="text-sm text-gray-500 mb-4">
              {connections.length > 0
                ? 'Your calendar meetings will appear here'
                : 'Connect a calendar or add a meeting manually'}
            </p>
            <Button variant="outline" onClick={() => setIsModalOpen(true)}>
              <LinkIcon className="w-4 h-4 mr-2" />
              Add Meeting via Link
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {upcomingMeetings.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                onToggleAutoJoin={handleToggleAutoJoin}
                isUpdating={isUpdating}
              />
            ))}
          </div>
        )}
      </div>

      {/* Past Meetings Section */}
      {pastMeetings.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Past Meetings</h2>
            <p className="text-sm text-gray-500">
              Recordings are available in the{' '}
              <Link href="/recordings" className="text-primary hover:underline">
                Recordings
              </Link>{' '}
              tab
            </p>
          </div>
          <div className="space-y-3">
            {pastMeetings.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                onToggleAutoJoin={handleToggleAutoJoin}
                isUpdating={isUpdating}
              />
            ))}
          </div>
        </div>
      )}

      {/* Join Meeting Modal */}
      <JoinMeetingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddMeeting}
        isSubmitting={isCreating}
      />
    </div>
  );
}
