import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const SESS_FMT = '#{session_name}\t#{session_attached}';
const WIN_FMT =
  '#{session_name}\t#{window_index}\t#{window_name}\t#{window_active}';

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const WIN_NAME_RE = /^[\w .-]{1,32}$/;

function noServer(err) {
  return /no server running|no sessions/i.test(
    String(err.stderr || err.message)
  );
}

// Returns an error string if invalid, or null if the name is acceptable.
export function validateSessionName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return 'name is required';
  }
  if (name.length > 32) {
    return 'name must be 32 characters or fewer';
  }
  if (!NAME_RE.test(name)) {
    return 'name may only contain letters, digits, "-" and "_"';
  }
  return null;
}

export function validateWindowName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return 'name is required';
  }
  if (!WIN_NAME_RE.test(name)) {
    return 'name must be 1-32 chars: letters, digits, space, ".", "-", "_"';
  }
  return null;
}

async function listAllWindows() {
  try {
    const { stdout } = await run('tmux', ['list-windows', '-a', '-F', WIN_FMT]);
    const bySession = new Map();
    for (const line of stdout.split('\n').filter(Boolean)) {
      const [session, index, name, active] = line.split('\t');
      if (!bySession.has(session)) bySession.set(session, []);
      bySession.get(session).push({
        index: Number(index),
        name,
        active: Number(active) > 0,
      });
    }
    return bySession;
  } catch (err) {
    if (noServer(err)) return new Map();
    throw err;
  }
}

export async function listSessions() {
  try {
    const { stdout } = await run('tmux', ['list-sessions', '-F', SESS_FMT]);
    const windowsBySession = await listAllWindows();
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, attached] = line.split('\t');
        const windows = windowsBySession.get(name) || [];
        return {
          name,
          attached: Number(attached) > 0,
          windows,
        };
      });
  } catch (err) {
    if (noServer(err)) return [];
    throw err;
  }
}

export async function createSession(name) {
  await run('tmux', ['new-session', '-d', '-s', name]);
}

export async function killSession(name) {
  await run('tmux', ['kill-session', '-t', name]);
}

export async function renameSession(oldName, newName) {
  await run('tmux', ['rename-session', '-t', oldName, newName]);
}

export async function renameWindow(session, index, newName) {
  await run('tmux', [
    'rename-window',
    '-t',
    `${session}:${index}`,
    newName,
  ]);
}

export async function selectWindow(session, index) {
  await run('tmux', ['select-window', '-t', `${session}:${index}`]);
}

export async function newWindow(session) {
  await run('tmux', ['new-window', '-t', session]);
}

export async function killWindow(session, index) {
  await run('tmux', ['kill-window', '-t', `${session}:${index}`]);
}
