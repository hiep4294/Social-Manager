import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { enqueueOperatorJob, ensureOperatorSchema, normalizeOperatorJob } from '../src/facebook-operator-core.js';

assert.equal(normalizeOperatorJob({ action: 'create_page', payload: { name: 'KODS Hà Nội', category: 'Business' } }).ok, true);
assert.equal(normalizeOperatorJob({ action: 'create_page', payload: {} }).ok, false);
assert.equal(normalizeOperatorJob({ action: 'create_group', payload: { name: 'Hội kỹ thuật', privacy: 'PUBLIC' } }).ok, true);
assert.equal(normalizeOperatorJob({ action: 'create_group', payload: { name: 'Hội kỹ thuật', privacy: 'SECRET' } }).ok, false);
assert.equal(normalizeOperatorJob({ action: 'join_group', payload: { group_url: 'https://www.facebook.com/groups/123' } }).ok, true);
assert.equal(normalizeOperatorJob({ action: 'join_group', payload: { group_url: 'file:///tmp/x' } }).ok, false);
assert.equal(normalizeOperatorJob({ action: 'post_group', payload: { group_url: 'https://facebook.com/groups/123', message: 'Xin chào' } }).ok, true);
assert.equal(normalizeOperatorJob({ action: 'comment_group', payload: { post_url: 'https://facebook.com/groups/123/posts/456', message: 'Cảm ơn' } }).ok, true);
assert.equal(normalizeOperatorJob({ action: 'delete_group', payload: {} }).ok, false);

const db = new Database(':memory:');
ensureOperatorSchema(db);
const first = enqueueOperatorJob(db, {
  id: 'job-1',
  brand_id: 1,
  action: 'create_page',
  payload: { name: 'KODS Hà Nội', bio: 'Cửa cuốn' },
  scheduled_at: '2026-09-12T19:00:00+07:00'
});
assert.equal(first.id, 'job-1');
assert.equal(first.status, 'QUEUED');
assert.equal(first.scheduled_at, '2026-09-12T12:00:00.000Z');
const duplicate = enqueueOperatorJob(db, {
  id: 'job-1',
  action: 'create_page',
  payload: { name: 'Khác' }
});
assert.equal(duplicate.id, 'job-1');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM facebook_operator_jobs').get().n, 1);
db.close();

console.log('FACEBOOK OPERATOR CORE TEST PASS');
