# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Complete UI redesign — "Atelier Console" terminal-studio aesthetic.
  Drop Bootstrap entirely in favour of a hand-written design system
  with cool-neutral dark palette and a restrained amber phosphor
  accent reserved for active states. Wordmark `tonsh▋` and empty
  state share a blinking caret signature (kept on even when
  `prefers-reduced-motion: reduce` is set; every other animation
  still respects it).
- Full-mono UI via system mono fallback chain (SF Mono → Cascadia
  Mono → JetBrains Mono → Menlo → Consolas → Ubuntu Mono → DejaVu
  Sans Mono). No bundled UI font — system fonts get freetype /
  ClearType / CoreText hinting that webfonts miss at low DPI. The
  Symbols Nerd Font Mono and Noto Sans Symbols 2 bundles stay for
  terminal glyph fallback.
- Replace Bootstrap Offcanvas with a custom CSS drawer
  (`transform` + scrim, 220ms cubic-bezier). ESC and scrim-tap
  close it.
- Mobile: `overscroll-behavior: none` on the page chain — swiping
  near the top with the keypad open no longer exposes blank space
  from the browser's rubber-band scroll.
- Sidebar: floating hamburger refined for visibility against the
  terminal background; action buttons swap icons for short text
  labels (`new` / `rename` / `kill`) with a rust hover on kill;
  active session shows a faded left rail, active window a 2px amber
  rail with a subtle phosphor glow; session rows fade-in staggered
  on first load.

### Removed
- `bootstrap` runtime dependency. The bundled `bootstrap.min.css`
  (~232KB) and the offcanvas JS import are gone. Net dist size
  ≈ −200KB.

## [0.1.2] - 2026-06-01

### Changed
- Bump `@xterm/xterm` to `^6`, `@xterm/addon-fit` to `^0.11`, and
  `@xterm/addon-web-links` to `^0.12`. None of the removed/renamed
  options (`overviewRulerWidth`, `windowsMode`, `fastScrollModifier`,
  the alt→ctrl arrow hack) were in use, so this is a drop-in bump
  from the API surface we touch.

## [0.1.1] - 2026-06-01

### Changed
- Bump `@fastify/static` to `^9` to pull in `glob@13` and silence the
  deprecation warning that surfaced on `npx` install.
- Bump `esbuild` to `^0.28` (dev only).

## [0.1.0] - 2026-06-01

### Added
- Initial release of `@bughela/tonsh` — web-based tmux client with
  first-class mobile support.
- Fastify + node-pty + WebSocket backend; xterm.js frontend bundled
  with esbuild.
- Sidebar session/window list with create, rename, kill, select.
- Optional shared-secret auth (`-s`), constant-time hash compare on
  every API and WebSocket connection.
- Daemon mode (`-d`) with PID-file lifecycle: `--restart`, `--stop`,
  interactive prompt when an instance is already running.
- Mobile-first frontend: Bootstrap offcanvas sidebar, virtual keypad
  (Tab / Ctrl / Esc / arrows), font-size controls, touch-swipe
  scrollback synthesized as SGR mouse-wheel events for tmux mouse
  mode, auto-reconnect on tab switch / focus / network change.
- Bundled Symbols Nerd Font Mono + Noto Sans Symbols 2 fallback so
  rare Unicode glyphs (powerline icons, media controls) render in
  the browser.

[Unreleased]: https://github.com/bughela/tonsh/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/bughela/tonsh/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/bughela/tonsh/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/bughela/tonsh/releases/tag/v0.1.0
