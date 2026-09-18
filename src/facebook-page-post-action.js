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
  const url = String(page.url() || '').toLowerCase();
  if (/\/login(?:\/|\?|$)|\/checkpoint(?:\/|\?|$)|\/two_factor(?:\/|\?|$)|\/recover\//.test(url)) {
    throw Object.assign(new Error('Facebook yêu cầu đăng nhập/xác minh trước khi đăng Page (URL challenge)'), { code: 'WAITING_USER' });
  }

  const passwordVisible = await page.locator('input[type="password"]').first()
    .isVisible({ timeout: 500 }).catch(() => false);
  const loginEmailVisible = await page.locator('input[name="email"],input[name="pass"]').first()
    .isVisible({ timeout: 500 }).catch(() => false);
  if (passwordVisible || loginEmailVisible) {
    throw Object.assign(new Error('Facebook yêu cầu đăng nhập trước khi đăng Page'), { code: 'WAITING_USER' });
  }

  const challenge = page.locator('[role="dialog"],main').filter({
    hasText: /security check|two[- ]factor|enter.*code|authentication code|xác minh danh tính|nhập mã xác nhận|mã xác thực|captcha/i
  }).first();
  if (await challenge.isVisible({ timeout: 700 }).catch(() => false)) {
    throw Object.assign(new Error('Facebook yêu cầu xác minh bảo mật trước khi đăng Page'), { code: 'WAITING_USER' });
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
  await page.waitForTimeout(2200);
  await assertNoCheckpoint(page);

  // Idempotency guard: if the beginning of the exact message is already visible
  // on the recent Page timeline, treat the job as already completed.
  const dedupeMarker = String(payload.dedupe_marker || payload.message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);
  if (dedupeMarker) {
    for (const y of [0, 650, 1300, 2100]) {
      await page.evaluate(v => window.scrollTo(0, v), y).catch(() => {});
      await sleep(550);
      const body = String(await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (body.includes(dedupeMarker)) {
        return {
          ok: true,
          verified: true,
          already_present: true,
          page_name: target.name || payload.page_name || '',
          page_url: target.url,
          current_url: page.url()
        };
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await sleep(350);
  }

  const opened = await clickFirst(page, [
    p => p.getByRole('button', { name: /^bạn đang nghĩ gì\?$|^what.?s on your mind\??$/i }),
    '[role="button"]:has-text("Bạn đang nghĩ gì?")',
    '[role="button"]:has-text("Chia sẻ suy nghĩ")',
    '[role="button"]:has-text("Tạo bài viết")'
  ], 4500);
  if (!opened) throw Object.assign(new Error('Không mở được hộp tạo bài trên Page'), { code: 'NEEDS_REVIEW' });

  await sleep(1800);
  let dialog = page.locator('[role="dialog"]').filter({ hasText: /Tạo bài viết|Create post/i }).last();
  if (!(await dialog.isVisible({ timeout: 3000 }).catch(() => false))) dialog = page.locator('[role="dialog"]').last();

  let editor = dialog.getByRole('textbox').last();
  if (!(await editor.isVisible({ timeout: 2500 }).catch(() => false))) {
    editor = dialog.locator('[contenteditable="true"],textarea').last();
  }
  if (!(await editor.isVisible({ timeout: 2500 }).catch(() => false))) {
    throw Object.assign(new Error('Không tìm thấy vùng nhập nội dung bài Page'), { code: 'NEEDS_REVIEW' });
  }

  if (payload.message) {
    await editor.click();
    try {
      await editor.fill(String(payload.message));
    } catch {
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.insertText(String(payload.message));
    }
  }

  let tempImage = null;
  try {
    if (payload.image_url) {
      const dataDir = path.resolve(process.cwd(), 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      tempImage = await downloadImage(payload.image_url, dataDir);

      let input = dialog.locator('input[type="file"][accept*="image" i]').last();
      if (!(await input.count())) input = page.locator('input[type="file"][accept*="image" i]').last();
      if (!(await input.count())) input = page.locator('input[type="file"]').last();
      await input.setInputFiles(tempImage, { timeout: 7000 });
      await sleep(2200);
    }

    // Current Facebook Page composer is commonly two-step: content -> Tiếp -> Đăng.
    let next = dialog.getByRole('button', { name: /^(Tiếp|Next)$/i }).last();
    if (!(await next.isVisible({ timeout: 2000 }).catch(() => false))) {
      next = page.getByRole('button', { name: /^(Tiếp|Next)$/i }).last();
    }
    if (await next.isVisible({ timeout: 1500 }).catch(() => false)) {
      for (let i = 0; i < 8; i += 1) {
        if (await next.isEnabled().catch(() => false)) break;
        await sleep(500);
      }
      if (!(await next.isEnabled().catch(() => false))) {
        throw Object.assign(new Error('Nút Tiếp chưa khả dụng sau khi nhập nội dung'), { code: 'NEEDS_REVIEW' });
      }
      await next.click({ timeout: 4000 });
      await sleep(2200);
      dialog = page.locator('[role="dialog"]').last();
    }

    let postButton = dialog.getByRole('button', { name: /^(Đăng|Post)$/i }).last();
    if (!(await postButton.isVisible({ timeout: 3000 }).catch(() => false))) {
      postButton = page.getByRole('button', { name: /^(Đăng|Post)$/i }).last();
    }
    if (!(await postButton.isVisible({ timeout: 3000 }).catch(() => false)) ||
        !(await postButton.isEnabled().catch(() => false))) {
      throw Object.assign(new Error('Không tìm thấy nút Đăng khả dụng của Page'), { code: 'NEEDS_REVIEW' });
    }

    if (payload.dry_run === true) {
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(500);
      return {
        ok: true,
        dry_run: true,
        ready_to_post: true,
        verified_composer: true,
        image_attached: Boolean(payload.image_url),
        page_name: target.name || payload.page_name || '',
        page_url: target.url,
        current_url: page.url()
      };
    }

    await postButton.click({ timeout: 4000 });
    await sleep(5000);
    await assertNoCheckpoint(page);

    // Require a real post-verification signal before reporting DONE.
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(3000);
    const marker = String(payload.message || '').replace(/\s+/g, ' ').trim().slice(0, 42);
    let verified = !marker;
    for (const y of [0, 700, 1400, 2200]) {
      await page.evaluate(v => window.scrollTo(0, v), y).catch(() => {});
      await sleep(650);
      const body = String(await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (marker && body.includes(marker)) { verified = true; break; }
    }
    if (!verified) {
      throw Object.assign(new Error('Facebook đã nhận thao tác Đăng nhưng chưa xác minh thấy bài trên timeline'), { code: 'NEEDS_REVIEW' });
    }

    return {
      ok: true,
      verified: true,
      page_name: target.name || payload.page_name || '',
      page_url: target.url,
      current_url: page.url()
    };
  } finally {
    if (tempImage) { try { fs.unlinkSync(tempImage); } catch {} }
  }
}
