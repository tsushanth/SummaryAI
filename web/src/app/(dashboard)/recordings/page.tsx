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
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      {showPaywall && <PaywallModal onClose={() => setShowPaywall(false)} />}

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Recordings</h1>
          <p className="text-sm text-muted-foreground tabular">
            {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
            {!subLoading && !isSubscribed && !isFiltered && (
              <span className="ml-2 rounded-sm bg-mark px-1.5 py-0.5 text-xs font-semibold text-mark-foreground">
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
        <SkeletonCardList count={4} label="Loading recordings" />
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
          message="Record a meeting, upload an audio file, or connect your calendar so calls arrive on their own. Each one becomes a transcript, a summary and a list of what people agreed to do."
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
            <section key={group.label} className="md:grid md:grid-cols-[8rem_minmax(0,1fr)] md:gap-6">
              <h2 className="mb-2 px-3 text-base font-semibold text-foreground md:sticky md:top-0 md:self-start md:px-0 md:pt-3 md:text-right">
                {group.label}
              </h2>
              <div className="space-y-1">
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
