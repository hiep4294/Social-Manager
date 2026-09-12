import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizeText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function wrapWords(text, maxChars = 32, maxLines = 7) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(' ').length;
  if (consumed < normalizeText(text).length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/u, '')}…`;
  }
  return lines;
}

export function inferVisualTone(message = '') {
  const text = normalizeText(message).toLowerCase();
  if (/khuyến mãi|giảm giá|ưu đãi|sale|voucher|\b\d+%/u.test(text)) return 'promo';
  if (/xin chào|chào mừng|chúc|cảm ơn|tri ân|welcome/u.test(text)) return 'greeting';
  if (/cảnh báo|thông báo|lưu ý|bảo trì|tạm ngừng/u.test(text)) return 'notice';
  if (/ra mắt|sản phẩm mới|mới về|khai trương|new/u.test(text)) return 'launch';
  return 'professional';
}

function palette(tone) {
  switch (tone) {
    case 'promo':
      return { a: '#7c2d12', b: '#ea580c', accent: '#fed7aa', text: '#ffffff', sub: '#ffedd5' };
    case 'greeting':
      return { a: '#0f766e', b: '#0891b2', accent: '#a7f3d0', text: '#ffffff', sub: '#ccfbf1' };
    case 'notice':
      return { a: '#7f1d1d', b: '#b91c1c', accent: '#fecaca', text: '#ffffff', sub: '#fee2e2' };
    case 'launch':
      return { a: '#312e81', b: '#7c3aed', accent: '#ddd6fe', text: '#ffffff', sub: '#ede9fe' };
    default:
      return { a: '#0f172a', b: '#1d4ed8', accent: '#bfdbfe', text: '#ffffff', sub: '#dbeafe' };
  }
}

export async function createSocialImage({
  message,
  brandName = 'Social Manager',
  publicBase,
  uploadDir,
  tone = 'auto'
}) {
  if (!publicBase) throw new Error('Thiếu PUBLIC_BASE_URL để tạo ảnh đăng mạng xã hội');
  if (!uploadDir) throw new Error('Thiếu thư mục upload');

  fs.mkdirSync(uploadDir, { recursive: true });

  const resolvedTone = tone === 'auto' ? inferVisualTone(message) : tone;
  const colors = palette(resolvedTone);
  const lines = wrapWords(message, 31, 7);
  const titleY = Math.max(330, 520 - (lines.length * 42));
  const lineHeight = 76;
  const textNodes = lines.map((line, i) => (
    `<text x="92" y="${titleY + i * lineHeight}" font-size="58" font-weight="700" fill="${colors.text}" font-family="Arial, DejaVu Sans, sans-serif">${escapeXml(line)}</text>`
  )).join('\n');

  const svg = `
  <svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${colors.a}"/>
        <stop offset="100%" stop-color="${colors.b}"/>
      </linearGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="24"/></filter>
    </defs>
    <rect width="1080" height="1080" rx="0" fill="url(#bg)"/>
    <circle cx="910" cy="170" r="230" fill="${colors.accent}" opacity="0.16"/>
    <circle cx="980" cy="940" r="320" fill="#ffffff" opacity="0.08"/>
    <circle cx="120" cy="1010" r="210" fill="${colors.accent}" opacity="0.10"/>
    <rect x="72" y="72" width="936" height="936" rx="46" fill="#ffffff" opacity="0.035" stroke="#ffffff" stroke-opacity="0.16"/>
    <text x="92" y="150" font-size="30" font-weight="700" letter-spacing="1.5" fill="${colors.sub}" font-family="Arial, DejaVu Sans, sans-serif">${escapeXml(brandName.toUpperCase())}</text>
    <rect x="92" y="188" width="92" height="8" rx="4" fill="${colors.accent}"/>
    ${textNodes}
    <text x="92" y="956" font-size="24" fill="${colors.sub}" font-family="Arial, DejaVu Sans, sans-serif">Nội dung được chuẩn bị tự động bởi Social Manager</text>
  </svg>`;

  const filename = `auto-social-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
  const outputPath = path.join(uploadDir, filename);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outputPath);

  const base = String(publicBase).replace(/\/$/, '');
  return {
    path: outputPath,
    filename,
    url: `${base}/uploads/${encodeURIComponent(filename)}`,
    tone: resolvedTone,
    width: 1080,
    height: 1080
  };
}
