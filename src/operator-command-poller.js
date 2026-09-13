import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { enqueueOperatorJob, ensureOperatorSchema, normalizeOperatorJob } from './facebook-operator-core.js';
import { findFacebookAsset } from './group-monitor-core.js';

const enabled = String(process.env.FB_OPERATOR_COMMAND_POLL_ENABLED || '').toLowerCase() === 'true';

if (!enabled) {
  console.log('Operator command poller: disabled');
} else {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');
  const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(root, 'data', 'social-manager.db');
  const statusPath = path.join(root, 'public', 'operator-command-status.json');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  ensureOperatorSchema(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS facebook_operator_remote_commands (
      command_id TEXT PRIMARY KEY,
      job_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      issued_at TEXT,
      expires_at TEXT,
      received_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fb_remote_commands_status
      ON facebook_operator_remote_commands(status, updated_at);
  `);

  const queueUrl = String(
    process.env.FB_OPERATOR_COMMAND_QUEUE_URL ||
    'https://raw.githubusercontent.com/hiep4294/Social-Manager/main/bridge/operator-queue.json'
  );
  const legacyUrl = String(
    process.env.FB_OPERATOR_LEGACY_COMMAND_URL ||
    process.env.GITHUB_BRIDGE_COMMAND_URL ||
    'https://raw.githubusercontent.com/hiep4294/Social-Manager/main/bridge/facebook-command.json'
  );
  const allowLegacy = String(process.env.FB_OPERATOR_ALLOW_LEGACY_COMMAND || 'false').toLowerCase() === 'true';
  const requireKnownGroup = String(process.env.FB_AGENT_REQUIRE_KNOWN_GROUP ?? 'true').toLowerCase() !== 'false';
  const pollMs = Math.max(3000, Number(process.env.FB_OPERATOR_COMMAND_POLL_MS || 5000));
  const maxAgeMs = Math.max(60_000, Number(process.env.FB_OPERATOR_COMMAND_MAX_AGE_MS || 15 * 60 * 1000));
  const futureSkewMs = Math.max(10_000, Number(process.env.FB_OPERATOR_COMMAND_FUTURE_SKEW_MS || 2 * 60 * 1000));
  const maxQueueItems = Math.max(10, Math.min(500, Number(process.env.FB_OPERATOR_COMMAND_QUEUE_MAX || 100)));

  function nowIso() {
    return new Date().toISOString();
  }

  function parseTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function writeStatus(extra = {}) {
    const rows = db.prepare(`
      SELECT status, COUNT(*) AS n
      FROM facebook_operator_remote_commands
      GROUP BY status
    `).all();
    const counts = Object.fromEntries(rows.map(row => [String(row.status), Number(row.n || 0)]));
    const last = db.prepare(`
      SELECT command_id, job_id, action, status, issued_at, expires_at, received_at, updated_at, error
      FROM facebook_operator_remote_commands
      ORDER BY updated_at DESC
      LIMIT 1
    `).get();
    try {
      fs.writeFileSync(statusPath, JSON.stringify({
        enabled: true,
        queue_url: queueUrl,
        legacy_enabled: allowLegacy,
        require_known_group: requireKnownGroup,
        poll_ms: pollMs,
        counts,
        last_command: last || null,
        ...extra,
        updated_at: nowIso()
      }, null, 2), 'utf8');
    } catch {}
  }

  function upsertReceipt({ commandId, jobId = null, action = '', status, issuedAt = null, expiresAt = null, error = null }) {
    const now = nowIso();
    db.prepare(`
      INSERT INTO facebook_operator_remote_commands(
        command_id,job_id,action,status,issued_at,expires_at,received_at,updated_at,error
      ) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(command_id) DO UPDATE SET
        job_id=COALESCE(excluded.job_id,facebook_operator_remote_commands.job_id),
        action=CASE WHEN excluded.action<>'' THEN excluded.action ELSE facebook_operator_remote_commands.action END,
        status=excluded.status,
        issued_at=COALESCE(excluded.issued_at,facebook_operator_remote_commands.issued_at),
        expires_at=COALESCE(excluded.expires_at,facebook_operator_remote_commands.expires_at),
        updated_at=excluded.updated_at,
        error=excluded.error
    `).run(commandId, jobId, action, status, issuedAt, expiresAt, now, now, error);
  }

  function syncReceiptsFromJobs() {
    const rows = db.prepare(`
      SELECT r.command_id, r.job_id, j.status, j.error
      FROM facebook_operator_remote_commands r
      JOIN facebook_operator_jobs j ON j.id=r.job_id
      WHERE r.job_id IS NOT NULL
        AND r.status<>j.status
    `).all();
    for (const row of rows) {
      db.prepare(`
        UPDATE facebook_operator_remote_commands
        SET status=?, error=?, updated_at=?
        WHERE command_id=?
      `).run(row.status, row.error || null, nowIso(), row.command_id);
    }
  }

  function rateLimitFor(action) {
    const defaults = {
      post_group: 8,
      comment_group: 20,
      like_group_post: 30,
      like_first_group_post: 30,
      like_group_comments: 12,
      join_group: 10,
      scan_group: 60
    };
    const key = `FB_AGENT_RATE_${String(action || '').toUpperCase()}_PER_HOUR`;
    const configured = Number(process.env[key]);
    if (Number.isFinite(configured) && configured >= 0) return configured;
    return defaults[action] ?? 60;
  }

  function checkRateLimit(action) {
    const limit = rateLimitFor(action);
    if (limit === 0) return { ok: false, error: `Action ${action} đang bị tắt bởi rate limit` };
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const count = Number(db.prepare(`
      SELECT COUNT(*) AS n
      FROM facebook_operator_jobs
      WHERE action=? AND created_at>=?
    `).get(action, since)?.n || 0);
    if (count >= limit) return { ok: false, error: `RATE_LIMIT ${action}: ${count}/${limit} trong 1 giờ` };
    return { ok: true };
  }

  function checkKnownGroup(action, payload = {}) {
    if (!requireKnownGroup) return { ok: true };
    if (['remember_group', 'join_group', 'create_group'].includes(action)) return { ok: true };
    if (!payload.group_url && !payload.group_name && payload.post_url) return { ok: true };
    if (!payload.group_url && !payload.group_name) return { ok: true };
    try {
      const asset = findFacebookAsset(db, {
        assetType: 'GROUP',
        url: payload.group_url,
        name: payload.group_name
      });
      if (asset) return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
    return { ok: false, error: 'GROUP_NOT_APPROVED: Hãy remember_group Group này trước khi thao tác.' };
  }

  function validateRemoteCommand(command, { legacy = false } = {}) {
    const commandId = String(command?.id || '').trim();
    if (!commandId) return { ok: false, commandId: '', error: 'Thiếu command id' };
    if (String(command?.action || '') !== 'facebook_operator') {
      return { ok: false, commandId, error: 'Remote queue chỉ nhận action=facebook_operator' };
    }

    const issued = parseTime(command?.issued_at);
    const expires = parseTime(command?.expires_at);
    const now = Date.now();

    if (!legacy) {
      if (!issued) return { ok: false, commandId, error: 'Thiếu/không hợp lệ issued_at' };
      if (!expires) return { ok: false, commandId, error: 'Thiếu/không hợp lệ expires_at' };
      if (expires.getTime() <= issued.getTime()) return { ok: false, commandId, error: 'expires_at phải sau issued_at' };
      if (now < issued.getTime() - futureSkewMs) return { ok: false, commandId, error: 'COMMAND_FROM_FUTURE' };
      if (now >= expires.getTime()) return { ok: false, commandId, expired: true, error: 'COMMAND_EXPIRED' };
      if (now - issued.getTime() > maxAgeMs) return { ok: false, commandId, expired: true, error: 'COMMAND_TOO_OLD' };
    }

    const operatorAction = String(command?.operator_action || '').trim();
    const normalized = normalizeOperatorJob({
      action: operatorAction,
      brand_id: command?.brand_id,
      payload: command?.payload || {},
      scheduled_at: command?.scheduled_at
    });
    if (!normalized.ok) return { ok: false, commandId, error: normalized.error };

    const known = checkKnownGroup(operatorAction, normalized.value.payload);
    if (!known.ok) return { ok: false, commandId, error: known.error };

    const rate = checkRateLimit(operatorAction);
    if (!rate.ok) return { ok: false, commandId, error: rate.error };

    return {
      ok: true,
      commandId,
      issuedAt: issued?.toISOString() || null,
      expiresAt: expires?.toISOString() || null,
      operatorAction,
      normalized: normalized.value
    };
  }

  function processOne(command, options = {}) {
    const id = String(command?.id || '').trim();
    if (!id) return;
    const existing = db.prepare('SELECT * FROM facebook_operator_remote_commands WHERE command_id=?').get(id);
    if (existing) return;

    const checked = validateRemoteCommand(command, options);
    if (!checked.ok) {
      upsertReceipt({
        commandId: id,
        action: String(command?.operator_action || ''),
        status: checked.expired ? 'EXPIRED' : 'REJECTED',
        issuedAt: parseTime(command?.issued_at)?.toISOString() || null,
        expiresAt: parseTime(command?.expires_at)?.toISOString() || null,
        error: checked.error
      });
      console.error(`Operator command poller: rejected ${id}: ${checked.error}`);
      return;
    }

    const jobId = `${checked.commandId}-operator`;
    try {
      const job = enqueueOperatorJob(db, {
        id: jobId,
        brand_id: checked.normalized.brandId,
        action: checked.operatorAction,
        payload: checked.normalized.payload,
        scheduled_at: checked.normalized.scheduledAt
      });
      upsertReceipt({
        commandId: checked.commandId,
        jobId: job.id,
        action: checked.operatorAction,
        status: job.status,
        issuedAt: checked.issuedAt,
        expiresAt: checked.expiresAt,
        error: job.error || null
      });
      console.log(`Operator command poller: queued ${job.id} action=${job.action}`);
    } catch (error) {
      upsertReceipt({
        commandId: checked.commandId,
        action: checked.operatorAction,
        status: 'REJECTED',
        issuedAt: checked.issuedAt,
        expiresAt: checked.expiresAt,
        error: String(error?.message || error)
      });
      console.error(`Operator command poller: ${String(error?.message || error)}`);
    }
  }

  async function fetchJson(urlText) {
    const url = new URL(urlText);
    url.searchParams.set('_', String(Date.now()));
    const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url.hostname}${url.pathname}`);
    return response.json();
  }

  async function poll() {
    try {
      syncReceiptsFromJobs();
      const envelope = await fetchJson(queueUrl);
      const commands = Array.isArray(envelope?.commands) ? envelope.commands.slice(-maxQueueItems) : [];
      for (const command of commands) processOne(command, { legacy: false });

      if (allowLegacy) {
        const legacy = await fetchJson(legacyUrl);
        processOne(legacy, { legacy: true });
      }

      writeStatus({ status: 'OK', queue_items: commands.length });
    } catch (error) {
      writeStatus({ status: 'ERROR', error: String(error?.message || error) });
      console.error(`Operator command poller: ${String(error?.message || error)}`);
    }
  }

  setInterval(() => poll().catch(() => {}), pollMs);
  setTimeout(() => poll().catch(() => {}), 1000);
  writeStatus({ status: 'STARTING' });
  console.log(`Operator command poller: enabled, queue=${queueUrl}, polling every ${pollMs}ms, legacy=${allowLegacy}`);
}
