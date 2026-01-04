'use client';

import { useRecordings } from '@/hooks/useRecordings';
import { RecordingCard } from '@/components/recordings/RecordingCard';
import { Button } from '@/components/ui/button';
import { Plus, Mic, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function RecordingsPage() {
  const { recordings, isLoading, error } = useRecordings();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Recordings</h1>
          <p className="text-gray-500">
            {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/recordings/new">
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
