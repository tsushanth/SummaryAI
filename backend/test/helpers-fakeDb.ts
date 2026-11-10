/** Tiny in-memory stand-in for supabaseAdmin used by route tests. Supports the chain shapes the meetings routes use. */
export type Row = Record<string, any>;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  /** 'table.column' that "does not exist" (migration not applied): selects/inserts/updates naming it fail like Postgres. */
  missing = new Set<string>();
  log: Array<{ table: string; op: string; payload?: any }> = [];
  private n = 0;

  rows(t: string): Row[] { return (this.tables[t] ??= []); }
  seed(t: string, row: Row): Row { const r = { id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`, created_at: new Date(1_700_000_000_000 + this.n * 1000).toISOString(), ...row }; this.rows(t).push(r); return r; }

  private missingIn(table: string, cols: string[]): string | null {
    for (const c of cols) if (this.missing.has(`${table}.${c.trim()}`)) return c.trim();
    return null;
  }

  from = (table: string) => {
    const db = this;
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let cols: string[] = ['*'];
    let payload: Row = {};
    const filters: Array<(r: Row) => boolean> = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let lim: number | null = null;
    let returning = false;
    let one: 'single' | 'maybe' | null = null;

    const exec = (): { data: any; error: any } => {
      db.log.push({ table, op, payload: op === 'select' ? undefined : payload });
      const touched = op === 'select' ? (cols[0] === '*' ? [] : cols) : Object.keys(payload);
      const bad = db.missingIn(table, touched);
      if (bad) return { data: null, error: { code: '42703', message: `column "${bad}" of relation "${table}" does not exist` } };
      if (op === 'insert') {
        const r = db.seed(table, payload);
        return { data: returning ? (one ? r : [r]) : null, error: null };
      }
      let matched = db.rows(table).filter((r) => filters.every((f) => f(r)));
      if (op === 'update') { matched.forEach((r) => Object.assign(r, payload)); return { data: returning ? (one ? matched[0] ?? null : matched) : null, error: null }; }
      if (op === 'delete') { db.tables[table] = db.rows(table).filter((r) => !matched.includes(r)); return { data: null, error: null }; }
      if (orderBy) matched = [...matched].sort((a, b) => (a[orderBy!.col] > b[orderBy!.col] ? 1 : -1) * (orderBy!.asc ? 1 : -1));
      if (lim !== null) matched = matched.slice(0, lim);
      if (one) {
        if (matched.length === 0) return { data: null, error: one === 'single' ? { code: 'PGRST116', message: 'no rows' } : null };
        return { data: matched[0], error: null };
      }
      return { data: matched, error: null };
    };

    const q: any = {
      select: (c?: string) => { if (op === 'select') cols = (c ?? '*').split(',').map((s) => s.trim()); else returning = true; return q; },
      insert: (row: Row) => { op = 'insert'; payload = row; return q; },
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      gte: (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] >= v); return q; },
      lt: (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] < v); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { orderBy = { col: c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { lim = n; return q; },
      single: () => { one = 'single'; return Promise.resolve(exec()); },
      maybeSingle: () => { one = 'maybe'; return Promise.resolve(exec()); },
      then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
    };
    return q;
  };
}
