import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { ensureOperatorSchema } from './facebook-operator-core.js';

const enabled = String(process.env.OPERATOR_SELF_HEALING_ENABLED ?? 'true').toLowerCase() !== 'false';

function nowIso() { return new Date().toISOString(); }
function fingerprint(error = '') {
  return String(error || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b\d{2,}\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function classify(error = '') {
  const text = String(error || '');
  if (/captcha|checkpoint|two[- ]?factor|2fa|xác minh|mã xác nhận|đăng nhập/i.test(text)) return 'MANUAL';
  if (/không tìm thấy|đổi giao diện|needs_review|permission|policy|restricted|not authorized|unsupported/i.test(text)) return 'REVIEW';
  if (/etimedout|econnreset|econnrefused|enotfound|eai_again|net::err_|timeout|navigation|target page.*closed|browser.*closed|socket hang up|http 408|http 429|http 5\d\d|temporarily unavailable|network/i.test(text)) return 'TRANSIENT';
  return 'UNKNOWN';
}

function ensureSchema(db) {
  ensureOperatorSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS operator_self_healing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      action TEXT,
      fingerprint TEXT NOT NULL,
      classification TEXT NOT NULL,
      decision TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_self_heal_created
      ON operator_self_healing_events(created_at);
  `);
}

function logEvent(db, { jobId = null, action = null, error = '', classification, decision }) {
  db.prepare(`
    INSERT INTO operator_self_healing_events(job_id,action,fingerprint,classification,decision,error,created_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(jobId, action, fingerprint(error), classification, decision, String(error || '').slice(0, 1600), nowIso());
}

function backoffMs(attempts) {
  const base = Math.max(30_000, Number(process.env.OPERATOR_SELF_HEALING_BASE_DELAY_MS || 60_000));
  const max = Math.max(base, Number(process.env.OPERATOR_SELF_HEALING_MAX_DELAY_MS || 30 * 60_000));
  return Math.min(max, base * (2 ** Math.max(0, Number(attempts || 1) - 1)));
}

function repairFailedJobs(db) {
  const maxAttempts = Math.max(1, Number(process.env.OPERATOR_SELF_HEALING_MAX_ATTEMPTS || 3));
  const rows = db.prepare(`
    SELECT id,action,status,error,attempts,updated_at
    FROM facebook_operator_jobs
    WHERE status='FAILED'
      AND updated_at>=?
    ORDER BY updated_at
    LIMIT 50
  `).all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  let requeued = 0;
  for (const job of rows) {
    const seen = db.prepare(`
      SELECT 1 FROM operator_self_healing_events
      WHERE job_id=? AND decision IN ('REQUEUED','NO_RETRY_MAX','NO_RETRY_REVIEW','NO_RETRY_UNKNOWN')
      ORDER BY id DESC LIMIT 1
    `).get(job.id);
    if (seen) continue;

    const type = classify(job.error);
    if (type === 'TRANSIENT' && Number(job.attempts || 0) < maxAttempts) {
      const next = new Date(Date.now() + backoffMs(job.attempts)).toISOString();
      db.prepare(`
        UPDATE facebook_operator_jobs
        SET status='QUEUED',scheduled_at=?,locked_at=NULL,updated_at=?
        WHERE id=? AND status='FAILED'
      `).run(next, nowIso(), job.id);
      logEvent(db, { jobId: job.id, action: job.action, error: job.error, classification: type, decision: 'REQUEUED' });
      requeued += 1;
      continue;
    }

    const decision = type === 'TRANSIENT'
      ? 'NO_RETRY_MAX'
      : (type === 'MANUAL' || type === 'REVIEW')
        ? 'NO_RETRY_REVIEW'
        : 'NO_RETRY_UNKNOWN';
    logEvent(db, { jobId: job.id, action: job.action, error: job.error, classification: type, decision });
  }
  return requeued;
}

function repairFoodState(db) {
  let repaired = 0;
  try {
    const daily = db.prepare(`
      SELECT d.id,d.post_job_id,j.status AS job_status
      FROM food_network_daily d
      JOIN facebook_operator_jobs j ON j.id=d.post_job_id
      WHERE d.status='FAILED' AND j.status IN ('QUEUED','PROCESSING')
    `).all();
    for (const row of daily) {
      db.prepare("UPDATE food_network_daily SET status='POST_QUEUED',error=NULL,updated_at=? WHERE id=?")
        .run(nowIso(), row.id);
      repaired += 1;
    }
  } catch {}

  try {
    const pages = db.prepare(`
      SELECT p.slot,p.create_job_id,j.status AS job_status
      FROM food_network_pages p
      JOIN facebook_operator_jobs j ON j.id=p.create_job_id
      WHERE p.status='FAILED' AND j.status IN ('QUEUED','PROCESSING')
    `).all();
    for (const row of pages) {
      db.prepare("UPDATE food_network_pages SET status='CREATE_QUEUED',last_error=NULL,updated_at=? WHERE slot=?")
        .run(nowIso(), row.slot);
      repaired += 1;
    }
  } catch {}
  return repaired;
}

function cleanupTempFiles(root) {
  const maxAge = Math.max(60 * 60 * 1000, Number(process.env.OPERATOR_TEMP_MAX_AGE_MS || 6 * 60 * 60 * 1000));
  const dirs = [path.join(root, 'data'), path.join(root, 'uploads')];
  let removed = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/^fb-(page|group)-upload-/i.test(name)) continue;
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (Date.now() - stat.mtimeMs > maxAge) {
          fs.unlinkSync(full);
          removed += 1;
        }
      } catch {}
    }
  }
  return removed;
}

function quickCheck(db) {
  try {
    const rows = db.pragma('quick_check');
    const ok = Array.isArray(rows) && rows.every(row => Object.values(row).some(v => String(v).toLowerCase() === 'ok'));
    return ok ? 'ok' : JSON.stringify(rows).slice(0, 1000);
  } catch (error) {
    return `error: ${String(error?.message || error)}`;
  }
}

if (!enabled) {
  console.log('Operator self-healing: disabled');
} else {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '..');
  const dataDir = path.join(root, 'data');
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });
  const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(dataDir, 'social-manager.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  ensureSchema(db);

  const tickMs = Math.max(15_000, Number(process.env.OPERATOR_SELF_HEALING_TICK_MS || 30_000));
  const statusPath = path.join(publicDir, 'self-healing-status.json');
  let lastQuickCheckAt = 0;
  let lastQuickCheck = 'not-run';
  let busy = false;

  function writeStatus(extra = {}) {
    const recent = db.prepare(`
      SELECT job_id,action,classification,decision,error,created_at
      FROM operator_self_healing_events
      ORDER BY id DESC LIMIT 20
    `).all();
    const counts = Object.fromEntries(db.prepare(`
      SELECT decision,COUNT(*) AS n
      FROM operator_self_healing_events
      WHERE created_at>=?
      GROUP BY decision
    `).all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).map(x => [x.decision, Number(x.n)]));
    try {
      fs.writeFileSync(statusPath, JSON.stringify({
        enabled: true,
        mode: 'BOUNDED_SELF_HEALING',
        db_quick_check: lastQuickCheck,
        last_24h: counts,
        recent_events: recent,
        ...extra,
        updated_at: nowIso()
      }, null, 2), 'utf8');
    } catch {}
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const requeued = repairFailedJobs(db);
      const stateRepairs = repairFoodState(db);
      const tempRemoved = cleanupTempFiles(root);
      if (Date.now() - lastQuickCheckAt > 6 * 60 * 60 * 1000) {
        lastQuickCheck = quickCheck(db);
        lastQuickCheckAt = Date.now();
        if (lastQuickCheck !== 'ok') {
          logEvent(db, { error: lastQuickCheck, classification: 'DB', decision: 'DIAGNOSTIC_ONLY' });
        }
      }
      if (requeued || stateRepairs || tempRemoved) {
        console.log(`Operator self-healing: requeued=${requeued} state_repairs=${stateRepairs} temp_removed=${tempRemoved}`);
      }
      writeStatus({ last_tick: { requeued, state_repairs: stateRepairs, temp_removed: tempRemoved } });
    } catch (error) {
      console.error(`Operator self-healing: ${String(error?.message || error)}`);
      writeStatus({ last_error: String(error?.message || error) });
    } finally {
      busy = false;
    }
  }

  setInterval(() => tick().catch(() => {}), tickMs);
  setTimeout(() => tick().catch(() => {}), 3000);
  console.log(`Operator self-healing: enabled tick=${tickMs}ms max_attempts=${Math.max(1, Number(process.env.OPERATOR_SELF_HEALING_MAX_ATTEMPTS || 3))}`);
}
