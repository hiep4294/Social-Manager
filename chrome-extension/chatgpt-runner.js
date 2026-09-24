function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function isChatGPTUrl(url = '') {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'chatgpt.com' || host === 'chat.openai.com';
  } catch {
    return false;
  }
}

async function waitTabComplete(tabId, timeoutMs = 45000) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
  } catch {}

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timeout chờ ChatGPT tải trang'));
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

async function sendToChatGPT(tabId, job) {
  let lastError = null;
  for (let i = 0; i < 8; i += 1) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: 'SM_EXECUTE_CHATGPT_JOB',
        job
      });
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(700 + i * 350);
  }

  throw new Error(`Không giao được job cho ChatGPT content script: ${String(lastError?.message || lastError || 'unknown')}`);
}

async function waitDownload(startedAt, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  const startedAfter = new Date(startedAt - 3000).toISOString();

  while (Date.now() < end) {
    const items = await chrome.downloads.search({
      startedAfter,
      orderBy: ['-startTime'],
      limit: 20
    });

    const hit = items.find(item => {
      const name = String(item.filename || '').toLowerCase();
      const mime = String(item.mime || '').toLowerCase();
      return item.state === 'complete' &&
        !item.error &&
        (mime.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name));
    });

    if (hit) return hit;
    await sleep(1000);
  }

  return null;
}

async function triggerDirectDownload(url, recipeCode) {
  if (!/^https?:\/\//i.test(String(url || ''))) {
    throw new Error('ChatGPT trả image_url không hợp lệ');
  }

  return chrome.downloads.download({
    url,
    filename: `social-manager/${String(recipeCode || 'food-image').toLowerCase()}-${Date.now()}.png`,
    conflictAction: 'uniquify',
    saveAs: false
  });
}

export async function runChatGPTImageJob(job) {
  if (job?.action !== 'generate_food_image') {
    return { status: 'FAILED', error: `Action ChatGPT không hỗ trợ: ${job?.action || '(trống)'}`, result: {} };
  }

  const previous = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] || null;
  const startedAt = Date.now();
  let tab = null;

  try {
    tab = await chrome.tabs.create({
      url: 'https://chatgpt.com/',
      active: true
    });

    await waitTabComplete(tab.id);
    await sleep(1800);

    const execution = await sendToChatGPT(tab.id, job);
    if (String(execution?.status || '').toUpperCase() !== 'DONE') {
      return execution;
    }

    if (execution?.result?.image_url) {
      await triggerDirectDownload(execution.result.image_url, job.payload?.recipe_code);
    }

    const download = await waitDownload(startedAt);
    if (!download) {
      return {
        status: 'NEEDS_REVIEW',
        error: 'ChatGPT đã tạo ảnh nhưng extension chưa xác minh được file tải xuống',
        result: {
          generation_done: true,
          current_url: tab.url || null
        }
      };
    }

    if (!isChatGPTUrl(tab.url || 'https://chatgpt.com/')) {
      return {
        status: 'FAILED',
        error: 'Tab tạo ảnh rời khỏi ChatGPT ngoài dự kiến',
        result: {}
      };
    }

    try { await chrome.tabs.remove(tab.id); } catch {}
    if (previous?.id) {
      try { await chrome.tabs.update(previous.id, { active: true }); } catch {}
    }

    return {
      status: 'DONE',
      result: {
        recipe_code: job.payload?.recipe_code || null,
        recipe_title: job.payload?.recipe_title || null,
        download_id: download.id,
        download_path: download.filename,
        download_bytes: Number(download.fileSize || 0),
        download_mime: download.mime || null,
        verified_download: true
      }
    };
  } catch (error) {
    return {
      status: 'FAILED',
      error: String(error?.message || error),
      result: {
        chatgpt_tab_id: tab?.id || null
      }
    };
  }
}
