import fs from 'node:fs';
import path from 'node:path';
import { foodPageBlueprints, foodRecipes, plannedCreateDate, pickRecipeForPage, buildRecipePost } from '../src/food-network-core.js';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const publicDir = path.join(root, 'public');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

const startDate = process.env.FOOD_NETWORK_START_DATE || new Date().toISOString();
const days = Math.max(30, Math.min(366, Number(process.env.FOOD_NETWORK_PLAN_DAYS || 30)));
const pages = foodPageBlueprints().map(page => ({
  ...page,
  planned_create_at: plannedCreateDate(startDate, page.slot),
  status: 'PLANNED',
  publishing: 'APPROVAL_REQUIRED'
}));

const recipes = foodRecipes();
const calendar = [];
for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
  const date = new Date(new Date(startDate).getTime() + dayOffset * 86400000).toISOString().slice(0, 10);
  const used = [];
  for (const page of pages) {
    const recipe = pickRecipeForPage({ pageSlot: page.slot, date, usedRecipeIds: used });
    used.push(recipe.id);
    const rendered = buildRecipePost({ page, recipe });
    calendar.push({
      date,
      page_slot: page.slot,
      page_name: page.name,
      theme: page.theme,
      recipe_id: recipe.id,
      recipe_title: recipe.title,
      content: rendered.content,
      image_prompt: rendered.imagePrompt,
      image_status: 'NEEDS_DISH_IMAGE',
      approval_status: 'PENDING'
    });
  }
}

const output = {
  version: 1,
  generated_at: new Date().toISOString(),
  start_date: startDate,
  target_pages: 24,
  create_rate: '2 pages/month',
  post_rate: '1 post/day/active page',
  safety_mode: 'APPROVAL_REQUIRED',
  pages,
  recipes_count: recipes.length,
  plan_days: days,
  calendar
};

const planPath = path.join(dataDir, 'food-network-plan.json');
const statusPath = path.join(publicDir, 'food-network-status.json');
fs.writeFileSync(planPath, JSON.stringify(output, null, 2), 'utf8');
fs.writeFileSync(statusPath, JSON.stringify({
  generated_at: output.generated_at,
  target_pages: output.target_pages,
  pages_planned: pages.length,
  recipes_count: recipes.length,
  plan_days: days,
  planned_posts: calendar.length,
  safety_mode: output.safety_mode,
  next_pages: pages.slice(0, 6),
  sample_today: calendar.slice(0, 24)
}, null, 2), 'utf8');

console.log(`Food Network plan: ${pages.length} pages, ${calendar.length} bài dự kiến trong ${days} ngày.`);
console.log(`Plan: ${planPath}`);
console.log(`Status: ${statusPath}`);
