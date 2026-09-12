import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { enqueueOperatorJob } from './facebook-operator-core.js';

const enabled = String(process.env.FB_OPERATOR_COMMAND_POLL_ENABLED || '').toLowerCase() === 'true';

if (!enabled) {
  console.log('Operator command poller: disabled');
} else {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');
  const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(root, 'data', 'social-manager.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const commandUrl = String(
    process.env.GITHUB_BRIDGE_COMMAND_URL ||
    'https://raw.githubusercontent.com/hiep4294/Social-Manager/main/bridge/facebook-command.json'
  );
  const pollMs = Math.max(3000, Number(process.env.FB_OPERATOR_COMMAND_POLL_MS || 5000));

  async function poll() {
    try {
      const url = new URL(commandUrl);
      url.searchParams.set('_', String(Date.now()));
      const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      if (!response.ok) throw new Error(`Command HTTP ${response.status}`);
      const command = await response.json();
      if (String(command?.action || '') !== 'facebook_operator') return;
      const operatorAction = String(command?.operator_action || '').trim();
      const id = `${String(command?.id || '').trim()}-operator`;
      if (!id || id === '-operator') return;
      const job = enqueueOperatorJob(db, {
        id,
        brand_id: command?.brand_id,
        action: operatorAction,
        payload: command?.payload || {},
        scheduled_at: command?.scheduled_at
      });
      if (job.status === 'QUEUED') console.log(`Operator command poller: queued ${job.id} action=${job.action}`);
    } catch (error) {
      console.error(`Operator command poller: ${String(error?.message || error)}`);
    }
  }

  setInterval(() => poll().catch(() => {}), pollMs);
  setTimeout(() => poll().catch(() => {}), 1000);
  console.log(`Operator command poller: enabled, polling every ${pollMs}ms`);
}
