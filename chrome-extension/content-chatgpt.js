function send(message) {
  return new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
}

function isAssistantImage(img) {
  if (!(img instanceof HTMLImageElement)) return false;
  if (img.dataset.smFoodImageBound === '1') return false;

  const width = Number(img.naturalWidth || img.width || 0);
  const height = Number(img.naturalHeight || img.height || 0);
  if (width < 512 || height < 512) return false;

  const roleNode = img.closest('[data-message-author-role]');
  if (roleNode && roleNode.getAttribute('data-message-author-role') !== 'assistant') return false;

  const src = String(img.currentSrc || img.src || '');
  if (!/^(https?:|blob:|data:image\/)/i.test(src)) return false;
  return true;
}

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Không đọc được ảnh'));
    reader.readAsDataURL(blob);
  });
}

async function pageFetchAsDataUrl(sourceUrl) {
  const response = await fetch(sourceUrl, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`Không đọc được ảnh từ ChatGPT (HTTP ${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`Nguồn không phải ảnh: ${blob.type || 'unknown'}`);
  if (blob.size > 25 * 1024 * 1024) throw new Error('Ảnh vượt quá 25 MB');
  return toDataUrl(blob);
}

function makeButton(img) {
  img.dataset.smFoodImageBound = '1';

  const holder = document.createElement('div');
  holder.dataset.smFoodImageButton = '1';
  holder.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0 12px;position:relative;z-index:2;';

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Lưu vào Social Manager';
  button.style.cssText = [
    'border:0',
    'border-radius:999px',
    'padding:7px 12px',
    'font:600 12px system-ui,-apple-system,Segoe UI,sans-serif',
    'background:#101828',
    'color:#fff',
    'cursor:pointer',
    'box-shadow:0 1px 3px rgba(0,0,0,.18)'
  ].join(';');

  const state = document.createElement('span');
  state.style.cssText = 'font:12px system-ui,-apple-system,Segoe UI,sans-serif;color:#667085;';

  holder.append(button, state);

  const anchor = img.closest('figure') || img.parentElement || img;
  try { anchor.insertAdjacentElement('afterend', holder); }
  catch { img.insertAdjacentElement('afterend', holder); }

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    const original = button.textContent;
    try {
      state.textContent = 'Đang lấy món kế tiếp...';
      const progress = await send({ type: 'GET_CHATGPT_IMAGE_PROGRESS' });
      if (!progress?.ok) throw new Error(progress?.error || 'Không đọc được kho ảnh');
      if (!progress.next) {
        state.textContent = 'Đã đủ 1.000 ảnh.';
        button.textContent = 'Kho đã đủ';
        return;
      }

      button.textContent = `Lưu ${progress.next.id}`;
      state.textContent = progress.next.title || '';
      const sourceUrl = String(img.currentSrc || img.src || '');

      let result = await send({
        type: 'SAVE_CHATGPT_IMAGE_URL',
        sourceUrl,
        foodId: progress.next.id
      });

      if (result?.needs_page_fetch) {
        state.textContent = 'Đang đọc ảnh trực tiếp từ trang...';
        const dataUrl = await pageFetchAsDataUrl(sourceUrl);
        result = await send({
          type: 'SAVE_CHATGPT_IMAGE_DATA_URL',
          dataUrl,
          sourceUrl,
          foodId: progress.next.id
        });
      }

      if (!result?.ok) throw new Error(result?.error || 'Không lưu được ảnh');
      button.textContent = 'Đã lưu';
      state.textContent = `${result.food_id} • ${result.title} • ${result.progress?.ready || '?'} / ${result.progress?.total || 1000}`;
      holder.dataset.smSaved = '1';
      button.style.background = '#027a48';
    } catch (error) {
      button.textContent = original;
      state.textContent = String(error?.message || error);
      state.style.color = '#b42318';
      button.disabled = false;
    }
  });
}

function scan(root = document) {
  const images = root.querySelectorAll ? root.querySelectorAll('img') : [];
  for (const img of images) {
    if (img.complete) {
      if (isAssistantImage(img)) makeButton(img);
    } else {
      img.addEventListener('load', () => {
        if (isAssistantImage(img)) makeButton(img);
      }, { once: true });
    }
  }
}

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('img') && isAssistantImage(node)) makeButton(node);
      scan(node);
    }
  }
});

scan();
observer.observe(document.documentElement, { childList: true, subtree: true });

send({ type: 'GET_CHATGPT_IMAGE_PROGRESS' }).then(progress => {
  if (progress?.ok) {
    console.info('[Social Manager] ChatGPT image bridge ready', progress.ready, '/', progress.total);
  }
}).catch(() => {});
