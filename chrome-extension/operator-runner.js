function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function isFacebookUrl(url = '') {
  try { return /(^|\.)facebook\.com$/i.test(new URL(url).hostname); }
  catch { return false; }
}

async function waitTabComplete(tabId, timeoutMs = 30000) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
  } catch {}
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timeout chờ Facebook tải trang'));
    }, timeoutMs);
    const listener = (id, info, tab) => {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function getOperatorTab() {
  const stored = await chrome.storage.local.get('operatorTabId');
  if (stored.operatorTabId) {
    try {
      const tab = await chrome.tabs.get(stored.operatorTabId);
      if (tab && isFacebookUrl(tab.url || 'https://www.facebook.com/')) return tab;
    } catch {}
  }
  const matches = await chrome.tabs.query({ url: ['https://www.facebook.com/*', 'https://facebook.com/*', 'https://web.facebook.com/*'] });
  if (matches[0]) {
    await chrome.storage.local.set({ operatorTabId: matches[0].id });
    return matches[0];
  }
  const created = await chrome.tabs.create({ url: 'https://www.facebook.com/', active: false });
  await chrome.storage.local.set({ operatorTabId: created.id });
  return created;
}

function targetUrl(job) {
  if (job.action === 'create_page') return 'https://www.facebook.com/pages/create';
  if (job.action === 'post_page' && job.payload?.page_url) return String(job.payload.page_url);
  return 'https://www.facebook.com/';
}

async function sendToContent(tabId, job) {
  let lastError = null;
  for (let i = 0; i < 5; i += 1) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'SM_EXECUTE_JOB', job });
      if (result) return result;
    } catch (error) { lastError = error; }
    await sleep(700 + i * 400);
  }
  throw new Error(`Không giao được lệnh cho content script: ${String(lastError?.message || lastError || 'unknown')}`);
}

export async function runFacebookJob(job) {
  const active = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] || null;
  const operator = await getOperatorTab();
  const tab = await chrome.tabs.update(operator.id, { url: targetUrl(job), active: true });
  await waitTabComplete(tab.id);
  await sleep(1500);
  const result = await sendToContent(tab.id, job);
  if (String(result?.status || '').toUpperCase() === 'DONE' && active?.id && active.id !== tab.id) {
    try { await chrome.tabs.update(active.id, { active: true }); } catch {}
  }
  return result;
}
