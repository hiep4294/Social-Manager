import assert from 'node:assert/strict';
import { normalizeBridgeCommand, isBridgeCommandDue } from '../src/github-bridge.js';

const text = normalizeBridgeCommand({
  id: 'cmd-1',
  action: 'post_facebook',
  brand_id: 1,
  message: 'xin chào',
  idempotency_key: 'request-1'
});
assert.equal(text.ok, true);
assert.equal(text.value.id, 'cmd-1');
assert.equal(text.value.brandId, 1);
assert.equal(text.value.idempotencyKey, 'request-1');
assert.equal(text.value.imageUrl, null);
assert.equal(text.value.scheduledAt, null);

const imageScheduled = normalizeBridgeCommand({
  id: 'cmd-2',
  action: 'post_facebook',
  brand_id: 2,
  message: 'Bài có ảnh',
  image_url: 'https://example.com/photo.jpg',
  scheduled_at: '2026-09-12T19:00:00+07:00'
});
assert.equal(imageScheduled.ok, true);
assert.equal(imageScheduled.value.imageUrl, 'https://example.com/photo.jpg');
assert.equal(imageScheduled.value.scheduledAt, '2026-09-12T12:00:00.000Z');
assert.equal(imageScheduled.value.idempotencyKey, 'cmd-2');

const imageOnly = normalizeBridgeCommand({
  id: 'cmd-3',
  action: 'post_facebook',
  image_url: 'https://example.com/only-image.png'
});
assert.equal(imageOnly.ok, true);

assert.equal(normalizeBridgeCommand({ action: 'post_facebook', message: 'x' }).ok, false);
assert.equal(normalizeBridgeCommand({ id: 'x', action: 'post_instagram', message: 'x' }).ok, false);
assert.equal(normalizeBridgeCommand({ id: 'x', action: 'post_facebook', message: '', image_url: '' }).ok, false);
assert.equal(normalizeBridgeCommand({ id: 'x', action: 'post_facebook', image_url: 'file:///tmp/a.jpg' }).ok, false);
assert.equal(normalizeBridgeCommand({ id: 'x', action: 'post_facebook', message: 'x', scheduled_at: 'not-a-date' }).ok, false);

assert.equal(isBridgeCommandDue(null, Date.parse('2026-09-12T12:00:00Z')), true);
assert.equal(isBridgeCommandDue('2026-09-12T11:59:59Z', Date.parse('2026-09-12T12:00:00Z')), true);
assert.equal(isBridgeCommandDue('2026-09-12T12:00:01Z', Date.parse('2026-09-12T12:00:00Z')), false);

console.log('GITHUB BRIDGE TEST PASS');
console.log('Checked: Facebook command validation, image URL, schedule normalization, idempotency key and due-time logic.');
