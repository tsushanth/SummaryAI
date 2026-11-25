export class OutreachMetrics {
  constructor(o?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; log?: (m: string) => void; now?: () => number; keychain?: (n: string) => string | null; timeoutMs?: number });
  enabled: boolean;
  env: Record<string, string | undefined>;
  registerCampaign(o: { id: string; product: string; senderDomain?: string; audienceSource?: string; offer?: string; subjectLabel?: string; plannedSize?: number; ctaUrl?: string; notes?: string }): Promise<boolean>;
  recordSent(o: { product: string; campaign: string; email: string; code?: string }): void;
  flushEvents(): Promise<{ posted: number; failed: number }>;
  screen(o: { product: string; campaign: string; emails: string[]; days?: number }): Promise<{ allowed: string[]; skippedLedger: number; skippedLayer: number; halt: { reason: string; bounce_pct: number | null; window_size: number | null } | null; layer: string }>;
}
export function campaignSlug(o: { product: string; type: string; date?: Date | string }): string;
export function resendTags(campaign: string, product?: string): { name: string; value: string }[];
export function dedupeDaysFrom(env?: Record<string, string | undefined>, fallback?: number): number;
export function metricsEnabled(env?: Record<string, string | undefined>): boolean;
