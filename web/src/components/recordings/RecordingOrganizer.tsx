'use client';

import { useState } from 'react';
import { Folder as FolderIcon, X } from 'lucide-react';
import type { Recording } from '@/types/api';
import { useFolders, useTags } from '@/hooks/useOrganize';
import { moveRecordingToFolder } from '@/lib/api/organize';
import { updateRecording } from '@/lib/api/recordings';

/** Folder picker and tag editor for one recording (detail page). */
export function RecordingOrganizer({
  recording,
  onChanged,
}: {
  recording: Recording;
  onChanged: () => void;
}) {
  const { folders, refresh: refreshFolders } = useFolders();
  const { refresh: refreshTags } = useTags();
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChanged();
      refreshFolders();
      refreshTags();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const tags = recording.tags ?? [];

  const addTag = () => {
    const t = tagInput.trim();
    setTagInput('');
    if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    run(() => updateRecording(recording.id, { tags: [...tags, t] }));
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-1.5 text-muted-foreground">
        <FolderIcon className="w-4 h-4" />
        <select
          value={recording.folder_id ?? ''}
          onChange={(e) => run(() => moveRecordingToFolder(recording.id, e.target.value || null))}
          className="rounded-md border border-input bg-card px-2 py-1 text-foreground"
          aria-label="Folder"
        >
          <option value="">No folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted rounded text-foreground/80">
            #{t}
            <button
              title={`Remove ${t}`}
              onClick={() => run(() => updateRecording(recording.id, { tags: tags.filter((x) => x !== t) }))}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
          placeholder="Add tag"
          maxLength={40}
          className="w-28 rounded-md border border-input bg-card px-2 py-0.5 text-foreground placeholder:text-muted-foreground"
        />
      </div>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
