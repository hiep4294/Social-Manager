import crypto from 'node:crypto';
import { classifyPageCommentRisk } from './facebook-page-engagement.js';

function normalizeText(value = '') {
  return String(value).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function cleanFacebookUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!/(^|\.)facebook\.com$/i.test(url.hostname) && !/(^|\.)fb\.com$/i.test(url.hostname)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function ensureGroupMonitorSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS facebook_operator_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_type TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      brand_id INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(asset_type, url)
    );
    CREATE INDEX IF NOT EXISTS idx_fb_assets_name
      ON facebook_operator_assets(asset_type, active, name);

    CREATE TABLE IF NOT EXISTS facebook_group_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER,
      group_name TEXT NOT NULL,
      group_url TEXT NOT NULL UNIQUE,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      watch_all INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'DRAFT',
      reply_template TEXT NOT NULL DEFAULT '',
      poll_seconds INTEGER NOT NULL DEFAULT 180,
      max_replies_per_hour INTEGER NOT NULL DEFAULT 3,
      active INTEGER NOT NULL DEFAULT 1,
      last_scan_at TEXT,
      next_scan_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fb_group_monitors_due
      ON facebook_group_monitors(active, next_scan_at);

    CREATE TABLE IF NOT EXISTS facebook_group_monitor_seen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      post_url TEXT,
      text_excerpt TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT 'LOW',
      status TEXT NOT NULL DEFAULT 'SEEN',
      reply_text TEXT,
      error TEXT,
      discovered_at TEXT NOT NULL,
      replied_at TEXT,
      UNIQUE(monitor_id, item_key)
    );
    CREATE INDEX IF NOT EXISTS idx_fb_group_seen_monitor
      ON facebook_group_monitor_seen(monitor_id, discovered_at);
  `);
}

export function rememberFacebookAsset(db, { assetType, name, url, brandId = null, metadata = {} }) {
  ensureGroupMonitorSchema(db);
  const type = String(assetType || '').trim().toUpperCase();
  if (!['PAGE', 'GROUP'].includes(type)) throw new Error('assetType chỉ nhận PAGE hoặc GROUP');
  const cleanName = String(name || '').trim();
  const cleanUrl = cleanFacebookUrl(url);
  if (!cleanName) throw new Error('Thiếu tên Facebook asset');
  if (!cleanUrl) throw new Error('URL Facebook asset không hợp lệ');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO facebook_operator_assets(asset_type,name,url,brand_id,metadata_json,active,created_at,updated_at)
    VALUES(?,?,?,?,?,1,?,?)
    ON CONFLICT(asset_type,url) DO UPDATE SET
      name=excluded.name,
      brand_id=COALESCE(excluded.brand_id,facebook_operator_assets.brand_id),
      metadata_json=excluded.metadata_json,
      active=1,
      updated_at=excluded.updated_at
  `).run(type, cleanName, cleanUrl, brandId ? Number(brandId) : null, JSON.stringify(metadata || {}), now, now);
  return db.prepare('SELECT * FROM facebook_operator_assets WHERE asset_type=? AND url=?').get(type, cleanUrl);
}

export function findFacebookAsset(db, { assetType = 'GROUP', name, url } = {}) {
  ensureGroupMonitorSchema(db);
  const type = String(assetType || 'GROUP').trim().toUpperCase();
  const cleanUrl = cleanFacebookUrl(url);
  if (cleanUrl) return db.prepare('SELECT * FROM facebook_operator_assets WHERE asset_type=? AND url=? AND active=1').get(type, cleanUrl) || null;
  const wanted = normalizeText(name);
  if (!wanted) return null;
  const rows = db.prepare('SELECT * FROM facebook_operator_assets WHERE asset_type=? AND active=1 ORDER BY updated_at DESC').all(type);
  const exact = rows.filter(row => normalizeText(row.name) === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`Có nhiều ${type} cùng tên "${name}"; hãy dùng URL.`);
  const contains = rows.filter(row => normalizeText(row.name).includes(wanted) || wanted.includes(normalizeText(row.name)));
  if (contains.length === 1) return contains[0];
  return null;
}

function normalizeKeywords(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(',');
  const out = [];
  for (const item of input) {
    const text = normalizeText(item);
    if (text && !out.includes(text)) out.push(text);
  }
  return out.slice(0, 50);
}

export function normalizeGroupMonitor(input = {}) {
  const groupName = String(input.group_name || input.name || '').trim();
  const groupUrl = cleanFacebookUrl(input.group_url || input.url);
  const keywords = normalizeKeywords(input.keywords || []);
  const watchAll = input.watch_all === true || String(input.watch_all || '').toLowerCase() === 'true';
  const mode = String(input.mode || 'DRAFT').trim().toUpperCase();
  const replyTemplate = String(input.reply_message || input.reply_template || '').trim();
  const pollSeconds = Math.max(60, Math.min(3600, Number(input.poll_seconds || 180) || 180));
  const maxRepliesPerHour = Math.max(1, Math.min(20, Number(input.max_replies_per_hour || 3) || 3));

  if (!groupName && !groupUrl) return { ok: false, error: 'Theo dõi Group cần group_name hoặc group_url' };
  if (!['AUTO', 'DRAFT'].includes(mode)) return { ok: false, error: 'mode chỉ nhận AUTO hoặc DRAFT' };
  if (mode === 'AUTO' && !watchAll && !keywords.length) return { ok: false, error: 'AUTO cần keywords hoặc watch_all=true' };
  if (mode === 'AUTO' && !replyTemplate) return { ok: false, error: 'AUTO cần reply_message để tránh trả lời ngoài ý muốn' };

  return {
    ok: true,
    value: {
      groupName,
      groupUrl,
      keywords,
      watchAll,
      mode,
      replyTemplate,
      pollSeconds,
      maxRepliesPerHour
    }
  };
}

export function configureGroupMonitor(db, input = {}) {
  ensureGroupMonitorSchema(db);
  const normalized = normalizeGroupMonitor(input);
  if (!normalized.ok) throw new Error(normalized.error);
  const value = normalized.value;

  let url = value.groupUrl;
  let name = value.groupName;
  if (!url && name) {
    const asset = findFacebookAsset(db, { assetType: 'GROUP', name });
    if (!asset) throw new Error(`Chưa biết URL của Group "${name}". Hãy tham gia/ghi nhớ Group bằng URL trước.`);
    url = asset.url;
    name ||= asset.name;
  }
  if (!name && url) {
    const asset = findFacebookAsset(db, { assetType: 'GROUP', url });
    name = asset?.name || 'Facebook Group';
  }

  rememberFacebookAsset(db, { assetType: 'GROUP', name, url, brandId: input.brand_id || null });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO facebook_group_monitors(
      brand_id,group_name,group_url,keywords_json,watch_all,mode,reply_template,
      poll_seconds,max_replies_per_hour,active,last_scan_at,next_scan_at,last_error,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,1,NULL,?,NULL,?,?)
    ON CONFLICT(group_url) DO UPDATE SET
      brand_id=COALESCE(excluded.brand_id,facebook_group_monitors.brand_id),
      group_name=excluded.group_name,
      keywords_json=excluded.keywords_json,
      watch_all=excluded.watch_all,
      mode=excluded.mode,
      reply_template=excluded.reply_template,
      poll_seconds=excluded.poll_seconds,
      max_replies_per_hour=excluded.max_replies_per_hour,
      active=1,
      next_scan_at=excluded.next_scan_at,
      last_error=NULL,
      updated_at=excluded.updated_at
  `).run(
    input.brand_id ? Number(input.brand_id) : null,
    name,
    url,
    JSON.stringify(value.keywords),
    value.watchAll ? 1 : 0,
    value.mode,
    value.replyTemplate,
    value.pollSeconds,
    value.maxRepliesPerHour,
    now,
    now,
    now
  );
  return db.prepare('SELECT * FROM facebook_group_monitors WHERE group_url=?').get(url);
}

export function stopGroupMonitor(db, input = {}) {
  ensureGroupMonitorSchema(db);
  let monitor = null;
  if (input.monitor_id) monitor = db.prepare('SELECT * FROM facebook_group_monitors WHERE id=?').get(Number(input.monitor_id));
  if (!monitor && input.group_url) monitor = db.prepare('SELECT * FROM facebook_group_monitors WHERE group_url=?').get(cleanFacebookUrl(input.group_url));
  if (!monitor && input.group_name) {
    const wanted = normalizeText(input.group_name);
    const rows = db.prepare('SELECT * FROM facebook_group_monitors WHERE active=1').all();
    const matches = rows.filter(row => normalizeText(row.group_name) === wanted);
    if (matches.length === 1) monitor = matches[0];
  }
  if (!monitor) throw new Error('Không tìm thấy Group Monitor cần dừng');
  const now = new Date().toISOString();
  db.prepare('UPDATE facebook_group_monitors SET active=0,updated_at=? WHERE id=?').run(now, monitor.id);
  return db.prepare('SELECT * FROM facebook_group_monitors WHERE id=?').get(monitor.id);
}

export function groupMonitorMatches(monitor, text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (Number(monitor?.watch_all || 0) === 1) return true;
  let keywords = [];
  try { keywords = JSON.parse(monitor?.keywords_json || '[]'); } catch {}
  return keywords.some(keyword => normalized.includes(normalizeText(keyword)));
}

export function renderGroupReply(monitor, postText = '') {
  const template = String(monitor?.reply_template || '').trim();
  if (!template) return '';
  const excerpt = String(postText || '').replace(/\s+/g, ' ').trim().slice(0, 350);
  return template
    .replaceAll('{{group}}', String(monitor?.group_name || ''))
    .replaceAll('{{post}}', excerpt);
}

export function groupItemKey({ postUrl, text }) {
  const source = cleanFacebookUrl(postUrl) || normalizeText(text).slice(0, 1200);
  return crypto.createHash('sha256').update(source || String(Date.now())).digest('hex');
}

export function classifyGroupItemRisk(text = '') {
  return classifyPageCommentRisk(text);
}

export function canAutoReply(db, monitor, now = Date.now()) {
  const max = Math.max(1, Number(monitor?.max_replies_per_hour || 3));
  const since = new Date(Number(now) - 60 * 60 * 1000).toISOString();
  const count = db.prepare(`
    SELECT COUNT(*) AS n FROM facebook_group_monitor_seen
    WHERE monitor_id=? AND status='REPLIED' AND replied_at>=?
  `).get(Number(monitor.id), since)?.n || 0;
  return count < max;
}
