export function dripCampaign(product: string, template: string, now?: Date): string;
export function dripTags(product: string, template: string, now?: Date): { name: string; value: string }[];
export function dripDedupeDays(template: string, env?: Record<string, string | undefined>): number;
export function screenDrip<T extends { email?: string | null }>(o: { om: any; product: string; template: string; users: T[]; now?: Date }): Promise<{ allowed: T[]; skippedLedger: number; skippedLayer: number; halt: { reason: string; bounce_pct: number | null; window_size: number | null } | null; campaign: string }>;
export function breakerHalt(o: { om: any; product: string; template: string; now?: Date }): Promise<string | null>;
