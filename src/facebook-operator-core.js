import crypto from 'node:crypto';
import { cleanFacebookUrl, ensureGroupMonitorSchema, normalizeGroupMonitor } from './group-monitor-core.js';

export const OPERATOR_ACTIONS = new Set([
  'generate_food_image',
  'create_page',
  'post_page',
  'create_group',
  'join_group',
  'post_group',
  'comment_group',
  'like_group_post',
  'like_first_group_post',
  'like_group_comments',
  'remember_group',
  'monitor_group',
  'stop_monitor_group',
  'scan_group'
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

function cleanImageSource(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // Remote images remain restricted to normal HTTP(S).
  const remote = cleanUrl(raw);
  if (remote) return remote;

  // Local operator jobs can safely carry a generated/uploaded image as a
  // data URL. Restrict the MIME type, require base64 and cap payload size.
  // 16 MiB encoded is ample for social images while preventing unbounded DB
  // payloads or arbitrary data: schemes.
  if (raw.length > 16 * 1024 * 1024) return null;

  const match = raw.match(
    /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i
  );

  if (!match) return null;

  const base64 = match[2].replace(/[\r\n]/g, '');
  if (!base64 || base64.length % 4 !== 0) return null;

  try {
    const decoded = Buffer.from(base64, 'base64');
    if (!decoded.length) return null;
  } catch {
    return null;
  }

  return `data:${match[1].toLowerCase()};base64,${base64}`;
}

function normalizeGroupTarget(payload, action) {
  payload.group_url = cleanFacebookUrl(payload.group_url);
  payload.group_name = String(payload.group_name || '').trim();
  payload.post_url = cleanFacebookUrl(payload.post_url);
  if (!payload.group_url && !payload.group_name && !payload.post_url) {
    return { ok: false, error: `${action} cần group_url, group_name hoặc post_url` };
  }
  return { ok: true };
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

  if (action === 'generate_food_image') {
    payload.prompt = String(payload.prompt || '').trim();
    payload.recipe_code = String(payload.recipe_code || '').trim().toUpperCase();
    payload.recipe_title = String(payload.recipe_title || '').trim();
    payload.page_key = String(payload.page_key || '').trim().toLowerCase();
    if (!payload.prompt) return { ok: false, error: 'generate_food_image cần prompt' };
    if (!/^RID\d{3,5}$/.test(payload.recipe_code)) return { ok: false, error: 'generate_food_image cần recipe_code dạng RIDxxx' };
    if (!payload.recipe_title) return { ok: false, error: 'generate_food_image cần recipe_title' };
  }

  if (action === 'create_page') {
    payload.name = String(payload.name || '').trim();
    payload.category = String(payload.category || '').trim();
    payload.bio = String(payload.bio || '').trim();
    if (!payload.name) return { ok: false, error: 'Tạo Page cần name' };
  }

  if (action === 'post_page') {
    payload.page_url = cleanFacebookUrl(payload.page_url);
    payload.page_name = String(payload.page_name || '').trim();
    payload.message = String(payload.message || '').trim();
    payload.image_url = cleanImageSource(payload.image_url);
    if (!payload.page_url && !payload.page_name) return { ok: false, error: 'post_page cần page_url hoặc page_name' };
    if (!payload.message && !payload.image_url) return { ok: false, error: 'post_page cần message hoặc image_url' };
  }

  if (action === 'create_group') {
    payload.name = String(payload.name || '').trim();
    payload.privacy = String(payload.privacy || 'PUBLIC').trim().toUpperCase();
    payload.description = String(payload.description || '').trim();
    if (!payload.name) return { ok: false, error: 'Tạo Group cần name' };
    if (!['PUBLIC', 'PRIVATE'].includes(payload.privacy)) return { ok: false, error: 'privacy chỉ nhận PUBLIC hoặc PRIVATE' };
  }

  if (['join_group', 'post_group'].includes(action)) {
    payload.group_url = cleanFacebookUrl(payload.group_url);
    payload.group_name = String(payload.group_name || '').trim();
    if (!payload.group_url && !payload.group_name) return { ok: false, error: `${action} cần group_url hoặc group_name` };
  }

  if (['like_group_post', 'like_first_group_post', 'like_group_comments'].includes(action)) {
    const target = normalizeGroupTarget(payload, action);
    if (!target.ok) return target;
  }

  if (action === 'like_group_comments') {
    const requested = Number(payload.count ?? 1);
    if (!Number.isInteger(requested) || requested < 1 || requested > 20) {
      return { ok: false, error: 'like_group_comments count phải là số nguyên từ 1 đến 20' };
    }
    payload.count = requested;
  }

  if (action === 'post_group') {
    payload.message = String(payload.message || '').trim();
    payload.image_url = cleanImageSource(payload.image_url);
    if (!payload.message && !payload.image_url) return { ok: false, error: 'post_group cần message hoặc image_url' };
  }

  if (action === 'comment_group') {
    payload.post_url = cleanFacebookUrl(payload.post_url);
    payload.message = String(payload.message || '').trim();
    if (!payload.post_url) return { ok: false, error: 'comment_group cần post_url Facebook hợp lệ' };
    if (!payload.message) return { ok: false, error: 'comment_group cần message' };
  }

  if (action === 'remember_group') {
    payload.group_name = String(payload.group_name || payload.name || '').trim();
    payload.group_url = cleanFacebookUrl(payload.group_url || payload.url);
    if (!payload.group_name) return { ok: false, error: 'remember_group cần group_name' };
    if (!payload.group_url) return { ok: false, error: 'remember_group cần group_url Facebook hợp lệ' };
  }

  if (action === 'monitor_group') {
    const normalized = normalizeGroupMonitor({ ...payload, brand_id: brandId });
    if (!normalized.ok) return normalized;
    Object.assign(payload, {
      group_name: normalized.value.groupName,
      group_url: normalized.value.groupUrl,
      keywords: normalized.value.keywords,
      watch_all: normalized.value.watchAll,
      mode: normalized.value.mode,
      reply_message: normalized.value.replyTemplate,
      poll_seconds: normalized.value.pollSeconds,
      max_replies_per_hour: normalized.value.maxRepliesPerHour
    });
  }

  if (action === 'stop_monitor_group') {
    payload.monitor_id = Number(payload.monitor_id || 0) || null;
    payload.group_name = String(payload.group_name || '').trim();
    payload.group_url = cleanFacebookUrl(payload.group_url);
    if (!payload.monitor_id && !payload.group_name && !payload.group_url) {
      return { ok: false, error: 'stop_monitor_group cần monitor_id, group_name hoặc group_url' };
    }
  }

  if (action === 'scan_group') {
    payload.monitor_id = Number(payload.monitor_id || 0) || null;
    if (!payload.monitor_id) return { ok: false, error: 'scan_group cần monitor_id' };
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
  ensureGroupMonitorSchema(db);
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
