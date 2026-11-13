export function loadSuppressions(o: { supabaseUrl: string; serviceKey: string; fetchImpl?: typeof fetch; pageSize?: number }): Promise<Set<string>>;
export function isSuppressed(set: Set<string>, email: string): boolean;
