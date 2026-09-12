import assert from 'node:assert/strict';
import { buildMetaAuthUrl, exchangeMetaCode, listMetaPages, metaRedirectUri, metaScopes } from '../src/meta-oauth.js';

const savedEnv = { ...process.env };
const savedFetch = global.fetch;

try {
  process.env.META_APP_ID = 'app-123';
  process.env.META_APP_SECRET = 'secret-456';
  process.env.META_GRAPH_VERSION = 'v26.0';
  process.env.META_REDIRECT_URI = '';
  process.env.META_OAUTH_SCOPES = '';

  const redirect = metaRedirectUri('https://example.test/');
  assert.equal(redirect, 'https://example.test/api/meta/oauth/callback');
  assert.deepEqual(metaScopes(), ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']);

  const authUrl = new URL(buildMetaAuthUrl({ publicBase: 'https://example.test', state: 'state-xyz' }));
  assert.equal(authUrl.hostname, 'www.facebook.com');
  assert.equal(authUrl.pathname, '/v26.0/dialog/oauth');
  assert.equal(authUrl.searchParams.get('client_id'), 'app-123');
  assert.equal(authUrl.searchParams.get('redirect_uri'), redirect);
  assert.equal(authUrl.searchParams.get('state'), 'state-xyz');
  assert.equal(authUrl.searchParams.get('scope'), 'pages_show_list,pages_read_engagement,pages_manage_posts');

  let tokenCall = 0;
  global.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/oauth/access_token')) {
      tokenCall += 1;
      assert.match(url.pathname, /^\/v26\.0\/oauth\/access_token$/);
      if (url.searchParams.get('grant_type') === 'fb_exchange_token') {
        return new Response(JSON.stringify({ access_token: 'long-token', expires_in: 5184000 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      assert.equal(url.searchParams.get('client_id'), 'app-123');
      assert.equal(url.searchParams.get('client_secret'), 'secret-456');
      assert.equal(url.searchParams.get('code'), 'auth-code');
      assert.equal(url.searchParams.get('redirect_uri'), redirect);
      return new Response(JSON.stringify({ access_token: 'short-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const exchanged = await exchangeMetaCode({ code: 'auth-code', publicBase: 'https://example.test' });
  assert.equal(tokenCall, 2);
  assert.equal(exchanged.accessToken, 'long-token');
  assert.equal(exchanged.expiresIn, 5184000);

  let pageCall = 0;
  global.fetch = async input => {
    const url = new URL(String(input));
    pageCall += 1;
    if (pageCall === 1) {
      assert.equal(url.pathname, '/v26.0/me/accounts');
      assert.equal(url.searchParams.get('access_token'), 'user-token');
      assert.equal(url.searchParams.get('fields'), 'id,name,category,access_token');
      return new Response(JSON.stringify({
        data: [{
          id: 'page-1',
          name: 'Page One',
          category: 'Restaurant',
          access_token: 'page-token-1'
        }],
        paging: { next: 'https://graph.facebook.com/v26.0/next-page' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (pageCall === 2) {
      return new Response(JSON.stringify({
        data: [{ id: 'page-2', name: 'Page Two', access_token: 'page-token-2' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('Unexpected pagination call');
  };

  const pages = await listMetaPages('user-token');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].pageId, 'page-1');
  assert.equal(pages[0].pageAccessToken, 'page-token-1');
  assert.equal(pages[0].instagram, null);
  assert.equal(pages[1].pageId, 'page-2');
  assert.equal(pages[1].instagram, null);

  global.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid OAuth token' } }), {
    status: 400,
    headers: { 'content-type': 'application/json' }
  });
  await assert.rejects(() => listMetaPages('bad-token'), /Invalid OAuth token/);

  console.log('META OAUTH TEST PASS');
  console.log('Checked: Graph API v26.0, Facebook Page scopes, code exchange, long-lived token exchange, Page discovery, pagination and Meta errors.');
} finally {
  global.fetch = savedFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}
