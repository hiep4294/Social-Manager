import fs from 'node:fs';

export const CHROME_EXTENSION_ACTIONS = Object.freeze(['create_page', 'post_page']);

export function extensionActionSupported(action) {
  return CHROME_EXTENSION_ACTIONS.includes(String(action || '').trim());
}

export function parseExtensionStatusFile(statusPath) {
  try {
    return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  } catch {
    return null;
  }
}

export function extensionStatusIsHealthy(status, { now = Date.now(), ttlMs = 45_000 } = {}) {
  if (!status || status.paired !== true) return false;
  const heartbeat = Date.parse(String(status.last_heartbeat_at || ''));
  if (!Number.isFinite(heartbeat)) return false;
  return now - heartbeat >= 0 && now - heartbeat <= ttlMs;
}

export function extensionActionPreferred(action, { statusPath, now = Date.now(), ttlMs = 45_000 } = {}) {
  if (!extensionActionSupported(action) || !statusPath) return false;
  return extensionStatusIsHealthy(parseExtensionStatusFile(statusPath), { now, ttlMs });
}
