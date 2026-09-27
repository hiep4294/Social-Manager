function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function response(status, result = {}, error = null) {
  return { ok: status === 'DONE', status, result, error };
}

function authCheckpoint() {
  const url = location.href.toLowerCase();
  const body = normalize(document.body?.innerText || '');
  if (/\/auth\/login|\/login/.test(url)) return 'ChatGPT yêu cầu đăng nhập';
  if (/log in|sign in|dang nhap/.test(body) && !findPromptBox()) return 'ChatGPT chưa đăng nhập';
  return null;
}

function findPromptBox() {
  const preferred = [
    document.querySelector('#prompt-textarea'),
    document.querySelector('textarea[placeholder]'),
    ...document.querySelectorAll('main textarea'),
    ...document.querySelectorAll('main [contenteditable="true"]')
  ];
  return preferred.find(visible) || null;
}

function setPrompt(el, value) {
  if (!el) return false;
  el.focus();

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, value);
  } catch {
    el.textContent = value;
  }

  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: value
  }));
  return normalize(el.textContent || '').length > 0;
}

function sendButton() {
  const selectors = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[aria-label*="Gửi"]',
    'button[aria-label*="gửi"]'
  ];
  for (const selector of selectors) {
    const el = [...document.querySelectorAll(selector)].find(visible);
    if (el && !el.disabled) return el;
  }
  return null;
}

function imageCandidates() {
  return [...document.querySelectorAll('main img')]
    .filter(img => visible(img) && img.complete && img.naturalWidth >= 512 && img.naturalHeight >= 512)
    .filter(img => !/avatar|profile/i.test(String(img.alt || '')));
}

function downloadButton(root = document) {
  const nodes = [...root.querySelectorAll('button,a,[role="button"]')].filter(visible);
  return nodes.find(el => {
    const probe = normalize(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`);
    return /(^| )(download|tai xuong|luu anh|save image)( |$)/i.test(probe);
  }) || null;
}

async function findDownloadForImage(img) {
  let cur = img;

  for (let i = 0; i < 8 && cur; i += 1, cur = cur.parentElement) {
    const button = downloadButton(cur);
    if (button) return button;
  }

  img.scrollIntoView({
    block: 'center',
    inline: 'center'
  });

  await sleep(400);

  try {
    img.click();
  } catch {}

  await sleep(900);

  const dialogs = [
    ...document.querySelectorAll('[role="dialog"]')
  ].filter(visible);

  for (let i = dialogs.length - 1; i >= 0; i -= 1) {
    const button = downloadButton(dialogs[i]);
    if (button) return button;
  }

  // Kh?ng fallback ra to?n document:
  // tr?nh click nh?m n?t t?i icon/avatar/UI asset.
  return null;
}

async function waitForImageAndDownload(before, timeoutMs = 240000) {
  const end = Date.now() + timeoutMs;

  while (Date.now() < end) {
    const blocked = authCheckpoint();

    if (blocked) {
      return response('WAITING_USER', {}, blocked);
    }

    const candidates = imageCandidates();

    const fresh = candidates.filter(img => {
      const key = String(
        img.currentSrc ||
        img.src ||
        ''
      );

      return key && !before.has(key);
    });

    if (fresh.length) {
      const img = fresh[fresh.length - 1];

      const src=String(
        img.currentSrc ||
        img.src ||
        ''
      );

      const width=Number(img.naturalWidth || 0);
      const height=Number(img.naturalHeight || 0);

      // ?u ti?n URL c?a ??ng ?nh thay v? b?m n?t Download.
      if (/^https?:\/\//i.test(src)) {
        return response('DONE', {
          download_triggered:false,
          image_url:src,
          image_width:width,
          image_height:height
        });
      }

      // Blob image: ch? b?m n?t Download n?m g?n ?nh/modal.
      const button = await findDownloadForImage(img);

      if (button) {
        button.click();

        return response('DONE', {
          download_triggered:true,
          image_src_kind:src.startsWith('blob:')
            ? 'blob'
            : 'url',
          image_width:width,
          image_height:height
        });
      }
    }

    await sleep(1000);
  }

  return response(
    'NEEDS_REVIEW',
    { current_url:location.href },
    'Kh?ng x?c ??nh ???c ?nh ChatGPT m?i ho?c n?t t?i ?nh trong th?i gian ch?'
  );
}

async function generateFoodImage(payload) {
  const blocked = authCheckpoint();
  if (blocked) return response('WAITING_USER', {}, blocked);

  const prompt = String(payload.prompt || '').trim();
  if (!prompt) return response('FAILED', {}, 'Job thiếu prompt tạo ảnh');

  const before = new Set(imageCandidates().map(img => String(img.currentSrc || img.src || '')).filter(Boolean));

  let box = findPromptBox();
  for (let i = 0; i < 20 && !box; i += 1) {
    await sleep(500);
    box = findPromptBox();
  }
  if (!box) return response('WAITING_USER', {}, 'Không tìm thấy ô nhập ChatGPT; kiểm tra trạng thái đăng nhập');

  if (!setPrompt(box, prompt)) {
    return response('NEEDS_REVIEW', {}, 'Không nhập được prompt vào ChatGPT');
  }

  let send = sendButton();
  for (let i = 0; i < 20 && !send; i += 1) {
    await sleep(300);
    send = sendButton();
  }
  if (!send) return response('NEEDS_REVIEW', {}, 'Không tìm thấy nút gửi prompt ChatGPT');

  send.click();
  await sleep(1200);

  return waitForImageAndDownload(before);
}

async function execute(job) {
  if (job?.action === 'generate_food_image') return generateFoodImage(job.payload || {});
  return response('NEEDS_REVIEW', {}, `ChatGPT content script không hỗ trợ action ${job?.action || '(trống)'}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'SM_EXECUTE_CHATGPT_JOB') return false;
  execute(message.job)
    .then(sendResponse)
    .catch(error => sendResponse(response('FAILED', {}, String(error?.message || error))));
  return true;
});
