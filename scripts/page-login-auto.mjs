import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = process.cwd();
const profileDir = process.env.FB_OPERATOR_PROFILE_DIR || path.join(root, 'data', 'facebook-browser-profile');

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
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find(x => x && fs.existsSync(x)) || null;
}

const browserPath = detectBrowserPath();
if (!browserPath) {
  console.error('Không tìm thấy Google Chrome/Chromium.');
  process.exit(2);
}

fs.mkdirSync(profileDir, { recursive: true });
console.log('PAGE_LOGIN_AUTO=OPENING');

const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: browserPath,
  headless: false,
  viewport: { width: 1440, height: 980 },
  locale: process.env.FB_OPERATOR_LOCALE || 'vi-VN',
  args: ['--disable-dev-shm-usage']
});

const page = context.pages()[0] || await context.newPage();
await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});

const deadline = Date.now() + Math.max(60_000, Number(process.env.FB_LOGIN_WAIT_MS || 10 * 60 * 1000));
let authenticated = false;

while (Date.now() < deadline) {
  const url = String(page.url() || '').toLowerCase();
  const cookies = await context.cookies('https://www.facebook.com/').catch(() => []);
  const hasUserCookie = cookies.some(c => c.name === 'c_user' && String(c.value || '').trim());
  const blocked = /\/checkpoint|\/two_factor/.test(url);
  if (hasUserCookie && !blocked) {
    authenticated = true;
    break;
  }
  await page.waitForTimeout(1000);
}

if (!authenticated) {
  console.error('PAGE_LOGIN_AUTO=TIMEOUT');
  await context.close().catch(() => {});
  process.exit(3);
}

console.log('PAGE_LOGIN_AUTO=AUTHENTICATED');
await page.waitForTimeout(1800);
await context.close();
console.log('PAGE_LOGIN_AUTO=CLOSED');
