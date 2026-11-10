/**
 * In-memory stand-in for supabaseAdmin with the chain operations the live-stt code uses: select/eq/in/gte/lt/like/is/order/limit,
 * insert, upsert (ON CONFLICT DO NOTHING by a unique column), update with filters, maybeSingle/single.
 * `missing` = 'table.column' that does not exist (migration not applied): selects, inserts and updates that name it fail like Postgres.
 */
export type Row = Record<string, any>;

export class LiveDb {
  tables: Record<string, Row[]> = {};
  missing = new Set<string>();
  private n = 0;

  rows(t: string): Row[] { return (this.tables[t] ??= []); }
  seed(t: string, row: Row): Row {
    const r = { id: row.id ?? `id-${t}-${++this.n}`, created_at: new Date(1_800_000_000_000 + this.n * 1000).toISOString(), ...row };
    this.rows(t).push(r);
    return r;
  }
  private bad(table: string, cols: string[]): string | null {
    for (const c of cols) if (this.missing.has(`${table}.${c.trim()}`)) return c.trim();
    return null;
  }

  from = (table: string) => {
    const db = this;
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let cols: string[] = ['*'];
    let payload: any = {};
    let opts: any = {};
    const filters: Array<(r: Row) => boolean> = [];
    let order: { col: string; asc: boolean } | null = null;
    let lim: number | null = null;
    let rng: [number, number] | null = null;
    let returning = false;
    let one: 'single' | 'maybe' | null = null;

    const like = (v: any, pat: string) => new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$').test(String(v ?? ''));

    const exec = (): { data: any; error: any } => {
      const touched = op === 'select' ? (cols[0] === '*' ? [] : cols) : Object.keys(Array.isArray(payload) ? payload[0] ?? {} : payload);
      const bad = db.bad(table, touched);
      if (bad) return { data: null, error: { code: '42703', message: `column "${bad}" of relation "${table}" does not exist` } };
      if (op === 'insert') {
        const r = db.seed(table, payload);
        return { data: returning ? [r] : null, error: null };
      }
      if (op === 'upsert') {
        const inserted: Row[] = [];
        for (const row of payload as Row[]) {
          if (db.rows(table).some((x) => x[opts.onConflict] === row[opts.onConflict])) continue;
          inserted.push(db.seed(table, row));
        }
        return { data: inserted, error: null };
      }
      let matched = db.rows(table).filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        matched.forEach((r) => Object.assign(r, payload));
        return { data: returning ? matched : null, error: null };
      }
      if (order) matched = [...matched].sort((a, b) => (a[order!.col] > b[order!.col] ? 1 : a[order!.col] < b[order!.col] ? -1 : 0) * (order!.asc ? 1 : -1));
      if (rng) matched = matched.slice(rng[0], rng[1] + 1);
      if (lim !== null) matched = matched.slice(0, lim);
      if (one) return { data: matched[0] ?? null, error: null };
      return { data: matched, error: null };
    };

    const q: any = {
      select: (c?: string) => { if (op === 'select') cols = (c ?? '*').split(',').map((s) => s.trim()); else returning = true; return q; },
      insert: (row: Row) => { op = 'insert'; payload = row; return q; },
      upsert: (rows: Row[], o: any) => { op = 'upsert'; payload = rows; opts = o ?? {}; return q; },
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      gte: (c: string, v: any) => { filters.push((r) => r[c] >= v); return q; },
      lt: (c: string, v: any) => { filters.push((r) => r[c] < v); return q; },
      like: (c: string, p: string) => { filters.push((r) => like(r[c], p)); return q; },
      is: (c: string, v: any) => { filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { order = { col: c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { lim = n; return q; },
      range: (a: number, b: number) => { rng = [a, b]; return q; },
      single: () => { one = 'single'; return Promise.resolve(exec()); },
      maybeSingle: () => { one = 'maybe'; return Promise.resolve(exec()); },
      then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
    };
    return q;
  };
}
