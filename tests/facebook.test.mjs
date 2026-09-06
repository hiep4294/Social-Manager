import assert from 'node:assert/strict';
import { publishFacebook } from '../src/platforms/facebook.js';

const originalFetch = globalThis.fetch;
const originalEnv = {
  FACEBOOK_PAGE_ID: process.env.FACEBOOK_PAGE_ID,
  FACEBOOK_PAGE_ACCESS_TOKEN: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
  META_GRAPH_VERSION: process.env.META_GRAPH_VERSION,
  DEMO_MODE: process.env.DEMO_MODE
};

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

try {
  delete process.env.FACEBOOK_PAGE_ID;
  delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  delete process.env.DEMO_MODE;
  process.env.META_GRAPH_VERSION = 'v99.0';

  await assert.rejects(
    () => publishFacebook({ message: 'test' }),
    /Facebook chưa được kết nối hoặc thiếu Page Access Token/,
    'Phải từ chối khi thiếu Page ID/token'
  );

  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return { ok: true, json: async () => ({ id: 'page_123_post_456' }) };
  };

  const textResult = await publishFacebook({
    message: 'Bài kiểm thử Facebook',
    pageId: 'page_123',
    accessToken: 'token_secret'
  });

  assert.equal(textResult.id, 'page_123_post_456');
  assert.equal(captured.url, 'https://graph.facebook.com/v99.0/page_123/feed');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const textBody = new URLSearchParams(captured.options.body);
  assert.equal(textBody.get('access_token'), 'token_secret');
  assert.equal(textBody.get('message'), 'Bài kiểm thử Facebook');
  assert.equal(textBody.has('url'), false);
  assert.equal(textBody.has('caption'), false);

  captured = null;
  const imageResult = await publishFacebook({
    message: 'Ảnh kiểm thử Facebook',
    imageUrl: 'https://example.com/test.jpg',
    pageId: 'page_789',
    accessToken: 'token_image'
  });

  assert.equal(imageResult.id, 'page_123_post_456');
  assert.equal(captured.url, 'https://graph.facebook.com/v99.0/page_789/photos');
  const imageBody = new URLSearchParams(captured.options.body);
  assert.equal(imageBody.get('access_token'), 'token_image');
  assert.equal(imageBody.get('url'), 'https://example.com/test.jpg');
  assert.equal(imageBody.get('caption'), 'Ảnh kiểm thử Facebook');
  assert.equal(imageBody.has('message'), false);

  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ error: { message: 'Invalid OAuth access token.' } })
  });
  await assert.rejects(
    () => publishFacebook({ message: 'x', pageId: 'page_1', accessToken: 'bad' }),
    /Invalid OAuth access token\./,
    'Phải trả đúng lỗi Graph API'
  );

  process.env.DEMO_MODE = 'true';
  globalThis.fetch = async () => {
    throw new Error('DEMO_MODE không được gọi mạng');
  };
  const demo = await publishFacebook({
    message: 'Demo Facebook',
    pageId: 'demo_page',
    accessToken: 'demo_token'
  });
  assert.equal(demo.demo, true);
  assert.equal(demo.page_id, 'demo_page');
  assert.equal(demo.has_image, false);
  assert.match(demo.id, /^demo-facebook-/);

  console.log('FACEBOOK ADAPTER TEST PASS');
  console.log('Checked: missing credentials, text post payload, photo post payload, Graph API error propagation, DEMO_MODE network isolation.');
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv('FACEBOOK_PAGE_ID', originalEnv.FACEBOOK_PAGE_ID);
  restoreEnv('FACEBOOK_PAGE_ACCESS_TOKEN', originalEnv.FACEBOOK_PAGE_ACCESS_TOKEN);
  restoreEnv('META_GRAPH_VERSION', originalEnv.META_GRAPH_VERSION);
  restoreEnv('DEMO_MODE', originalEnv.DEMO_MODE);
}
