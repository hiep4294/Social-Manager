import assert from 'node:assert/strict';

import {
  buildFoodPhotoPrompt,
  generateFoodPhotoWithOpenAI,
} from '../src/openai-food-image.js';

const recipe = {
  title: 'Gà rang gừng',
  ingredients: [
    '700g thịt gà',
    '40g gừng',
    '2 muỗng canh nước mắm',
    '1 muỗng cà phê đường',
    'hành tím',
  ],
  steps: [
    'Gà chặt miếng và ướp gia vị.',
    'Phi thơm gừng.',
    'Rang gà lửa vừa.',
    'Rim đến khi thấm.',
  ],
};

const prompt = buildFoodPhotoPrompt({
  recipe,
  pageName: 'Hôm Nay Ăn Gì?',
});

assert.match(prompt, /Gà rang gừng/);
assert.match(prompt, /Vietnamese food/i);
assert.match(prompt, /NO text/i);
assert.match(prompt, /NO logo/i);
assert.match(prompt, /upper-left/i);
assert.match(prompt, /lower-left/i);

await assert.rejects(
  () =>
    generateFoodPhotoWithOpenAI({
      recipe,
      pageName: 'Hôm Nay Ăn Gì?',
      outDir: 'artifacts/test-food-image',
      date: '2099-01-01',
      stateKey: 'test',
      apiKey: '',
    }),
  /OPENAI_API_KEY/
);

console.log('OpenAI food image helper OK');
