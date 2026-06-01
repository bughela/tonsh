#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.js';
import {
  pidPath,
  readRunningPid,
  writePidFile,
  installPidCleanup,
  killAndWait,
  promptYesNo,
} from '../src/lifecycle.js';

const DAEMON_CHILD = process.env.TONSH_DAEMON_CHILD === '1';

function parseArgs(argv) {
  const opts = { port: 7000, host: 'localhost' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') {
      opts.port = Number(argv[++i]);
    } else if (a === '--host') {
      opts.host = argv[++i];
    } else if (a === '--secret' || a === '-s') {
      opts.secret = argv[++i];
    } else if (a === '--daemon' || a === '-d') {
      opts.daemon = true;
    } else if (a === '--stop') {
      opts.stop = true;
    } else if (a === '--restart') {
      opts.restart = true;
    } else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: tonsh [options]\n\n' +
          '  -p, --port <n>     port to listen on (default: 7000)\n' +
          '      --host <addr>  host to bind (default: localhost)\n' +
          '  -s, --secret <key> require this key to connect (default: none)\n' +
          '  -d, --daemon       run in background, detached from the terminal\n' +
          '      --restart      stop a running tonsh (if any) before starting\n' +
          '      --stop         stop a running tonsh and exit\n' +
          '  -h, --help         show this help\n'
      );
      process.exit(0);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    console.error(`Invalid port: ${opts.port}`);
    process.exit(1);
  }
  if ('secret' in opts && !opts.secret) {
    console.error('--secret requires a non-empty value');
    process.exit(1);
  }
  return opts;
}

async function handleStop() {
  const pid = readRunningPid();
  if (!pid) {
    console.log('tonsh: not running');
    return 0;
  }
  await killAndWait(pid);
  console.log(`tonsh: stopped (pid=${pid})`);
  return 0;
}

// In daemon mode the parent runs the lifecycle checks (so the prompt has a
// TTY) and then spawns a detached child that actually runs the server.
async function spawnDaemon() {
  const childArgs = process.argv
    .slice(2)
    .filter((a) => a !== '-d' && a !== '--daemon' && a !== '--restart');
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), ...childArgs],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, TONSH_DAEMON_CHILD: '1' },
    }
  );
  child.unref();
  console.log(
    `tonsh: started in background (pid=${child.pid}, pidfile=${pidPath()})`
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // The detached child re-enters this script with --daemon stripped from
  // argv. It must skip the lifecycle prompt and go straight to listening.
  if (DAEMON_CHILD) {
    await startServer(opts);
    writePidFile(process.pid);
    installPidCleanup();
    return;
  }

  if (opts.stop) {
    process.exit(await handleStop());
  }

  const running = readRunningPid();
  if (running) {
    let restart = opts.restart;
    if (!restart) {
      const ans = await promptYesNo(
        `tonsh: already running (pid=${running}). Stop and restart? [y/N]: `
      );
      if (ans === null) {
        console.error(
          `tonsh: already running (pid=${running}). Use --restart or --stop.`
        );
        process.exit(1);
      }
      restart = ans;
    }
    if (!restart) {
      console.log('tonsh: not started.');
      process.exit(0);
    }
    await killAndWait(running);
    console.log(`tonsh: stopped previous instance (pid=${running})`);
  }

  if (opts.daemon) {
    await spawnDaemon();
    return;
  }

  await startServer(opts);
  writePidFile(process.pid);
  installPidCleanup();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
