import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { decryptSecret } from './security.js';
import { publishFacebook } from './platforms/facebook.js';

const enabled = String(process.env.GITHUB_BRIDGE_ENABLED || '').toLowerCase() === 'true';
if (!enabled) {
  console.log('GitHub bridge: disabled');
} else {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');
  const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(root, 'data', 'social-manager.db');
  const statusPath = path.join(root, 'public', 'bridge-status.json');
  const commandUrl = String(
    process.env.GITHUB_BRIDGE_COMMAND_URL ||
    'https://raw.githubusercontent.com/hiep4294/Social-Manager/main/bridge/facebook-command.json'
  );
  const pollMs = Math.max(3000, Number(process.env.GITHUB_BRIDGE_POLL_MS || 5000));

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS github_bridge_commands (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      brand_id INTEGER,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      external_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT
    );
  `);

  function nowIso() {
    return new Date().toISOString();
  }

  function writeStatus(payload) {
    fs.writeFileSync(statusPath, JSON.stringify({ ...payload, updated_at: nowIso() }, null, 2), 'utf8');
  }

  writeStatus({ bridge: 'ready', command_url: commandUrl, status: 'IDLE' });

  async function poll() {
    try {
      const url = new URL(commandUrl);
      url.searchParams.set('_', String(Date.now()));
      const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      if (!response.ok) throw new Error(`Command HTTP ${response.status}`);
      const command = await response.json();

      const id = String(command?.id || '').trim();
      const action = String(command?.action || '').trim();
      const message = String(command?.message || '');
      const brandId = Number(command?.brand_id || 0) || null;

      if (!id || action !== 'post_facebook' || !message.trim()) return;
      if (db.prepare('SELECT 1 FROM github_bridge_commands WHERE id=?').get(id)) return;

      db.prepare(`
        INSERT INTO github_bridge_commands(id,action,brand_id,message,status,created_at)
        VALUES(?,?,?,?,?,?)
      `).run(id, action, brandId, message, 'PROCESSING', nowIso());
      writeStatus({ id, action, brand_id: brandId, message, status: 'PROCESSING' });

      try {
        const account = brandId
          ? db.prepare("SELECT * FROM social_accounts WHERE brand_id=? AND platform='facebook' ORDER BY id LIMIT 1").get(brandId)
          : db.prepare("SELECT * FROM social_accounts WHERE platform='facebook' ORDER BY id LIMIT 1").get();

        if (!account) throw new Error('Không tìm thấy Facebook Page đã kết nối trong Social Manager');

        const accessToken = decryptSecret(account.access_token_enc);
        const result = await publishFacebook({
          message,
          pageId: account.account_id,
          accessToken
        });
        const externalId = result?.id || result?.post_id || null;

        db.prepare(`
          UPDATE github_bridge_commands
          SET status='PUBLISHED', external_id=?, error=NULL, processed_at=?
          WHERE id=?
        `).run(externalId, nowIso(), id);

        writeStatus({
          id,
          action,
          brand_id: account.brand_id,
          page_id: account.account_id,
          page_name: account.account_name,
          message,
          status: 'PUBLISHED',
          external_id: externalId
        });
        console.log(`GitHub bridge: Facebook published command=${id} post_id=${externalId || 'unknown'}`);
      } catch (error) {
        const errorText = String(error?.message || error);
        db.prepare(`
          UPDATE github_bridge_commands
          SET status='FAILED', error=?, processed_at=?
          WHERE id=?
        `).run(errorText, nowIso(), id);
        writeStatus({ id, action, brand_id: brandId, message, status: 'FAILED', error: errorText });
        console.error(`GitHub bridge: command=${id} failed: ${errorText}`);
      }
    } catch (error) {
      console.error(`GitHub bridge poll error: ${String(error?.message || error)}`);
    }
  }

  setInterval(() => poll().catch(console.error), pollMs);
  setTimeout(() => poll().catch(console.error), 1200);
  console.log(`GitHub bridge: enabled, polling every ${pollMs}ms`);
}
