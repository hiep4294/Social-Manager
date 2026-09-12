import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSocialImage, inferVisualTone } from '../src/social-image.js';

assert.equal(inferVisualTone('Xin chào quý khách'), 'greeting');
assert.equal(inferVisualTone('Giảm giá 20% cuối tuần'), 'promo');
assert.equal(inferVisualTone('Thông báo bảo trì hệ thống'), 'notice');
assert.equal(inferVisualTone('Sản phẩm mới đã về'), 'launch');
assert.equal(inferVisualTone('Giải pháp cửa cuốn cho công trình'), 'professional');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-image-'));
const result = await createSocialImage({
  message: 'Xin chào quý khách. Chúc một ngày làm việc hiệu quả.',
  brandName: 'Kodsdoor',
  publicBase: 'https://example.test',
  uploadDir: dir,
  tone: 'auto'
});

assert.equal(result.tone, 'greeting');
assert.equal(result.width, 1080);
assert.equal(result.height, 1080);
assert.match(result.url, /^https:\/\/example\.test\/uploads\/auto-social-/);
assert.equal(fs.existsSync(result.path), true);
const buffer = fs.readFileSync(result.path);
assert.equal(buffer[0], 0x89);
assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
assert.ok(buffer.length > 1000);

fs.rmSync(dir, { recursive: true, force: true });
console.log('SOCIAL IMAGE TEST PASS');
console.log('Checked: tone inference and 1080x1080 PNG generation.');
