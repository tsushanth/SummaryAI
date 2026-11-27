/**
 * A throwaway local Postgres for tests of the SQL spend control (migration 032 and later). Uses the pg_ctl/psql on this
 * machine; `pgAvailable` is false where there is none, and those tests are skipped.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN_DIRS = [process.env.PG_BIN_DIR, '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin']
  .filter((d): d is string => !!d);
const binDir = BIN_DIRS.find((d) => existsSync(join(d, 'initdb')));
export const pgAvailable = !!binDir;

export interface TestDb {
  /** Runs SQL, returns the unaligned output (one row per line, columns separated by |). Throws on error. */
  sql(statement: string): string;
  /** Same, without waiting: for concurrency tests. */
  stop(): void;
  socketDir: string;
  psql: string;
}

const BOOTSTRAP = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'select null::uuid';
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE TABLE public.recordings (id uuid PRIMARY KEY);
`;

export function startTestDb(migrations: string[]): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'mmpg-'));
  const data = join(dir, 'data');
  const bin = binDir!;
  const env = { ...process.env, LC_ALL: 'C' };
  execFileSync(join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync'], { env, stdio: 'pipe' });
  // Unix socket only, inside the temp directory: nothing listens on the network.
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-o', `-k ${dir} -c listen_addresses='' -c fsync=off`, '-l', join(dir, 'log'), '-w', 'start'], { env, stdio: 'pipe' });
  const psql = join(bin, 'psql');
  const run = (input: string): string => {
    const r = spawnSync(psql, ['-h', dir, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || `psql exit ${r.status}`);
    return r.stdout.trim();
  };
  const stop = () => {
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'pipe' }); } catch { /* already down */ }
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    run(BOOTSTRAP);
    for (const m of migrations) run(readFileSync(join(__dirname, '..', 'supabase', m), 'utf8'));
  } catch (e) { stop(); throw e; }
  return { sql: run, stop, socketDir: dir, psql };
}
