import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { ensureOperatorSchema } from './facebook-operator-core.js';

const enabled = String(process.env.FB_OPERATOR_RELIABILITY_ENABLED ?? 'true').toLowerCase() !== 'false';

if (!enabled) {
  console.log('Operator reliability: disabled');
} else {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');
  const dataDir = path.join(root, 'data');
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(dataDir, 'social-manager.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  ensureOperatorSchema(db);

  const heartbeatMs = Math.max(5000, Number(process.env.FB_OPERATOR_HEARTBEAT_MS || 15000));
  const leaseMs = Math.max(60000, Number(process.env.FB_OPERATOR_JOB_LEASE_MS || 600000));
  const maxAttempts = Math.max(1, Number(process.env.FB_OPERATOR_MAX_ATTEMPTS || 3));
  const statusPath = path.join(publicDir, 'agent-health.json');
  const backupDir = path.join(dataDir, 'backups');
  const backupEveryMs = Math.max(60 * 60 * 1000, Number(process.env.FB_OPERATOR_BACKUP_MS || 24 * 60 * 60 * 1000));
  const backupKeep = Math.max(2, Math.min(30, Number(process.env.FB_OPERATOR_BACKUP_KEEP || 7)));
  let lastBackupAt = 0;
  let backupBusy = false;

  function nowIso() {
    return new Date().toISOString();
  }

  function readPackageVersion() {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function readHead() {
    try {
      const head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
      if (!head.startsWith('ref:')) return head.slice(0, 12);
      const ref = head.slice(5).trim();
      return fs.readFileSync(path.join(root, '.git', ref), 'utf8').trim().slice(0, 12);
    } catch {
      return null;
    }
  }

  function recoverStaleJobs() {
    const cutoff = new Date(Date.now() - leaseMs).toISOString();
    const stale = db.prepare(`
      SELECT id, attempts FROM facebook_operator_jobs
      WHERE status='PROCESSING' AND locked_at IS NOT NULL AND locked_at < ?
      ORDER BY locked_at
      LIMIT 50
    `).all(cutoff);

    let requeued = 0;
    let failed = 0;
    const now = nowIso();
    for (const row of stale) {
      if (Number(row.attempts || 0) >= maxAttempts) {
        db.prepare(`
          UPDATE facebook_operator_jobs
          SET status='FAILED', error=?, locked_at=NULL, updated_at=?
          WHERE id=? AND status='PROCESSING'
        `).run(`JOB_LEASE_EXPIRED after ${row.attempts} attempts`, now, row.id);
        failed += 1;
      } else {
        db.prepare(`
          UPDATE facebook_operator_jobs
          SET status='QUEUED', error=?, locked_at=NULL, updated_at=?
          WHERE id=? AND status='PROCESSING'
        `).run('RECOVERED_AFTER_STALE_PROCESSING_LEASE', now, row.id);
        requeued += 1;
      }
    }
    if (requeued || failed) {
      console.log(`Operator reliability: recovered stale jobs requeued=${requeued} failed=${failed}`);
    }
    return { requeued, failed };
  }

  function queueSnapshot() {
    const rows = db.prepare(`
      SELECT status, COUNT(*) AS n FROM facebook_operator_jobs GROUP BY status
    `).all();
    const counts = Object.fromEntries(rows.map(row => [String(row.status), Number(row.n || 0)]));
    const last = db.prepare(`
      SELECT id, action, status, error, screenshot_url, result_json, created_at, updated_at
      FROM facebook_operator_jobs
      ORDER BY updated_at DESC
      LIMIT 1
    `).get();
    let result = null;
    if (last?.result_json) {
      try { result = JSON.parse(last.result_json); } catch {}
    }
    return {
      counts,
      last_job: last ? {
        id: last.id,
        action: last.action,
        status: last.status,
        error: last.error || null,
        screenshot_url: last.screenshot_url || null,
        result,
        created_at: last.created_at,
        updated_at: last.updated_at
      } : null
    };
  }

  function writeHealth(extra = {}) {
    const queue = queueSnapshot();
    const body = {
      online: true,
      service: 'facebook-operator-agent',
      version: readPackageVersion(),
      git_head: readHead(),
      host: os.hostname(),
      pid: process.pid,
      update_channel: String(process.env.FB_AGENT_UPDATE_BRANCH || 'stable'),
      auto_update: String(process.env.FB_AGENT_AUTO_UPDATE ?? 'true').toLowerCase() !== 'false',
      auto_start: String(process.env.FB_AGENT_AUTOSTART ?? 'true').toLowerCase() !== 'false',
      queue,
      ...extra,
      heartbeat_at: nowIso()
    };
    try { fs.writeFileSync(statusPath, JSON.stringify(body, null, 2), 'utf8'); } catch {}
  }

  async function backupDbIfDue() {
    if (backupBusy || Date.now() - lastBackupAt < backupEveryMs) return;
    backupBusy = true;
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const destination = path.join(backupDir, `social-manager-${stamp}.db`);
      await db.backup(destination);
      lastBackupAt = Date.now();
      const files = fs.readdirSync(backupDir)
        .filter(name => /^social-manager-.*\.db$/i.test(name))
        .map(name => ({ name, full: path.join(backupDir, name), mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const file of files.slice(backupKeep)) {
        try { fs.unlinkSync(file.full); } catch {}
      }
      console.log(`Operator reliability: backup OK ${path.basename(destination)}`);
    } catch (error) {
      console.error(`Operator reliability: backup error: ${String(error?.message || error)}`);
    } finally {
      backupBusy = false;
    }
  }

  async function tick() {
    const recovered = recoverStaleJobs();
    writeHealth({ recovered });
    await backupDbIfDue();
  }

  writeHealth({ status: 'STARTING' });
  setInterval(() => tick().catch(error => console.error(`Operator reliability: ${String(error?.message || error)}`)), heartbeatMs);
  setTimeout(() => tick().catch(() => {}), 1500);
  console.log(`Operator reliability: enabled heartbeat=${heartbeatMs}ms lease=${leaseMs}ms max_attempts=${maxAttempts}`);
}
