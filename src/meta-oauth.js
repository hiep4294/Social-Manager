function version() {
  return process.env.META_GRAPH_VERSION || 'v23.0';
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu cấu hình ${name}`);
  return value;
}

export function metaRedirectUri(publicBase) {
  return process.env.META_REDIRECT_URI || `${String(publicBase).replace(/\/$/, '')}/api/meta/oauth/callback`;
}

export function metaScopes() {
  return (process.env.META_OAUTH_SCOPES || 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

export function buildMetaAuthUrl({ publicBase, state }) {
  const appId = required('META_APP_ID');
  const redirectUri = metaRedirectUri(publicBase);
  const url = new URL(`https://www.facebook.com/${version()}/dialog/oauth`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', metaScopes().join(','));

  if (process.env.META_CONFIG_ID) {
    url.searchParams.set('config_id', process.env.META_CONFIG_ID);
    url.searchParams.set('override_default_response_type', 'true');
  }
  return url.toString();
}

async function graphJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `Meta API lỗi HTTP ${response.status}`);
  }
  return data;
}

export async function exchangeMetaCode({ code, publicBase }) {
  const appId = required('META_APP_ID');
  const appSecret = required('META_APP_SECRET');
  const redirectUri = metaRedirectUri(publicBase);
  const tokenUrl = new URL(`https://graph.facebook.com/${version()}/oauth/access_token`);
  tokenUrl.searchParams.set('client_id', appId);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);
  const short = await graphJson(tokenUrl);
  if (!short.access_token) throw new Error('Meta không trả về access token');

  try {
    const longUrl = new URL(`https://graph.facebook.com/${version()}/oauth/access_token`);
    longUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longUrl.searchParams.set('client_id', appId);
    longUrl.searchParams.set('client_secret', appSecret);
    longUrl.searchParams.set('fb_exchange_token', short.access_token);
    const long = await graphJson(longUrl);
    return {
      accessToken: long.access_token || short.access_token,
      expiresIn: Number(long.expires_in || short.expires_in || 0) || null
    };
  } catch {
    return {
      accessToken: short.access_token,
      expiresIn: Number(short.expires_in || 0) || null
    };
  }
}

export async function listMetaPages(userAccessToken) {
  const first = new URL(`https://graph.facebook.com/${version()}/me/accounts`);
  first.searchParams.set('fields', 'id,name,category,access_token,instagram_business_account{id,username,name,profile_picture_url}');
  first.searchParams.set('limit', '100');
  first.searchParams.set('access_token', userAccessToken);

  const pages = [];
  let next = first.toString();
  while (next && pages.length < 500) {
    const data = await graphJson(next);
    for (const page of data.data || []) {
      if (!page?.id || !page?.access_token) continue;
      pages.push({
        pageId: String(page.id),
        pageName: page.name || '',
        category: page.category || '',
        pageAccessToken: page.access_token,
        instagram: page.instagram_business_account ? {
          id: String(page.instagram_business_account.id),
          username: page.instagram_business_account.username || '',
          name: page.instagram_business_account.name || '',
          picture: page.instagram_business_account.profile_picture_url || ''
        } : null
      });
    }
    next = data?.paging?.next || null;
  }
  return pages;
}
