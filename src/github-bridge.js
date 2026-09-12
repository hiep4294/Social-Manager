import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { decryptSecret } from './security.js';
import { publishFacebook } from './platforms/facebook.js';

const IMAGE_TONES = new Set(['auto', 'promo', 'greeting', 'notice', 'launch', 'professional']);

export function normalizeBridgeCommand(command = {}) {
  const id = String(command?.id || '').trim();
  const action = String(command?.action || '').trim();
  const message = String(command?.message || '');
  const brandId = Number(command?.brand_id || 0) || null;
  const imageRaw = String(command?.image_url || '').trim();
  const imageModeRaw = String(command?.image_mode || '').trim().toLowerCase();
  const imageToneRaw = String(command?.image_tone || 'auto').trim().toLowerCase();
  const scheduledRaw = String(command?.scheduled_at || '').trim();
  const idempotencyKey = String(command?.idempotency_key || id).trim();

  if (!id) return { ok: false, error: 'Thiếu command id' };
  if (action !== 'post_facebook') return { ok: false, error: `Action không hỗ trợ: ${action || '(trống)'}` };
  if (!message.trim() && !imageRaw) return { ok: false, error: 'Lệnh Facebook phải có message hoặc image_url' };

  let imageUrl = null;
  if (imageRaw) {
    try {
      const parsed = new URL(imageRaw);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
      imageUrl = parsed.toString();
    } catch {
      return { ok: false, error: 'image_url phải là URL http/https hợp lệ' };
    }
  }

  let imageMode = null;
  if (!imageUrl && imageModeRaw) {
    if (!['auto', 'none'].includes(imageModeRaw)) return { ok: false, error: 'image_mode chỉ nhận auto hoặc none' };
    imageMode = imageModeRaw;
  }

  if (!IMAGE_TONES.has(imageToneRaw)) return { ok: false, error: 'image_tone không hợp lệ' };

  let scheduledAt = null;
  if (scheduledRaw) {
    const parsed = new Date(scheduledRaw);
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: 'scheduled_at không hợp lệ' };
    scheduledAt = parsed.toISOString();
  }

  return {
    ok: true,
    value: {
      id,
      action,
      brandId,
      message,
      imageUrl,
      imageMode,
      imageTone: imageToneRaw,
      scheduledAt,
      idempotencyKey: idempotencyKey || id
    }
  };
}

export function isBridgeCommandDue(scheduledAt, now = Date.now()) {
  if (!scheduledAt) return true;
  const when = new Date(scheduledAt).getTime();
  return Number.isFinite(when) && when <= Number(now);
}

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

  function hasColumn(name) {
    return db.prepare('PRAGMA table_info(github_bridge_commands)').all().some(row => row.name === name);
  }

  const migrations = [
    ['image_url', 'TEXT'],
    ['image_mode', 'TEXT'],
    ['image_tone', "TEXT DEFAULT 'auto'"],
    ['generated_image_url', 'TEXT'],
    ['scheduled_at', 'TEXT'],
    ['idempotency_key', 'TEXT'],
    ['attempts', 'INTEGER NOT NULL DEFAULT 0']
  ];
  for (const [name, type] of migrations) {
    if (!hasColumn(name)) db.exec(`ALTER TABLE github_bridge_commands ADD COLUMN ${name} ${type}`);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_github_bridge_idempotency
    ON github_bridge_commands(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_github_bridge_due
    ON github_bridge_commands(status, scheduled_at, created_at);
  `);

  function nowIso() {
    return new Date().toISOString();
  }

  function writeStatus(payload) {
    const queued = db.prepare("SELECT COUNT(*) AS n FROM github_bridge_commands WHERE status='QUEUED'").get()?.n || 0;
    const failed = db.prepare("SELECT COUNT(*) AS n FROM github_bridge_commands WHERE status='FAILED'").get()?.n || 0;
    fs.writeFileSync(statusPath, JSON.stringify({
      ...payload,
      queue: { queued, failed },
      updated_at: nowIso()
    }, null, 2), 'utf8');
  }

  writeStatus({ bridge: 'ready', command_url: commandUrl, status: 'IDLE' });

  function queueCommand(rawCommand) {
    const normalized = normalizeBridgeCommand(rawCommand);
    if (!normalized.ok) {
      writeStatus({ bridge: 'ready', status: 'INVALID_COMMAND', error: normalized.error });
      return null;
    }

    const command = normalized.value;
    const existingById = db.prepare('SELECT * FROM github_bridge_commands WHERE id=?').get(command.id);
    if (existingById) return existingById;

    const existingByKey = db.prepare('SELECT * FROM github_bridge_commands WHERE idempotency_key=?').get(command.idempotencyKey);
    if (existingByKey) {
      writeStatus({
        bridge: 'ready',
        status: 'DUPLICATE_IGNORED',
        id: command.id,
        duplicate_of: existingByKey.id,
        idempotency_key: command.idempotencyKey,
        external_id: existingByKey.external_id || null
      });
      return existingByKey;
    }

    db.prepare(`
      INSERT INTO github_bridge_commands(
        id,action,brand_id,message,image_url,image_mode,image_tone,scheduled_at,idempotency_key,status,created_at,attempts
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,0)
    `).run(
      command.id,
      command.action,
      command.brandId,
      command.message,
      command.imageUrl,
      command.imageMode,
      command.imageTone,
      command.scheduledAt,
      command.idempotencyKey,
      'QUEUED',
      nowIso()
    );

    writeStatus({
      bridge: 'ready',
      status: command.scheduledAt ? 'SCHEDULED' : 'QUEUED',
      id: command.id,
      brand_id: command.brandId,
      has_image: Boolean(command.imageUrl),
      image_mode: command.imageMode,
      image_tone: command.imageTone,
      scheduled_at: command.scheduledAt,
      idempotency_key: command.idempotencyKey
    });
    console.log(`GitHub bridge: queued command=${command.id}${command.scheduledAt ? ` scheduled_at=${command.scheduledAt}` : ''}`);
    return db.prepare('SELECT * FROM github_bridge_commands WHERE id=?').get(command.id);
  }

  async function resolveImage(row, account) {
    if (row.image_url) return { url: row.image_url, generated: false, tone: null };
    if (row.image_mode !== 'auto') return { url: null, generated: false, tone: null };

    const brand = row.brand_id
      ? db.prepare('SELECT * FROM brands WHERE id=?').get(row.brand_id)
      : null;
    const { createSocialImage } = await import('./social-image.js');
    const generated = await createSocialImage({
      message: row.message,
      brandName: brand?.name || account?.account_name || 'Social Manager',
      publicBase: process.env.PUBLIC_BASE_URL,
      uploadDir: path.join(root, 'uploads'),
      tone: row.image_tone || 'auto'
    });
    db.prepare('UPDATE github_bridge_commands SET generated_image_url=? WHERE id=?').run(generated.url, row.id);
    return { url: generated.url, generated: true, tone: generated.tone };
  }

  async function processCommand(row) {
    const lock = db.prepare(`
      UPDATE github_bridge_commands
      SET status='PROCESSING', attempts=COALESCE(attempts,0)+1
      WHERE id=? AND status='QUEUED'
    `).run(row.id);
    if (!lock.changes) return;

    writeStatus({
      bridge: 'ready',
      id: row.id,
      action: row.action,
      brand_id: row.brand_id,
      has_image: Boolean(row.image_url),
      image_mode: row.image_mode || null,
      scheduled_at: row.scheduled_at,
      status: 'PROCESSING'
    });

    try {
      const account = row.brand_id
        ? db.prepare("SELECT * FROM social_accounts WHERE brand_id=? AND platform='facebook' ORDER BY id LIMIT 1").get(row.brand_id)
        : db.prepare("SELECT * FROM social_accounts WHERE platform='facebook' ORDER BY id LIMIT 1").get();

      if (!account) throw new Error('Không tìm thấy Facebook Page đã kết nối trong Social Manager');

      const image = await resolveImage(row, account);
      const accessToken = decryptSecret(account.access_token_enc);
      const result = await publishFacebook({
        message: row.message,
        imageUrl: image.url || undefined,
        pageId: account.account_id,
        accessToken
      });
      const externalId = result?.id || result?.post_id || null;

      db.prepare(`
        UPDATE github_bridge_commands
        SET status='PUBLISHED', external_id=?, error=NULL, processed_at=?
        WHERE id=?
      `).run(externalId, nowIso(), row.id);

      writeStatus({
        bridge: 'ready',
        id: row.id,
        action: row.action,
        brand_id: account.brand_id,
        page_id: account.account_id,
        page_name: account.account_name,
        has_image: Boolean(image.url),
        generated_image: image.generated,
        image_tone: image.tone,
        image_url: image.url,
        scheduled_at: row.scheduled_at,
        status: 'PUBLISHED',
        external_id: externalId
      });
      console.log(`GitHub bridge: Facebook published command=${row.id} post_id=${externalId || 'unknown'}${image.generated ? ` generated_image=${image.url}` : ''}`);
    } catch (error) {
      const errorText = String(error?.message || error);
      db.prepare(`
        UPDATE github_bridge_commands
        SET status='FAILED', error=?, processed_at=?
        WHERE id=?
      `).run(errorText, nowIso(), row.id);
      writeStatus({
        bridge: 'ready',
        id: row.id,
        action: row.action,
        brand_id: row.brand_id,
        has_image: Boolean(row.image_url),
        image_mode: row.image_mode || null,
        scheduled_at: row.scheduled_at,
        status: 'FAILED',
        error: errorText
      });
      console.error(`GitHub bridge: command=${row.id} failed: ${errorText}`);
    }
  }

  async function processDueCommands() {
    const now = nowIso();
    const rows = db.prepare(`
      SELECT * FROM github_bridge_commands
      WHERE status='QUEUED'
        AND (scheduled_at IS NULL OR scheduled_at <= ?)
      ORDER BY COALESCE(scheduled_at, created_at) ASC, created_at ASC
      LIMIT 10
    `).all(now);

    for (const row of rows) await processCommand(row);
  }

  async function poll() {
    try {
      const url = new URL(commandUrl);
      url.searchParams.set('_', String(Date.now()));
      const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      if (!response.ok) throw new Error(`Command HTTP ${response.status}`);
      const command = await response.json();
      queueCommand(command);
      await processDueCommands();
    } catch (error) {
      console.error(`GitHub bridge poll error: ${String(error?.message || error)}`);
    }
  }

  setInterval(() => poll().catch(console.error), pollMs);
  setTimeout(() => poll().catch(console.error), 1200);
  console.log(`GitHub bridge: enabled, polling every ${pollMs}ms`);
}
