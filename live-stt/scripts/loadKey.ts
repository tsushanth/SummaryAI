import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Loads SONIOX_API_KEY into process.env ONLY (never printed, never written anywhere): either it is already in the environment, or
 * SONIOX_ENV_FILE points at a local .env-style file (a leading ~/ is expanded). Returns true if the key is now set.
 */
export function loadSonioxKey(file = process.env.SONIOX_ENV_FILE): boolean {
  if (process.env.SONIOX_API_KEY) return true;
  if (!file) return false;
  if (file.startsWith('~/')) file = join(homedir(), file.slice(2));
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?SONIOX_API_KEY\s*=\s*(.*)$/.exec(line);
      if (m) {
        const v = m[1]!.trim().replace(/^['"]|['"]$/g, '');
        if (v) { process.env.SONIOX_API_KEY = v; return true; }
      }
    }
  } catch { /* no file */ }
  return false;
}
