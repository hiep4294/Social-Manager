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

  // Facebook can render multiple nested dialogs. Select the visible dialog
  // that actually owns the composer editor instead of relying on .last().
  const dialogs = page.locator('[role="dialog"]');
  const dialogCount = Math.min(12, await dialogs.count().catch(() => 0));

  let dialog = null;
  let editor = null;

  for (let i = 0; i < dialogCount && !editor; i += 1) {
    const candidateDialog = dialogs.nth(i);
    if (!(await candidateDialog.isVisible({ timeout: 700 }).catch(() => false))) continue;

    const candidates = candidateDialog.locator(
      '[role="textbox"][contenteditable="true"],' +
      '[data-lexical-editor="true"][contenteditable="true"],' +
      'textarea'
    );
    const count = Math.min(20, await candidates.count().catch(() => 0));

    for (let j = count - 1; j >= 0; j -= 1) {
      const candidate = candidates.nth(j);
      if (!(await candidate.isVisible({ timeout: 500 }).catch(() => false))) continue;
      const aria = String(await candidate.getAttribute('aria-label').catch(() => ''));
      if (/bình luận|comment/i.test(aria)) continue;
      dialog = candidateDialog;
      editor = candidate;
      break;
    }
  }

  if (!editor) {
    const candidates = page.locator(
      '[role="textbox"][contenteditable="true"],' +
      '[data-lexical-editor="true"][contenteditable="true"],' +
      'textarea'
    );
    const count = Math.min(30, await candidates.count().catch(() => 0));
    for (let i = count - 1; i >= 0; i -= 1) {
      const candidate = candidates.nth(i);
      if (!(await candidate.isVisible({ timeout: 500 }).catch(() => false))) continue;
      const aria = String(await candidate.getAttribute('aria-label').catch(() => ''));
      if (/bình luận|comment/i.test(aria)) continue;
      editor = candidate;
      break;
    }
  }

  if (!editor) {
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
    }

    const finalDialogs = page.locator('[role="dialog"]');
    const finalDialogCount = Math.min(12, await finalDialogs.count().catch(() => 0));

    let finalDialog = null;
    let postButton = null;

    for (let i = 0; i < finalDialogCount && !postButton; i += 1) {
      const candidateDialog = finalDialogs.nth(i);
      if (!(await candidateDialog.isVisible({ timeout: 500 }).catch(() => false))) continue;

      const buttons = candidateDialog.getByRole('button', { name: /^(Đăng|Post)$/i });
      const buttonCount = Math.min(10, await buttons.count().catch(() => 0));

      for (let j = 0; j < buttonCount; j += 1) {
        const candidate = buttons.nth(j);
        const visible = await candidate.isVisible({ timeout: 400 }).catch(() => false);
        const enabled = await candidate.isEnabled().catch(() => false);
        if (visible && enabled) {
          finalDialog = candidateDialog;
          postButton = candidate;
          break;
        }
      }
    }

    if (!postButton) {
      const buttons = page.getByRole('button', { name: /^(Đăng|Post)$/i });
      const buttonCount = Math.min(20, await buttons.count().catch(() => 0));
      for (let i = 0; i < buttonCount; i += 1) {
        const candidate = buttons.nth(i);
        const visible = await candidate.isVisible({ timeout: 400 }).catch(() => false);
        const enabled = await candidate.isEnabled().catch(() => false);
        if (visible && enabled) {
          postButton = candidate;
          break;
        }
      }
    }

    if (!postButton) {
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

    // Register the create-story listener before clicking Post. Facebook can
    // delay the mutation while an optional post-interception dialog is shown.
    const publishMutationPromise = page.waitForResponse(
      response => {
        try {
          if (!response.url().includes('/api/graphql')) return false;
          const request = response.request();
          if (request.method() !== 'POST') return false;
          const params = new URLSearchParams(String(request.postData() || ''));
          return params.get('fb_api_req_friendly_name') === 'ComposerStoryCreateMutation';
        } catch {
          return false;
        }
      },
      { timeout: 45_000 }
    ).catch(() => null);

    await postButton.click({ timeout: 4000 });

    // Some Pages show an optional "Call now" promotion after the first Post
    // click. Dismiss it with "Later/Not now" so Facebook can submit the story.
    let interceptionDismissed = false;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const dialogsAfterPost = page.locator('[role="dialog"]');
      const dialogCount = Math.min(15, await dialogsAfterPost.count().catch(() => 0));

      for (let i = 0; i < dialogCount && !interceptionDismissed; i += 1) {
        const candidateDialog = dialogsAfterPost.nth(i);
        if (!(await candidateDialog.isVisible({ timeout: 250 }).catch(() => false))) continue;

        const dialogText = String(await candidateDialog.innerText().catch(() => ''));
        if (!/Trò chuyện trực tiếp với mọi người|Gọi ngay|chat with people|call now/i.test(dialogText)) continue;

        const dismissButtons = candidateDialog.getByRole('button', {
          name: /^(Lúc khác|Để sau|Not now|Skip|Maybe later|Later)$/i
        });
        const dismissCount = Math.min(10, await dismissButtons.count().catch(() => 0));

        for (let j = 0; j < dismissCount; j += 1) {
          const dismissButton = dismissButtons.nth(j);
          const visible = await dismissButton.isVisible({ timeout: 250 }).catch(() => false);
          const enabled = await dismissButton.isEnabled().catch(() => false);
          if (!visible || !enabled) continue;
          await dismissButton.click({ timeout: 3000 });
          interceptionDismissed = true;
          break;
        }

        if (!interceptionDismissed) {
          const dismissText = candidateDialog.getByText(
            /^(Lúc khác|Để sau|Not now|Skip|Maybe later|Later)$/i
          );
          const count = Math.min(10, await dismissText.count().catch(() => 0));
          for (let j = 0; j < count; j += 1) {
            const candidate = dismissText.nth(j);
            if (await candidate.isVisible().catch(() => false)) {
              await candidate.click({ timeout: 3000 });
              interceptionDismissed = true;
              break;
            }
          }
        }
      }

      if (interceptionDismissed) {
        await sleep(500);
        break;
      }
      await sleep(500);
    }

    const publishResponse = await publishMutationPromise;

    if (!publishResponse) {
      throw Object.assign(
        new Error('Đã bấm Đăng nhưng không nhận được ComposerStoryCreateMutation trong 45 giây; không tự retry để tránh đăng trùng'),
        { code: 'NEEDS_REVIEW' }
      );
    }

    let publishPayload = null;
    let publishErrors = [];
    try {
      let responseText = await publishResponse.text();
      responseText = responseText.replace(/^for\s*\(;;\);\s*/, '');
      publishPayload = JSON.parse(responseText);
      if (Array.isArray(publishPayload?.errors)) publishErrors = publishPayload.errors;
    } catch {}

    if (!publishResponse.ok() || publishErrors.length > 0) {
      const detail = publishErrors
        .slice(0, 3)
        .map(error => String(error?.message || error?.summary || 'GraphQL error'))
        .join(' | ');
      throw Object.assign(
        new Error('ComposerStoryCreateMutation trả lỗi' + (detail ? ': ' + detail : '')),
        { code: 'NEEDS_REVIEW' }
      );
    }

    await sleep(4000);
    await assertNoCheckpoint(page);

    // Verify the exact dedupe marker with reload retries. The Page feed can
    // lag several seconds behind a successful ComposerStoryCreateMutation.
    const marker = String(payload.dedupe_marker || payload.message || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 96);

    let verified = !marker;
    let verifiedUrl = '';

    for (let attempt = 0; attempt < 6 && !verified; attempt += 1) {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await sleep(2500 + attempt * 1000);

      for (const y of [0, 700, 1400, 2200, 3200]) {
        await page.evaluate(v => window.scrollTo(0, v), y).catch(() => {});
        await sleep(550);

        const articles = page.locator('[role="article"]');
        const count = Math.min(50, await articles.count().catch(() => 0));

        for (let i = 0; i < count; i += 1) {
          const article = articles.nth(i);
          const text = String(await article.innerText().catch(() => ''))
            .replace(/\s+/g, ' ');
          if (!marker || !text.includes(marker)) continue;

          verified = true;

          const links = article.locator(
            'a[href*="permalink"],a[href*="story_fbid"],a[href*="/posts/"]'
          );
          const linkCount = Math.min(30, await links.count().catch(() => 0));
          for (let j = 0; j < linkCount; j += 1) {
            const href = await links.nth(j).getAttribute('href').catch(() => null);
            if (href) {
              verifiedUrl = href;
              break;
            }
          }
          break;
        }

        if (verified) break;

        const body = String(await page.locator('body').innerText().catch(() => ''))
          .replace(/\s+/g, ' ');
        if (marker && body.includes(marker)) {
          verified = true;
          break;
        }
      }
    }

    if (!verified) {
      throw Object.assign(
        new Error('ComposerStoryCreateMutation thành công nhưng chưa xác minh thấy bài trên timeline; không tự retry để tránh đăng trùng'),
        { code: 'NEEDS_REVIEW' }
      );
    }

    return {
      ok: true,
      verified: true,
      publish_mutation: 'ComposerStoryCreateMutation',
      post_url: verifiedUrl || null,
      page_name: target.name || payload.page_name || '',
      page_url: target.url,
      current_url: page.url()
    };
  } finally {
    if (tempImage) { try { fs.unlinkSync(tempImage); } catch {} }
  }
}
