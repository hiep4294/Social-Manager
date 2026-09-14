import fs from 'node:fs';
import path from 'node:path';
import { findFacebookAsset } from './group-monitor-core.js';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function clickFirst(page, selectors, timeout = 3000) {
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

async function fillFirst(page, selectors, value, timeout = 3500) {
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

async function assertNoCheckpoint(page) {
  const url = page.url();
  const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
  if (/\/login|\/checkpoint|\/two_factor/.test(url) || /captcha|security check|xác minh|mã xác nhận|two-factor|checkpoint/.test(body)) {
    throw Object.assign(new Error('Facebook yêu cầu đăng nhập/xác minh trước khi đăng Page'), { code: 'WAITING_USER' });
  }
}

function resolvePageTarget(db, payload = {}) {
  if (payload.page_url) return { url: String(payload.page_url), name: String(payload.page_name || '') };
  if (payload.page_name) {
    const asset = findFacebookAsset(db, { assetType: 'PAGE', name: payload.page_name });
    if (asset) return { url: asset.url, name: asset.name };
  }
  throw Object.assign(new Error('Không xác định được Facebook Page đích'), { code: 'NEEDS_REVIEW' });
}

async function downloadImage(imageUrl, targetDir) {
  const response = await fetch(imageUrl, { headers: { 'User-Agent': 'Social-Manager-FoodNetwork/1.9' } });
  if (!response.ok) throw new Error(`Không tải được ảnh HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.startsWith('image/')) throw new Error('URL không trả về dữ liệu ảnh');
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  const file = path.join(targetDir, `fb-page-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

export async function executePostPage(page, payload, db) {
  const target = resolvePageTarget(db, payload);
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await assertNoCheckpoint(page);

  const opened = await clickFirst(page, [
    p => p.getByText(/create a post|tạo bài viết|what's on your mind|bạn đang nghĩ gì/i),
    '[role="button"]:has-text("Create a post")',
    '[role="button"]:has-text("Tạo bài viết")',
    '[role="button"]:has-text("Bạn đang nghĩ gì")'
  ], 4500);
  if (!opened) throw Object.assign(new Error('Không mở được hộp tạo bài trên Page; Facebook có thể đã đổi giao diện'), { code: 'NEEDS_REVIEW' });
  await sleep(1000);

  const filled = await fillFirst(page, [
    p => p.getByRole('textbox', { name: /create a post|tạo bài viết|what's on your mind|bạn đang nghĩ gì/i }),
    '[role="dialog"] [contenteditable="true"]',
    '[contenteditable="true"]'
  ], payload.message || '', 4000);
  if (!filled && payload.message) throw Object.assign(new Error('Không tìm thấy vùng nhập nội dung bài Page'), { code: 'NEEDS_REVIEW' });

  let tempImage = null;
  try {
    if (payload.image_url) {
      const dataDir = path.resolve(process.cwd(), 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      tempImage = await downloadImage(payload.image_url, dataDir);
      let input = page.locator('[role="dialog"] input[type="file"][accept*="image" i]').last();
      if (!(await input.count())) input = page.locator('input[type="file"][accept*="image" i]').last();
      if (!(await input.count())) input = page.locator('input[type="file"]').last();
      await input.setInputFiles(tempImage, { timeout: 7000 });
      await sleep(2200);
    }

    const posted = await clickFirst(page, [
      p => p.getByRole('button', { name: /^post$|^đăng$/i }),
      '[role="dialog"] button:has-text("Post")',
      '[role="dialog"] button:has-text("Đăng")'
    ], 5000);
    if (!posted) throw Object.assign(new Error('Không tìm thấy nút Đăng của Page'), { code: 'NEEDS_REVIEW' });
    await sleep(3000);
    await assertNoCheckpoint(page);
    return { ok: true, page_name: target.name || payload.page_name || '', page_url: target.url, current_url: page.url() };
  } finally {
    if (tempImage) { try { fs.unlinkSync(tempImage); } catch {} }
  }
}
