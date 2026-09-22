import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildFoodLibrary } from './food-library-core.js';

function nowIso() {
  return new Date().toISOString();
}

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function ensureChatGptImageSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chatgpt_food_images (
      food_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      image_path TEXT NOT NULL,
      image_url TEXT NOT NULL,
      sha256 TEXT NOT NULL UNIQUE,
      width INTEGER,
      height INTEGER,
      source_url TEXT,
      remote_status TEXT NOT NULL DEFAULT 'PENDING',
      remote_error TEXT,
      remote_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chatgpt_food_images_updated
      ON chatgpt_food_images(updated_at);
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(chatgpt_food_images)').all().map(row => row.name));
  if (!columns.has('remote_status')) db.exec("ALTER TABLE chatgpt_food_images ADD COLUMN remote_status TEXT NOT NULL DEFAULT 'PENDING'");
  if (!columns.has('remote_error')) db.exec('ALTER TABLE chatgpt_food_images ADD COLUMN remote_error TEXT');
  if (!columns.has('remote_synced_at')) db.exec('ALTER TABLE chatgpt_food_images ADD COLUMN remote_synced_at TEXT');
}

export function createChatGptImageStore({ db, root }) {
  if (!db) throw new Error('Thiếu database cho ChatGPT image store');
  if (!root) throw new Error('Thiếu root cho ChatGPT image store');

  ensureChatGptImageSchema(db);

  const imageDir = path.join(root, 'uploads', 'food-library');
  fs.mkdirSync(imageDir, { recursive: true });

  const library = buildFoodLibrary();
  const libraryById = new Map(library.map(item => [item.id, item]));

  function storedRows() {
    return db.prepare('SELECT * FROM chatgpt_food_images ORDER BY food_id').all();
  }

  function validStoredIds() {
    const ids = new Set();
    for (const row of storedRows()) {
      const absolutePath = path.isAbsolute(row.image_path) ? row.image_path : path.join(root, row.image_path);
      if (fs.existsSync(absolutePath)) ids.add(row.food_id);
    }
    return ids;
  }

  function nextMissing() {
    const stored = validStoredIds();
    return library.find(item => !stored.has(item.id)) || null;
  }

  function status() {
    const stored = validStoredIds();
    const next = library.find(item => !stored.has(item.id)) || null;
    return {
      total: library.length,
      ready: stored.size,
      missing: Math.max(0, library.length - stored.size),
      next: next ? { id: next.id, title: next.title, category: next.category, image_prompt: next.image_prompt } : null
    };
  }

  async function importImage({ buffer, contentType, foodId, sourceUrl, remoteReady = false }) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw httpError('Ảnh rỗng', 400);
    if (buffer.length > 25 * 1024 * 1024) throw httpError('Ảnh vượt quá 25 MB', 413);

    const requestedId = String(foodId || '').trim();
    const target = requestedId ? libraryById.get(requestedId) : nextMissing();
    if (!target) {
      if (requestedId) throw httpError(`Không tìm thấy món ${requestedId}`, 404);
      throw httpError('Kho 1.000 món đã có đủ ảnh', 409);
    }

    let metadata;
    try {
      metadata = await sharp(buffer, { failOn: 'error' }).metadata();
    } catch {
      throw httpError('Dữ liệu gửi lên không phải ảnh hợp lệ', 415);
    }
    if (!metadata.width || !metadata.height) throw httpError('Không đọc được kích thước ảnh', 415);
    if (metadata.width < 512 || metadata.height < 512) {
      throw httpError(`Ảnh quá nhỏ: ${metadata.width}x${metadata.height}; yêu cầu tối thiểu 512x512`, 422);
    }

    const normalized = await sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize(1080, 1080, { fit: 'cover', position: 'centre', withoutEnlargement: false })
      .webp({ quality: 92, effort: 4 })
      .toBuffer();

    const sha256 = crypto.createHash('sha256').update(normalized).digest('hex');
    const duplicate = db.prepare('SELECT * FROM chatgpt_food_images WHERE sha256=?').get(sha256);
    if (duplicate && duplicate.food_id !== target.id) {
      throw httpError(`Ảnh này đã được lưu cho ${duplicate.food_id}; không gán trùng sang ${target.id}`, 409);
    }

    const fileName = `${target.id}.webp`;
    const relativePath = path.join('uploads', 'food-library', fileName);
    const absolutePath = path.join(root, relativePath);
    const tempPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, normalized);
    fs.renameSync(tempPath, absolutePath);

    const imageUrl = `/uploads/food-library/${encodeURIComponent(fileName)}`;
    const now = nowIso();
    const existing = db.prepare('SELECT food_id,created_at FROM chatgpt_food_images WHERE food_id=?').get(target.id);
    const remoteStatus = remoteReady ? 'READY' : 'PENDING';
    const remoteSyncedAt = remoteReady ? now : null;
    db.prepare(`
      INSERT INTO chatgpt_food_images(
        food_id,title,image_path,image_url,sha256,width,height,source_url,
        remote_status,remote_error,remote_synced_at,created_at,updated_at
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(food_id) DO UPDATE SET
        title=excluded.title,
        image_path=excluded.image_path,
        image_url=excluded.image_url,
        sha256=excluded.sha256,
        width=excluded.width,
        height=excluded.height,
        source_url=excluded.source_url,
        remote_status=excluded.remote_status,
        remote_error=NULL,
        remote_synced_at=excluded.remote_synced_at,
        updated_at=excluded.updated_at
    `).run(
      target.id,
      target.title,
      relativePath,
      imageUrl,
      sha256,
      1080,
      1080,
      String(sourceUrl || '').slice(0, 1800) || null,
      remoteStatus,
      null,
      remoteSyncedAt,
      existing?.created_at || now,
      now
    );

    return {
      ok: true,
      food_id: target.id,
      title: target.title,
      category: target.category,
      image_url: imageUrl,
      width: 1080,
      height: 1080,
      sha256,
      source_content_type: String(contentType || ''),
      next: status().next,
      progress: status()
    };
  }

  function markRemoteSync(foodId, { ok, error = null } = {}) {
    const now = nowIso();
    db.prepare(`
      UPDATE chatgpt_food_images
      SET remote_status=?, remote_error=?, remote_synced_at=?, updated_at=?
      WHERE food_id=?
    `).run(ok ? 'READY' : 'FAILED', ok ? null : String(error || 'REMOTE_SYNC_FAILED').slice(0, 1800), ok ? now : null, now, foodId);
    return db.prepare('SELECT * FROM chatgpt_food_images WHERE food_id=?').get(foodId) || null;
  }

  function pendingRemote(limit = 20) {
    return db.prepare(`
      SELECT * FROM chatgpt_food_images
      WHERE remote_status IN ('PENDING','FAILED')
      ORDER BY updated_at ASC
      LIMIT ?
    `).all(Math.max(1, Math.min(100, Number(limit) || 20)));
  }

  function get(foodId) {
    return db.prepare('SELECT * FROM chatgpt_food_images WHERE food_id=?').get(String(foodId || '')) || null;
  }

  return {
    nextMissing,
    status,
    importImage,
    markRemoteSync,
    pendingRemote,
    get,
    list: () => storedRows()
  };
}
