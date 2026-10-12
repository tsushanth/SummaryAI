'use client';

import { useState, useMemo } from 'react';
import { Edit2, Check, X } from 'lucide-react';
import type { Transcript } from '@/types/api';
import { formatDuration } from '@/lib/utils/audio';
import { cn } from '@/lib/utils/cn';
import { speakerColor, speakerInitials } from '@/lib/utils/speakers';

interface TranscriptViewerProps {
  transcript: Transcript;
  currentTime?: number;
  onSeek?: (time: number) => void;
  onSpeakerNameChange?: (speakerNames: Record<string, string>) => void;
  isUpdating?: boolean;
}

interface SpeakerInfo {
  index: number;
  name: string;
  talkTime: number;
  wordCount: number;
  segmentCount: number;
}

export function TranscriptViewer({
  transcript,
  currentTime = 0,
  onSeek,
  onSpeakerNameChange,
  isUpdating = false,
}: TranscriptViewerProps) {
  const [selectedSpeakers, setSelectedSpeakers] = useState<Set<number>>(new Set());
  const [editingSpeaker, setEditingSpeaker] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  // Calculate speaker info and stats
  const speakerInfo = useMemo(() => {
    const info: Map<number, SpeakerInfo> = new Map();

    transcript.segments.forEach(segment => {
      const existing = info.get(segment.speaker_index);
      const duration = segment.end_time - segment.start_time;
      const words = segment.text.split(/\s+/).filter(w => w.length > 0).length;

      if (existing) {
        existing.talkTime += duration;
        existing.wordCount += words;
        existing.segmentCount += 1;
      } else {
        const customName = transcript.speaker_names?.[String(segment.speaker_index)];
        info.set(segment.speaker_index, {
          index: segment.speaker_index,
          name: customName || segment.speaker_label || `Speaker ${segment.speaker_index + 1}`,
          talkTime: duration,
          wordCount: words,
          segmentCount: 1,
        });
      }
    });

    return Array.from(info.values()).sort((a, b) => a.index - b.index);
  }, [transcript.segments, transcript.speaker_names]);

  // Total talk time for percentage calculation
  const totalTalkTime = useMemo(() =>
    speakerInfo.reduce((sum, s) => sum + s.talkTime, 0),
    [speakerInfo]
  );

  // Initialize selected speakers to all
  useMemo(() => {
    if (selectedSpeakers.size === 0 && speakerInfo.length > 0) {
      setSelectedSpeakers(new Set(speakerInfo.map(s => s.index)));
    }
  }, [speakerInfo, selectedSpeakers.size]);

  // Filter segments based on selected speakers
  const filteredSegments = useMemo(() => {
    if (selectedSpeakers.size === 0 || selectedSpeakers.size === speakerInfo.length) {
      return transcript.segments;
    }
    return transcript.segments.filter(s => selectedSpeakers.has(s.speaker_index));
  }, [transcript.segments, selectedSpeakers, speakerInfo.length]);

  // Get display name for a speaker
  const getSpeakerName = (speakerIndex: number): string => {
    const customName = transcript.speaker_names?.[String(speakerIndex)];
    return customName || `Speaker ${speakerIndex + 1}`;
  };

  // Handle speaker filter toggle
  const toggleSpeaker = (speakerIndex: number) => {
    setSelectedSpeakers(prev => {
      const next = new Set(prev);
      if (next.has(speakerIndex)) {
        // Don't allow deselecting all speakers
        if (next.size > 1) {
          next.delete(speakerIndex);
        }
      } else {
        next.add(speakerIndex);
      }
      return next;
    });
  };

  // Select all speakers
  const selectAllSpeakers = () => {
    setSelectedSpeakers(new Set(speakerInfo.map(s => s.index)));
  };

  // Handle speaker name edit
  const startEditing = (speaker: SpeakerInfo) => {
    setEditingSpeaker(speaker.index);
    setEditingName(speaker.name);
  };

  const cancelEditing = () => {
    setEditingSpeaker(null);
    setEditingName('');
  };

  const saveEditing = () => {
    if (editingSpeaker === null || !onSpeakerNameChange) return;

    const newNames = {
      ...transcript.speaker_names,
      [String(editingSpeaker)]: editingName.trim(),
    };

    onSpeakerNameChange(newNames);
    setEditingSpeaker(null);
    setEditingName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEditing();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  return (
    <div className="space-y-4">
      {/* Speaker Toolbar */}
      {speakerInfo.length > 1 && (
        <div className="bg-muted rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground/90">Speakers</span>
            {selectedSpeakers.size !== speakerInfo.length && (
              <button
                onClick={selectAllSpeakers}
                className="text-xs text-primary hover:underline"
              >
                Show all
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {speakerInfo.map(speaker => {
              const isSelected = selectedSpeakers.has(speaker.index);
              const isEditing = editingSpeaker === speaker.index;
              const percentage = totalTalkTime > 0
                ? Math.round((speaker.talkTime / totalTalkTime) * 100)
                : 0;

              return (
                <div
                  key={speaker.index}
                  style={{ backgroundColor: speakerColor(String(speaker.index)) }}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-white transition-opacity',
                    !isSelected && 'opacity-50'
                  )}
                >
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        aria-label="Speaker name"
                        className="w-24 px-1 py-0.5 text-sm text-foreground bg-card rounded border border-input focus:outline-none focus:ring-2 focus:ring-ring"
                        autoFocus
                        disabled={isUpdating}
                      />
                      <button
                        onClick={saveEditing}
                        disabled={isUpdating || !editingName.trim()}
                        aria-label="Save speaker name"
                        className="p-1 hover:bg-white/20 rounded disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={cancelEditing}
                        aria-label="Cancel renaming"
                        className="p-1 hover:bg-white/20 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => toggleSpeaker(speaker.index)}
                        aria-pressed={isSelected}
                        className="min-h-[28px] text-sm font-medium hover:underline"
                      >
                        {speaker.name}
                      </button>
                      {onSpeakerNameChange && (
                        <button
                          onClick={() => startEditing(speaker)}
                          className="p-1 hover:bg-white/20 rounded"
                          aria-label={`Rename ${speaker.name}`}
                          title="Rename speaker"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                      <span className="text-xs opacity-75">
                        {percentage}%
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Single speaker - just show edit option */}
      {speakerInfo.length === 1 && onSpeakerNameChange && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {editingSpeaker === speakerInfo[0].index ? (
            <div className="flex items-center gap-1">
              <span>Speaker:</span>
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-32 px-2 py-1 text-sm rounded border border-input focus:outline-none focus:ring-2 focus:ring-ring bg-card text-foreground"
                autoFocus
                disabled={isUpdating}
              />
              <button
                onClick={saveEditing}
                disabled={isUpdating || !editingName.trim()}
                className="p-1 hover:bg-accent rounded disabled:opacity-50"
              >
                <Check className="w-4 h-4 text-success" />
              </button>
              <button
                onClick={cancelEditing}
                className="p-1 hover:bg-accent rounded"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => startEditing(speakerInfo[0])}
              className="flex items-center gap-1 hover:text-primary"
            >
              <span>Speaker: {speakerInfo[0].name}</span>
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Transcript Segments */}
      <div className="space-y-1">
        {filteredSegments.map((segment, index) => {
          const isActive =
            currentTime >= segment.start_time && currentTime < segment.end_time;
          const name = getSpeakerName(segment.speaker_index);
          const color = speakerColor(String(segment.speaker_index));

          return (
            <div
              key={segment.segment_id || index}
              onClick={() => onSeek?.(segment.start_time)}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg transition-colors',
                onSeek && 'cursor-pointer',
                isActive ? 'bg-accent' : 'hover:bg-accent/50'
              )}
            >
              <div
                aria-hidden="true"
                style={{ backgroundColor: color }}
                className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              >
                {speakerInitials(name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    {name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek?.(segment.start_time);
                    }}
                    aria-label={`Jump to ${formatDuration(segment.start_time)}`}
                    className="text-xs text-muted-foreground hover:text-primary hover:underline"
                  >
                    {formatDuration(segment.start_time)}
                  </button>
                </div>
                <p className="text-foreground/90 leading-relaxed">{segment.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state when all filtered out */}
      {filteredSegments.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>No segments to display.</p>
          <button
            onClick={selectAllSpeakers}
            className="text-primary hover:underline mt-2"
          >
            Show all speakers
          </button>
        </div>
      )}
    </div>
  );
}
