import assert from 'node:assert/strict';
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
  assert.match(post.content, /NGUYÊN LIỆU/);
  assert.match(post.content, /CÁCH LÀM/);
  assert.match(post.content, /MẸO NHỎ/);
  assert.match(post.imagePrompt, /không chữ/);
}

console.log(`Food Network OK: ${pages.length} pages, ${recipes.length} recipes, 24 món không trùng trong ngày.`);
