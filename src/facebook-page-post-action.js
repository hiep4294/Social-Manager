import fs from 'node:fs';
import path from 'node:path';
import { findFacebookAsset } from './group-monitor-core.js';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function clickFirst(page, selectors, timeout = 3000) {
  for (const selector of selectors) {
    try {
      const locator = typeof selector === 'string' ? page.locator(selector) : selector(page);
      const count = Math.min(30, await locator.count().catch(() => 0));
      for (let i = 0; i < count; i += 1) {
        const candidate = locator.nth(i);
        const visible = await candidate.isVisible({ timeout: Math.min(timeout, 700) }).catch(() => false);
        if (!visible) continue;
        const enabled = await candidate.isEnabled().catch(() => true);
        if (!enabled) continue;
        await candidate.click({ timeout });
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

  // Idempotency guard. For media jobs, marker text alone is not enough:
  // the existing post must also contain real media or a text-only partial
  // publish could be mistaken for success on a retry.
  const dedupeMarker = String(payload.dedupe_marker || payload.message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);

  if (dedupeMarker) {
    for (const y of [0, 650, 1300, 2100, 3200]) {
      await page.evaluate(v => window.scrollTo(0, v), y).catch(() => {});
      await sleep(550);

      const articles = page.locator('[role="article"]');
      const articleCount = Math.min(50, await articles.count().catch(() => 0));

      for (let i = 0; i < articleCount; i += 1) {
        const article = articles.nth(i);
        const text = String(await article.innerText().catch(() => ''))
          .replace(/\s+/g, ' ');

        if (!text.includes(dedupeMarker)) continue;

        let mediaVerified = !payload.image_url;

        if (payload.image_url) {
          const images = article.locator('img');
          const imageCount = Math.min(30, await images.count().catch(() => 0));

          for (let j = 0; j < imageCount && !mediaVerified; j += 1) {
            const dims = await images.nth(j).evaluate(img => {
              const rect = img.getBoundingClientRect();
              return {
                naturalWidth: Number(img.naturalWidth || 0),
                naturalHeight: Number(img.naturalHeight || 0),
                width: Number(rect.width || 0),
                height: Number(rect.height || 0)
              };
            }).catch(() => null);

            if (!dims) continue;

            if (
              (dims.naturalWidth >= 300 && dims.naturalHeight >= 180) ||
              (dims.width >= 300 && dims.height >= 180)
            ) {
              mediaVerified = true;
            }
          }

          if (!mediaVerified) {
            const roleImages = article.locator('[role="img"]');
            const roleCount = Math.min(30, await roleImages.count().catch(() => 0));

            for (let j = 0; j < roleCount && !mediaVerified; j += 1) {
              const dims = await roleImages.nth(j).evaluate(el => {
                const rect = el.getBoundingClientRect();
                return {
                  width: Number(rect.width || 0),
                  height: Number(rect.height || 0)
                };
              }).catch(() => null);

              if (dims && dims.width >= 300 && dims.height >= 180) {
                mediaVerified = true;
              }
            }
          }

          if (!mediaVerified) {
            const mediaLinks = article.locator(
              'a[href*="/photo/"],' +
              'a[href*="/photos/"],' +
              'a[href*="photo.php?fbid="],' +
              'a[href*="media/set"]'
            );

            mediaVerified = (await mediaLinks.count().catch(() => 0)) > 0;
          }
        }

        if (!mediaVerified) continue;

        return {
          ok: true,
          verified: true,
          already_present: true,
          media_verified: Boolean(payload.image_url),
          page_name: target.name || payload.page_name || '',
          page_url: target.url,
          current_url: page.url()
        };
      }

      if (!payload.image_url) {
        const body = String(await page.locator('body').innerText().catch(() => ''))
          .replace(/\s+/g, ' ');

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
    }

    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await sleep(350);
  }

  // Facebook changes the exact composer label frequently and may render
  // hidden duplicate controls before the visible one.
  let opened = await clickFirst(page, [
    p => p.getByRole('button', {
      name: /bạn đang nghĩ gì|chia sẻ suy nghĩ|tạo bài viết|viết bài|bạn muốn chia sẻ gì|create post|create a post|write a post|what.?s on your mind/i
    }),
    p => p.locator('button,[role="button"],[tabindex="0"]').filter({
      hasText: /bạn đang nghĩ gì|chia sẻ suy nghĩ|tạo bài viết|viết bài|bạn muốn chia sẻ gì|create post|create a post|write a post|what.?s on your mind/i
    }),
    '[aria-label*="Tạo bài viết" i]',
    '[aria-label*="Viết bài" i]',
    '[aria-label*="Create post" i]',
    '[aria-label*="Write a post" i]'
  ], 3500);

  if (!opened) {
    const controls = page.locator('button,[role="button"],[tabindex="0"]');
    const count = Math.min(120, await controls.count().catch(() => 0));

    for (let i = 0; i < count && !opened; i += 1) {
      const control = controls.nth(i);
      if (!(await control.isVisible({ timeout: 200 }).catch(() => false))) continue;

      const text = String(await control.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      const aria = String(await control.getAttribute('aria-label').catch(() => '')).replace(/\s+/g, ' ').trim();
      const label = (text + ' ' + aria).trim();

      if (!/bạn đang nghĩ gì|chia sẻ suy nghĩ|tạo bài viết|viết bài|bạn muốn chia sẻ gì|create post|create a post|write a post|what.?s on your mind/i.test(label)) continue;
      if (!(await control.isEnabled().catch(() => true))) continue;

      await control.click({ timeout: 3000 });
      opened = true;
    }
  }

  if (!opened) {
    throw Object.assign(new Error('Không mở được hộp tạo bài trên Page'), { code: 'NEEDS_REVIEW' });
  }

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

      // Use the actual Photo/Video control and its filechooser event. Facebook
      // keeps several hidden file inputs on the page; selecting an arbitrary
      // input can show a temporary preview but submit a text-only story.
      let mediaButton = dialog.getByRole('button', {
        name: /^(Ảnh\/video|Photo\/video|Photo\/Video)$/i
      }).last();

      if (!(await mediaButton.isVisible({ timeout: 1200 }).catch(() => false))) {
        mediaButton = dialog.locator(
          '[aria-label="Ảnh/video" i],' +
          '[aria-label="Photo/video" i],' +
          '[aria-label="Photo/Video" i]'
        ).last();
      }

      if (!(await mediaButton.isVisible({ timeout: 1200 }).catch(() => false))) {
        mediaButton = dialog.locator('button,[role="button"]').filter({
          hasText: /Ảnh\/video|Photo\/video/i
        }).last();
      }

      if (!(await mediaButton.isVisible({ timeout: 1500 }).catch(() => false))) {
        throw Object.assign(
          new Error('Không tìm thấy nút Ảnh/video trong composer của Page'),
          { code: 'NEEDS_REVIEW' }
        );
      }

      const chooserPromise = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
      await mediaButton.click({ timeout: 4000 });
      const chooser = await chooserPromise;

      if (chooser) {
        await chooser.setFiles(tempImage);
      } else {
        // Conservative fallback only inside the active composer dialog.
        let input = dialog.locator('input[type="file"][accept*="image" i]').last();
        if (!(await input.count())) input = dialog.locator('input[type="file"]').last();

        if (!(await input.count())) {
          throw Object.assign(
            new Error('Nút Ảnh/video không mở filechooser và composer không có input ảnh'),
            { code: 'NEEDS_REVIEW' }
          );
        }

        await input.setInputFiles(tempImage, { timeout: 7000 });
      }

      // Wait for a stable media preview in the composer, not merely a file
      // selected on a hidden input. Require two consecutive stable checks.
      let mediaReady = false;
      let stableChecks = 0;

      for (let attempt = 0; attempt < 40 && !mediaReady; attempt += 1) {
        const attachmentSignals = dialog.locator(
          '[aria-label*="Chỉnh sửa file phương tiện" i],' +
          '[aria-label*="Gỡ file đính kèm" i],' +
          '[aria-label*="Edit media" i],' +
          '[aria-label*="Remove attachment" i]'
        );

        const signalCount = Math.min(12, await attachmentSignals.count().catch(() => 0));
        let attachmentVisible = false;

        for (let i = 0; i < signalCount; i += 1) {
          if (await attachmentSignals.nth(i).isVisible({ timeout: 120 }).catch(() => false)) {
            attachmentVisible = true;
            break;
          }
        }

        const previews = dialog.locator('img,[role="img"]');
        const previewCount = Math.min(40, await previews.count().catch(() => 0));
        let largePreviewVisible = false;

        for (let i = 0; i < previewCount; i += 1) {
          const dims = await previews.nth(i).evaluate(el => {
            const rect = el.getBoundingClientRect();
            const naturalWidth = 'naturalWidth' in el ? Number(el.naturalWidth || 0) : 0;
            const naturalHeight = 'naturalHeight' in el ? Number(el.naturalHeight || 0) : 0;
            return {
              width: Number(rect.width || 0),
              height: Number(rect.height || 0),
              naturalWidth,
              naturalHeight
            };
          }).catch(() => null);

          if (!dims) continue;
          if (
            (dims.naturalWidth >= 300 && dims.naturalHeight >= 180) ||
            (dims.width >= 300 && dims.height >= 180)
          ) {
            largePreviewVisible = true;
            break;
          }
        }

        const progress = dialog.locator('[role="progressbar"],[aria-busy="true"]');
        const progressCount = Math.min(12, await progress.count().catch(() => 0));
        let progressVisible = false;

        for (let i = 0; i < progressCount; i += 1) {
          if (await progress.nth(i).isVisible({ timeout: 100 }).catch(() => false)) {
            progressVisible = true;
            break;
          }
        }

        if (attachmentVisible && largePreviewVisible && !progressVisible) {
          stableChecks += 1;
        } else {
          stableChecks = 0;
        }

        if (stableChecks >= 2) {
          mediaReady = true;
          break;
        }

        await sleep(500);
      }

      if (!mediaReady) {
        throw Object.assign(
          new Error('Ảnh chưa được xác nhận là attachment thật trong composer; dừng trước khi Đăng'),
          { code: 'NEEDS_REVIEW' }
        );
      }

      await sleep(1500);
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
    }

    // Photo posts can take several seconds to finish media processing after
    // Next. Poll for the real enabled Post button instead of assuming a fixed
    // 2.2 second transition.
    let finalDialog = null;
    let postButton = null;

    for (let attempt = 0; attempt < 20 && !postButton; attempt += 1) {
      const finalDialogs = page.locator('[role="dialog"]');
      const finalDialogCount = Math.min(15, await finalDialogs.count().catch(() => 0));

      for (let i = 0; i < finalDialogCount && !postButton; i += 1) {
        const candidateDialog = finalDialogs.nth(i);
        if (!(await candidateDialog.isVisible({ timeout: 250 }).catch(() => false))) continue;

        const buttons = candidateDialog.getByRole('button', { name: /^(Đăng|Post)$/i });
        const buttonCount = Math.min(12, await buttons.count().catch(() => 0));

        for (let j = 0; j < buttonCount; j += 1) {
          const candidate = buttons.nth(j);
          const visible = await candidate.isVisible({ timeout: 250 }).catch(() => false);
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
        const buttonCount = Math.min(30, await buttons.count().catch(() => 0));

        for (let i = 0; i < buttonCount; i += 1) {
          const candidate = buttons.nth(i);
          const visible = await candidate.isVisible({ timeout: 250 }).catch(() => false);
          const enabled = await candidate.isEnabled().catch(() => false);
          if (visible && enabled) {
            postButton = candidate;
            break;
          }
        }
      }

      if (!postButton) await sleep(500);
    }

    if (!postButton) {
      throw Object.assign(
        new Error('Không tìm thấy nút Đăng khả dụng của Page sau khi chờ media xử lý'),
        { code: 'NEEDS_REVIEW' }
      );
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

    // Diagnostic-only mode: use Chrome DevTools Protocol Fetch interception.
    // Facebook may send publish traffic through a Service Worker, which
    // page.route() cannot reliably intercept. CDP lets us pause the exact
    // publish request, inspect its variables, then abort it before Facebook
    // can create the story.
    if (payload.diagnostic_capture_graphql === true) {
      const captured = [];
      const marker = String(payload.dedupe_marker || payload.message || '');
      const armedAt = Date.now();
      const cdp = await page.context().newCDPSession(page);

      const analyzeMedia = variablesRaw => {
        let variables = {};
        try { variables = JSON.parse(String(variablesRaw || '{}')); } catch {}

        const hints = [];

        const walk = (value, currentPath = '$', depth = 0) => {
          if (depth > 12 || hints.length >= 100) return;

          if (Array.isArray(value)) {
            value.slice(0, 30).forEach((item, index) => {
              walk(item, `${currentPath}[${index}]`, depth + 1);
            });
            return;
          }

          if (!value || typeof value !== 'object') return;

          for (const [key, child] of Object.entries(value)) {
            const nextPath = `${currentPath}.${key}`;

            if (/photo|image|media|attachment|upload|asset/i.test(key)) {
              let meaningful = false;
              let summary = '';

              if (Array.isArray(child)) {
                meaningful = child.length > 0;
                summary = `array(${child.length})`;
              } else if (child && typeof child === 'object') {
                const keys = Object.keys(child);
                meaningful = keys.length > 0;
                summary = `object(${keys.slice(0, 15).join(',')})`;
              } else {
                const text = String(child ?? '').trim();
                meaningful = Boolean(text && text !== 'false' && text !== '0' && text !== 'null');
                summary = text.slice(0, 180);
              }

              hints.push({
                path: nextPath,
                meaningful,
                summary
              });
            }

            walk(child, nextPath, depth + 1);
            if (hints.length >= 100) break;
          }
        };

        walk(variables);

        return {
          has_media_reference: hints.some(item => item.meaningful),
          media_hints: hints
        };
      };

      const pausedHandler = async event => {
        const request = event.request || {};
        const requestId = event.requestId;

        try {
          const method = String(request.method || '');
          const postData = String(request.postData || '');

          if (method !== 'POST') {
            await cdp.send('Fetch.continueRequest', { requestId });
            return;
          }

          const params = new URLSearchParams(postData);
          const friendlyName = String(params.get('fb_api_req_friendly_name') || '');
          const docId = String(params.get('doc_id') || '');
          const variablesRaw = String(params.get('variables') || '');

          const markerInRequest =
            Boolean(marker) &&
            (
              variablesRaw.includes(marker) ||
              postData.includes(marker) ||
              postData.includes(encodeURIComponent(marker))
            );

          const looksLikePublish =
            markerInRequest ||
            friendlyName === 'ComposerStoryCreateMutation';

          if (!looksLikePublish) {
            await cdp.send('Fetch.continueRequest', { requestId });
            return;
          }

          const media = analyzeMedia(variablesRaw);

          captured.push({
            elapsed_ms: Date.now() - armedAt,
            url: String(request.url || ''),
            friendly_name: friendlyName,
            doc_id: docId,
            marker_in_request: markerInRequest,
            variables_length: variablesRaw.length,
            has_media_reference: media.has_media_reference,
            media_hints: media.media_hints
          });

          await cdp.send('Fetch.failRequest', {
            requestId,
            errorReason: 'Aborted'
          });
        } catch {
          await cdp.send('Fetch.continueRequest', { requestId }).catch(() => {});
        }
      };

      cdp.on('Fetch.requestPaused', pausedHandler);

      await cdp.send('Fetch.enable', {
        patterns: [
          { urlPattern: '*facebook.com/*', resourceType: 'XHR', requestStage: 'Request' },
          { urlPattern: '*facebook.com/*', resourceType: 'Fetch', requestStage: 'Request' }
        ]
      });

      await postButton.click({ timeout: 4000 });

      let interceptionDismissed = false;

      for (let attempt = 0; attempt < 36; attempt += 1) {
        const dialogsAfterPost = page.locator('[role="dialog"]');
        const dialogCount = Math.min(15, await dialogsAfterPost.count().catch(() => 0));

        for (let i = 0; i < dialogCount && !interceptionDismissed; i += 1) {
          const candidateDialog = dialogsAfterPost.nth(i);
          if (!(await candidateDialog.isVisible({ timeout: 200 }).catch(() => false))) continue;

          const dialogText = String(await candidateDialog.innerText().catch(() => ''));
          if (!/Trò chuyện trực tiếp với mọi người|Gọi ngay|chat with people|call now/i.test(dialogText)) continue;

          const dismissButtons = candidateDialog.getByRole('button', {
            name: /^(Lúc khác|Để sau|Not now|Skip|Maybe later|Later)$/i
          });

          const dismissCount = Math.min(10, await dismissButtons.count().catch(() => 0));

          for (let j = 0; j < dismissCount; j += 1) {
            const dismissButton = dismissButtons.nth(j);
            const visible = await dismissButton.isVisible({ timeout: 200 }).catch(() => false);
            const enabled = await dismissButton.isEnabled().catch(() => false);
            if (!visible || !enabled) continue;

            await dismissButton.click({ timeout: 3000 }).catch(() => {});
            interceptionDismissed = true;
            break;
          }
        }

        if (captured.length > 0) break;
        await sleep(300);
      }

      // Keep the CDP interceptor armed briefly after the UI interaction in
      // case Facebook submits asynchronously after dismissing the promotion.
      for (let attempt = 0; attempt < 20 && captured.length === 0; attempt += 1) {
        await sleep(250);
      }

      await cdp.send('Fetch.disable').catch(() => {});
      cdp.off('Fetch.requestPaused', pausedHandler);
      await cdp.detach().catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});

      const diagnosticDir = path.resolve(process.cwd(), 'data');
      fs.mkdirSync(diagnosticDir, { recursive: true });
      const diagnosticFile = path.join(diagnosticDir, 'facebook-publish-graphql-diagnostic.json');

      fs.writeFileSync(
        diagnosticFile,
        JSON.stringify({
          captured_at: new Date().toISOString(),
          page_url: target.url,
          requested_image: Boolean(payload.image_url),
          dedupe_marker: marker,
          publish_aborted: captured.length > 0,
          interception_dismissed: interceptionDismissed,
          requests: captured
        }, null, 2),
        'utf8'
      );

      return {
        ok: true,
        dry_run: true,
        diagnostic_capture_graphql: true,
        publish_aborted: captured.length > 0,
        requested_image: Boolean(payload.image_url),
        interception_dismissed: interceptionDismissed,
        captured_count: captured.length,
        captured_requests: captured,
        diagnostic_file: diagnosticFile,
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

          let mediaVerified = !payload.image_url;

          if (payload.image_url) {
            const images = article.locator('img');
            const imageCount = Math.min(30, await images.count().catch(() => 0));

            for (let j = 0; j < imageCount && !mediaVerified; j += 1) {
              const dims = await images.nth(j).evaluate(img => {
                const rect = img.getBoundingClientRect();
                return {
                  naturalWidth: Number(img.naturalWidth || 0),
                  naturalHeight: Number(img.naturalHeight || 0),
                  width: Number(rect.width || 0),
                  height: Number(rect.height || 0)
                };
              }).catch(() => null);

              if (!dims) continue;
              if (
                (dims.naturalWidth >= 300 && dims.naturalHeight >= 180) ||
                (dims.width >= 300 && dims.height >= 180)
              ) {
                mediaVerified = true;
              }
            }

            if (!mediaVerified) {
              const roleImages = article.locator('[role="img"]');
              const roleCount = Math.min(30, await roleImages.count().catch(() => 0));

              for (let j = 0; j < roleCount && !mediaVerified; j += 1) {
                const dims = await roleImages.nth(j).evaluate(el => {
                  const rect = el.getBoundingClientRect();
                  return {
                    width: Number(rect.width || 0),
                    height: Number(rect.height || 0)
                  };
                }).catch(() => null);

                if (dims && dims.width >= 300 && dims.height >= 180) {
                  mediaVerified = true;
                }
              }
            }

            if (!mediaVerified) {
              const mediaLinks = article.locator(
                'a[href*="/photo/"],' +
                'a[href*="/photos/"],' +
                'a[href*="photo.php?fbid="],' +
                'a[href*="media/set"]'
              );
              mediaVerified = (await mediaLinks.count().catch(() => 0)) > 0;
            }
          }

          if (!mediaVerified) continue;

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

        // Text-only fallback is valid only when no media was requested.
        if (!payload.image_url && marker && body.includes(marker)) {
          verified = true;
          break;
        }
      }
    }

    if (!verified) {
      throw Object.assign(
        new Error(
          payload.image_url
            ? 'ComposerStoryCreateMutation thành công nhưng chưa xác minh thấy bài kèm ảnh trên timeline; không tự retry để tránh đăng trùng'
            : 'ComposerStoryCreateMutation thành công nhưng chưa xác minh thấy bài trên timeline; không tự retry để tránh đăng trùng'
        ),
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
