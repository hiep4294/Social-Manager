export async function publishFacebook({ message, imageUrl }) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const version = process.env.META_GRAPH_VERSION || 'v23.0';

  if (!pageId || !token) {
    throw new Error('Facebook chưa được cấu hình PAGE_ID hoặc PAGE_ACCESS_TOKEN');
  }

  const endpoint = imageUrl
    ? `https://graph.facebook.com/${version}/${pageId}/photos`
    : `https://graph.facebook.com/${version}/${pageId}/feed`;

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

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Facebook Graph API lỗi');
  }

  return data;
}
