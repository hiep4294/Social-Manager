import { publishFacebook } from '../src/platforms/facebook.js';

const pageId = String(process.env.FACEBOOK_PAGE_ID || '').trim();
const accessToken = String(process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim();

if (!pageId || !accessToken) {
  console.error('FACEBOOK_LIVE_TEST_BLOCKED: thiếu GitHub Actions secrets FACEBOOK_PAGE_ID hoặc FACEBOOK_PAGE_ACCESS_TOKEN.');
  process.exit(2);
}

const message = String(
  process.env.FACEBOOK_TEST_MESSAGE ||
  `[TEST] Social Manager V1.1 - kiểm thử đăng bài Facebook tự động - ${new Date().toISOString()}`
);

try {
  const result = await publishFacebook({ message, pageId, accessToken });
  if (!result?.id) throw new Error(`Facebook không trả về post id: ${JSON.stringify(result)}`);
  console.log(`FACEBOOK_LIVE_TEST_PASS post_id=${result.id}`);
} catch (error) {
  console.error(`FACEBOOK_LIVE_TEST_FAIL: ${String(error?.message || error)}`);
  process.exit(1);
}
