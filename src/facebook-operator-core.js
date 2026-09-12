import crypto from 'node:crypto';

export const OPERATOR_ACTIONS = new Set([
  'create_page',
  'create_group',
  'join_group',
  'post_group',
  'comment_group'
]);

function cleanUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeOperatorJob(input = {}) {
  const action = String(input?.action || '').trim();
  const payload = input?.payload && typeof input.payload === 'object' ? { ...input.payload } : {};
  const brandId = Number(input?.brand_id || 0) || null;
  const scheduledRaw = String(input?.scheduled_at || '').trim();
  let scheduledAt = null;

  if (!OPERATOR_ACTIONS.has(action)) return { ok: false, error: `Operator action không hỗ trợ: ${action || '(trống)'}` };
  if (scheduledRaw) {
    const parsed = new Date(scheduledRaw);
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: 'scheduled_at không hợp lệ' };
    scheduledAt = parsed.toISOString();
  }

  if (action === 'create_page') {
    payload.name = String(payload.name || '').trim();
    payload.category = String(payload.category || '').trim();
    payload.bio = String(payload.bio || '').trim();
    if (!payload.name) return { ok: false, error: 'Tạo Page cần name' };
  }

  if (action === 'create_group') {
    payload.name = String(payload.name || '').trim();
    payload.privacy = String(payload.privacy || 'PUBLIC').trim().toUpperCase();
    payload.description = String(payload.description || '').trim();
    if (!payload.name) return { ok: false, error: 'Tạo Group cần name' };
    if (!['PUBLIC', 'PRIVATE'].includes(payload.privacy)) return { ok: false, error: 'privacy chỉ nhận PUBLIC hoặc PRIVATE' };
  }

  if (['join_group', 'post_group'].includes(action)) {
    payload.group_url = cleanUrl(payload.group_url);
    if (!payload.group_url) return { ok: false, error: `${action} cần group_url hợp lệ` };
  }

  if (action === 'post_group') {
    payload.message = String(payload.message || '').trim();
    payload.image_url = cleanUrl(payload.image_url);
    if (!payload.message && !payload.image_url) return { ok: false, error: 'post_group cần message hoặc image_url' };
  }

  if (action === 'comment_group') {
    payload.post_url = cleanUrl(payload.post_url);
    payload.message = String(payload.message || '').trim();
    if (!payload.post_url) return { ok: false, error: 'comment_group cần post_url hợp lệ' };
    if (!payload.message) return { ok: false, error: 'comment_group cần message' };
  }

  return {
    ok: true,
    value: {
      action,
      brandId,
      payload,
      scheduledAt
    }
  };
}

export function ensureOperatorSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS facebook_operator_jobs (
      id TEXT PRIMARY KEY,
      brand_id INTEGER,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'QUEUED',
      result_json TEXT,
      error TEXT,
      screenshot_url TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      scheduled_at TEXT,
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fb_operator_due
      ON facebook_operator_jobs(status, scheduled_at, created_at);
  `);
}

export function enqueueOperatorJob(db, input = {}) {
  ensureOperatorSchema(db);
  const normalized = normalizeOperatorJob(input);
  if (!normalized.ok) throw new Error(normalized.error);
  const value = normalized.value;
  const id = String(input?.id || `fbop-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`).trim();
  const existing = db.prepare('SELECT * FROM facebook_operator_jobs WHERE id=?').get(id);
  if (existing) return existing;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO facebook_operator_jobs(
      id,brand_id,action,payload_json,status,scheduled_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)
  `).run(
    id,
    value.brandId,
    value.action,
    JSON.stringify(value.payload),
    'QUEUED',
    value.scheduledAt,
    now,
    now
  );
  return db.prepare('SELECT * FROM facebook_operator_jobs WHERE id=?').get(id);
}
