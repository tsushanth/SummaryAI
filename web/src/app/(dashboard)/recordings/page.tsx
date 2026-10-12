'use client';

import { useState } from 'react';
import { useRecordings } from '@/hooks/useRecordings';
import { useSubscription } from '@/hooks/useSubscription';
import { RecordingCard } from '@/components/recordings/RecordingCard';
import { PaywallModal } from '@/components/subscription/PaywallModal';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonCardList } from '@/components/ui/skeleton';
import { RecordingFilters, filtersToParams, type RecordingFilterState } from '@/components/recordings/RecordingFilters';
import { WeeklyStatsCard } from '@/components/recordings/WeeklyStatsCard';
import { groupRecordingsByDate } from '@/lib/recordingGroups';
import { Plus, Mic, CloudOff, Search } from 'lucide-react';
import Link from 'next/link';

const FREE_TIER_LIMIT = 3;

export default function RecordingsPage() {
  const [filters, setFilters] = useState<RecordingFilterState>({});
  const params = filtersToParams(filters);
  const isFiltered = Object.keys(params).length > 0;
  const { recordings, isLoading, error } = useRecordings({ per_page: 50, ...params });
  const { isSubscribed, isLoading: subLoading } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);

  const atFreeLimit = !subLoading && !isSubscribed && !isFiltered && recordings.length >= FREE_TIER_LIMIT;

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
          <p className="text-muted-foreground">
            {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
            {!subLoading && !isSubscribed && !isFiltered && (
              <span className="ml-2 text-xs text-amber-700 dark:text-amber-300 font-medium">
                {recordings.length}/{FREE_TIER_LIMIT} free used
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/search">
            <Button variant="outline">
              <Search className="w-4 h-4 mr-2" aria-hidden="true" />
              Search
            </Button>
          </Link>
          <Link href="/recordings/new" onClick={handleNewRecording}>
            <Button>
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
              New Recording
            </Button>
          </Link>
        </div>
      </div>

      {!isFiltered && <WeeklyStatsCard />}

      <RecordingFilters value={filters} onChange={setFilters} />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <SkeletonCardList count={3} label="Loading recordings" />
        </div>
      ) : error ? (
        <EmptyState
          icon={<CloudOff />}
          title="Failed to load recordings"
          action={
            <Button variant="outline" onClick={() => window.location.reload()}>
              Retry
            </Button>
          }
        />
      ) : recordings.length === 0 && isFiltered ? (
        <EmptyState
          icon={<Search />}
          title="No recordings match these filters"
          action={
            <Button variant="outline" onClick={() => setFilters({})}>
              Clear filters
            </Button>
          }
        />
      ) : recordings.length === 0 ? (
        <EmptyState
          icon={<Mic />}
          title="No recordings yet"
          message="Create your first recording to get started"
          action={
            <Link href="/recordings/new">
              <Button>
                <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                New Recording
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          {groupRecordingsByDate(recordings).map((group) => (
            <section key={group.label}>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
                {group.label}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.recordings.map((recording) => (
                  <RecordingCard key={recording.id} recording={recording} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
