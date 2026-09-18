import 'dotenv/config';
import { chromium } from 'playwright-core';
import path from 'node:path';

const target = process.argv[2];
if (!target) throw new Error('Missing Facebook Page URL');
const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile = path.join(root, 'data', 'facebook-browser-profile');
const browser = process.env.FB_OPERATOR_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ctx = await chromium.launchPersistentContext(profile,{executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'});
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(4000);
  const title = await page.title();
  const h1 = await page.locator('h1').allTextContents().catch(()=>[]);
  const text = (await page.locator('body').innerText().catch(()=>'' )).replace(/\s+/g,' ').slice(0,2500);
  console.log(JSON.stringify({url:page.url(),title,h1,text}));
} finally {
  await ctx.close();
}