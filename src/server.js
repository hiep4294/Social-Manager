import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { publishFacebook } from './platforms/facebook.js';
import { publishInstagram } from './platforms/instagram.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const uploadDir = path.join(root, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, 'social-manager.db'));
db.pragma('journal_mode = WAL');
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
`);

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
  const tx = db.transaction(() => defaults.forEach(t => ins.run(...t)));
  tx();
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
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

function hydratedTemplate(text, brand) {
  return text
    .replaceAll('{{brand}}', brand.name || '')
    .replaceAll('{{address}}', brand.address || '')
    .replaceAll('{{phone}}', brand.phone || '')
    .replaceAll('{{map_url}}', brand.map_url || '');
}

async function publishTarget(targetId) {
  const target = db.prepare(`
    SELECT pt.*, p.content, p.image_url
    FROM post_targets pt JOIN posts p ON p.id = pt.post_id
    WHERE pt.id = ?
  `).get(targetId);
  if (!target) return;

  const lock = db.prepare(`
    UPDATE post_targets
    SET status='PROCESSING', locked_at=?
    WHERE id=? AND status IN ('PENDING','FAILED')
  `).run(new Date().toISOString(), targetId);
  if (!lock.changes) return;

  try {
    let result;
    if (target.platform === 'facebook') {
      result = await publishFacebook({ message: target.content, imageUrl: target.image_url });
    } else if (target.platform === 'instagram') {
      result = await publishInstagram({ message: target.content, imageUrl: target.image_url });
    } else {
      throw new Error(`Platform không hỗ trợ trong V1: ${target.platform}`);
    }

    db.prepare(`UPDATE post_targets SET status='PUBLISHED', external_id=?, error=NULL, published_at=?, locked_at=NULL WHERE id=?`)
      .run(result?.id || result?.post_id || null, new Date().toISOString(), targetId);
  } catch (err) {
    db.prepare(`UPDATE post_targets SET status='FAILED', error=?, locked_at=NULL WHERE id=?`)
      .run(String(err?.message || err), targetId);
  }
}

async function runScheduler() {
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT pt.id
    FROM post_targets pt JOIN posts p ON p.id = pt.post_id
    WHERE pt.status='PENDING'
      AND (p.scheduled_at IS NULL OR p.scheduled_at <= ?)
    ORDER BY pt.id ASC LIMIT 10
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

app.get('/api/brand', auth, (_req, res) => res.json(db.prepare('SELECT * FROM brand WHERE id=1').get()));
app.put('/api/brand', auth, (req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE brand SET name=?, slogan=?, address=?, phone=?, opening_hours=?, map_url=? WHERE id=1`)
    .run(b.name || '', b.slogan || '', b.address || '', b.phone || '', b.opening_hours || '', b.map_url || '');
  res.json(db.prepare('SELECT * FROM brand WHERE id=1').get());
});

app.get('/api/templates', auth, (_req, res) => {
  const brand = db.prepare('SELECT * FROM brand WHERE id=1').get();
  const rows = db.prepare('SELECT * FROM templates ORDER BY id').all().map(t => ({ ...t, rendered: hydratedTemplate(t.content, brand) }));
  res.json(rows);
});

app.post('/api/upload', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa có ảnh hợp lệ' });
  const url = `${publicBase(req)}/uploads/${encodeURIComponent(req.file.filename)}`;
  res.json({ path: req.file.path, url });
});

app.get('/api/posts', auth, (_req, res) => {
  const posts = db.prepare('SELECT * FROM posts ORDER BY id DESC LIMIT 200').all();
  const targetsStmt = db.prepare('SELECT * FROM post_targets WHERE post_id=? ORDER BY id');
  res.json(posts.map(p => ({ ...p, targets: targetsStmt.all(p.id) })));
});

app.post('/api/posts', auth, async (req, res) => {
  const content = String(req.body.content || '').trim();
  const platforms = Array.isArray(req.body.platforms) ? req.body.platforms : [];
  const imageUrl = String(req.body.image_url || '').trim() || null;
  let scheduledAt = req.body.scheduled_at ? new Date(req.body.scheduled_at).toISOString() : null;

  if (!content) return res.status(400).json({ error: 'Nội dung bài đăng đang trống' });
  const allowed = platforms.filter(p => ['facebook', 'instagram'].includes(p));
  if (!allowed.length) return res.status(400).json({ error: 'Chọn ít nhất một nền tảng' });
  if (allowed.includes('instagram') && !imageUrl) return res.status(400).json({ error: 'Instagram V1 yêu cầu có ảnh' });

  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO posts(content,image_url,scheduled_at,created_at,updated_at) VALUES(?,?,?,?,?)`)
    .run(content, imageUrl, scheduledAt, now, now);
  const targetStmt = db.prepare(`INSERT INTO post_targets(post_id,platform,status) VALUES(?,?, 'PENDING')`);
  const tx = db.transaction(() => allowed.forEach(p => targetStmt.run(info.lastInsertRowid, p)));
  tx();

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

app.get('/api/health', (_req, res) => res.json({ ok: true, version: 'V1.0.0' }));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`Social Manager V1 listening on :${PORT}`));
