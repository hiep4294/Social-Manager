import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { ensureOperatorSchema } from './facebook-operator-core.js';
import {
  CHROME_EXTENSION_ACTIONS,
  extensionStatusIsHealthy
} from './chrome-extension-bridge-core.js';

const enabled = String(process.env.CHROME_EXTENSION_BRIDGE_ENABLED ?? 'true').toLowerCase() !== 'false';

function nowIso() { return new Date().toISOString(); }
function randomToken() { return crypto.randomBytes(32).toString('hex'); }
function randomPairCode() { return String(crypto.randomInt(100000, 1000000)); }
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function defaultFoodImageRoot() {
  const base = process.env.OneDrive
    ? path.join(process.env.OneDrive, 'Documents')
    : path.join(process.env.USERPROFILE || os.homedir(), 'Documents');
  return path.join(base, 'anh-mon-an');
}

function readJsonBody(req, maxBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Payload quá lớn'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('JSON không hợp lệ'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

function ensureBridgeSchema(db) {
  ensureOperatorSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chrome_extension_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      action TEXT,
      event_type TEXT NOT NULL,
      status TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chrome_extension_events_created
      ON chrome_extension_events(created_at);
  `);
}

if (!enabled) {
  console.log('Chrome Extension bridge: disabled');
} else {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '..');
  const dataDir = path.join(root, 'data');
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(dataDir, 'social-manager.db');
  const foodImageRoot = path.resolve(process.env.FOOD_IMAGE_ROOT || defaultFoodImageRoot());
  fs.mkdirSync(foodImageRoot, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  ensureBridgeSchema(db);

  const host = String(process.env.CHROME_EXTENSION_BRIDGE_HOST || '127.0.0.1');
  const port = Math.max(1024, Math.min(65535, Number(process.env.CHROME_EXTENSION_BRIDGE_PORT || 3210)));
  const heartbeatTtlMs = Math.max(15_000, Number(process.env.CHROME_EXTENSION_HEARTBEAT_TTL_MS || 45_000));
  const reservationTtlMs = Math.max(heartbeatTtlMs, Number(process.env.CHROME_EXTENSION_RESERVATION_TTL_MS || 60_000));
  const statusPath = path.join(publicDir, 'chrome-extension-status.json');
  const statePath = path.join(dataDir, 'chrome-extension-bridge.json');
  const expectedVersion = '2.1.0';

  function newState() {
    return {
      token: randomToken(),
      pairing_code: randomPairCode(),
      paired: false,
      extension_id: null,
      paired_at: null,
      created_at: nowIso()
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (!parsed?.token) throw new Error('missing token');
      if (!parsed.paired && !parsed.pairing_code) parsed.pairing_code = randomPairCode();
      return parsed;
    } catch {
      const state = newState();
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
      return state;
    }
  }

  let state = loadState();
  let lastHeartbeatAt = null;
  let extensionVersion = null;
  let lastJob = null;
  let lastError = null;

  function saveState() {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  function online() {
    return extensionStatusIsHealthy({ paired: Boolean(state.paired), last_heartbeat_at: lastHeartbeatAt }, { ttlMs: heartbeatTtlMs });
  }

  function writeStatus(extra = {}) {
    const body = {
      enabled: true,
      mode: 'EXTENSION_PRIMARY_PLAYWRIGHT_FALLBACK',
      paired: Boolean(state.paired),
      extension_id: state.extension_id || null,
      extension_version: extensionVersion,
      expected_version: expectedVersion,
      extension_online: online(),
      last_heartbeat_at: lastHeartbeatAt,
      supported_actions: CHROME_EXTENSION_ACTIONS,
      bridge: { host, port },
      last_job: lastJob,
      last_error: lastError,
      ...extra,
      updated_at: nowIso()
    };
    try { fs.writeFileSync(statusPath, JSON.stringify(body, null, 2), 'utf8'); } catch {}
  }

  function logEvent({ jobId = null, action = null, eventType, status = null, detail = null }) {
    try {
      db.prepare(`
        INSERT INTO chrome_extension_events(job_id,action,event_type,status,detail_json,created_at)
        VALUES(?,?,?,?,?,?)
      `).run(jobId, action, eventType, status, detail ? JSON.stringify(detail) : null, nowIso());
    } catch {}
  }

  function authenticate(req) {
    if (!state.paired) return false;
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const extensionId = String(req.headers['x-sm-extension-id'] || '').trim();
    return safeEqual(token, state.token) && extensionId && extensionId === state.extension_id;
  }

  function reserveDueJobs() {
    if (!online()) return 0;
    const now = nowIso();
    const placeholders = CHROME_EXTENSION_ACTIONS.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id,action FROM facebook_operator_jobs
      WHERE status='QUEUED'
        AND action IN (${placeholders})
        AND (scheduled_at IS NULL OR scheduled_at<=?)
      ORDER BY COALESCE(scheduled_at,created_at),created_at
      LIMIT 5
    `).all(...CHROME_EXTENSION_ACTIONS, now);
    let n = 0;
    for (const row of rows) {
      const changed = db.prepare(`
        UPDATE facebook_operator_jobs
        SET status='EXTENSION_QUEUED',updated_at=?
        WHERE id=? AND status='QUEUED'
      `).run(now, row.id);
      if (changed.changes) {
        n += 1;
        logEvent({ jobId: row.id, action: row.action, eventType: 'RESERVED', status: 'EXTENSION_QUEUED' });
      }
    }
    return n;
  }

  function releaseStaleReservations() {
    if (online()) return 0;
    const cutoff = new Date(Date.now() - reservationTtlMs).toISOString();
    const rows = db.prepare(`
      SELECT id,action FROM facebook_operator_jobs
      WHERE status='EXTENSION_QUEUED' AND updated_at<?
      LIMIT 20
    `).all(cutoff);
    let n = 0;
    for (const row of rows) {
      const changed = db.prepare(`
        UPDATE facebook_operator_jobs
        SET status='QUEUED',updated_at=?
        WHERE id=? AND status='EXTENSION_QUEUED'
      `).run(nowIso(), row.id);
      if (changed.changes) {
        n += 1;
        logEvent({ jobId: row.id, action: row.action, eventType: 'RELEASED_TO_PLAYWRIGHT', status: 'QUEUED' });
      }
    }
    return n;
  }

  function claimJob() {
    reserveDueJobs();
    const now = nowIso();
    const job = db.prepare(`
      SELECT * FROM facebook_operator_jobs
      WHERE status='EXTENSION_QUEUED'
      ORDER BY COALESCE(scheduled_at,created_at),created_at
      LIMIT 1
    `).get();
    if (!job) return null;
    const locked = db.prepare(`
      UPDATE facebook_operator_jobs
      SET status='PROCESSING',attempts=attempts+1,locked_at=?,updated_at=?
      WHERE id=? AND status='EXTENSION_QUEUED'
    `).run(now, now, job.id);
    if (!locked.changes) return null;
    const current = db.prepare('SELECT * FROM facebook_operator_jobs WHERE id=?').get(job.id);
    let payload = {};
    try { payload = JSON.parse(current.payload_json || '{}'); } catch {}
    lastJob = { id: current.id, action: current.action, status: 'PROCESSING', claimed_at: now };
    logEvent({ jobId: current.id, action: current.action, eventType: 'CLAIMED', status: 'PROCESSING' });
    writeStatus();
    return {
      id: current.id,
      action: current.action,
      brand_id: current.brand_id || null,
      payload,
      attempts: Number(current.attempts || 0),
      scheduled_at: current.scheduled_at || null,
      created_at: current.created_at
    };
  }

  function assetMime(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
  }

  function serveJobAsset(url, res) {
    const match = url.pathname.match(/^\/v1\/assets\/([^/]+)$/);
    if (!match) return false;

    const jobId = decodeURIComponent(match[1]);
    const token = String(url.searchParams.get('token') || '');
    const job = db.prepare('SELECT payload_json FROM facebook_operator_jobs WHERE id=?').get(jobId);
    if (!job) {
      sendJson(res, 404, { ok:false, error:'Asset job không tồn tại' });
      return true;
    }

    let payload = {};
    try { payload = JSON.parse(job.payload_json || '{}'); } catch {}
    if (!token || !safeEqual(token, String(payload.asset_token || ''))) {
      sendJson(res, 403, { ok:false, error:'Asset token không hợp lệ' });
      return true;
    }

    const file = path.resolve(String(payload.local_image_path || ''));
    const relative = path.relative(foodImageRoot, file);
    if (!file || relative.startsWith('..') || path.isAbsolute(relative)) {
      sendJson(res, 403, { ok:false, error:'Asset nằm ngoài kho ảnh cho phép' });
      return true;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      sendJson(res, 404, { ok:false, error:'Asset file không tồn tại' });
      return true;
    }

    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'content-type': assetMime(file),
      'content-length': body.length,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff'
    });
    res.end(body);
    return true;
  }

  function finishJob(input) {
    const id = String(input?.id || '').trim();
    const status = String(input?.status || '').trim().toUpperCase();
    if (!id) throw Object.assign(new Error('Thiếu job id'), { statusCode: 400 });
    if (!['DONE', 'FAILED', 'WAITING_USER', 'NEEDS_REVIEW'].includes(status)) {
      throw Object.assign(new Error(`Trạng thái kết quả không hợp lệ: ${status}`), { statusCode: 400 });
    }
    const job = db.prepare('SELECT * FROM facebook_operator_jobs WHERE id=?').get(id);
    if (!job) throw Object.assign(new Error('Không tìm thấy job'), { statusCode: 404 });
    if (job.status !== 'PROCESSING') {
      throw Object.assign(new Error(`Job không còn PROCESSING (hiện tại ${job.status})`), { statusCode: 409 });
    }
    const result = input?.result && typeof input.result === 'object' ? input.result : {};
    const error = status === 'DONE' ? null : String(input?.error || status).slice(0, 1800);
    db.prepare(`
      UPDATE facebook_operator_jobs
      SET status=?,result_json=?,error=?,locked_at=NULL,updated_at=?
      WHERE id=? AND status='PROCESSING'
    `).run(status, JSON.stringify(result), error, nowIso(), id);
    lastJob = { id, action: job.action, status, finished_at: nowIso(), result };
    lastError = error;
    logEvent({ jobId: id, action: job.action, eventType: 'RESULT', status, detail: { result, error } });
    writeStatus();
    return db.prepare('SELECT id,action,status,error,updated_at FROM facebook_operator_jobs WHERE id=?').get(id);
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url || '/', `http://${host}:${port}`);
      if (req.method === 'OPTIONS' && url.pathname.startsWith('/v1/assets/')) {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,OPTIONS',
          'cache-control': 'no-store'
        });
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/v1/assets/')) {
        if (serveJobAsset(url, res)) return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/health') {
        return sendJson(res, 200, {
          ok: true,
          service: 'social-manager-chrome-extension-bridge',
          paired: Boolean(state.paired),
          extension_online: online(),
          last_heartbeat_at: lastHeartbeatAt,
          expected_version: expectedVersion,
          supported_actions: CHROME_EXTENSION_ACTIONS
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/pair') {
        const body = await readJsonBody(req);
        if (state.paired) return sendJson(res, 409, { ok: false, error: 'Extension đã được ghép đôi. Dùng npm run extension:reset-pairing nếu cần ghép lại.' });
        const extensionId = String(body.extension_id || '').trim();
        if (!/^[a-p]{32}$/i.test(extensionId)) return sendJson(res, 400, { ok: false, error: 'extension_id không hợp lệ' });
        if (!safeEqual(String(body.code || '').trim(), state.pairing_code)) return sendJson(res, 403, { ok: false, error: 'Mã ghép đôi không đúng' });
        state = { ...state, paired: true, extension_id: extensionId, pairing_code: null, paired_at: nowIso() };
        saveState();
        lastHeartbeatAt = nowIso();
        extensionVersion = String(body.version || '').trim() || null;
        writeStatus();
        console.log(`Chrome Extension bridge: paired extension=${extensionId}`);
        return sendJson(res, 200, { ok: true, token: state.token, expected_version: expectedVersion });
      }

      if (!authenticate(req)) return sendJson(res, 401, { ok: false, error: 'Extension chưa xác thực' });

      if (req.method === 'POST' && url.pathname === '/v1/heartbeat') {
        const body = await readJsonBody(req);
        lastHeartbeatAt = nowIso();
        extensionVersion = String(body.version || '').trim() || extensionVersion;
        lastError = null;
        const reserved = reserveDueJobs();
        writeStatus({ last_heartbeat: { reserved } });
        return sendJson(res, 200, {
          ok: true,
          expected_version: expectedVersion,
          reload_required: Boolean(extensionVersion && extensionVersion !== expectedVersion),
          reserved
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/jobs/claim') {
        lastHeartbeatAt = nowIso();
        const job = claimJob();
        return sendJson(res, 200, { ok: true, job });
      }

      if (req.method === 'POST' && url.pathname === '/v1/jobs/result') {
        lastHeartbeatAt = nowIso();
        const body = await readJsonBody(req);
        const job = finishJob(body);
        return sendJson(res, 200, { ok: true, job });
      }

      return sendJson(res, 404, { ok: false, error: 'Không tìm thấy endpoint' });
    } catch (error) {
      lastError = String(error?.message || error);
      writeStatus();
      return sendJson(res, Number(error?.statusCode || 500), { ok: false, error: lastError });
    }
  }

  const server = http.createServer(handle);
  server.listen(port, host, () => {
    console.log(`Chrome Extension bridge: listening http://${host}:${port}`);
    if (!state.paired) console.log(`Chrome Extension pairing code: ${state.pairing_code}`);
    else console.log(`Chrome Extension bridge: paired extension=${state.extension_id}`);
    writeStatus();
  });

  setInterval(() => {
    const released = releaseStaleReservations();
    const reserved = reserveDueJobs();
    writeStatus({ reservation_tick: { reserved, released } });
  }, 1000).unref?.();
}
