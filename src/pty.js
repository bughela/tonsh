import pty from 'node-pty';

// Attach a websocket connection to a tmux session via a dedicated PTY.
// `-A` => attach if it exists, otherwise create.
export function attachSession(socket, sessionName, { cols = 80, rows = 24 } = {}) {
  const term = pty.spawn(
    'tmux',
    ['new-session', '-A', '-s', sessionName],
    {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME,
      env: process.env,
    }
  );

  term.onData((data) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(data);
    }
  });

  term.onExit(() => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'exit' }));
      socket.close();
    }
  });

  socket.on('message', (raw) => {
    // JSON control messages start with '{'; everything else is raw input.
    const str = raw.toString();
    if (str[0] === '{') {
      try {
        const msg = JSON.parse(str);
        if (msg.type === 'resize') {
          term.resize(Math.max(1, msg.cols | 0), Math.max(1, msg.rows | 0));
          return;
        }
        if (msg.type === 'input') {
          term.write(msg.data);
          return;
        }
        if (msg.type === 'ping') {
          // Keepalive heartbeat; nothing to do server-side.
          return;
        }
      } catch {
        // not JSON, fall through to raw write
      }
    }
    term.write(str);
  });

  socket.on('close', () => {
    // Kill the PTY (detaches the tmux client). tmux session stays alive.
    try {
      term.kill();
    } catch {
      /* already gone */
    }
  });
}
