async function graphPost(path, params, accessToken) {
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  const token = accessToken || process.env.INSTAGRAM_ACCESS_TOKEN;
  const endpoint = `https://graph.facebook.com/${version}/${path}`;
  const body = new URLSearchParams({ ...params, access_token: token || '' });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error?.message || 'Instagram Graph API lỗi');
  return data;
}

export async function publishInstagram({ message, imageUrl, userId, accessToken }) {
  const resolvedUserId = userId || process.env.INSTAGRAM_USER_ID;
  const token = accessToken || process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!resolvedUserId || !token) {
    throw new Error('Instagram chưa được kết nối hoặc thiếu Access Token');
  }
  if (!imageUrl) {
    throw new Error('Instagram yêu cầu ít nhất 1 ảnh có URL công khai');
  }

  if (process.env.DEMO_MODE === 'true') {
    return {
      id: `demo-instagram-${Date.now()}`,
      demo: true,
      instagram_user_id: resolvedUserId,
      image_url: imageUrl,
      caption_length: String(message || '').length
    };
  }

  const container = await graphPost(`${resolvedUserId}/media`, {
    image_url: imageUrl,
    caption: message || ''
  }, token);

  return graphPost(`${resolvedUserId}/media_publish`, {
    creation_id: container.id
  }, token);
}
