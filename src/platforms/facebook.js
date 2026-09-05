export async function publishFacebook({ message, imageUrl, pageId, accessToken }) {
  const resolvedPageId = pageId || process.env.FACEBOOK_PAGE_ID;
  const token = accessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const version = process.env.META_GRAPH_VERSION || 'v23.0';

  if (!resolvedPageId || !token) {
    throw new Error('Facebook chưa được kết nối hoặc thiếu Page Access Token');
  }

  if (process.env.DEMO_MODE === 'true') {
    return {
      id: `demo-facebook-${Date.now()}`,
      demo: true,
      page_id: resolvedPageId,
      has_image: Boolean(imageUrl),
      message_length: String(message || '').length
    };
  }

  const endpoint = imageUrl
    ? `https://graph.facebook.com/${version}/${resolvedPageId}/photos`
    : `https://graph.facebook.com/${version}/${resolvedPageId}/feed`;

  const body = new URLSearchParams();
  body.set('access_token', token);
  if (imageUrl) {
    body.set('url', imageUrl);
    body.set('caption', message || '');
  } else {
    body.set('message', message || '');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || 'Facebook Graph API lỗi');
  }

  return data;
}
