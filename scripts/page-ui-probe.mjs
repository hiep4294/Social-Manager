import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const target = String(process.argv[2] || 'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile = path.join(root,'data','facebook-browser-profile');
const browser = process.env.FB_OPERATOR_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function clean(s){ return String(s||'').replace(/\s+/g,' ').trim(); }

async function inspectMatches(page, label, re){
  const rows = await page.locator('button,[role="button"],a,div,span').evaluateAll((els, src) => {
    const re = new RegExp(src, 'i');
    const out=[];
    for(const el of els){
      const t=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
      if(!t || t.length>120 || !re.test(t)) continue;
      const r=el.getBoundingClientRect();
      const cs=getComputedStyle(el);
      if(r.width<1 || r.height<1 || cs.visibility==='hidden' || cs.display==='none') continue;
      const anc=el.closest('button,[role="button"],a');
      out.push({
        tag:el.tagName,
        role:el.getAttribute('role')||'',
        aria:el.getAttribute('aria-label')||'',
        text:t.slice(0,120),
        href:el.getAttribute('href')||'',
        ancestor:anc ? {
          tag:anc.tagName,
          role:anc.getAttribute('role')||'',
          aria:anc.getAttribute('aria-label')||'',
          text:(anc.innerText||anc.textContent||'').replace(/\s+/g,' ').trim().slice(0,160),
          href:anc.getAttribute('href')||''
        } : null
      });
      if(out.length>=12) break;
    }
    return out;
  }, re.source);
  console.log('PROBE_'+label+'='+JSON.stringify(rows));
}

const ctx = await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});

try{
  const page=ctx.pages()[0] || await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4500);

  const body=clean(await page.locator('body').innerText().catch(()=>'' ));
  console.log('PROBE_URL='+page.url());
  console.log('PROBE_ACTIVE='+( /Công cụ chuyên nghiệp|Professional dashboard/i.test(body) ));
  await inspectMatches(page,'EDIT',/^Chỉnh sửa$/i);
  await inspectMatches(page,'BIO',/Gợi ý món mỗi ngày|Tiểu sử|Bio/i);
  await inspectMatches(page,'POST',/Bạn đang nghĩ gì|Chia sẻ suy nghĩ|Tạo bài viết|Create a post/i);

  const editCandidates=page.locator('button,[role="button"],a').filter({hasText:/^\s*Chỉnh sửa\s*$/i});
  const n=await editCandidates.count().catch(()=>0);
  console.log('PROBE_EDIT_CLICK_CANDIDATES='+n);
  if(n){
    const el=editCandidates.first();
    console.log('PROBE_EDIT_BEFORE='+JSON.stringify({
      tag:await el.evaluate(e=>e.tagName),
      role:await el.getAttribute('role'),
      aria:await el.getAttribute('aria-label'),
      href:await el.getAttribute('href')
    }));
    await el.click({timeout:4000});
    await sleep(1800);
    console.log('PROBE_AFTER_CLICK_URL='+page.url());
    const dialogs=page.locator('[role="dialog"]');
    console.log('PROBE_DIALOGS='+(await dialogs.count().catch(()=>0)));
    const vis=[];
    for(let i=0;i<Math.min(await dialogs.count().catch(()=>0),5);i++){
      if(await dialogs.nth(i).isVisible().catch(()=>false)){
        vis.push(clean(await dialogs.nth(i).innerText().catch(()=>'' )).slice(0,1200));
      }
    }
    console.log('PROBE_DIALOG_TEXT='+JSON.stringify(vis));
    const fields=await page.locator('input,textarea,[contenteditable="true"],[role="textbox"]').evaluateAll(els=>els.map(e=>({
      tag:e.tagName,role:e.getAttribute('role')||'',aria:e.getAttribute('aria-label')||'',
      placeholder:e.getAttribute('placeholder')||'',value:e.value||'',text:(e.innerText||'').slice(0,200)
    })).slice(0,40));
    console.log('PROBE_FIELDS='+JSON.stringify(fields));
    await inspectMatches(page,'AFTER_EDIT',/Tiểu sử|Bio|Mô tả|Danh mục|Category|Lưu|Save|Xong|Done/i);
  }
} finally {
  await ctx.close();
}
