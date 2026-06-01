import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  listSessions,
  createSession,
  killSession,
  renameSession,
  renameWindow,
  selectWindow,
  newWindow,
  killWindow,
  validateSessionName,
  validateWindowName,
} from './tmux.js';
import { readConfig, writeConfig } from './config.js';
import { attachSession } from './pty.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');

// Constant-time secret check. Hashing both sides to a fixed length avoids
// leaking length and avoids timingSafeEqual's equal-length requirement.
function makeAuth(secret) {
  if (!secret) {
    return { required: false, check: () => true };
  }
  const want = createHash('sha256').update(secret).digest();
  return {
    required: true,
    check(provided) {
      if (typeof provided !== 'string' || provided.length === 0) return false;
      const got = createHash('sha256').update(provided).digest();
      return timingSafeEqual(want, got);
    },
  };
}

export async function startServer({ port, host, secret }) {
  const app = Fastify({ logger: false });
  const auth = makeAuth(secret);

  await app.register(fastifyWebsocket);
  await app.register(fastifyStatic, { root: DIST, prefix: '/' });

  // Gate every /api/* route (except the public discovery endpoint). Static
  // assets are intentionally public — they contain no secrets and the API/WS
  // below are still locked, so bypassing the UI gains nothing.
  app.addHook('onRequest', async (req, reply) => {
    if (!auth.required) return;
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    if (path === '/api/auth-required') return;
    if (!auth.check(req.headers['x-tonsh-secret'])) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // Public: lets the client know whether to prompt for a key. Leaks only
  // whether auth is enabled, not the key itself.
  app.get('/api/auth-required', async () => ({ required: auth.required }));

  // Reaching this handler means the onRequest hook already accepted the key.
  app.get('/api/auth', async () => ({ ok: true }));

  app.get('/api/sessions', async () => {
    return { sessions: await listSessions() };
  });

  app.post('/api/sessions', async (req, reply) => {
    const name = req.body && req.body.name;
    const err = validateSessionName(name);
    if (err) {
      return reply.code(400).send({ error: err });
    }
    const existing = await listSessions();
    if (existing.some((s) => s.name === name)) {
      return reply.code(409).send({ error: `session "${name}" already exists` });
    }
    await createSession(name);
    return { ok: true };
  });

  app.delete('/api/sessions/:name', async (req) => {
    await killSession(req.params.name);
    return { ok: true };
  });

  app.patch('/api/sessions/:name', async (req, reply) => {
    const oldName = req.params.name;
    const newName = req.body && req.body.name;
    const err = validateSessionName(newName);
    if (err) {
      return reply.code(400).send({ error: err });
    }
    if (newName !== oldName) {
      const existing = await listSessions();
      if (existing.some((s) => s.name === newName)) {
        return reply
          .code(409)
          .send({ error: `session "${newName}" already exists` });
      }
    }
    await renameSession(oldName, newName);
    return { ok: true };
  });

  app.post('/api/sessions/:name/windows', async (req) => {
    await newWindow(req.params.name);
    return { ok: true };
  });

  app.delete('/api/sessions/:name/windows/:index', async (req, reply) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      return reply.code(400).send({ error: 'invalid window index' });
    }
    await killWindow(req.params.name, index);
    return { ok: true };
  });

  app.post('/api/sessions/:name/windows/:index/select', async (req, reply) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      return reply.code(400).send({ error: 'invalid window index' });
    }
    await selectWindow(req.params.name, index);
    return { ok: true };
  });

  app.patch('/api/sessions/:name/windows/:index', async (req, reply) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      return reply.code(400).send({ error: 'invalid window index' });
    }
    const newName = req.body && req.body.name;
    const err = validateWindowName(newName);
    if (err) {
      return reply.code(400).send({ error: err });
    }
    await renameWindow(req.params.name, index, newName);
    return { ok: true };
  });

  app.get('/api/config', async () => readConfig());

  app.post('/api/config', async (req) => writeConfig(req.body || {}));

  app.register(async (scoped) => {
    scoped.get('/ws/:session', { websocket: true }, (socket, req) => {
      // Browsers can't set headers on WebSocket, so the key comes via query.
      // Behind TLS this is encrypted in transit.
      if (!auth.check(req.query.s)) {
        socket.close();
        return;
      }
      const session = req.params.session;
      if (validateSessionName(session)) {
        socket.close();
        return;
      }
      const cols = Number(req.query.cols) || 80;
      const rows = Number(req.query.rows) || 24;
      attachSession(socket, session, { cols, rows });
    });
  });

  await app.listen({ port, host });
  console.log(
    `tonsh listening on http://${host}:${port}` +
      (auth.required ? ' (secret auth enabled)' : '')
  );
}
