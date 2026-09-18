function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pageNameFromTitle(title) {
  return normalizeText(String(title || '')
    .replace(/\s*[|·-]\s*Facebook\s*$/i, '')
    .replace(/^Facebook\s*[|·-]\s*/i, ''));
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
  await page.waitForTimeout(1800);
  const state = await checkpointState(page);
  if (state.blocked) {
    const error = new Error(`Facebook yêu cầu đăng nhập/xác minh: ${state.reason}`);
    error.code = 'WAITING_USER';
    throw error;
  }
}

async function clickFirst(page, factories, timeout = 3000) {
  for (const factory of factories) {
    try {
      const locator = typeof factory === 'string' ? page.locator(factory) : factory(page);
      if (await locator.first().isVisible({ timeout })) {
        await locator.first().click({ timeout });
        return true;
      }
    } catch {}
  }
  return false;
}

async function fillFirst(page, factories, value, timeout = 3000) {
  if (!String(value || '').trim()) return false;
  for (const factory of factories) {
    try {
      const locator = typeof factory === 'string' ? page.locator(factory) : factory(page);
      if (await locator.first().isVisible({ timeout })) {
        await locator.first().fill(String(value), { timeout });
        return true;
      }
    } catch {}
  }
  return false;
}

function resolvePageUrl(payload = {}) {
  const url = String(payload.page_url || '').trim();
  if (!url) {
    const error = new Error('inspect/edit Page hiện cần page_url');
    error.code = 'NEEDS_REVIEW';
    throw error;
  }
  return url;
}

export async function inspectFacebookPage(page, payload = {}) {
  const requestedUrl = resolvePageUrl(payload);
  await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitStable(page);

  const title = await page.title().catch(() => '');
  const h1 = (await page.locator('h1').allTextContents().catch(() => []))
    .map(normalizeText)
    .filter(Boolean);
  const body = normalizeText(await page.locator('body').innerText().catch(() => '')).slice(0, 5000);
  const pageName = h1[0] || pageNameFromTitle(title) || String(payload.page_name || '').trim();

  const editVisible = await page.getByText(/edit page details|edit details|chỉnh sửa chi tiết trang|chỉnh sửa thông tin/i)
    .first().isVisible({ timeout: 1200 }).catch(() => false);

  return {
    ok: true,
    requested_url: requestedUrl,
    page_url: page.url(),
    page_name: pageName,
    title,
    can_edit: Boolean(editVisible),
    text: body
  };
}

export async function editFacebookPage(page, payload = {}) {
  const inspection = await inspectFacebookPage(page, payload);

  const opened = await clickFirst(page, [
    p => p.getByRole('button', { name: /edit page details|edit details|chỉnh sửa chi tiết trang|chỉnh sửa thông tin/i }),
    p => p.getByText(/edit page details|edit details|chỉnh sửa chi tiết trang|chỉnh sửa thông tin/i),
    'a[href*="about"]'
  ], 4500);

  if (!opened) {
    const error = new Error('Không tìm thấy nút Chỉnh sửa chi tiết Trang; Facebook có thể đã đổi giao diện hoặc tài khoản chưa ở chế độ quản trị Page');
    error.code = 'NEEDS_REVIEW';
    throw error;
  }

  await page.waitForTimeout(1200);
  const changed = [];

  if (payload.bio) {
    const ok = await fillFirst(page, [
      p => p.getByLabel(/bio|tiểu sử|mô tả/i),
      'textarea[placeholder*="bio" i]',
      'textarea[placeholder*="mô tả" i]',
      'textarea'
    ], payload.bio, 3500);
    if (ok) changed.push('bio');
  }

  if (payload.category) {
    const ok = await fillFirst(page, [
      p => p.getByLabel(/category|danh mục|hạng mục/i),
      'input[placeholder*="category" i]',
      'input[placeholder*="danh mục" i]',
      'input[placeholder*="hạng mục" i]'
    ], payload.category, 3000);
    if (ok) {
      await page.waitForTimeout(700);
      await clickFirst(page, [p => p.getByRole('option').first(), '[role="option"]'], 1800);
      changed.push('category');
    }
  }

  if (payload.username) {
    const ok = await fillFirst(page, [
      p => p.getByLabel(/username|tên người dùng/i),
      'input[placeholder*="username" i]',
      'input[placeholder*="tên người dùng" i]'
    ], payload.username, 2500);
    if (ok) changed.push('username');
  }

  if (!changed.length) {
    const error = new Error('Đã mở phần chỉnh sửa nhưng không tìm thấy trường cần cập nhật');
    error.code = 'NEEDS_REVIEW';
    throw error;
  }

  const saved = await clickFirst(page, [
    p => p.getByRole('button', { name: /^(save|lưu|done|xong)$/i }),
    'button:has-text("Save")',
    'button:has-text("Lưu")'
  ], 4000);

  if (!saved) {
    const error = new Error('Đã điền thông tin nhưng không tìm thấy nút Lưu; dừng để tránh thao tác sai');
    error.code = 'NEEDS_REVIEW';
    throw error;
  }

  await page.waitForTimeout(2200);
  const state = await checkpointState(page);
  if (state.blocked) {
    const error = new Error(`Facebook yêu cầu xác minh sau khi lưu: ${state.reason}`);
    error.code = 'WAITING_USER';
    throw error;
  }

  return {
    ok: true,
    page_name: inspection.page_name,
    page_url: page.url(),
    changed
  };
}
