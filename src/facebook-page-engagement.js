export function graphVersion() {
  return process.env.META_GRAPH_VERSION || 'v26.0';
}

async function graphJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `Meta API lỗi HTTP ${response.status}`);
  }
  return data;
}

export async function listPagePostsWithComments({ pageId, accessToken, postLimit = 15, commentLimit = 50 }) {
  if (!pageId || !accessToken) throw new Error('Thiếu Facebook Page hoặc Page Access Token');
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(pageId)}/feed`);
  url.searchParams.set('fields', `id,message,created_time,permalink_url,comments.limit(${Math.max(1, Math.min(100, Number(commentLimit) || 50))}){id,message,created_time,from,parent}`);
  url.searchParams.set('limit', String(Math.max(1, Math.min(100, Number(postLimit) || 15))));
  url.searchParams.set('access_token', accessToken);
  return graphJson(url);
}

export async function commentOnFacebookObject({ objectId, message, accessToken }) {
  if (!objectId) throw new Error('Thiếu Facebook object/comment id');
  if (!String(message || '').trim()) throw new Error('Nội dung bình luận đang trống');
  if (!accessToken) throw new Error('Thiếu Page Access Token');

  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(objectId)}/comments`);
  const body = new URLSearchParams();
  body.set('message', String(message));
  body.set('access_token', accessToken);
  return graphJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
}

function normalized(text = '') {
  return String(text).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function classifyPageCommentRisk(message = '') {
  const text = normalized(message);
  const high = [
    /tai nạn/u, /thương tích/u, /bồi thường/u, /khởi kiện/u, /kiện/u,
    /cháy(?:\s|$)/u, /hỏa hoạn/u, /điện giật/u, /nguy hiểm/u, /tử vong/u,
    /công an/u, /luật sư/u, /pháp lý/u, /tố cáo/u
  ];
  const medium = [
    /khiếu nại/u, /hoàn tiền/u, /trả tiền/u, /hỏng/u, /bị lỗi/u, /lỗi/u,
    /không hoạt động/u, /bảo hành/u, /chiết khấu/u, /giảm thêm/u, /quá đắt/u,
    /không hài lòng/u, /tệ/u
  ];
  if (high.some(re => re.test(text))) return 'HIGH';
  if (medium.some(re => re.test(text))) return 'MEDIUM';
  return 'LOW';
}

export function draftSafePageReply(message = '', brand = {}) {
  const text = normalized(message);
  const name = String(brand?.name || 'chúng tôi').trim() || 'chúng tôi';
  const phone = String(brand?.phone || '').trim();
  const address = String(brand?.address || '').trim();
  const hours = String(brand?.opening_hours || '').trim();

  if (/giá|bao nhiêu|báo giá|price/u.test(text)) {
    return `Chào anh/chị. Giá phụ thuộc cấu hình và kích thước thực tế. Anh/chị gửi giúp kích thước hoặc nhu cầu cụ thể${phone ? `, hoặc liên hệ ${phone}` : ''} để ${name} báo giá chính xác.`;
  }
  if (/địa chỉ|ở đâu|chỗ nào|location/u.test(text)) {
    return address ? `${name} tại ${address}. Anh/chị cần chỉ đường hoặc tư vấn thêm cứ nhắn tại đây.` : `Anh/chị vui lòng nhắn khu vực cần hỗ trợ, ${name} sẽ gửi địa chỉ phù hợp.`;
  }
  if (/mấy giờ|giờ mở cửa|giờ làm việc|open/u.test(text)) {
    return hours ? `Giờ làm việc của ${name}: ${hours}.` : `${name} đã nhận được câu hỏi về giờ làm việc và sẽ phản hồi ngay.`;
  }
  if (/số điện thoại|liên hệ|hotline|phone/u.test(text)) {
    return phone ? `Anh/chị có thể liên hệ ${name} qua số ${phone}.` : `${name} đã nhận được yêu cầu liên hệ. Anh/chị có thể để lại số điện thoại qua tin nhắn riêng.`;
  }
  if (/cảm ơn|thanks|thank you/u.test(text)) {
    return `${name} cảm ơn anh/chị đã quan tâm và phản hồi.`;
  }
  if (/xin chào|chào|hello|hi\b/u.test(text)) {
    return `Chào anh/chị. ${name} có thể hỗ trợ anh/chị thông tin gì?`;
  }
  return `Cảm ơn anh/chị đã để lại bình luận. ${name} đã ghi nhận và sẽ hỗ trợ thêm nếu anh/chị cung cấp nhu cầu cụ thể.`;
}
