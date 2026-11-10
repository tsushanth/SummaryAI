/** A tiny executing fake of the supabase query builder (eq / in / or-ilike / order / limit / single / maybeSingle / insert), logging every query. */
export interface Q { table: string; eq: Array<[string, any]>; in: Array<[string, any[]]>; or?: string }

export function makeFakeDb(TABLES: Record<string, any[]>) {
  const queries: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, eq: [], in: [] };
    let order: { col: string; asc: boolean } | null = null;
    let lim = Infinity;
    const run = () => {
      queries.push(q);
      let rows = (TABLES[table] ?? []).filter((r) => q.eq.every(([c, v]) => r[c] === v) && q.in.every(([c, vs]) => vs.includes(r[c])));
      if (q.or) {
        const pats = q.or.split(',').map((p) => /^(\w+)\.ilike\.%(.*)%$/.exec(p)!).map((m) => [m[1], m[2]!.toLowerCase()] as const);
        rows = rows.filter((r) => pats.some(([c, p]) => String(r[c]).toLowerCase().includes(p)));
      }
      if (order) rows = [...rows].sort((x, y) => (x[order!.col] > y[order!.col] ? 1 : -1) * (order!.asc ? 1 : -1));
      return { data: rows.slice(0, lim), error: null };
    };
    const b: any = {
      select: () => b, eq: (c: string, v: any) => { q.eq.push([c, v]); return b; }, in: (c: string, vs: any[]) => { q.in.push([c, vs]); return b; },
      or: (s: string) => { q.or = s; return b; }, order: (c: string, o?: any) => { order = { col: c, asc: o?.ascending !== false }; return b; },
      limit: (n: number) => { lim = n; return b; },
      maybeSingle: () => Promise.resolve(run()).then((r) => ({ data: r.data[0] ?? null, error: null })),
      single: () => Promise.resolve(run()).then((r) => ({ data: r.data[0] ?? null, error: r.data[0] ? null : { code: 'PGRST116' } })),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { db: { from } as any, queries };
}

