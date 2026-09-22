function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?;base64,(.*)$/s);
  if (!match) throw new Error('Data URL không hợp lệ');
  const mime = match[1] || 'image/webp';
  const raw = atob(match[2]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function appReady() {
  try {
    const response = await fetch('/api/food-library/progress', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) return { ok: false, status: response.status };
    const payload = await response.json();
    return { ok: payload?.ok === true, progress: payload };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'SM_PING') {
      return appReady();
    }
    if (message?.type === 'SM_GET_FOOD_PROGRESS') {
      return appReady();
    }
    if (message?.type === 'SM_IMPORT_FOOD_IMAGE') {
      const blob = dataUrlToBlob(message.dataUrl);
      const headers = {
        'content-type': blob.type || 'image/webp',
        'x-sm-food-id': String(message.foodId || '')
      };
      if (message.sourceUrl) headers['x-sm-source-url'] = String(message.sourceUrl).slice(0, 1800);
      const response = await fetch('/api/food-library/ingest-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: blob,
        cache: 'no-store'
      });
      let payload = {};
      try { payload = await response.json(); } catch {}
      if (!response.ok) return { ok: false, status: response.status, error: payload.error || `HTTP ${response.status}` };
      return { ok: true, ...payload };
    }
    return { ok: false, error: 'Unknown Social Manager content message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

console.info('[Social Manager] storage-tab bridge loaded');
