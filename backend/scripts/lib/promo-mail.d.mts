export const LIST: 'mm';
export const APP_NAME: string;
export function injectFooter(html: string, footer: string): string;
export function buildPromoMessage(o: { from: string; to: string; subject: string; html: string }): {
  from: string; to: string; subject: string; html: string; headers: Record<string, string>;
};
export function filterRecipients<T extends { email?: string | null }>(users: T[], suppressed: Set<string>): {
  allowed: T[]; counts: { candidates: number; suppressed: number; relay: number; no_email: number };
};
