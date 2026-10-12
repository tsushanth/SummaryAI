import type { Recording } from '@/types/api';

export interface RecordingGroup {
  label: string;
  recordings: Recording[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Starred recordings first, then Today / Yesterday / This week / This month /
 * "<Month Year>". Starred recordings are not repeated in the date groups.
 * Input order (newest first from the API) is preserved inside each group.
 */
export function groupRecordingsByDate(recordings: Recording[], now: Date = new Date()): RecordingGroup[] {
  const today = startOfDay(now);
  const day = 86400000;
  const weekStart = today - 6 * day;

  const starred: Recording[] = [];
  const buckets = new Map<string, Recording[]>();
  const order: string[] = [];

  const add = (label: string, r: Recording) => {
    if (!buckets.has(label)) {
      buckets.set(label, []);
      order.push(label);
    }
    buckets.get(label)!.push(r);
  };

  for (const r of recordings) {
    if (r.is_favorite) {
      starred.push(r);
      continue;
    }
    const created = new Date(r.created_at);
    const t = startOfDay(created);
    if (t >= today) add('Today', r);
    else if (t >= today - day) add('Yesterday', r);
    else if (t >= weekStart) add('This week', r);
    else if (created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth()) {
      add('This month', r);
    } else {
      add(`${MONTHS[created.getMonth()]} ${created.getFullYear()}`, r);
    }
  }

  const groups: RecordingGroup[] = [];
  if (starred.length) groups.push({ label: 'Starred', recordings: starred });
  for (const label of order) groups.push({ label, recordings: buckets.get(label)! });
  return groups;
}
