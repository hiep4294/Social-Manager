import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

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
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  return candidates.find(x => x && fs.existsSync(x)) || null;
}

function cleanGroupUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
    if (!/^\/groups\/[^/]+\/?/i.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function checkpointState(page) {
  const url = page.url();
  const body = String(await page.locator('body').innerText().catch(() => '')).toLowerCase();
  if (/\/login|\/checkpoint|\/two_factor/.test(url)) return { blocked: true, reason: 'LOGIN_OR_CHECKPOINT' };
  if (/captcha|security check|xác minh|mã xác nhận|two-factor|two factor|checkpoint/.test(body)) {
    return { blocked: true, reason: 'SECURITY_CHECK' };
  }
  return { blocked: false };
}

async function firstPostArticle(page) {
  const articles = page.locator('div[role="feed"] div[role="article"], div[role="article"]');
  const count = Math.min(20, await articles.count().catch(() => 0));
  for (let i = 0; i < count; i += 1) {
    const article = articles.nth(i);
    if (!(await article.isVisible().catch(() => false))) continue;
    const text = String(await article.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (text.length < 8) continue;
    const postLink = article.locator('a[href*="/groups/"][href*="/posts/"]').first();
    if (await postLink.count().catch(() => 0)) return { article, text };
  }
  for (let i = 0; i < count; i += 1) {
    const article = articles.nth(i);
    if (!(await article.isVisible().catch(() => false))) continue;
    const text = String(await article.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (text.length >= 8) return { article, text };
  }
  return null;
}

async function findLikeButton(article) {
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

const groupUrl = cleanGroupUrl(process.argv[2]);
if (!groupUrl) {
  console.error('Cách dùng: node scripts/like-first-group-post.mjs https://www.facebook.com/groups/GROUP_ID/');
  process.exit(2);
}

const browserPath = detectBrowserPath();
if (!browserPath) {
  console.error('Không tìm thấy Chrome. Có thể đặt FB_OPERATOR_BROWSER_PATH trong .env.');
  process.exit(3);
}

const root = path.resolve(process.cwd());
const profileDir = process.env.FB_OPERATOR_PROFILE_DIR || path.join(root, 'data', 'facebook-browser-profile');
const headless = String(process.env.FB_OPERATOR_HEADLESS || 'false').toLowerCase() === 'true';

const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: browserPath,
  headless,
  viewport: { width: 1440, height: 980 },
  locale: process.env.FB_OPERATOR_LOCALE || 'vi-VN',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2200);

  const checkpoint = await checkpointState(page);
  if (checkpoint.blocked) {
    console.error(`WAITING_USER: Facebook yêu cầu đăng nhập/xác minh (${checkpoint.reason}).`);
    process.exitCode = 4;
  } else {
    const post = await firstPostArticle(page);
    if (!post) {
      console.error('NEEDS_REVIEW: Không tìm thấy bài viết đầu tiên trong Group.');
      process.exitCode = 5;
    } else {
      const like = await findLikeButton(post.article);
      if (!like) {
        console.error('NEEDS_REVIEW: Không tìm thấy nút Like/Thích của bài đầu tiên. Facebook có thể đã đổi giao diện.');
        process.exitCode = 6;
      } else if (like.state === 'already_liked') {
        console.log('ALREADY_LIKED: Bài đầu tiên đã được Like/Thích, không bấm lại để tránh bỏ Like.');
      } else {
        await like.locator.click({ timeout: 5000 });
        await page.waitForTimeout(1200);
        console.log('DONE: Đã Like/Thích bài đầu tiên đang hiển thị trong Group.');
      }
    }
  }
} finally {
  await context.close().catch(() => {});
}
