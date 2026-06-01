import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const CONFIG_DIR = join(homedir(), '.tonsh');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  fontSize: 14,
  theme: 'dark',
};

export async function readConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeConfig(patch) {
  const current = await readConfig();
  const next = { ...current, ...patch };
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}
