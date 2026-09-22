export const BRIDGE_URL = 'http://127.0.0.1:3210';
export const EXTENSION_VERSION = '2.1.0';

export async function getBridgeToken() {
  const value = await chrome.storage.local.get('bridgeToken');
  return value.bridgeToken || null;
}

export async function bridgeRequest(path, options = {}) {
  const method = options.method || 'GET';
  const token = options.auth === false ? null : await getBridgeToken();
  const headers = {
    'content-type': 'application/json',
    'x-sm-extension-id': chrome.runtime.id
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method,
    headers,
    body: options.body == null ? undefined : JSON.stringify(options.body),
    cache: 'no-store'
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload.error || `Bridge HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function pairBridge(code) {
  const payload = await bridgeRequest('/v1/pair', {
    method: 'POST',
    auth: false,
    body: { code: String(code || '').trim(), extension_id: chrome.runtime.id, version: EXTENSION_VERSION }
  });
  if (!payload.token) throw new Error('Bridge không trả token ghép đôi');
  await chrome.storage.local.set({ bridgeToken: payload.token });
  return payload;
}

export async function heartbeatBridge() {
  return bridgeRequest('/v1/heartbeat', {
    method: 'POST',
    body: { version: EXTENSION_VERSION, extension_id: chrome.runtime.id }
  });
}

export async function claimBridgeJob() {
  const payload = await bridgeRequest('/v1/jobs/claim', { method: 'POST', body: {} });
  return payload.job || null;
}

export async function reportBridgeJob(job, execution) {
  return bridgeRequest('/v1/jobs/result', {
    method: 'POST',
    body: {
      id: job.id,
      status: String(execution?.status || (execution?.ok ? 'DONE' : 'FAILED')).toUpperCase(),
      result: execution?.result || {},
      error: execution?.error || null
    }
  });
}

export async function bridgeHealth() {
  try { return await bridgeRequest('/v1/health', { auth: false }); }
  catch (error) { return { ok: false, error: String(error?.message || error) }; }
}


export async function getChatGptImageProgress() {
  return bridgeRequest('/v1/chatgpt-image/next');
}

export async function importChatGptImage({ buffer, contentType, foodId = '', sourceUrl = '' }) {
  const token = await getBridgeToken();
  if (!token) throw new Error('Extension chưa ghép đôi với Social Manager Agent');
  const headers = {
    'content-type': String(contentType || 'image/png'),
    'x-sm-extension-id': chrome.runtime.id
  };
  if (foodId) headers['x-sm-food-id'] = String(foodId);
  if (sourceUrl) headers['x-sm-source-url'] = String(sourceUrl).slice(0, 1800);
  headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${BRIDGE_URL}/v1/chatgpt-image/import`, {
    method: 'POST',
    headers,
    body: buffer,
    cache: 'no-store'
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload.error || `Bridge HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}


export async function getPendingChatGptImage() {
  return bridgeRequest('/v1/chatgpt-image/pending');
}

export async function markChatGptImageSynced(foodId, ok, error = null) {
  return bridgeRequest('/v1/chatgpt-image/mark-synced', {
    method: 'POST',
    body: { food_id: foodId, ok: ok === true, error }
  });
}
