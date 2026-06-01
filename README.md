# tonsh

Web-based tmux client with first-class mobile support.

Attach to your existing tmux sessions from any browser — desktop or phone — without installing anything beyond `npx`.

## Quick start

```sh
npx tonsh
```

Open `http://localhost:7000` in a browser. Pick or create a session in the sidebar, and start working.

## Usage

```
tonsh [options]

  -p, --port <n>     port to listen on (default: 7000)
      --host <addr>  host to bind (default: localhost)
  -s, --secret <key> require this key to connect (default: none)
  -d, --daemon       run in background, detached from the terminal
      --restart      stop a running tonsh (if any) before starting
      --stop         stop a running tonsh and exit
  -h, --help         show this help
```

### Examples

Run on a different port, bound to all interfaces:

```sh
npx tonsh --host 0.0.0.0 -p 9000
```

Run in the background (writes a PID file to `$XDG_RUNTIME_DIR/tonsh.pid` or `/tmp/tonsh-<uid>.pid`):

```sh
npx tonsh -d
npx tonsh --stop      # later
npx tonsh -d --restart
```

Require a shared secret instead of relying on a reverse proxy:

```sh
npx tonsh -s "$(head -c32 /dev/urandom | base64)"
```

The browser prompts for the secret on first connect and remembers it in `localStorage`.

## Security

`tonsh` has **no built-in user accounts**. By default it binds to `localhost` only, so exposing it to other devices requires a deliberate choice. Two recommended patterns:

- **Reverse proxy with auth** — put `tonsh` behind something like Traefik + Authelia / Caddy + basic auth / Cloudflare Access. This is the strongest option.
- **Shared secret** — pass `-s <key>`. The HTTP API and WebSocket are both gated by a constant-time hash check. Use TLS in transit (the secret travels in headers/query). Suitable for personal/small-team use.

The static assets (HTML/JS/CSS) themselves are public; only the API and PTY-attaching WebSocket are protected.

## Mobile notes

- Sessions list collapses into an offcanvas drawer.
- A small keypad above the on-screen keyboard provides Tab / Ctrl / Esc / arrows.
- Swiping the terminal scrolls tmux history (synthesized as wheel events; works with tmux `mouse on`).
- The page auto-reconnects after backgrounding / tab switches / network changes.

## Requirements

- Node.js ≥ 20
- A working `tmux` binary on `PATH`
- `node-pty` ships prebuilt binaries for most platforms. If your platform lacks one, install `python3`, `make`, and a C++ compiler (Xcode CLT on macOS, `build-essential` on Debian/Ubuntu) so `node-pty` can compile.

## Development

```sh
git clone https://github.com/bughela/tonsh.git
cd tonsh
npm install
npm run dev
```

`npm run dev` runs the esbuild bundler once then starts the server. Re-run after editing the frontend.

## License

MIT
