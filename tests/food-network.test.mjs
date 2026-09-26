import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  foodPageBlueprints,
  foodRecipes,
  plannedCreateDate,
  pickRecipeForPage,
  buildRecipePost
} from '../src/food-network-core.js';

const pages = foodPageBlueprints();
assert.equal(pages.length, 24, 'phải có đúng 24 Page');
assert.equal(new Set(pages.map(x => x.name)).size, 24, 'tên Page phải không trùng');

const recipes = foodRecipes();
assert.ok(recipes.length >= 48, 'cần tối thiểu 48 công thức');
assert.equal(new Set(recipes.map(x => x.title)).size, recipes.length, 'công thức không được trùng tên');

const start = '2026-09-14T00:00:00.000Z';
const createDates = pages.map(p => plannedCreateDate(start, p.slot));
assert.equal(createDates.length, 24);
for (let i = 1; i < createDates.length; i += 1) {
  assert.ok(new Date(createDates[i]) >= new Date(createDates[i - 1]), 'lịch tạo Page phải tăng dần');
}

const used = [];
for (const page of pages) {
  const recipe = pickRecipeForPage({ pageSlot: page.slot, date: '2026-09-14', usedRecipeIds: used });
  assert.ok(recipe?.id);
  assert.ok(!used.includes(recipe.id), 'trong cùng ngày 24 Page không dùng cùng món');
  used.push(recipe.id);
  const post = buildRecipePost({ page, recipe });
  assert.match(post.content, /CÔNG THỨC CHI TIẾT/);
  assert.match(post.content, /NGUYÊN LIỆU/);
  assert.match(post.content, /SƠ CHẾ & CHUẨN BỊ/);
  assert.match(post.content, /CÁCH LÀM CHI TIẾT/);
  assert.match(post.content, /DẤU HIỆU MÓN ĐẠT/);
  assert.match(post.content, /MẸO QUAN TRỌNG/);
  assert.match(post.content, /LỖI THƯỜNG GẶP & CÁCH TRÁNH/);
  assert.match(post.content, /CÁCH DÙNG & BẢO QUẢN/);
  assert.ok(post.content.length >= 1200, 'công thức phải đủ chi tiết, không được quá ngắn');
  assert.equal(post.recipeDetail?.format_version, 'detailed-v2');
  assert.match(post.imagePrompt, /không chữ/);
}

for (const recipe of recipes) {
  const post = buildRecipePost({
    page:{ slot:6, name:'Món Ngon Dễ Làm', theme:'Công thức cơ bản', voice:'rõ bước, dễ theo' },
    recipe
  });

  assert.ok(
    post.content.length >= 1200,
    `công thức ${recipe.title} quá ngắn: ${post.content.length} ký tự`
  );
  assert.match(post.content, /CÔNG THỨC CHI TIẾT/);
  assert.match(post.content, /SƠ CHẾ & CHUẨN BỊ/);
  assert.match(post.content, /CÁCH LÀM CHI TIẾT/);
  assert.match(post.content, /DẤU HIỆU MÓN ĐẠT/);
  assert.match(post.content, /LỖI THƯỜNG GẶP & CÁCH TRÁNH/);
  assert.match(post.content, /CÁCH DÙNG & BẢO QUẢN/);
}

const thitKhoTrung = recipes.find(x => x.title === 'Thịt kho trứng');
const thitKhoPost = buildRecipePost({
  page:{ slot:6, name:'Món Ngon Dễ Làm', theme:'Công thức cơ bản', voice:'rõ bước, dễ theo' },
  recipe:thitKhoTrung
});

assert.match(
  thitKhoPost.content,
  /6 trứng gà: Kiểm tra vỏ nguyên, sạch/,
  'trứng gà không được phân loại nhầm thành thịt gia cầm'
);

assert.match(
  thitKhoPost.content,
  /màu cánh gián[\s\S]*Không để đường chuyển nâu đen/,
  'bước thắng đường phải có hướng dẫn caramel phù hợp'
);

const foodAgentSource = fs.readFileSync(
  path.resolve('scripts', 'food-local-agent.mjs'),
  'utf8'
);

assert.match(
  foodAgentSource,
  /buildImagePrompt\(page, recipe\)/,
  'Food Local Agent phải tạo prompt theo Page + món'
);
assert.match(
  foodAgentSource,
  /Typography tiếng Việt phải rõ ràng, đúng dấu/,
  'Prompt phải yêu cầu chữ tiếng Việt rõ và đúng dấu'
);
assert.match(
  foodAgentSource,
  /chatgpt-food-poster-v3/,
  'Ảnh nguồn phải có version poster ChatGPT'
);
assert.match(
  foodAgentSource,
  /sourceIsCurrentPoster/,
  'Ảnh legacy phải được phát hiện và tạo lại'
);
assert.match(
  foodAgentSource,
  /do not add a second title\/logo layer/,
  'Không được ghép title/logo lần hai lên poster ChatGPT'
);

const localConfig = JSON.parse(
  fs.readFileSync(path.resolve('config', 'food-local-pages.json'), 'utf8')
);

assert.equal(localConfig.publish?.enabled, true, 'publish của Food Local Agent phải được bật');
const enabledLocalPages = (localConfig.pages || []).filter(x => x.enabled);
assert.equal(enabledLocalPages.length, 1, 'chỉ được bật đúng 1 Page ở giai đoạn hiện tại');
assert.equal(enabledLocalPages[0].page_key, 'hom-nay-an-gi');

console.log(`Food Network OK: ${pages.length} pages, ${recipes.length} recipes, detailed-v2 + ChatGPT poster-v3 + verified publish config.`);
