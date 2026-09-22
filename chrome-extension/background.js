import {
  EXTENSION_VERSION,
  bridgeHealth,
  claimBridgeJob,
  getBridgeToken,
  heartbeatBridge,
  pairBridge,
  reportBridgeJob,
  getChatGptImageProgress,
  importChatGptImage
} from './bridge-client.js';
import { runFacebookJob } from './operator-runner.js';

const POLL_ALARM = 'social-manager-poll';
let busy = false;
let lastResult = null;
let lastImageImport = null;

function guessImageContentType(bytes, fallback = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (b.length >= 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && String.fromCharCode(...b.slice(4, 8)) === 'ftyp' && /avif|avis/.test(String.fromCharCode(...b.slice(8, 12)))) return 'image/avif';
  return String(fallback || '').startsWith('image/') ? String(fallback) : 'image/png';
}

function dataUrlToBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('Data URL ảnh không hợp lệ');
  const mime = match[1] || 'image/png';
  const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return { bytes, mime };
}

async function fetchImageBytes(sourceUrl) {
  const url = String(sourceUrl || '');
  if (url.startsWith('data:image/')) return dataUrlToBytes(url);
  if (url.startsWith('blob:')) {
    const error = new Error('Blob URL cần đọc trong tab ChatGPT');
    error.needsPageFetch = true;
    throw error;
  }
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`Không tải được ảnh từ ChatGPT: HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 25 * 1024 * 1024) throw new Error('Ảnh vượt quá 25 MB');
  const headerType = String(response.headers.get('content-type') || '').split(';')[0];
  return { bytes: new Uint8Array(buffer), mime: guessImageContentType(new Uint8Array(buffer), headerType) };
}

async function saveChatGptImage({ sourceUrl, foodId, dataUrl }) {
  let loaded;
  try {
    loaded = dataUrl ? dataUrlToBytes(dataUrl) : await fetchImageBytes(sourceUrl);
  } catch (error) {
    if (error?.needsPageFetch) return { ok: false, needs_page_fetch: true, error: error.message };
    throw error;
  }
  const result = await importChatGptImage({
    buffer: loaded.bytes,
    contentType: guessImageContentType(loaded.bytes, loaded.mime),
    foodId,
    sourceUrl
  });
  lastImageImport = { ...result, at: new Date().toISOString() };
  return { ok: true, ...result };
}

async function setBadge(text) {
  try { await chrome.action.setBadgeText({ text: String(text || '').slice(0, 4) }); } catch {}
}

async function poll() {
  if (busy) return;
  busy = true;
  try {
    const token = await getBridgeToken();
    if (!token) {
      await setBadge('PAIR');
      return;
    }
    try {
      const heartbeat = await heartbeatBridge();
      if (heartbeat.reload_required) {
        setTimeout(() => chrome.runtime.reload(), 250);
        return;
      }
    } catch (error) {
      if (Number(error?.status) === 401) {
        await chrome.storage.local.remove('bridgeToken');
        await setBadge('PAIR');
      } else {
        await setBadge('OFF');
      }
      return;
    }
    const job = await claimBridgeJob();
    if (!job) {
      await setBadge('ON');
      return;
    }
    let execution;
    try {
      execution = await runFacebookJob(job);
    } catch (error) {
      execution = { status: 'FAILED', error: String(error?.message || error), result: { extension_error: true } };
    }
    try { await reportBridgeJob(job, execution); } catch {}
    lastResult = { job_id: job.id, action: job.action, ...execution, at: new Date().toISOString() };
    await setBadge(String(execution?.status || '').toUpperCase() === 'DONE' ? 'ON' : '!');
  } finally {
    busy = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  poll().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  poll().catch(() => {});
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === POLL_ALARM) poll().catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'PAIR') return pairBridge(message.code);
    if (message?.type === 'POLL_NOW') {
      await poll();
      return { ok: true };
    }
    if (message?.type === 'GET_CHATGPT_IMAGE_PROGRESS') {
      const progress = await getChatGptImageProgress();
      return { ok: true, ...progress };
    }
    if (message?.type === 'SAVE_CHATGPT_IMAGE_URL') {
      return saveChatGptImage({
        sourceUrl: message.sourceUrl,
        foodId: message.foodId
      });
    }
    if (message?.type === 'SAVE_CHATGPT_IMAGE_DATA_URL') {
      return saveChatGptImage({
        sourceUrl: message.sourceUrl,
        foodId: message.foodId,
        dataUrl: message.dataUrl
      });
    }
    if (message?.type === 'GET_STATUS') {
      let imageProgress = null;
      try { imageProgress = await getChatGptImageProgress(); } catch {}
      return {
        ok: true,
        extension_id: chrome.runtime.id,
        extension_version: EXTENSION_VERSION,
        token_present: Boolean(await getBridgeToken()),
        bridge: await bridgeHealth(),
        last_result: lastResult,
        image_progress: imageProgress,
        last_image_import: lastImageImport
      };
    }
    return { ok: false, error: 'Unknown message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
setInterval(() => poll().catch(() => {}), 5000);
poll().catch(() => {});
