import {
  EXTENSION_VERSION,
  bridgeHealth,
  claimBridgeJob,
  getBridgeToken,
  heartbeatBridge,
  pairBridge,
  reportBridgeJob
} from './bridge-client.js';
import { runFacebookJob } from './operator-runner.js';
import { runChatGPTImageJob } from './chatgpt-runner.js';

const POLL_ALARM = 'social-manager-poll';
let busy = false;
let lastResult = null;

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
      execution = job.action === 'generate_food_image'
        ? await runChatGPTImageJob(job)
        : await runFacebookJob(job);
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
    if (message?.type === 'GET_STATUS') {
      return {
        ok: true,
        extension_id: chrome.runtime.id,
        extension_version: EXTENSION_VERSION,
        token_present: Boolean(await getBridgeToken()),
        bridge: await bridgeHealth(),
        last_result: lastResult
      };
    }
    return { ok: false, error: 'Unknown message' };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
setInterval(() => poll().catch(() => {}), 5000);
poll().catch(() => {});
