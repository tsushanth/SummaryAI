'use client';

import { useState } from 'react';
import { useRecordings } from '@/hooks/useRecordings';
import { useSubscription } from '@/hooks/useSubscription';
import { RecordingCard } from '@/components/recordings/RecordingCard';
import { PaywallModal } from '@/components/subscription/PaywallModal';
import { Button } from '@/components/ui/button';
import { Plus, Mic, Loader2 } from 'lucide-react';
import Link from 'next/link';

const FREE_TIER_LIMIT = 3;

export default function RecordingsPage() {
  const { recordings, isLoading, error } = useRecordings();
  const { isSubscribed, isLoading: subLoading } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);

  const atFreeLimit = !subLoading && !isSubscribed && recordings.length >= FREE_TIER_LIMIT;

  const handleNewRecording = (e: React.MouseEvent) => {
    if (atFreeLimit) {
      e.preventDefault();
      setShowPaywall(true);
    }
  };

  return (
    <div className="p-6">
      {showPaywall && <PaywallModal onClose={() => setShowPaywall(false)} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Recordings</h1>
          <p className="text-gray-500">
            {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
            {!subLoading && !isSubscribed && (
              <span className="ml-2 text-xs text-amber-600 font-medium">
                {recordings.length}/{FREE_TIER_LIMIT} free used
              </span>
            )}
          </p>
        </div>
        <Link href="/recordings/new" onClick={handleNewRecording}>
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Recording
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-500 mb-4">Failed to load recordings</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      ) : recordings.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mic className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium mb-2">No recordings yet</h3>
          <p className="text-gray-500 mb-4">
            Create your first recording to get started
          </p>
          <Link href="/recordings/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Recording
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {recordings.map((recording) => (
            <RecordingCard key={recording.id} recording={recording} />
          ))}
        </div>
      )}
    </div>
  );
}
