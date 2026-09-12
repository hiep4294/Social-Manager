import assert from 'node:assert/strict';
import { classifyPageCommentRisk, commentOnFacebookObject, draftSafePageReply, listPagePostsWithComments } from '../src/facebook-page-engagement.js';

const savedFetch = global.fetch;
const savedVersion = process.env.META_GRAPH_VERSION;
process.env.META_GRAPH_VERSION = 'v26.0';

try {
  assert.equal(classifyPageCommentRisk('Giá bao nhiêu vậy?'), 'LOW');
  assert.equal(classifyPageCommentRisk('Sản phẩm bị lỗi, tôi muốn khiếu nại'), 'MEDIUM');
  assert.equal(classifyPageCommentRisk('Cửa gây tai nạn, tôi yêu cầu bồi thường'), 'HIGH');

  const brand = { name: 'Kodsdoor', phone: '0123456789', address: 'Hà Nội', opening_hours: '8:00-17:30' };
  assert.match(draftSafePageReply('Giá bao nhiêu?', brand), /Kodsdoor|0123456789/);
  assert.match(draftSafePageReply('Địa chỉ ở đâu?', brand), /Hà Nội/);
  assert.match(draftSafePageReply('Số điện thoại?', brand), /0123456789/);

  let calls = 0;
  global.fetch = async input => {
    const url = new URL(String(input));
    calls += 1;
    if (calls === 1) {
      assert.equal(url.pathname, '/v26.0/page-1/feed');
      assert.equal(url.searchParams.get('access_token'), 'page-token');
      assert.match(url.searchParams.get('fields') || '', /comments/);
      return new Response(JSON.stringify({ data: [{ id: 'post-1', comments: { data: [{ id: 'comment-1', message: 'Xin chào' }] } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    assert.equal(url.pathname, '/v26.0/comment-1/comments');
    const body = input instanceof Request ? await input.text() : '';
    return new Response(JSON.stringify({ id: 'reply-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const feed = await listPagePostsWithComments({ pageId: 'page-1', accessToken: 'page-token' });
  assert.equal(feed.data[0].id, 'post-1');

  global.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/v26.0/comment-1/comments');
    const params = new URLSearchParams(String(options.body));
    assert.equal(params.get('message'), 'Cảm ơn bạn');
    assert.equal(params.get('access_token'), 'page-token');
    return new Response(JSON.stringify({ id: 'reply-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const reply = await commentOnFacebookObject({ objectId: 'comment-1', message: 'Cảm ơn bạn', accessToken: 'page-token' });
  assert.equal(reply.id, 'reply-1');

  console.log('FACEBOOK ENGAGEMENT TEST PASS');
} finally {
  global.fetch = savedFetch;
  if (savedVersion === undefined) delete process.env.META_GRAPH_VERSION;
  else process.env.META_GRAPH_VERSION = savedVersion;
}
