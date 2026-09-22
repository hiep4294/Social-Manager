function send(message) {
  return new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
}

function cls(el, name) {
  el.className = `value ${name || ''}`.trim();
}

async function refresh() {
  const status = document.getElementById('status');
  const detail = document.getElementById('detail');
  const pairCard = document.getElementById('pairCard');
  const last = document.getElementById('last');
  const imageProgress = document.getElementById('imageProgress');
  const imageNext = document.getElementById('imageNext');
  const lastImage = document.getElementById('lastImage');
  const s = await send({ type: 'GET_STATUS' });
  if (!s?.ok) {
    status.textContent = s?.error || 'Không đọc được trạng thái';
    cls(status, 'bad');
    return;
  }
  const bridge = s.bridge || {};
  if (!bridge.ok) {
    status.textContent = 'Local Agent không kết nối';
    cls(status, 'bad');
  } else if (!s.token_present || !bridge.paired) {
    status.textContent = 'Chưa ghép đôi';
    cls(status, 'warn');
  } else if (bridge.extension_online) {
    status.textContent = 'Extension đang hoạt động';
    cls(status, 'ok');
  } else {
    status.textContent = 'Đã ghép đôi, đang chờ heartbeat';
    cls(status, 'warn');
  }
  detail.textContent = `Extension ${s.extension_version} · ID ${s.extension_id || '-'} · Agent mong đợi ${bridge.expected_version || '-'}`;
  pairCard.style.display = s.token_present && bridge.paired ? 'none' : 'block';
  last.textContent = s.last_result ? JSON.stringify(s.last_result, null, 2) : 'Chưa có';
  if (s.image_progress) {
    imageProgress.textContent = `${s.image_progress.ready || 0} / ${s.image_progress.total || 1000} ảnh`;
    cls(imageProgress, (s.image_progress.missing || 0) === 0 ? 'ok' : 'warn');
    imageNext.textContent = s.image_progress.next
      ? `Tiếp theo: ${s.image_progress.next.id} - ${s.image_progress.next.title}`
      : 'Kho ảnh đã đủ.';
  } else {
    imageProgress.textContent = 'Chưa kết nối được kho ảnh';
    cls(imageProgress, 'bad');
    imageNext.textContent = '';
  }
  lastImage.textContent = s.last_image_import ? JSON.stringify(s.last_image_import, null, 2) : 'Chưa có';
}

document.getElementById('pair').addEventListener('click', async () => {
  const code = document.getElementById('code').value.trim();
  const result = await send({ type: 'PAIR', code });
  if (!result?.ok) alert(result?.error || 'Ghép đôi thất bại');
  await refresh();
});
document.getElementById('refresh').addEventListener('click', refresh);
document.getElementById('poll').addEventListener('click', async () => {
  await send({ type: 'POLL_NOW' });
  await refresh();
});
refresh();

document.getElementById('openChatgpt').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: 'https://chatgpt.com/' });
  }
});
