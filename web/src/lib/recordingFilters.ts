/** Recording-list filter state and its mapping to API params. No runtime imports (unit-tested in node). */

export interface RecordingFilterState {
  /** undefined = all, 'none' = unfiled, otherwise a folder id */
  folderId?: string;
  tag?: string;
  favorite?: boolean;
  range?: 'today' | '7d' | '30d';
  /** Meetings / Imported tabs (server `recording_type`); undefined = every type */
  recordingType?: 'meeting' | 'imported';
}

/** Converts filter state to API params. */
export function filtersToParams(f: RecordingFilterState) {
  const params: {
    folder_id?: string;
    tag?: string;
    favorite?: boolean;
    from?: string;
    recording_type?: 'meeting' | 'imported';
  } = {};
  if (f.folderId) params.folder_id = f.folderId;
  if (f.tag) params.tag = f.tag;
  if (f.favorite) params.favorite = true;
  if (f.recordingType) params.recording_type = f.recordingType;
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
