import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

// Drawer state lives on <body data-drawer="open|closed">.
function openDrawer() {
  document.body.dataset.drawer = 'open';
}
function closeDrawer() {
  document.body.dataset.drawer = 'closed';
}
function closeSidebarOnMobile() {
  if (isMobile()) closeDrawer();
}

const FONT_KEY = 'tonsh.fontSize';
const FONT_MIN = 8;
const FONT_MAX = 24;

function getFontSize() {
  const v = parseInt(localStorage.getItem(FONT_KEY), 10);
  return Number.isFinite(v) ? v : isMobile() ? 11 : 14;
}

function setFontSize(n) {
  n = Math.min(FONT_MAX, Math.max(FONT_MIN, n));
  localStorage.setItem(FONT_KEY, String(n));
  document.getElementById('font-size').textContent = n;
  if (term) {
    term.options.fontSize = n;
    doResize();
  }
}

const listEl = document.getElementById('session-list');
const placeholder = document.getElementById('placeholder');
const termContainer = document.getElementById('terminal');

const LAST_KEY = 'tonsh.lastSession';
const SECRET_KEY = 'tonsh.secret';

let secret = localStorage.getItem(SECRET_KEY) || '';

function authHeaders() {
  return secret ? { 'x-tonsh-secret': secret } : {};
}

// If the server requires a key, validate the stored one and prompt until a
// correct key is entered. Resolves once authenticated (or auth is disabled).
async function ensureAuth() {
  const req = await fetch('/api/auth-required');
  const { required } = await req.json();
  if (!required) return;

  for (;;) {
    const res = await fetch('/api/auth', { headers: authHeaders() });
    if (res.ok) return;
    const entered = prompt('This tonsh requires a secret key:');
    if (entered == null) {
      throw new Error('authentication cancelled');
    }
    secret = entered.trim();
    localStorage.setItem(SECRET_KEY, secret);
  }
}

let term = null;
let fitAddon = null;
let ws = null;
let current = null;
let currentWindow = null;
let firstLoad = true;

let reconnectTimer = null;
let reconnectAttempts = 0;
let pingTimer = null;
let manualClose = false;
let sessionEnded = false;
let showedReconnecting = false;

let ctrlSticky = false;

function sendInput(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data }));
  }
}

// Apply sticky Ctrl to a single typed character, then clear the modifier.
function applyStickyModifiers(data) {
  if (ctrlSticky && data.length === 1) {
    const code = data.toUpperCase().charCodeAt(0);
    data = String.fromCharCode(code & 0x1f);
    ctrlSticky = false;
    refreshModButtons();
  }
  return data;
}

function refreshModButtons() {
  document
    .querySelectorAll('#keypad button[data-mod="ctrl"]')
    .forEach((b) => b.classList.toggle('sticky-on', ctrlSticky));
}

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const WIN_NAME_RE = /^[\w .-]{1,32}$/;

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      ...authHeaders(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    alert(error || `${method} ${url} failed (${res.status})`);
    return false;
  }
  return true;
}

async function fetchSessions() {
  const res = await fetch('/api/sessions', { headers: authHeaders() });
  const { sessions } = await res.json();
  renderSessions(sessions);

  if (firstLoad) {
    firstLoad = false;
    const last = localStorage.getItem(LAST_KEY);
    if (last && sessions.some((s) => s.name === last)) {
      connect(last);
    } else if (sessions.length === 0 && isMobile()) {
      // No sessions: open the drawer so the user can create/pick one.
      openDrawer();
    }
  }
}

function renderSessions(sessions) {
  listEl.innerHTML = '';
  currentWindow = null;
  document.getElementById('session-empty').hidden = sessions.length > 0;
  for (const s of sessions) {
    const li = document.createElement('li');
    li.className = 'session' + (s.name === current ? ' active' : '');

    const row = document.createElement('div');
    row.className = 'row';

    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = s.name;
    label.title = `${s.windows.length} window(s)${s.attached ? ' · attached' : ''}`;
    label.onclick = () => connect(s.name);

    row.append(label);
    li.append(row);

    const wul = document.createElement('ul');
    wul.className = 'windows list-unstyled m-0';
    for (const w of s.windows) {
      if (s.name === current && w.active) {
        currentWindow = { index: w.index, name: w.name };
      }
      const wli = document.createElement('li');
      wli.className =
        'window' + (s.name === current && w.active ? ' active' : '');

      const wname = document.createElement('span');
      wname.className = 'name';
      wname.textContent = `${w.index}: ${w.name}`;
      wname.onclick = async () => {
        const ok = await api(
          'POST',
          `/api/sessions/${encodeURIComponent(s.name)}/windows/${w.index}/select`
        );
        if (!ok) return;
        if (current !== s.name) connect(s.name);
        else fetchSessions();
      };

      wli.append(wname);
      wul.append(wli);
    }
    li.append(wul);
    listEl.append(li);
  }
  updateFooter();
}

function updateFooter() {
  document
    .getElementById('app')
    .classList.toggle('has-session', !!current);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function startPing() {
  stopPing();
  // App-level heartbeat: keeps the connection alive through proxies and
  // lets a dead socket be detected on the next tick.
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 25000);
}

function teardownTerm() {
  manualClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopPing();
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (term) {
    term.dispose();
    term = null;
  }
  current = null;
  currentWindow = null;
  placeholder.style.display = '';
  updateFooter();
}

function openSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  fitAddon.fit();
  const { cols, rows } = term;
  const sq = secret ? `&s=${encodeURIComponent(secret)}` : '';
  ws = new WebSocket(
    `${proto}://${location.host}/ws/${encodeURIComponent(current)}?cols=${cols}&rows=${rows}${sq}`
  );
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    reconnectAttempts = 0;
    if (showedReconnecting) {
      // Clear stale screen so tmux's reattach repaint is clean.
      term.reset();
      showedReconnecting = false;
    }
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    startPing();
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'exit') {
          sessionEnded = true;
          stopPing();
          term.write('\r\n\x1b[33m[session ended]\x1b[0m\r\n');
          // The tmux session is gone. Keep the message on screen but drop
          // the now-stale UI state and refresh the sidebar.
          current = null;
          currentWindow = null;
          updateFooter();
          fetchSessions();
          return;
        }
      } catch {
        /* not control json */
      }
      term.write(ev.data);
    } else {
      term.write(new Uint8Array(ev.data));
    }
  };

  ws.onerror = () => {
    if (ws) ws.close();
  };

  ws.onclose = () => {
    stopPing();
    if (manualClose || sessionEnded) return;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  if (!showedReconnecting && term) {
    const msg = navigator.onLine
      ? '[connection lost — reconnecting…]'
      : '[offline — waiting for network…]';
    term.write(`\r\n\x1b[33m${msg}\x1b[0m`);
    showedReconnecting = true;
  }
  reconnectAttempts += 1;
  const base = Math.min(30000, 1000 * 2 ** (reconnectAttempts - 1));
  const delay = base + Math.floor(Math.random() * 500);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!manualClose && !sessionEnded && current) openSocket();
  }, delay);
}

// Foreground return / network change: reconnect immediately instead of
// waiting out the throttled backoff timer.
function reconnectNow() {
  if (!current || sessionEnded || manualClose) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  openSocket();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) reconnectNow();
});
window.addEventListener('focus', reconnectNow);
window.addEventListener('online', reconnectNow);

function connect(name) {
  closeSidebarOnMobile();
  if (current === name && ws && ws.readyState === WebSocket.OPEN) return;
  teardownTerm();
  manualClose = false;
  sessionEnded = false;
  showedReconnecting = false;
  reconnectAttempts = 0;
  current = name;
  localStorage.setItem(LAST_KEY, name);
  placeholder.style.display = 'none';

  term = new Terminal({
    cursorBlink: true,
    fontSize: getFontSize(),
    fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", "Symbols Nerd Font Mono", "Noto Sans Symbols 2", monospace',
    theme: { background: '#1e1e1e' },
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(termContainer);
  fitAddon.fit();
  term.focus();

  term.onData((d) => {
    sendInput(applyStickyModifiers(d));
  });

  openSocket();
  fetchSessions();
}

function doResize() {
  if (!term || !fitAddon) return;
  fitAddon.fit();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }
}

window.addEventListener('resize', doResize);

// The mobile virtual keyboard shrinks the visual viewport without firing a
// window resize. Clamp the app to the visible area so the terminal sits
// above the keyboard, then keep the prompt in view. After Android dismisses
// the keyboard the canvas is often left with stale pixels in the area the
// keyboard occupied — its compositor doesn't auto-invalidate that region.
// Fix: schedule multiple refresh points across the keyboard's animation,
// and toggle a transform on #app to force compositor layer invalidation.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const appEl = document.getElementById('app');
  const settleTimers = [];

  const refreshAll = () => {
    void appEl.offsetHeight; // force reflow
    doResize();
    if (term && term.cols > 0 && term.rows > 1) {
      // Nuclear option: force xterm.js to fully reallocate its canvas and
      // re-rasterize every glyph. Android Chrome leaves stale pixels behind
      // after a soft-keyboard dismiss and only a hard repaint clears them.
      if (typeof term.clearTextureAtlas === 'function') {
        term.clearTextureAtlas();
      }
      const cols = term.cols;
      const rows = term.rows;
      term.resize(cols, rows - 1);
      term.resize(cols, rows);
      term.refresh(0, term.rows - 1);
      term.scrollToBottom();
    }
  };

  const invalidateCompositor = () => {
    appEl.style.transform = 'translateZ(0)';
    requestAnimationFrame(() => {
      appEl.style.transform = '';
    });
  };

  const onViewport = () => {
    appEl.style.height = `${vv.height}px`;
    window.scrollTo(0, 0);
    while (settleTimers.length) clearTimeout(settleTimers.pop());
    // Immediate: layout the new height.
    requestAnimationFrame(refreshAll);
    // Mid-animation: Android keyboard glide is ~150-250ms.
    settleTimers.push(setTimeout(refreshAll, 180));
    // After settle: final pass + compositor kick.
    settleTimers.push(
      setTimeout(() => {
        refreshAll();
        invalidateCompositor();
      }, 360)
    );
  };
  vv.addEventListener('resize', onViewport);
  vv.addEventListener('scroll', onViewport);
}

// xterm.js doesn't translate touch drag into wheel events, so on mobile a
// swipe never reaches tmux. Synthesize SGR mouse-wheel sequences so tmux's
// mouse mode treats a vertical swipe like a wheel and scrolls history.
let touchY = null;
let touchAccum = 0;
let touchCol = 1;
let touchRow = 1;
const TOUCH_WHEEL_STEP = 24;

function touchCell(touch) {
  if (!term) return [1, 1];
  const rect = termContainer.getBoundingClientRect();
  const lx = touch.clientX - rect.left;
  const ly = touch.clientY - rect.top;
  const col = Math.max(1, Math.min(term.cols, Math.floor((lx / rect.width) * term.cols) + 1));
  const row = Math.max(1, Math.min(term.rows, Math.floor((ly / rect.height) * term.rows) + 1));
  return [col, row];
}

termContainer.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) {
    touchY = null;
    return;
  }
  const t = e.touches[0];
  touchY = t.clientY;
  touchAccum = 0;
  [touchCol, touchRow] = touchCell(t);
}, { passive: true });

termContainer.addEventListener('touchmove', (e) => {
  if (touchY === null || e.touches.length !== 1 || !term) return;
  const t = e.touches[0];
  touchAccum += t.clientY - touchY;
  touchY = t.clientY;
  while (touchAccum >= TOUCH_WHEEL_STEP) {
    sendInput(`\x1b[<64;${touchCol};${touchRow}M`);
    touchAccum -= TOUCH_WHEEL_STEP;
  }
  while (touchAccum <= -TOUCH_WHEEL_STEP) {
    sendInput(`\x1b[<65;${touchCol};${touchRow}M`);
    touchAccum += TOUCH_WHEEL_STEP;
  }
}, { passive: true });

const endTouch = () => {
  touchY = null;
};
termContainer.addEventListener('touchend', endTouch);
termContainer.addEventListener('touchcancel', endTouch);

document.getElementById('new-session').onclick = async () => {
  const name = (prompt('New session name:') || '').trim();
  if (!name) return;
  if (name.length > 32 || !NAME_RE.test(name)) {
    alert('Name may only contain letters, digits, "-" and "_" (max 32).');
    return;
  }
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    alert(error || `Failed to create session (${res.status})`);
    return;
  }
  await fetchSessions();
  connect(name);
};

document.getElementById('rename-session-btn').onclick = async () => {
  if (!current) return;
  const next = (prompt('Rename session:', current) || '').trim();
  if (!next || next === current) return;
  if (next.length > 32 || !NAME_RE.test(next)) {
    alert('Name may only contain letters, digits, "-" and "_" (max 32).');
    return;
  }
  const ok = await api('PATCH', `/api/sessions/${encodeURIComponent(current)}`, {
    name: next,
  });
  if (!ok) return;
  teardownTerm();
  connect(next);
};

document.getElementById('rename-window-btn').onclick = async () => {
  if (!current || !currentWindow) return;
  const next = (prompt('Rename window:', currentWindow.name) || '').trim();
  if (!next || next === currentWindow.name) return;
  if (!WIN_NAME_RE.test(next)) {
    alert('1-32 chars: letters, digits, space, ".", "-", "_".');
    return;
  }
  const ok = await api(
    'PATCH',
    `/api/sessions/${encodeURIComponent(current)}/windows/${currentWindow.index}`,
    { name: next }
  );
  if (ok) fetchSessions();
};

document.getElementById('kill-session-btn').onclick = async () => {
  if (!current) return;
  if (!confirm(`Kill session "${current}"? Running work will be lost.`)) return;
  const ok = await api('DELETE', `/api/sessions/${encodeURIComponent(current)}`);
  if (!ok) return;
  teardownTerm();
  fetchSessions();
};

document.getElementById('new-window-btn').onclick = async () => {
  if (!current) return;
  const ok = await api(
    'POST',
    `/api/sessions/${encodeURIComponent(current)}/windows`
  );
  if (ok) {
    fetchSessions();
    if (term) term.focus();
  }
};

document.getElementById('kill-window-btn').onclick = async () => {
  if (!current || !currentWindow) return;
  const w = `${currentWindow.index}: ${currentWindow.name}`;
  if (!confirm(`Kill window "${w}"? Running work will be lost.`)) return;
  const ok = await api(
    'DELETE',
    `/api/sessions/${encodeURIComponent(current)}/windows/${currentWindow.index}`
  );
  if (!ok) return;
  // Killing the last window removes the session too.
  const res = await fetch('/api/sessions', { headers: authHeaders() });
  const { sessions } = await res.json();
  if (!sessions.some((s) => s.name === current)) teardownTerm();
  renderSessions(sessions);
};

async function splitPane(direction) {
  if (!current || !currentWindow) return;
  const ok = await api(
    'POST',
    `/api/sessions/${encodeURIComponent(current)}/windows/${currentWindow.index}/panes`,
    { direction }
  );
  if (ok && term) term.focus();
}

document.getElementById('split-pane-h-btn').onclick = () => splitPane('h');
document.getElementById('split-pane-v-btn').onclick = () => splitPane('v');

document.getElementById('kill-pane-btn').onclick = async () => {
  if (!current || !currentWindow) return;
  if (!confirm('Kill active pane? Running work in it will be lost.')) return;
  const ok = await api(
    'DELETE',
    `/api/sessions/${encodeURIComponent(current)}/windows/${currentWindow.index}/panes`
  );
  if (!ok) return;
  // Killing the last pane removes the window; if it was the last window,
  // the session is gone too. Refresh and tear down if needed.
  const res = await fetch('/api/sessions', { headers: authHeaders() });
  const { sessions } = await res.json();
  if (!sessions.some((s) => s.name === current)) teardownTerm();
  renderSessions(sessions);
  if (term) term.focus();
};

document.getElementById('open-sidebar').onclick = () => {
  if (isMobile()) {
    openDrawer();
  } else {
    document.getElementById('app').classList.remove('sidebar-collapsed');
    setTimeout(doResize, 200);
  }
};

document.getElementById('collapse-sidebar').onclick = () => {
  if (isMobile()) {
    closeDrawer();
  } else {
    document.getElementById('app').classList.add('sidebar-collapsed');
    setTimeout(doResize, 200);
  }
};

document.getElementById('drawer-scrim').onclick = closeDrawer;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.dataset.drawer === 'open') {
    closeDrawer();
  }
});

document.getElementById('keypad-toggle').onclick = () => {
  document.getElementById('app').classList.toggle('keypad-open');
  setTimeout(doResize, 200);
};

// Keypad: use mousedown + preventDefault so the terminal keeps focus.
const SEQ_MAP = {
  '\\x1b': '\x1b',
  '\\t': '\t',
  '\\x1b[A': '\x1b[A',
  '\\x1b[B': '\x1b[B',
  '\\x1b[C': '\x1b[C',
  '\\x1b[D': '\x1b[D',
};

document.querySelectorAll('#keypad button').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    if (btn.dataset.mod === 'ctrl') {
      ctrlSticky = !ctrlSticky;
      refreshModButtons();
    } else {
      const seq = SEQ_MAP[btn.dataset.seq] ?? btn.dataset.seq;
      sendInput(applyStickyModifiers(seq));
    }
    if (term) term.focus();
  });
});

// Font size controls.
document.getElementById('font-size').textContent = getFontSize();
document.getElementById('font-minus').onclick = () =>
  setFontSize(getFontSize() - 1);
document.getElementById('font-plus').onclick = () =>
  setFontSize(getFontSize() + 1);

// Mobile: keep the keypad visible by default.
if (isMobile()) {
  document.getElementById('app').classList.add('keypad-open');
}

ensureAuth()
  .then(fetchSessions)
  .catch((e) => {
    // A failed fetch (offline or server unreachable) throws a TypeError whose
    // message is a cryptic "Failed to fetch" — show something actionable.
    if (!navigator.onLine) {
      placeholder.innerHTML =
        "You're offline<br>tonsh needs a network connection to its server.";
    } else if (e instanceof TypeError) {
      placeholder.textContent =
        "Can't reach the tonsh server. Make sure it's running.";
    } else {
      placeholder.textContent = e.message;
    }
  });

// PWA: register the service worker only in a secure context (HTTPS or
// localhost). Over plain HTTP registration is rejected, so the guard keeps
// those users error-free — they just don't get the installable app.
if (window.isSecureContext && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
