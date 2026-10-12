'use client';

import { useState } from 'react';
import { Folder as FolderIcon, Plus, Pencil, Trash2, Star } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useFolders, useTags } from '@/hooks/useOrganize';
import { createFolder, renameFolder, deleteFolder } from '@/lib/api/organize';

export interface RecordingFilterState {
  /** undefined = all, 'none' = unfiled, otherwise a folder id */
  folderId?: string;
  tag?: string;
  favorite?: boolean;
  range?: 'today' | '7d' | '30d';
}

/** Converts filter state to API params. */
export function filtersToParams(f: RecordingFilterState) {
  const params: {
    folder_id?: string;
    tag?: string;
    favorite?: boolean;
    from?: string;
  } = {};
  if (f.folderId) params.folder_id = f.folderId;
  if (f.tag) params.tag = f.tag;
  if (f.favorite) params.favorite = true;
  if (f.range) {
    const d = new Date();
    if (f.range === 'today') d.setHours(0, 0, 0, 0);
    else d.setDate(d.getDate() - (f.range === '7d' ? 7 : 30));
    // Round to the minute so the SWR key is stable between renders.
    d.setSeconds(0, 0);
    params.from = d.toISOString();
  }
  return params;
}

const chip = (active: boolean) =>
  cn(
    'inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm border transition-colors',
    active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-700 hover:bg-gray-50'
  );

export function RecordingFilters({
  value,
  onChange,
}: {
  value: RecordingFilterState;
  onChange: (next: RecordingFilterState) => void;
}) {
  const { folders, refresh: refreshFolders } = useFolders();
  const { tags } = useTags();
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      await refreshFolders();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  const onNewFolder = () => {
    const name = window.prompt('Folder name');
    if (name?.trim()) guard(async () => void (await createFolder(name.trim())));
  };

  const selected = folders.find((f) => f.id === value.folderId);

  const onRename = () => {
    if (!selected) return;
    const name = window.prompt('Rename folder', selected.name);
    if (name?.trim() && name.trim() !== selected.name) {
      guard(async () => void (await renameFolder(selected.id, name.trim())));
    }
  };

  const onDelete = () => {
    if (!selected) return;
    if (!window.confirm(`Delete folder "${selected.name}"? Recordings in it are kept and become unfiled.`)) return;
    guard(async () => {
      await deleteFolder(selected.id);
      onChange({ ...value, folderId: undefined });
    });
  };

  return (
    <div className="space-y-2 mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={chip(!value.folderId && !value.favorite)}
          onClick={() => onChange({ ...value, folderId: undefined, favorite: undefined })}
        >
          All
        </button>
        <button
          className={chip(!!value.favorite)}
          onClick={() => onChange({ ...value, favorite: value.favorite ? undefined : true })}
        >
          <Star className="w-3.5 h-3.5" /> Starred
        </button>
        <button
          className={chip(value.folderId === 'none')}
          onClick={() => onChange({ ...value, folderId: value.folderId === 'none' ? undefined : 'none' })}
        >
          Unfiled
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            className={chip(value.folderId === f.id)}
            onClick={() => onChange({ ...value, folderId: value.folderId === f.id ? undefined : f.id })}
          >
            <FolderIcon className="w-3.5 h-3.5" />
            {f.name}
            <span className="opacity-70">{f.recording_count}</span>
          </button>
        ))}
        <button className={chip(false)} onClick={onNewFolder}>
          <Plus className="w-3.5 h-3.5" /> New folder
        </button>
        {selected && (
          <>
            <button className="p-1.5 rounded hover:bg-gray-100" title="Rename folder" onClick={onRename}>
              <Pencil className="w-4 h-4 text-gray-500" />
            </button>
            <button className="p-1.5 rounded hover:bg-gray-100" title="Delete folder" onClick={onDelete}>
              <Trash2 className="w-4 h-4 text-red-500" />
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value.range ?? ''}
          onChange={(e) =>
            onChange({ ...value, range: (e.target.value || undefined) as RecordingFilterState['range'] })
          }
          className="border rounded-md px-2 py-1 text-sm bg-white"
          aria-label="Date range"
        >
          <option value="">Any date</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        {tags.slice(0, 15).map((t) => (
          <button
            key={t.tag}
            className={chip(value.tag?.toLowerCase() === t.tag.toLowerCase())}
            onClick={() =>
              onChange({ ...value, tag: value.tag?.toLowerCase() === t.tag.toLowerCase() ? undefined : t.tag })
            }
          >
            #{t.tag}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
