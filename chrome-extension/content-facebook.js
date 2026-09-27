function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
}
function textOf(el) { return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim(); }
function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function response(status, result = {}, error = null) { return { ok: status === 'DONE', status, result, error }; }

function checkpoint() {
  const url = location.href.toLowerCase();
  const body = normalize(document.body?.innerText || '');
  if (/\/login|\/checkpoint|\/two_factor/.test(url)) return 'Facebook yêu cầu đăng nhập hoặc checkpoint';
  if (/captcha|security check|xac minh danh tinh|ma xac nhan|two factor|two-factor/.test(body)) return 'Facebook yêu cầu xác minh bảo mật';
  return null;
}

function fieldByPattern(pattern) {
  const fields = [...document.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible);
  return fields.find(el => pattern.test(normalize(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('name') || ''}`))) || null;
}

function setField(el, value) {
  if (!el) return false;
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, String(value)); else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.textContent = String(value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
  }
  return true;
}

function clickableByText(pattern, root = document) {
  const nodes = [...root.querySelectorAll('button,[role="button"],[role="option"]')].filter(visible);
  return nodes.find(el => pattern.test(normalize(textOf(el))) || pattern.test(normalize(el.getAttribute('aria-label') || ''))) || null;
}

async function waitFor(fn, timeoutMs = 15000, intervalMs = 400) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

async function createPage(payload) {
  const blocked = checkpoint();
  if (blocked) return response('WAITING_USER', {}, blocked);
  const name = fieldByPattern(/page name|ten trang/i);
  if (!name) return response('NEEDS_REVIEW', {}, 'Không tìm thấy ô Tên Trang; Facebook có thể đã đổi giao diện');
  setField(name, payload.name || '');

  const category = fieldByPattern(/category|hang muc|danh muc/i);
  if (category && payload.category) {
    setField(category, payload.category);
    await sleep(700);
    const option = [...document.querySelectorAll('[role="option"]')].find(visible);
    if (option) option.click();
  }

  const bio = fieldByPattern(/bio|tieu su|mo ta/i) || [...document.querySelectorAll('textarea')].find(visible);
  if (bio && payload.bio) setField(bio, payload.bio);

  const create = clickableByText(/^(create page|tao trang)$/i) || clickableByText(/create page|tao trang/i);
  if (!create) return response('NEEDS_REVIEW', {}, 'Không tìm thấy nút Tạo Trang');
  create.click();

  const changed = await waitFor(() => !/\/pages\/create/i.test(location.pathname), 25000, 500);
  const after = checkpoint();
  if (after) return response('WAITING_USER', {}, after);
  if (!changed) return response('NEEDS_REVIEW', { current_url: location.href }, 'Đã bấm Tạo Trang nhưng chưa xác minh được Page được tạo');
  return response('DONE', { page_name: payload.name || '', page_url: location.href, verified: true });
}

async function attachImage(imageUrl) {
  if (!imageUrl) return true;
  const input = [...document.querySelectorAll('input[type="file"]')].filter(el => {
    const accept = String(el.getAttribute('accept') || '').toLowerCase();
    return !accept || accept.includes('image');
  }).pop();
  if (!input) throw new Error('Không tìm thấy input tải ảnh của Facebook');
  const r = await fetch(imageUrl, { credentials: 'omit', cache: 'no-store' });
  if (!r.ok) throw new Error(`Không tải được ảnh HTTP ${r.status}`);
  const blob = await r.blob();
  if (!String(blob.type || '').startsWith('image/')) throw new Error('Nguồn ảnh không trả về định dạng image');
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
  const file = new File([blob], `food-${Date.now()}.${ext}`, { type: blob.type || 'image/jpeg' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(2500);
  return true;
}

function postVerified(message) {
  const wanted = normalize(message).slice(0, 70);
  if (!wanted) return true;
  const probe = wanted.slice(0, Math.min(45, wanted.length));
  const articles = [...document.querySelectorAll('[role="article"]')].filter(visible);
  return articles.some(el => normalize(textOf(el)).includes(probe));
}

async function postPage(payload) {
  const blocked = checkpoint();

  if (blocked) {
    return response(
      'WAITING_USER',
      {},
      blocked
    );
  }

  const openerPattern =
    /create a post|tao bai viet|write a post|viet bai viet|what.?s on your mind|ban dang nghi gi|write something|viet gi do/i;

  // Facebook Page th??ng render composer tr? h?n document.load.
  // Kh?ng fail ngay sau 1.5 gi?y.
  const opener = await waitFor(
    () => clickableByText(openerPattern),
    20000,
    500
  );

  if (!opener) {
    const composerCandidates = [
      ...document.querySelectorAll(
        'button,[role="button"]'
      )
    ]
      .filter(visible)
      .map(el => ({
        text:textOf(el).slice(0,120),
        aria:String(
          el.getAttribute('aria-label') ||
          ''
        ).slice(0,120)
      }))
      .filter(x => x.text || x.aria)
      .slice(0,30);

    return response(
      'NEEDS_REVIEW',
      {
        page_url:location.href,
        clicked_post:false,
        composer_candidates:
          composerCandidates
      },
      'Kh?ng m? ???c h?p t?o b?i tr?n Page'
    );
  }

  opener.click();

  const editor = await waitFor(
    () => {
      const dialog = [
        ...document.querySelectorAll(
          '[role="dialog"]'
        )
      ].filter(visible).pop();

      const root=dialog || document;

      return [
        ...root.querySelectorAll(
          '[contenteditable="true"],textarea'
        )
      ].filter(visible)[0] || null;
    },
    12000,
    400
  );

  if (!editor && payload.message) {
    return response(
      'NEEDS_REVIEW',
      {
        page_url:location.href,
        clicked_post:false
      },
      'Kh?ng t?m th?y v?ng nh?p n?i dung b?i Page'
    );
  }

  if(editor && payload.message){
    setField(
      editor,
      payload.message
    );
  }

  try{
    await attachImage(
      payload.image_url
    );
  }catch(error){
    return response(
      'NEEDS_REVIEW',
      {
        page_url:location.href,
        clicked_post:false
      },
      'Kh?ng g?n ???c ?nh: '+
      String(
        error?.message ||
        error
      )
    );
  }

  const post = await waitFor(
    () => {
      const dialog = [
        ...document.querySelectorAll(
          '[role="dialog"]'
        )
      ].filter(visible).pop();

      return (
        clickableByText(
          /^(post|dang)$/i,
          dialog || document
        ) ||
        clickableByText(
          /^(post|dang)$/i
        )
      );
    },
    12000,
    400
  );

  if(!post){
    return response(
      'NEEDS_REVIEW',
      {
        page_url:location.href,
        clicked_post:false
      },
      'Kh?ng t?m th?y n?t ??ng c?a Page'
    );
  }

  post.click();

  await sleep(3500);

  const after=checkpoint();

  if(after){
    return response(
      'WAITING_USER',
      {
        page_url:location.href,
        clicked_post:true,
        verified:false
      },
      after
    );
  }

  const verified=await waitFor(
    () => postVerified(
      payload.message || ''
    ),
    25000,
    800
  );

  if(!verified){
    return response(
      'NEEDS_REVIEW',
      {
        page_url:location.href,
        clicked_post:true,
        verified:false
      },
      '?? b?m ??ng nh?ng ch?a x?c minh ???c b?i xu?t hi?n; kh?ng t? ??ng l?i ?? tr?nh tr?ng b?i'
    );
  }

  return response(
    'DONE',
    {
      page_name:
        payload.page_name || '',
      page_url:
        payload.page_url ||
        location.href,
      clicked_post:true,
      verified:true
    }
  );
}

async function execute(job) {
  const payload = job?.payload || {};
  if (job?.action === 'create_page') return createPage(payload);
  if (job?.action === 'post_page') return postPage(payload);
  return response('NEEDS_REVIEW', {}, `Extension chưa hỗ trợ action ${job?.action || '(trống)'}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'SM_EXECUTE_JOB') return false;
  execute(message.job)
    .then(sendResponse)
    .catch(error => sendResponse(response('FAILED', {}, String(error?.message || error))));
  return true;
});
