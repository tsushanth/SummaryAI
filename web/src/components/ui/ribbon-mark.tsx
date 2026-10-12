import { cn } from '@/lib/utils/cn';

/** Brand mark: a tiny voice ribbon, three rows of speaker-colored turns. */
export function RibbonMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-6 w-6', className)} aria-hidden="true">
      <rect x="2" y="4" width="20" height="4" rx="1" fill="#4A4DCB" />
      <rect x="2" y="10" width="13" height="4" rx="1" fill="#0B7A75" />
      <rect x="17" y="10" width="5" height="4" rx="1" fill="#B4501A" />
      <rect x="2" y="16" width="8" height="4" rx="1" fill="#A33A5B" />
      <rect x="12" y="16" width="10" height="4" rx="1" fill="#4A4DCB" />
    </svg>
  );
}
