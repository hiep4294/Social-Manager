import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
import { ensureOperatorSchema } from './facebook-operator-core.js';
import {
  canAutoReply,
  classifyGroupItemRisk,
  configureGroupMonitor,
  findFacebookAsset,
  groupItemKey,
  groupMonitorMatches,
  rememberFacebookAsset,
  renderGroupReply,
  stopGroupMonitor
} from './group-monitor-core.js';

const enabled = String(process.env.FB_OPERATOR_ENABLED || '').toLowerCase() === 'true';

function detectBrowserPath() {
  const explicit = String(process.env.FB_OPERATOR_BROWSER_PATH || '').trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find(x => x && fs.existsSync(x)) || null;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clickFirst(page, selectors, timeout = 2500) {
  for (const selector of selectors) {
    try {
      const locator = typeof selector === 'string' ? page.locator(selector) : selector(page);
      if (await locator.first().isVisible({ timeout })) {
        await locator.first().click({ timeout });
        return true;
      }
    } catch {}
  }
  return false;
}

async function fillFirst(page, selectors, value, timeout = 2500) {
  if (!String(value || '').trim()) return false;
  for (const selector of selectors) {
    try {
      const locator = typeof selector === 'string' ? page.locator(selector) : selector(page);
      if (await locator.first().isVisible({ timeout })) {
        await locator.first().fill(String(value), { timeout });
        return true;
      }
    } catch {}
  }
  return false;
}

async function checkpointState(page) {
  const url = page.url();
  const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
  if (/\/login|\/checkpoint|\/two_factor/.test(url)) return { blocked: true, reason: 'LOGIN_OR_CHECKPOINT', url };
  if (/captcha|security check|xác minh|mã xác nhận|two-factor|two factor|checkpoint/.test(body)) {
    return { blocked: true, reason: 'SECURITY_CHECK', url };
  }
  return { blocked: false, url };
}

async function waitStable(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const state = await checkpointState(page);
  if (state.blocked) {
    const error = new Error(`Facebook yêu cầu đăng nhập/xác minh: ${state.reason}`);
    error.code = 'WAITING_USER';
    throw error;
  }
}

function resolveGroupTarget(db, payload = {}) {
  if (payload.group_url) return { url: payload.group_url, name: payload.group_name || '' };
  if (payload.group_name) {
    const asset = findFacebookAsset(db, { assetType: 'GROUP', name: payload.group_name });
    if (!asset) throw Object.assign(new Error(`Chưa biết URL Group "${payload.group_name}". Hãy tham gia hoặc ghi nhớ Group trước.`), { code: 'NEEDS_REVIEW' });
    return { url: asset.url, name: asset.name };
  }
  throw Object.assign(new Error('Thiếu Group đích'), { code: 'NEEDS_REVIEW' });
}

async function executeCreatePage(page, payload, db, brandId) {
  await page.goto('https://www.facebook.com/pages/create', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitStable(page);

  const nameOk = await fillFirst(page, [
    p => p.getByLabel(/page name|tên trang/i),
    'input[placeholder*="Page name" i]',
    'input[placeholder*="Tên Trang" i]'
  ], payload.name);
  if (!nameOk) throw Object.assign(new Error('Không tìm thấy ô Tên Trang; Facebook có thể đã đổi giao diện'), { code: 'NEEDS_REVIEW' });

  await fillFirst(page, [
    p => p.getByLabel(/category|hạng mục|danh mục/i),
    'input[placeholder*="Category" i]',
    'input[placeholder*="Hạng mục" i]'
  ], payload.category || '');
  await page.waitForTimeout(700);
  await clickFirst(page, [p => p.getByRole('option').first(), '[role="option"]']);

  await fillFirst(page, [
    p => p.getByLabel(/bio|tiểu sử|mô tả/i),
    'textarea',
    '[contenteditable="true"]'
  ], payload.bio || '');

  const created = await clickFirst(page, [
    p => p.getByRole('button', { name: /create page|tạo trang/i }),
    'button:has-text("Create Page")',
    'button:has-text("Tạo Trang")'
  ], 4000);
  if (!created) throw Object.assign(new Error('Không tìm thấy nút Tạo Trang; cần kiểm tra giao diện Facebook'), { code: 'NEEDS_REVIEW' });
  await page.waitForTimeout(3500);
  await waitStable(page);
  const url = page.url();
  if (/facebook\.com/i.test(url)) rememberFacebookAsset(db, { assetType: 'PAGE', name: payload.name, url, brandId });
  return { ok: true, url, name: payload.name };
}

async function executeCreateGroup(page, payload, db, brandId) {
  await page.goto('https://www.facebook.com/groups/create', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitStable(page);

  const nameOk = await fillFirst(page, [
    p => p.getByLabel(/group name|tên nhóm/i),
    'input[placeholder*="Group name" i]',
    'input[placeholder*="Tên nhóm" i]'
  ], payload.name);
  if (!nameOk) throw Object.assign(new Error('Không tìm thấy ô Tên nhóm'), { code: 'NEEDS_REVIEW' });

  const privacyClicked = await clickFirst(page, [
    p => p.getByText(/choose privacy|chọn quyền riêng tư/i),
    p => p.getByLabel(/privacy|quyền riêng tư/i)
  ]);
  if (privacyClicked) {
    await page.waitForTimeout(500);
    const wanted = payload.privacy === 'PRIVATE' ? /private|riêng tư/i : /public|công khai/i;
    await clickFirst(page, [p => p.getByRole('option', { name: wanted }), p => p.getByText(wanted)]);
  }

  const created = await clickFirst(page, [
    p => p.getByRole('button', { name: /create|tạo/i }),
    'button:has-text("Create")',
    'button:has-text("Tạo")'
  ], 4000);
  if (!created) throw Object.assign(new Error('Không tìm thấy nút Tạo nhóm'), { code: 'NEEDS_REVIEW' });
  await page.waitForTimeout(3500);
  await waitStable(page);
  const url = page.url();
  if (/facebook\.com\/groups\//i.test(url)) rememberFacebookAsset(db, { assetType: 'GROUP', name: payload.name, url, brandId });
  return { ok: true, url, name: payload.name, privacy: payload.privacy };
}

async function executeJoinGroup(page, payload, db, brandId) {
  const target = resolveGroupTarget(db, payload);
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitStable(page);
  const joined = await clickFirst(page, [
    p => p.getByRole('button', { name: /join group|tham gia nhóm|join/i }),
    'div[role="button"]:has-text("Join group")',
    'div[role="button"]:has-text("Tham gia nhóm")'
  ], 4000);
  if (!joined) throw Object.assign(new Error('Không tìm thấy nút Tham gia nhóm; có thể đã tham gia hoặc nhóm cần quy trình khác'), { code: 'NEEDS_REVIEW' });
  await page.waitForTimeout(1800);
  const name = target.name || payload.group_name || (await page.title().catch(() => 'Facebook Group'));
  rememberFacebookAsset(db, { assetType: 'GROUP', name, url: target.url, brandId });
  return { ok: true, url: page.url(), requested: true, group_name: name };
}

async function downloadImage(imageUrl, targetDir) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Không tải được ảnh HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.startsWith('image/')) throw new Error('URL không trả về dữ liệu ảnh');
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  const file = path.join(targetDir, `fb-group-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

async function executePostGroup(page, payload, db) {
  const target = resolveGroupTarget(db, payload);
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitStable(page);
  const opened = await clickFirst(page, [
    p => p.getByText(/write something|viết gì đó|create a public post|tạo bài viết công khai/i),
    '[role="button"]:has-text("Write something")',
    '[role="button"]:has-text("Viết gì đó")'
  ], 4000);
  if (!opened) throw Object.assign(new Error('Không mở được hộp tạo bài trong Group'), { code: 'NEEDS_REVIEW' });
  await page.waitForTimeout(900);

  const filled = await fillFirst(page, [
    p => p.getByRole('textbox', { name: /create a public post|tạo bài viết|write something|viết gì đó/i }),
    '[role="dialog"] [contenteditable="true"]',
    '[contenteditable="true"]'
  ], payload.message || '', 3500);
  if (!filled && payload.message) throw Object.assign(new Error('Không tìm thấy vùng nhập bài Group'), { code: 'NEEDS_REVIEW' });

  let tempImage = null;
  if (payload.image_url) {
    try {
      tempImage = await downloadImage(payload.image_url, path.join(process.cwd(), 'data'));
      const input = page.locator('input[type="file"]').last();
      await input.setInputFiles(tempImage, { timeout: 5000 });
      await page.waitForTimeout(1800);
    } catch (error) {
      throw Object.assign(new Error(`Không gắn được ảnh vào bài Group: ${String(error?.message || error)}`), { code: 'NEEDS_REVIEW' });
    }
  }

  const posted = await clickFirst(page, [
    p => p.getByRole('button', { name: /^post$|^đăng$/i }),
    '[role="dialog"] button:has-text("Post")',
    '[role="dialog"] button:has-text("Đăng")'
  ], 4000);
  if (!posted) throw Object.assign(new Error('Không tìm thấy nút Đăng trong Group'), { code: 'NEEDS_REVIEW' });
  await page.waitForTimeout(2200);
  if (tempImage) { try { fs.unlinkSync(tempImage); } catch {} }
  return { ok: true, url: page.url(), group_name: target.name || payload.group_name || '' };
}

async function executeCommentGroup(page, payload) {
  await page.goto(payload.post_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitStable(page);
  const filled = await fillFirst(page, [
    p => p.getByRole('textbox', { name: /comment|bình luận/i }),
    '[contenteditable="true"][aria-label*="comment" i]',
    '[contenteditable="true"][aria-label*="bình luận" i]'
  ], payload.message, 4000);
  if (!filled) throw Object.assign(new Error('Không tìm thấy ô bình luận Group'), { code: 'NEEDS_REVIEW' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  return { ok: true, url: page.url() };
}

async function firstGroupPostArticle(page) {
  const articles = page.locator('div[role="feed"] div[role="article"], div[role="article"]');
  const count = Math.min(25, await articles.count().catch(() => 0));
  for (let i = 0; i < count; i += 1) {
    const article = articles.nth(i);
    if (!(await article.isVisible().catch(() => false))) continue;
    const text = String(await article.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (text.length < 8) continue;
    const postLink = article.locator('a[href*="/groups/"][href*="/posts/"]').first();
    if (await postLink.count().catch(() => 0)) return { article, text };
  }
  return null;
}

async function findGroupLikeButton(article) {
  const pressed = article.locator('[role="button"][aria-pressed="true"]');
  const pressedCount = Math.min(30, await pressed.count().catch(() => 0));
  for (let i = 0; i < pressedCount; i += 1) {
    const el = pressed.nth(i);
    const label = `${await el.getAttribute('aria-label').catch(() => '')} ${await el.innerText().catch(() => '')}`.trim();
    if (/\blike\b|thích/i.test(label)) return { state: 'already_liked', locator: el };
  }

  const candidates = [
    article.getByRole('button', { name: /^(like|thích)$/i }),
    article.locator('[role="button"][aria-label="Like" i]'),
    article.locator('[role="button"][aria-label="Thích" i]'),
    article.locator('[role="button"][aria-label*="Like" i]'),
    article.locator('[role="button"][aria-label*="Thích" i]')
  ];
  for (const locator of candidates) {
    const count = Math.min(8, await locator.count().catch(() => 0));
    for (let i = 0; i < count; i += 1) {
      const el = locator.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const label = `${await el.getAttribute('aria-label').catch(() => '')} ${await el.innerText().catch(() => '')}`.trim();
      if (/unlike|remove like|bỏ thích|gỡ.*thích/i.test(label)) return { state: 'already_liked', locator: el };
      if (/\blike\b|thích/i.test(label)) return { state: 'ready', locator: el };
    }
  }
  return null;
}

async function executeLikeFirstGroupPost(page, payload, db) {
  const target = resolveGroupTarget(db, payload);
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitStable(page);
  await page.waitForTimeout(1200);
  const post = await firstGroupPostArticle(page);
  if (!post) throw Object.assign(new Error('Không tìm thấy bài viết đầu tiên trong Group'), { code: 'NEEDS_REVIEW' });
  const like = await findGroupLikeButton(post.article);
  if (!like) throw Object.assign(new Error('Không tìm thấy nút Like/Thích của bài đầu tiên; Facebook có thể đã đổi giao diện'), { code: 'NEEDS_REVIEW' });
  if (like.state === 'already_liked') {
    return { ok: true, already_liked: true, liked: false, group_url: target.url, group_name: target.name || payload.group_name || '' };
  }
  await like.locator.click({ timeout: 5000 });
  await page.waitForTimeout(1200);
  return { ok: true, already_liked: false, liked: true, group_url: target.url, group_name: target.name || payload.group_name || '' };
}

function canonicalGroupPostUrl(raw, base = 'https://www.facebook.com') {
  try {
    const url = new URL(raw, base);
    if (!/facebook\.com$/i.test(url.hostname) && !/\.facebook\.com$/i.test(url.hostname)) return null;
    if (!/\/groups\/[^/]+\/posts\/[^/]+/i.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function collectGroupArticles(page) {
  const locator = page.locator('div[role="feed"] div[role="article"], div[role="article"]');
  const count = Math.min(25, await locator.count().catch(() => 0));
  const items = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    const article = locator.nth(i);
    const text = String(await article.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (text.length < 8) continue;
    const links = article.locator('a[href*="/groups/"][href*="/posts/"]');
    const linkCount = Math.min(12, await links.count().catch(() => 0));
    let postUrl = null;
    for (let j = 0; j < linkCount; j += 1) {
      const href = await links.nth(j).getAttribute('href').catch(() => null);
      postUrl = canonicalGroupPostUrl(href, page.url());
      if (postUrl) break;
    }
    const key = groupItemKey({ postUrl, text });
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, postUrl, text });
  }
  return items;
}

async function executeScanGroup(page, payload, db) {
  const monitor = db.prepare('SELECT * FROM facebook_group_monitors WHERE id=? AND active=1').get(Number(payload.monitor_id));
  if (!monitor) return { ok: true, skipped: true, reason: 'MONITOR_INACTIVE' };

  await page.goto(monitor.group_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitStable(page);
  await page.waitForTimeout(1200);
  const items = await collectGroupArticles(page);
  const matches = [];
  let discovered = 0;
  let review = 0;

  for (const item of items) {
    const existing = db.prepare('SELECT 1 FROM facebook_group_monitor_seen WHERE monitor_id=? AND item_key=?').get(monitor.id, item.key);
    if (existing) continue;
    const matched = groupMonitorMatches(monitor, item.text);
    const risk = matched ? classifyGroupItemRisk(item.text) : 'LOW';
    const reply = matched ? renderGroupReply(monitor, item.text) : '';
    let status = matched ? (risk === 'LOW' ? 'MATCHED' : 'NEEDS_REVIEW') : 'SEEN';
    if (matched && monitor.mode === 'DRAFT') status = risk === 'LOW' ? 'DRAFT' : 'NEEDS_REVIEW';
    db.prepare(`
      INSERT INTO facebook_group_monitor_seen(
        monitor_id,item_key,post_url,text_excerpt,risk,status,reply_text,error,discovered_at,replied_at
      ) VALUES(?,?,?,?,?,?,?,?,?,NULL)
    `).run(monitor.id, item.key, item.postUrl, item.text.slice(0, 1200), risk, status, reply || null, null, nowIso());
    discovered += 1;
    if (status === 'NEEDS_REVIEW') review += 1;
    if (matched && risk === 'LOW' && monitor.mode === 'AUTO' && item.postUrl && reply) matches.push({ ...item, reply });
  }

  const maxPerScan = Math.max(1, Math.min(5, Number(process.env.GROUP_MONITOR_MAX_REPLIES_PER_SCAN || 2)));
  let replied = 0;
  for (const item of matches.slice(0, maxPerScan)) {
    if (!canAutoReply(db, monitor)) break;
    try {
      await executeCommentGroup(page, { post_url: item.postUrl, message: item.reply });
      db.prepare(`
        UPDATE facebook_group_monitor_seen
        SET status='REPLIED',replied_at=?,error=NULL
        WHERE monitor_id=? AND item_key=?
      `).run(nowIso(), monitor.id, item.key);
      replied += 1;
      await sleep(Math.max(5000, Number(process.env.GROUP_MONITOR_REPLY_DELAY_MS || 8000)));
    } catch (error) {
      db.prepare(`
        UPDATE facebook_group_monitor_seen
        SET status='FAILED',error=?
        WHERE monitor_id=? AND item_key=?
      `).run(String(error?.message || error), monitor.id, item.key);
      if (String(error?.code || '') === 'WAITING_USER') throw error;
    }
  }

  const next = new Date(Date.now() + Math.max(60, Number(monitor.poll_seconds || 180)) * 1000).toISOString();
  db.prepare(`
    UPDATE facebook_group_monitors
    SET last_scan_at=?,next_scan_at=?,last_error=NULL,updated_at=?
    WHERE id=?
  `).run(nowIso(), next, nowIso(), monitor.id);

  return {
    ok: true,
    monitor_id: monitor.id,
    group_name: monitor.group_name,
    scanned: items.length,
    discovered,
    auto_replied: replied,
    needs_review: review,
    mode: monitor.mode
  };
}

async function executeJob(page, job, db) {
  const payload = JSON.parse(job.payload_json || '{}');
  switch (job.action) {
    case 'create_page': return executeCreatePage(page, payload, db, job.brand_id);
    case 'create_group': return executeCreateGroup(page, payload, db, job.brand_id);
    case 'join_group': return executeJoinGroup(page, payload, db, job.brand_id);
    case 'post_group': return executePostGroup(page, payload, db);
    case 'comment_group': return executeCommentGroup(page, payload);
    case 'like_first_group_post': return executeLikeFirstGroupPost(page, payload, db);
    case 'remember_group': {
      const asset = rememberFacebookAsset(db, {
        assetType: 'GROUP',
        name: payload.group_name,
        url: payload.group_url,
        brandId: job.brand_id
      });
      return { ok: true, asset_id: asset.id, group_name: asset.name, group_url: asset.url };
    }
    case 'monitor_group': {
      const monitor = configureGroupMonitor(db, { ...payload, brand_id: job.brand_id });
      return { ok: true, monitor_id: monitor.id, group_name: monitor.group_name, mode: monitor.mode, active: Boolean(monitor.active) };
    }
    case 'stop_monitor_group': {
      const monitor = stopGroupMonitor(db, payload);
      return { ok: true, monitor_id: monitor.id, group_name: monitor.group_name, active: Boolean(monitor.active) };
    }
    case 'scan_group': return executeScanGroup(page, payload, db);
    default: throw new Error(`Operator action không hỗ trợ: ${job.action}`);
  }
}

if (!enabled) {
  console.log('Facebook operator: disabled');
} else {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');
  const dataDir = path.join(root, 'data');
  const uploadDir = path.join(root, 'uploads');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(dataDir, 'social-manager.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  ensureOperatorSchema(db);

  const browserPath = detectBrowserPath();
  const headless = String(process.env.FB_OPERATOR_HEADLESS || 'true').toLowerCase() !== 'false';
  const profileDir = process.env.FB_OPERATOR_PROFILE_DIR || path.join(dataDir, 'facebook-browser-profile');
  const pollMs = Math.max(5_000, Number(process.env.FB_OPERATOR_POLL_MS || 10_000));
  const minDelayMs = Math.max(3_000, Number(process.env.FB_OPERATOR_MIN_DELAY_MS || 8_000));
  const statusPath = path.join(root, 'public', 'facebook-operator-status.json');
  let context = null;
  let busy = false;
  let lastActionAt = 0;

  function writeStatus(payload) {
    const queued = db.prepare("SELECT COUNT(*) AS n FROM facebook_operator_jobs WHERE status='QUEUED'").get()?.n || 0;
    const waiting = db.prepare("SELECT COUNT(*) AS n FROM facebook_operator_jobs WHERE status IN ('WAITING_USER','NEEDS_REVIEW')").get()?.n || 0;
    const activeMonitors = db.prepare('SELECT COUNT(*) AS n FROM facebook_group_monitors WHERE active=1').get()?.n || 0;
    const monitorReview = db.prepare("SELECT COUNT(*) AS n FROM facebook_group_monitor_seen WHERE status='NEEDS_REVIEW'").get()?.n || 0;
    try {
      fs.writeFileSync(statusPath, JSON.stringify({
        enabled: true,
        browser_path: browserPath,
        headless,
        profile_dir: profileDir,
        queue: { queued, waiting },
        group_monitor: { active: activeMonitors, needs_review: monitorReview },
        ...payload,
        updated_at: nowIso()
      }, null, 2), 'utf8');
    } catch {}
  }

  async function getContext() {
    if (context) return context;
    if (!browserPath) throw Object.assign(new Error('Không tìm thấy Chrome/Chromium. Hãy cấu hình FB_OPERATOR_BROWSER_PATH.'), { code: 'OPERATOR_UNAVAILABLE' });
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: browserPath,
      headless,
      viewport: { width: 1440, height: 980 },
      locale: process.env.FB_OPERATOR_LOCALE || 'vi-VN',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    return context;
  }

  async function capture(page, jobId) {
    try {
      const filename = `fb-operator-${jobId}-${Date.now()}.png`;
      const target = path.join(uploadDir, filename);
      await page.screenshot({ path: target, fullPage: false });
      const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
      return base ? `${base}/uploads/${encodeURIComponent(filename)}` : null;
    } catch {
      return null;
    }
  }

  async function runOne(job) {
    const gap = Date.now() - lastActionAt;
    if (gap < minDelayMs) await sleep(minDelayMs - gap);
    lastActionAt = Date.now();

    const locked = db.prepare(`
      UPDATE facebook_operator_jobs
      SET status='PROCESSING', attempts=attempts+1, locked_at=?, updated_at=?
      WHERE id=? AND status='QUEUED'
    `).run(nowIso(), nowIso(), job.id);
    if (!locked.changes) return;

    let page = null;
    try {
      const browserRequired = !['remember_group', 'monitor_group', 'stop_monitor_group'].includes(job.action);
      if (browserRequired) {
        const ctx = await getContext();
        page = ctx.pages()[0] || await ctx.newPage();
      }
      const result = await executeJob(page, job, db);
      db.prepare(`
        UPDATE facebook_operator_jobs
        SET status='DONE', result_json=?, error=NULL, screenshot_url=NULL, locked_at=NULL, updated_at=?
        WHERE id=?
      `).run(JSON.stringify(result || {}), nowIso(), job.id);
      writeStatus({ status: 'DONE', job_id: job.id, action: job.action, result });
      console.log(`Facebook operator: DONE job=${job.id} action=${job.action}`);
    } catch (error) {
      const code = String(error?.code || 'FAILED');
      const status = code === 'WAITING_USER' ? 'WAITING_USER' : code === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : code === 'OPERATOR_UNAVAILABLE' ? 'WAITING_USER' : 'FAILED';
      const screenshotUrl = page ? await capture(page, job.id) : null;
      db.prepare(`
        UPDATE facebook_operator_jobs
        SET status=?, error=?, screenshot_url=?, locked_at=NULL, updated_at=?
        WHERE id=?
      `).run(status, String(error?.message || error), screenshotUrl, nowIso(), job.id);
      if (job.action === 'scan_group') {
        try {
          const payload = JSON.parse(job.payload_json || '{}');
          if (payload.monitor_id) db.prepare('UPDATE facebook_group_monitors SET last_error=?,updated_at=? WHERE id=?').run(String(error?.message || error), nowIso(), Number(payload.monitor_id));
        } catch {}
      }
      writeStatus({ status, job_id: job.id, action: job.action, error: String(error?.message || error), screenshot_url: screenshotUrl });
      console.error(`Facebook operator: ${status} job=${job.id}: ${String(error?.message || error)}`);
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const now = nowIso();
      const jobs = db.prepare(`
        SELECT * FROM facebook_operator_jobs
        WHERE status='QUEUED' AND (scheduled_at IS NULL OR scheduled_at <= ?)
        ORDER BY COALESCE(scheduled_at, created_at), created_at
        LIMIT 3
      `).all(now);
      for (const job of jobs) await runOne(job);
      if (!jobs.length) writeStatus({ status: browserPath ? 'IDLE' : 'WAITING_BROWSER' });
    } finally {
      busy = false;
    }
  }

  writeStatus({ status: browserPath ? 'STARTING' : 'WAITING_BROWSER', host: os.hostname() });
  setInterval(() => tick().catch(() => {}), pollMs);
  setTimeout(() => tick().catch(() => {}), 4_000);
  console.log(`Facebook operator: enabled headless=${headless} browser=${browserPath || 'MISSING'}`);
}
