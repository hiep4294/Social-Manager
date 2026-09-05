async function graphPost(path, params) {
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const endpoint = `https://graph.facebook.com/${version}/${path}`;
  const body = new URLSearchParams({ ...params, access_token: token });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Instagram Graph API lỗi');
  return data;
}

export async function publishInstagram({ message, imageUrl }) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !token) {
    throw new Error('Instagram chưa được cấu hình USER_ID hoặc ACCESS_TOKEN');
  }
  if (!imageUrl) {
    throw new Error('Instagram V1 yêu cầu ít nhất 1 ảnh công khai');
  }

  const container = await graphPost(`${userId}/media`, {
    image_url: imageUrl,
    caption: message || ''
  });

  return graphPost(`${userId}/media_publish`, {
    creation_id: container.id
  });
}
