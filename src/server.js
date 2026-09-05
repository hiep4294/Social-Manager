import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { publishFacebook } from './platforms/facebook.js';
import { publishInstagram } from './platforms/instagram.js';
import { encryptSecret, decryptSecret } from './security.js';
import { buildMetaAuthUrl, exchangeMetaCode, listMetaPages, metaRedirectUri, metaScopes } from './meta-oauth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const uploadDir = path.join(root, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, 'social-manager.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS brand (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  slogan TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  opening_hours TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO brand(id) VALUES(1);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'BRAND',
  parent_id INTEGER,
  name TEXT NOT NULL DEFAULT '',
  slogan TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  opening_hours TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(parent_id) REFERENCES brands(id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  image_path TEXT,
  image_url TEXT,
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  external_id TEXT,
  error TEXT,
  published_at TEXT,
  locked_at TEXT,
  FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE,
  UNIQUE(post_id, platform)
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  access_token_enc TEXT NOT NULL,
  token_expires_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(brand_id) REFERENCES brands(id),
  UNIQUE(brand_id, platform)
);
`);

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(x => x.name === column);
}

if (!hasColumn('posts', 'brand_id')) {
  db.exec('ALTER TABLE posts ADD COLUMN brand_id INTEGER');
}

const nowIso = () => new Date().toISOString();
const brandCount = db.prepare('SELECT COUNT(*) AS n FROM brands').get().n;
if (brandCount === 0) {
  const legacy = db.prepare('SELECT * FROM brand WHERE id=1').get() || {};
  const now = nowIso();
  db.prepare(`
    INSERT INTO brands(kind,parent_id,name,slogan,address,phone,opening_hours,map_url,active,created_at,updated_at)
    VALUES('BRAND',NULL,?,?,?,?,?,?,1,?,?)
  `).run(legacy.name || 'Thương hiệu chính', legacy.slogan || '', legacy.address || '', legacy.phone || '', legacy.opening_hours || '', legacy.map_url || '', now, now);
}

const defaultBrandId = db.prepare('SELECT id FROM brands WHERE active=1 ORDER BY id LIMIT 1').get()?.id;
if (defaultBrandId) {
  db.prepare('UPDATE posts SET brand_id=? WHERE brand_id IS NULL').run(defaultBrandId);
}

const templateCount = db.prepare('SELECT COUNT(*) AS n FROM templates').get().n;
if (templateCount === 0) {
  const ins = db.prepare('INSERT INTO templates(name, category, content) VALUES(?,?,?)');
  const defaults = [
    ['Khuyến mãi cuối tuần', 'QUAN_AN', 'CUỐI TUẦN ĂN NGON - GIÁ TỐT\n\n[Ưu đãi]\n[Thời gian áp dụng]\n\nĐịa chỉ: {{address}}\nLiên hệ: {{phone}}'],
    ['Món mới', 'QUAN_AN', 'MÓN MỚI ĐÃ CÓ MẶT\n\n[Tên món] - [mô tả ngắn]\n\nGhé {{brand}} để thử ngay.\nĐịa chỉ: {{address}}'],
    ['Sản phẩm mới', 'CUA_HANG', 'HÀNG MỚI VỀ\n\n[Tên sản phẩm]\n[Điểm nổi bật]\n[Giá/ưu đãi]\n\nInbox hoặc gọi {{phone}} để đặt hàng.'],
    ['Khai trương', 'CHUNG', 'KHAI TRƯƠNG {{brand}}\n\n[Ưu đãi khai trương]\n[Thời gian]\n\nĐịa chỉ: {{address}}\nBản đồ: {{map_url}}'],
    ['Feedback khách hàng', 'CHUNG', 'CẢM ƠN KHÁCH HÀNG ĐÃ TIN TƯỞNG {{brand}}\n\n[Trích feedback]\n\nChúng tôi luôn cố gắng phục vụ tốt hơn mỗi ngày.']
  ];
  db.transaction(() => defaults.forEach(t => ins.run(...t)))();
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(root, 'public')));

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

function auth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'UNAUTHORIZED' });
}

function publicBase(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function cleanBrandInput(body = {}) {
  const kind = String(body.kind || 'BRAND').toUpperCase() === 'BRANCH' ? 'BRANCH' : 'BRAND';
  const parentId = kind === 'BRANCH' && body.parent_id ? Number(body.parent_id) : null;
  return {
    kind,
    parentId: Number.isFinite(parentId) ? parentId : null,
    name: String(body.name || '').trim(),
    slogan: String(body.slogan || '').trim(),
    address: String(body.address || '').trim(),
    phone: String(body.phone || '').trim(),
    openingHours: String(body.opening_hours || '').trim(),
    mapUrl: String(body.map_url || '').trim()
  };
}

function getBrand(id, activeOnly = true) {
  const sql = activeOnly ? 'SELECT * FROM brands WHERE id=? AND active=1' : 'SELECT * FROM brands WHERE id=?';
  return db.prepare(sql).get(Number(id));
}

function hydratedTemplate(text, brand) {
  return text
    .replaceAll('{{brand}}', brand?.name || '')
    .replaceAll('{{address}}', brand?.address || '')
    .replaceAll('{{phone}}', brand?.phone || '')
    .replaceAll('{{map_url}}', brand?.map_url || '');
}

function safeAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    brand_id: row.brand_id,
    platform: row.platform,
    account_id: row.account_id,
    account_name: row.account_name,
    username: row.username,
    token_expires_at: row.token_expires_at,
    connected_at: row.connected_at,
    updated_at: row.updated_at
  };
}

function connectedAccount(brandId, platform) {
  return db.prepare('SELECT * FROM social_accounts WHERE brand_id=? AND platform=?').get(Number(brandId), platform);
}

function hasPublishingCredential(brandId, platform) {
  if (connectedAccount(brandId, platform)) return true;
  if (platform === 'facebook') return Boolean(process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_PAGE_ACCESS_TOKEN);
  if (platform === 'instagram') return Boolean(process.env.INSTAGRAM_USER_ID && process.env.INSTAGRAM_ACCESS_TOKEN);
  return false;
}

function upsertSocialAccount({ brandId, platform, accountId, accountName, username, accessToken, tokenExpiresAt, metadata }) {
  const now = nowIso();
  const tokenEnc = encryptSecret(accessToken);
  db.prepare(`
    INSERT INTO social_accounts(brand_id,platform,account_id,account_name,username,access_token_enc,token_expires_at,metadata_json,connected_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(brand_id,platform) DO UPDATE SET
      account_id=excluded.account_id,
      account_name=excluded.account_name,
      username=excluded.username,
      access_token_enc=excluded.access_token_enc,
      token_expires_at=excluded.token_expires_at,
      metadata_json=excluded.metadata_json,
      connected_at=excluded.connected_at,
      updated_at=excluded.updated_at
  `).run(
    Number(brandId), platform, String(accountId), accountName || '', username || '', tokenEnc,
    tokenExpiresAt || null, JSON.stringify(metadata || {}), now, now
  );
}

async function publishTarget(targetId) {
  const target = db.prepare(`
    SELECT pt.*, p.content, p.image_url, p.brand_id
    FROM post_targets pt JOIN posts p ON p.id = pt.post_id
    WHERE pt.id = ?
  `).get(targetId);
  if (!target) return;

  const lock = db.prepare(`
    UPDATE post_targets
    SET status='PROCESSING', locked_at=?
    WHERE id=? AND status IN ('PENDING','FAILED')
  `).run(nowIso(), targetId);
  if (!lock.changes) return;

  try {
    const account = connectedAccount(target.brand_id, target.platform);
    const accessToken = account ? decryptSecret(account.access_token_enc) : null;
    let result;

    if (target.platform === 'facebook') {
      result = await publishFacebook({
        message: target.content,
        imageUrl: target.image_url,
        pageId: account?.account_id,
        accessToken
      });
    } else if (target.platform === 'instagram') {
      result = await publishInstagram({
        message: target.content,
        imageUrl: target.image_url,
        userId: account?.account_id,
        accessToken
      });
    } else {
      throw new Error(`Platform không hỗ trợ: ${target.platform}`);
    }

    db.prepare(`UPDATE post_targets SET status='PUBLISHED', external_id=?, error=NULL, published_at=?, locked_at=NULL WHERE id=?`)
      .run(result?.id || result?.post_id || null, nowIso(), targetId);
  } catch (err) {
    db.prepare(`UPDATE post_targets SET status='FAILED', error=?, locked_at=NULL WHERE id=?`)
      .run(String(err?.message || err), targetId);
  }
}

async function runScheduler() {
  const now = nowIso();
  const stale = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  db.prepare(`UPDATE post_targets SET status='PENDING', locked_at=NULL WHERE status='PROCESSING' AND locked_at < ?`).run(stale);

  const rows = db.prepare(`
    SELECT pt.id
    FROM post_targets pt JOIN posts p ON p.id = pt.post_id
    WHERE pt.status='PENDING'
      AND (p.scheduled_at IS NULL OR p.scheduled_at <= ?)
    ORDER BY COALESCE(p.scheduled_at,p.created_at) ASC, pt.id ASC
    LIMIT 10
  `).all(now);
  for (const row of rows) await publishTarget(row.id);
}
setInterval(() => runScheduler().catch(console.error), 15000);
setTimeout(() => runScheduler().catch(console.error), 2000);

app.post('/api/login', (req, res) => {
  const user = String(req.body.user || '');
  const password = String(req.body.password || '');
  if (user === (process.env.ADMIN_USER || 'admin') && password === (process.env.ADMIN_PASSWORD || 'change-me-now')) {
    req.session.user = user;
    return res.json({ ok: true, user });
  }
  res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
});

app.post('/api/logout', auth, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json({ authenticated: Boolean(req.session?.user), user: req.session?.user || null }));

app.get('/api/brands', auth, (_req, res) => {
  const rows = db.prepare(`
    SELECT b.*, p.name AS parent_name
    FROM brands b LEFT JOIN brands p ON p.id=b.parent_id
    WHERE b.active=1
    ORDER BY CASE b.kind WHEN 'BRAND' THEN 0 ELSE 1 END, COALESCE(p.name,b.name), b.name
  `).all();
  res.json(rows);
});

app.post('/api/brands', auth, (req, res) => {
  const b = cleanBrandInput(req.body);
  if (!b.name) return res.status(400).json({ error: 'Tên thương hiệu/chi nhánh không được để trống' });
  if (b.kind === 'BRANCH' && (!b.parentId || !getBrand(b.parentId))) {
    return res.status(400).json({ error: 'Chi nhánh phải thuộc một thương hiệu đang hoạt động' });
  }
  const now = nowIso();
  const info = db.prepare(`
    INSERT INTO brands(kind,parent_id,name,slogan,address,phone,opening_hours,map_url,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,1,?,?)
  `).run(b.kind, b.parentId, b.name, b.slogan, b.address, b.phone, b.openingHours, b.mapUrl, now, now);
  res.status(201).json(getBrand(info.lastInsertRowid));
});

app.put('/api/brands/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!getBrand(id)) return res.status(404).json({ error: 'Không tìm thấy thương hiệu/chi nhánh' });
  const b = cleanBrandInput(req.body);
  if (!b.name) return res.status(400).json({ error: 'Tên thương hiệu/chi nhánh không được để trống' });
  if (b.kind === 'BRANCH' && (!b.parentId || b.parentId === id || !getBrand(b.parentId))) {
    return res.status(400).json({ error: 'Thương hiệu cha không hợp lệ' });
  }
  db.prepare(`
    UPDATE brands SET kind=?,parent_id=?,name=?,slogan=?,address=?,phone=?,opening_hours=?,map_url=?,updated_at=?
    WHERE id=?
  `).run(b.kind, b.parentId, b.name, b.slogan, b.address, b.phone, b.openingHours, b.mapUrl, nowIso(), id);
  res.json(getBrand(id));
});

app.delete('/api/brands/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!getBrand(id)) return res.status(404).json({ error: 'Không tìm thấy thương hiệu/chi nhánh' });
  const activeCount = db.prepare('SELECT COUNT(*) AS n FROM brands WHERE active=1').get().n;
  if (activeCount <= 1) return res.status(400).json({ error: 'Phải giữ lại ít nhất một thương hiệu' });
  db.prepare('UPDATE brands SET active=0, updated_at=? WHERE id=?').run(nowIso(), id);
  db.prepare('UPDATE brands SET parent_id=NULL, kind=\'BRAND\', updated_at=? WHERE parent_id=? AND active=1').run(nowIso(), id);
  res.json({ ok: true });
});

app.get('/api/templates', auth, (req, res) => {
  const brandId = Number(req.query.brand_id || defaultBrandId);
  const brand = getBrand(brandId) || getBrand(defaultBrandId);
  const rows = db.prepare('SELECT * FROM templates ORDER BY id').all().map(t => ({
    ...t,
    rendered: hydratedTemplate(t.content, brand)
  }));
  res.json(rows);
});

app.post('/api/upload', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa có ảnh hợp lệ' });
  const url = `${publicBase(req)}/uploads/${encodeURIComponent(req.file.filename)}`;
  res.json({ path: req.file.path, url });
});

app.get('/api/social-accounts', auth, (req, res) => {
  const brandId = Number(req.query.brand_id || 0);
  if (!getBrand(brandId)) return res.status(400).json({ error: 'brand_id không hợp lệ' });
  const rows = db.prepare('SELECT * FROM social_accounts WHERE brand_id=? ORDER BY platform').all(brandId);
  res.json(rows.map(safeAccount));
});

app.delete('/api/social-accounts/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const change = db.prepare('DELETE FROM social_accounts WHERE id=?').run(id);
  if (!change.changes) return res.status(404).json({ error: 'Không tìm thấy kết nối' });
  res.json({ ok: true });
});

app.get('/api/meta/config', auth, (req, res) => {
  const base = publicBase(req);
  res.json({
    configured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    app_id_configured: Boolean(process.env.META_APP_ID),
    app_secret_configured: Boolean(process.env.META_APP_SECRET),
    token_encryption_configured: Boolean(process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET),
    redirect_uri: metaRedirectUri(base),
    scopes: metaScopes()
  });
});

app.get('/api/meta/oauth/start', auth, (req, res) => {
  const brandId = Number(req.query.brand_id || 0);
  if (!getBrand(brandId)) return res.status(400).send('brand_id không hợp lệ');
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return res.status(400).send('Chưa cấu hình META_APP_ID / META_APP_SECRET');
  }
  const state = crypto.randomBytes(24).toString('base64url');
  req.session.metaOAuth = { state, brandId, createdAt: Date.now() };
  res.redirect(buildMetaAuthUrl({ publicBase: publicBase(req), state }));
});

app.get('/api/meta/oauth/callback', async (req, res) => {
  const home = publicBase(req);
  try {
    if (!req.session?.user) throw new Error('Phiên đăng nhập đã hết hạn');
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const saved = req.session.metaOAuth;
    if (!saved || saved.state !== String(req.query.state || '')) throw new Error('OAuth state không hợp lệ');
    if (Date.now() - Number(saved.createdAt || 0) > 10 * 60 * 1000) throw new Error('Yêu cầu OAuth đã hết hạn');
    const brand = getBrand(saved.brandId);
    if (!brand) throw new Error('Thương hiệu không còn tồn tại');
    const exchanged = await exchangeMetaCode({ code: String(req.query.code || ''), publicBase: home });
    const pages = await listMetaPages(exchanged.accessToken);
    if (!pages.length) throw new Error('Không tìm thấy Facebook Page mà tài khoản có quyền quản lý');
    req.session.metaPending = {
      brandId: saved.brandId,
      createdAt: Date.now(),
      userTokenExpiresIn: exchanged.expiresIn,
      pages
    };
    delete req.session.metaOAuth;
    res.redirect('/?oauth=meta');
  } catch (err) {
    if (req.session) delete req.session.metaOAuth;
    res.redirect(`/?oauth_error=${encodeURIComponent(String(err?.message || err))}`);
  }
});

app.get('/api/meta/oauth/pending', auth, (req, res) => {
  const pending = req.session.metaPending;
  if (!pending || Date.now() - Number(pending.createdAt || 0) > 10 * 60 * 1000) {
    delete req.session.metaPending;
    return res.json({ pending: false });
  }
  res.json({
    pending: true,
    brand_id: pending.brandId,
    pages: pending.pages.map(p => ({
      page_id: p.pageId,
      page_name: p.pageName,
      category: p.category,
      instagram: p.instagram
    }))
  });
});

app.post('/api/meta/oauth/complete', auth, (req, res) => {
  const pending = req.session.metaPending;
  if (!pending || Date.now() - Number(pending.createdAt || 0) > 10 * 60 * 1000) {
    delete req.session.metaPending;
    return res.status(400).json({ error: 'Phiên kết nối Meta đã hết hạn, hãy kết nối lại' });
  }
  const pageId = String(req.body.page_id || '');
  const page = pending.pages.find(p => p.pageId === pageId);
  if (!page) return res.status(400).json({ error: 'Facebook Page không hợp lệ' });
  const brand = getBrand(pending.brandId);
  if (!brand) return res.status(400).json({ error: 'Thương hiệu không còn tồn tại' });

  const expiresAt = pending.userTokenExpiresIn
    ? new Date(Date.now() + Number(pending.userTokenExpiresIn) * 1000).toISOString()
    : null;

  upsertSocialAccount({
    brandId: pending.brandId,
    platform: 'facebook',
    accountId: page.pageId,
    accountName: page.pageName,
    username: '',
    accessToken: page.pageAccessToken,
    tokenExpiresAt: expiresAt,
    metadata: { category: page.category }
  });

  if (req.body.connect_instagram !== false && page.instagram?.id) {
    upsertSocialAccount({
      brandId: pending.brandId,
      platform: 'instagram',
      accountId: page.instagram.id,
      accountName: page.instagram.name || page.instagram.username || 'Instagram',
      username: page.instagram.username || '',
      accessToken: page.pageAccessToken,
      tokenExpiresAt: expiresAt,
      metadata: { facebook_page_id: page.pageId, picture: page.instagram.picture || '' }
    });
  }

  const brandId = pending.brandId;
  delete req.session.metaPending;
  const accounts = db.prepare('SELECT * FROM social_accounts WHERE brand_id=? ORDER BY platform').all(brandId).map(safeAccount);
  res.json({ ok: true, accounts });
});

app.post('/api/meta/oauth/cancel', auth, (req, res) => {
  delete req.session.metaPending;
  delete req.session.metaOAuth;
  res.json({ ok: true });
});

function postsWithTargets(posts) {
  const targetsStmt = db.prepare('SELECT * FROM post_targets WHERE post_id=? ORDER BY id');
  return posts.map(p => ({ ...p, targets: targetsStmt.all(p.id) }));
}

app.get('/api/posts', auth, (req, res) => {
  const brandId = Number(req.query.brand_id || 0);
  const posts = brandId
    ? db.prepare('SELECT * FROM posts WHERE brand_id=? ORDER BY id DESC LIMIT 300').all(brandId)
    : db.prepare('SELECT * FROM posts ORDER BY id DESC LIMIT 300').all();
  res.json(postsWithTargets(posts));
});

app.get('/api/calendar', auth, (req, res) => {
  const brandId = Number(req.query.brand_id || 0);
  if (!getBrand(brandId)) return res.status(400).json({ error: 'brand_id không hợp lệ' });
  const start = String(req.query.start || '');
  const end = String(req.query.end || '');
  if (!start || !end) return res.status(400).json({ error: 'Thiếu start/end' });
  const rows = db.prepare(`
    SELECT * FROM posts
    WHERE brand_id=? AND COALESCE(scheduled_at,created_at) >= ? AND COALESCE(scheduled_at,created_at) < ?
    ORDER BY COALESCE(scheduled_at,created_at), id
  `).all(brandId, start, end);
  res.json(postsWithTargets(rows));
});

app.post('/api/posts', auth, (req, res) => {
  const brandId = Number(req.body.brand_id || 0);
  const brand = getBrand(brandId);
  if (!brand) return res.status(400).json({ error: 'Chọn thương hiệu/chi nhánh hợp lệ' });

  const content = String(req.body.content || '').trim();
  const platforms = Array.isArray(req.body.platforms) ? req.body.platforms : [];
  const imageUrl = String(req.body.image_url || '').trim() || null;
  let scheduledAt = null;
  if (req.body.scheduled_at) {
    const parsed = new Date(req.body.scheduled_at);
    if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'Thời gian đăng không hợp lệ' });
    scheduledAt = parsed.toISOString();
  }

  if (!content) return res.status(400).json({ error: 'Nội dung bài đăng đang trống' });
  const allowed = [...new Set(platforms.filter(p => ['facebook', 'instagram'].includes(p)))];
  if (!allowed.length) return res.status(400).json({ error: 'Chọn ít nhất một nền tảng' });
  if (allowed.includes('instagram') && !imageUrl) return res.status(400).json({ error: 'Instagram yêu cầu có ảnh' });
  for (const platform of allowed) {
    if (!hasPublishingCredential(brandId, platform)) {
      return res.status(400).json({ error: `${brand.name} chưa kết nối ${platform === 'facebook' ? 'Facebook Page' : 'Instagram'}` });
    }
  }

  const now = nowIso();
  const info = db.prepare(`INSERT INTO posts(brand_id,content,image_url,scheduled_at,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
    .run(brandId, content, imageUrl, scheduledAt, now, now);
  const targetStmt = db.prepare(`INSERT INTO post_targets(post_id,platform,status) VALUES(?,?, 'PENDING')`);
  db.transaction(() => allowed.forEach(p => targetStmt.run(info.lastInsertRowid, p)))();

  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ ...post, targets: db.prepare('SELECT * FROM post_targets WHERE post_id=?').all(info.lastInsertRowid) });
  setTimeout(() => runScheduler().catch(console.error), 50);
});

app.post('/api/targets/:id/retry', auth, (req, res) => {
  const id = Number(req.params.id);
  const change = db.prepare(`UPDATE post_targets SET status='PENDING', error=NULL, locked_at=NULL WHERE id=? AND status='FAILED'`).run(id);
  if (!change.changes) return res.status(400).json({ error: 'Không thể retry target này' });
  res.json({ ok: true });
  setTimeout(() => runScheduler().catch(console.error), 50);
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: 'V1.1.0',
    brands: db.prepare('SELECT COUNT(*) AS n FROM brands WHERE active=1').get().n,
    posts: db.prepare('SELECT COUNT(*) AS n FROM posts').get().n
  });
});

app.get('*', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`Social Manager V1.1 listening on :${PORT}`));
