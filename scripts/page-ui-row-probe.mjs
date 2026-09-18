import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const target = String(process.argv[2] || 'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile = path.join(root,'data','facebook-browser-profile');
const browser = process.env.FB_OPERATOR_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const clean = s => String(s || '').replace(/\s+/g,' ').trim();

async function inspectTextChain(page, exactText, label) {
  const result = await page.evaluate(({exactText}) => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const all = [...document.querySelectorAll('body *')];
    const hit = all.find(el => visible(el) && cleanLocal(el.innerText || el.textContent || '') === exactText);
    function cleanLocal(s){ return String(s||'').replace(/\s+/g,' ').trim(); }
    if (!hit) return {found:false};

    const chain = [];
    let cur = hit;
    for (let depth=0; cur && depth<=10; depth++, cur=cur.parentElement) {
      const clickables = [...cur.querySelectorAll('button,[role="button"],a,[tabindex="0"]')]
        .filter(visible)
        .map(x => ({
          tag:x.tagName,
          role:x.getAttribute('role')||'',
          aria:x.getAttribute('aria-label')||'',
          title:x.getAttribute('title')||'',
          text:cleanLocal(x.innerText || x.textContent || '').slice(0,160),
          href:x.getAttribute('href')||''
        }))
        .filter(x => x.aria || x.title || x.text)
        .slice(0,20);

      chain.push({
        depth,
        tag:cur.tagName,
        role:cur.getAttribute('role')||'',
        aria:cur.getAttribute('aria-label')||'',
        text:cleanLocal(cur.innerText || cur.textContent || '').slice(0,700),
        clickables
      });
    }
    return {found:true,chain};
  }, {exactText});

  console.log(label+'='+JSON.stringify(result));
}

async function inspectVisibleActions(page, label, patternSource) {
  const rows = await page.evaluate(({patternSource}) => {
    const re = new RegExp(patternSource,'i');
    const visible = el => {
      const r=el.getBoundingClientRect();
      const cs=getComputedStyle(el);
      return r.width>0 && r.height>0 && cs.visibility!=='hidden' && cs.display!=='none';
    };
    const cleanLocal=s=>String(s||'').replace(/\s+/g,' ').trim();
    return [...document.querySelectorAll('button,[role="button"],a,[tabindex="0"]')]
      .filter(visible)
      .map(el=>({
        tag:el.tagName,
        role:el.getAttribute('role')||'',
        aria:el.getAttribute('aria-label')||'',
        title:el.getAttribute('title')||'',
        text:cleanLocal(el.innerText||el.textContent||'').slice(0,180),
        href:el.getAttribute('href')||''
      }))
      .filter(x=>re.test([x.aria,x.title,x.text].join(' ')))
      .slice(0,50);
  }, {patternSource});
  console.log(label+'='+JSON.stringify(rows));
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});

try{
  const page=ctx.pages()[0] || await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);

  const edit=page.getByRole('link',{name:/chỉnh sửa trang cá nhân|edit profile/i}).first();
  if(await edit.isVisible({timeout:3000}).catch(()=>false)){
    await edit.click();
    await sleep(2200);
    console.log('ROW_EDIT_URL='+page.url());
    await inspectTextChain(page,'Tiểu sử','ROW_BIO_TITLE');
    await inspectTextChain(page,'Gợi ý món mỗi ngày','ROW_BIO_VALUE');
    await inspectVisibleActions(page,'ROW_EDIT_ACTIONS','chỉnh sửa|edit|tiểu sử|bio|bút|pencil');
  }

  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);
  console.log('ROW_PAGE_URL='+page.url());
  await inspectTextChain(page,'Chia sẻ suy nghĩ...','ROW_COMPOSER_TEXT');
  await inspectVisibleActions(page,'ROW_COMPOSER_ACTIONS','chia sẻ suy nghĩ|bạn đang nghĩ gì|tạo bài viết|create a post|what.?s on your mind');
} finally {
  await ctx.close();
}
