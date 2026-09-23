import fs from 'node:fs';
import path from 'node:path';

export function buildFoodPhotoPrompt({
  recipe,
  pageName = '',
}) {
  if (!recipe?.title) {
    throw new Error('Recipe thiếu title');
  }

  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.slice(0, 8).join(', ')
    : '';

  const preparation = Array.isArray(recipe.steps)
    ? recipe.steps.slice(0, 4).join(' ')
    : '';

  return [
    'Create a premium photorealistic Vietnamese food photograph for a Facebook food page.',
    `DISH: ${recipe.title}.`,
    ingredients ? `INGREDIENT REFERENCE: ${ingredients}.` : '',
    preparation ? `PREPARATION REFERENCE: ${preparation}.` : '',
    'Square 1:1 social-media composition.',
    'The completed cooked dish is the hero subject and occupies roughly 65-75% of the frame.',
    'Food must look realistic, freshly cooked, appetizing and edible.',
    'Position the plate or bowl slightly to the right of center.',
    'Preserve relatively clean negative space in the upper-left and lower-left areas because exact branding and Vietnamese dish text will be overlaid later.',
    'Show a few relevant fresh ingredients naturally around the outer edges of the scene.',
    'Do not let props obscure the finished dish.',
    'Camera angle around 35-45 degrees.',
    'Natural soft restaurant or home-kitchen lighting.',
    'High detail in food texture.',
    'Vietnamese culinary presentation.',
    'Warm, premium, inviting color palette.',
    'Clean table styling.',
    pageName ? `Suitable for page: ${pageName}.` : '',
    'STRICT CONSTRAINTS: NO text, NO letters, NO numbers, NO captions, NO logo, NO watermark, NO human, NO hands, NO packaging, NO distorted utensils.',
    'Do not create a collage or illustration.',
    'Do not create an unfinished ingredient-only scene.',
    'The finished dish must remain the clear visual focus.',
  ].filter(Boolean).join(' ');
}

export async function generateFoodPhotoWithOpenAI({
  recipe,
  pageName,
  outDir,
  date,
  stateKey,
  apiKey,
  model = 'gpt-image-2',
  size = '1024x1024',
  quality = 'high',
}) {
  const rawKey = String(apiKey || '').trim();
  const key = rawKey
    .replace(/^["'\u2018\u2019\u201C\u201D]+/, '')
    .replace(/["'\u2018\u2019\u201C\u201D]+$/, '')
    .trim();

  if (!key) {
    throw new Error('Thiếu OPENAI_API_KEY');
  }

  if (!key.startsWith('sk-') || !/^[\x21-\x7E]+$/.test(key)) {
    throw new Error('OPENAI_API_KEY không đúng định dạng API key ASCII bắt đầu bằng sk-');
  }

  if (!recipe?.title) {
    throw new Error('Recipe không hợp lệ');
  }

  fs.mkdirSync(outDir, { recursive: true });

  const prompt = buildFoodPhotoPrompt({
    recipe,
    pageName,
  });

  const safeTitle = String(recipe.title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

  const prefix = `${date}-${stateKey}-${safeTitle}`;
  const promptPath = path.join(outDir, `${prefix}.prompt.txt`);
  const rawImagePath = path.join(outDir, `${prefix}.openai.jpg`);

  fs.writeFileSync(promptPath, `${prompt}\n`, 'utf8');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150000);

  let response;

  try {
    response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        quality,
        output_format: 'jpeg',
        output_compression: 92,
        background: 'opaque',
        moderation: 'auto',
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('OpenAI image generation timeout sau 150 giây');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body?.error) {
    const message = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(`OpenAI image generation failed: ${message}`);
  }

  const base64 = body?.data?.[0]?.b64_json;

  if (!base64) {
    throw new Error('OpenAI API không trả về b64_json');
  }

  const imageBuffer = Buffer.from(base64, 'base64');

  if (imageBuffer.length < 10000) {
    throw new Error(`Ảnh OpenAI quá nhỏ hoặc không hợp lệ: ${imageBuffer.length} bytes`);
  }

  fs.writeFileSync(rawImagePath, imageBuffer);

  return {
    provider: 'openai',
    model,
    size,
    quality,
    path: rawImagePath,
    promptPath,
    bytes: imageBuffer.length,
  };
}
