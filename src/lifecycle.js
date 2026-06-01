import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export function pidPath() {
  if (process.env.XDG_RUNTIME_DIR) {
    return path.join(process.env.XDG_RUNTIME_DIR, 'tonsh.pid');
  }
  const uid =
    typeof process.getuid === 'function' ? process.getuid() : 'user';
  return `/tmp/tonsh-${uid}.pid`;
}

// Returns the PID from the PID file if the process is still alive,
// otherwise null (stale or missing file).
export function readRunningPid() {
  let pid;
  try {
    pid = parseInt(fs.readFileSync(pidPath(), 'utf8'), 10);
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  return pid;
}

export function writePidFile(pid) {
  fs.writeFileSync(pidPath(), String(pid));
}

// Install handlers so the running tonsh removes its own PID file on exit.
export function installPidCleanup() {
  const file = pidPath();
  const cleanup = () => {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  };
  process.on('exit', cleanup);
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(sig, () => {
      cleanup();
      process.exit(0);
    });
  }
}

// SIGTERM then poll for exit; SIGKILL after timeoutMs. Returns when the
// target process is gone (or we gave up).
export async function killAndWait(pid, { timeoutMs = 3000 } = {}) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      process.kill(pid, 0);
    } catch {
      try {
        fs.unlinkSync(pidPath());
      } catch {
        /* gone */
      }
      return;
    }
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  await new Promise((r) => setTimeout(r, 100));
  try {
    fs.unlinkSync(pidPath());
  } catch {
    /* gone */
  }
}

export function promptYesNo(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(null);
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}
