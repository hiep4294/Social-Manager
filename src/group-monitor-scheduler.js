import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { enqueueOperatorJob, ensureOperatorSchema } from './facebook-operator-core.js';

const enabled = String(process.env.GROUP_MONITOR_ENABLED || '').toLowerCase() === 'true';

if (!enabled) {
  console.log('Group monitor scheduler: disabled');
} else {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');
  const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(root, 'data', 'social-manager.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  ensureOperatorSchema(db);

  const tickMs = Math.max(15_000, Number(process.env.GROUP_MONITOR_SCHEDULER_MS || 30_000));
  let running = false;

  const nowIso = () => new Date().toISOString();

  function queueDueMonitor(monitor) {
    const now = Date.now();
    const slot = Math.floor(now / Math.max(60_000, Number(monitor.poll_seconds || 180) * 1000));
    const jobId = `group-monitor-${monitor.id}-${slot}`;
    const job = enqueueOperatorJob(db, {
      id: jobId,
      brand_id: monitor.brand_id,
      action: 'scan_group',
      payload: { monitor_id: monitor.id }
    });
    const next = new Date(now + Math.max(60, Number(monitor.poll_seconds || 180)) * 1000).toISOString();
    db.prepare('UPDATE facebook_group_monitors SET next_scan_at=?,updated_at=? WHERE id=?')
      .run(next, nowIso(), monitor.id);
    return job;
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = nowIso();
      const rows = db.prepare(`
        SELECT * FROM facebook_group_monitors
        WHERE active=1 AND (next_scan_at IS NULL OR next_scan_at<=?)
        ORDER BY COALESCE(next_scan_at,created_at),id
        LIMIT 10
      `).all(now);
      for (const monitor of rows) {
        try {
          const job = queueDueMonitor(monitor);
          if (job.status === 'QUEUED') console.log(`Group monitor scheduler: queued monitor=${monitor.id} group=${monitor.group_name}`);
        } catch (error) {
          db.prepare('UPDATE facebook_group_monitors SET last_error=?,updated_at=? WHERE id=?')
            .run(String(error?.message || error), nowIso(), monitor.id);
        }
      }
    } finally {
      running = false;
    }
  }

  setInterval(() => tick().catch(() => {}), tickMs);
  setTimeout(() => tick().catch(() => {}), 2500);
  console.log(`Group monitor scheduler: enabled, tick every ${tickMs}ms`);
}
