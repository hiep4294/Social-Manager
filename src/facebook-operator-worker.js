import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';
import { ensureOperatorSchema } from './facebook-operator-core.js';

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

async function executeCreatePage(page, payload) {
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
  return { ok: true, url: page.url(), name: payload.name };
}

async function executeCreateGroup(page, payload) {
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
  return { ok: true, url: page.url(), name: payload.name, privacy: payload.privacy };
}

async function executeJoinGroup(page, payload) {
  await page.goto(payload.group_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitStable(page);
  const joined = await clickFirst(page, [
    p => p.getByRole('button', { name: /join group|tham gia nhóm|join/i }),
    'div[role="button"]:has-text("Join group")',
    'div[role="button"]:has-text("Tham gia nhóm")'
  ], 4000);
  if (!joined) throw Object.assign(new Error('Không tìm thấy nút Tham gia nhóm; có thể đã tham gia hoặc nhóm cần quy trình khác'), { code: 'NEEDS_REVIEW' });
  await page.waitForTimeout(1800);
  return { ok: true, url: page.url(), requested: true };
}

async function executePostGroup(page, payload) {
  await page.goto(payload.group_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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

  if (payload.image_url) {
    throw Object.assign(new Error('Đăng ảnh vào Group bằng Browser Operator chưa kích hoạt ở V1.5.0; bài chữ vẫn hỗ trợ'), { code: 'NEEDS_REVIEW' });
  }

  const posted = await clickFirst(page, [
    p => p.getByRole('button', { name: /^post$|^đăng$/i }),
    '[role="dialog"] button:has-text("Post")',
    '[role="dialog"] button:has-text("Đăng")'
  ], 4000);
  if (!posted) throw Object.assign(new Error('Không tìm thấy nút Đăng trong Group'), { code: 'NEEDS_REVIEW' });
  await page.waitForTimeout(2200);
  return { ok: true, url: page.url() };
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

async function executeJob(page, job) {
  const payload = JSON.parse(job.payload_json || '{}');
  switch (job.action) {
    case 'create_page': return executeCreatePage(page, payload);
    case 'create_group': return executeCreateGroup(page, payload);
    case 'join_group': return executeJoinGroup(page, payload);
    case 'post_group': return executePostGroup(page, payload);
    case 'comment_group': return executeCommentGroup(page, payload);
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
    try {
      fs.writeFileSync(statusPath, JSON.stringify({
        enabled: true,
        browser_path: browserPath,
        headless,
        profile_dir: profileDir,
        queue: { queued, waiting },
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
    if (gap < minDelayMs) await new Promise(resolve => setTimeout(resolve, minDelayMs - gap));
    lastActionAt = Date.now();

    const locked = db.prepare(`
      UPDATE facebook_operator_jobs
      SET status='PROCESSING', attempts=attempts+1, locked_at=?, updated_at=?
      WHERE id=? AND status='QUEUED'
    `).run(nowIso(), nowIso(), job.id);
    if (!locked.changes) return;

    let page = null;
    try {
      const ctx = await getContext();
      page = ctx.pages()[0] || await ctx.newPage();
      const result = await executeJob(page, job);
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
