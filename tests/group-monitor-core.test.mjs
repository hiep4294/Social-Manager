import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  canAutoReply,
  classifyGroupItemRisk,
  configureGroupMonitor,
  ensureGroupMonitorSchema,
  findFacebookAsset,
  groupItemKey,
  groupMonitorMatches,
  normalizeGroupMonitor,
  rememberFacebookAsset,
  renderGroupReply,
  stopGroupMonitor
} from '../src/group-monitor-core.js';

const db = new Database(':memory:');
ensureGroupMonitorSchema(db);

const asset = rememberFacebookAsset(db, {
  assetType: 'GROUP',
  name: 'Hội kỹ thuật cửa cuốn Việt Nam',
  url: 'https://www.facebook.com/groups/123456/',
  brandId: 1
});
assert.equal(asset.asset_type, 'GROUP');
assert.equal(findFacebookAsset(db, { assetType: 'GROUP', name: 'kỹ thuật cửa cuốn' }).url, asset.url);

const normalized = normalizeGroupMonitor({
  group_name: 'Hội kỹ thuật cửa cuốn Việt Nam',
  keywords: ['motor', 'tủ điều khiển'],
  mode: 'AUTO',
  reply_message: 'KODS có thể hỗ trợ về {{post}}',
  poll_seconds: 5,
  max_replies_per_hour: 99
});
assert.equal(normalized.ok, true);
assert.equal(normalized.value.pollSeconds, 300);
assert.equal(normalized.value.maxRepliesPerHour, 20);
assert.equal(normalizeGroupMonitor({ group_name: 'x', mode: 'DRAFT' }).value.pollSeconds, 600);
assert.equal(normalizeGroupMonitor({ group_name: 'x', mode: 'AUTO', keywords: [] }).ok, false);

const monitor = configureGroupMonitor(db, {
  brand_id: 1,
  group_name: 'Hội kỹ thuật cửa cuốn Việt Nam',
  keywords: ['motor', 'tủ điều khiển'],
  mode: 'AUTO',
  reply_message: 'Xin chào, tôi thấy bạn đang hỏi về {{post}}',
  poll_seconds: 120,
  max_replies_per_hour: 2
});
assert.equal(monitor.mode, 'AUTO');
assert.equal(monitor.poll_seconds, 300);
assert.equal(groupMonitorMatches(monitor, 'Mình cần hỏi MOTOR cửa cuốn'), true);
assert.equal(groupMonitorMatches(monitor, 'Bán bàn ghế'), false);
assert.match(renderGroupReply(monitor, 'Motor FJJ335 bị nhảy aptomat'), /Motor FJJ335/);
assert.equal(classifyGroupItemRisk('Xin hỏi giá motor'), 'LOW');
assert.equal(classifyGroupItemRisk('Cửa gây tai nạn cần bồi thường'), 'HIGH');

const keyA = groupItemKey({ postUrl: 'https://www.facebook.com/groups/123/posts/456/', text: 'abc' });
const keyB = groupItemKey({ postUrl: 'https://www.facebook.com/groups/123/posts/456/', text: 'khác' });
assert.equal(keyA, keyB);
assert.equal(canAutoReply(db, monitor), true);

db.prepare(`INSERT INTO facebook_group_monitor_seen(monitor_id,item_key,status,discovered_at,replied_at) VALUES(?,?, 'REPLIED',?,?)`)
  .run(monitor.id, 'k1', new Date().toISOString(), new Date().toISOString());
db.prepare(`INSERT INTO facebook_group_monitor_seen(monitor_id,item_key,status,discovered_at,replied_at) VALUES(?,?, 'REPLIED',?,?)`)
  .run(monitor.id, 'k2', new Date().toISOString(), new Date().toISOString());
assert.equal(canAutoReply(db, monitor), false);

const stopped = stopGroupMonitor(db, { group_name: 'Hội kỹ thuật cửa cuốn Việt Nam' });
assert.equal(stopped.active, 0);

console.log('GROUP MONITOR CORE TEST PASS');
