/** Speaker colors shared with the Android app. White text stays readable on each. */
export const SPEAKER_COLORS = [
  '#4A4DCB', // indigo
  '#0B7A75', // teal
  '#B4501A', // burnt orange
  '#8E3A9E', // purple
  '#2B6CB0', // blue
  '#A33A5B', // rose
  '#4D7C0F', // olive green
  '#6B5B95', // slate violet
] as const;

/** Stable color for a speaker label: the same label always yields the same color. */
export function speakerColor(label?: string | null): string {
  if (!label) return SPEAKER_COLORS[0];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return SPEAKER_COLORS[(hash & 0x7fffffff) % SPEAKER_COLORS.length];
}

export function speakerInitials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
}
