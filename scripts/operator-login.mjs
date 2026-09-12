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
  console.error('Không tìm thấy Google Chrome/Chromium. Cấu hình FB_OPERATOR_BROWSER_PATH trong .env.');
  process.exit(2);
}

fs.mkdirSync(profileDir, { recursive: true });
console.log(`Facebook operator profile: ${profileDir}`);
console.log('Cửa sổ Chrome sẽ mở. Hãy đăng nhập Facebook thủ công và hoàn tất 2FA/checkpoint nếu có.');
console.log('Social Manager không lưu mật khẩu Facebook. Sau khi thấy trang chủ Facebook, đóng cửa sổ Chrome để lưu phiên.');

const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: browserPath,
  headless: false,
  viewport: { width: 1440, height: 980 },
  locale: process.env.FB_OPERATOR_LOCALE || 'vi-VN',
  args: ['--disable-dev-shm-usage']
});
const page = context.pages()[0] || await context.newPage();
await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
await new Promise(resolve => context.on('close', resolve));
console.log('Đã đóng browser. Phiên Facebook được giữ trong profile cục bộ.');
