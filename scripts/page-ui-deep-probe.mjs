import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const target = String(process.argv[2] || 'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile = path.join(root,'data','facebook-browser-profile');
const browser = process.env.FB_OPERATOR_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function dumpAncestors(page, exactText, label){
  const hit=page.getByText(exactText,{exact:true}).first();
  const visible=await hit.isVisible({timeout:2500}).catch(()=>false);
  console.log(label+'_VISIBLE='+visible);
  if(!visible) return;
  for(let depth=0;depth<=8;depth++){
    const node=depth===0?hit:hit.locator('xpath='+'../'.repeat(depth));
    const count=await node.count().catch(()=>0);
    if(!count) continue;
    const info=await node.first().evaluate(el=>{
      const clicks=[...el.querySelectorAll('button,[role="button"],a')].map(x=>({
        tag:x.tagName,
        role:x.getAttribute('role')||'',
        aria:x.getAttribute('aria-label')||'',
        title:x.getAttribute('title')||'',
        text:(x.innerText||x.textContent||'').replace(/\s+/g,' ').trim().slice(0,120),
        href:x.getAttribute('href')||''
      })).slice(0,12);
      return {
        tag:el.tagName,
        role:el.getAttribute('role')||'',
        aria:el.getAttribute('aria-label')||'',
        text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,500),
        clicks,
        html:el.outerHTML.slice(0,1800)
      };
    }).catch(()=>null);
    console.log(label+'_DEPTH_'+depth+'='+JSON.stringify(info));
  }
}

async function dumpComposer(page){
  console.log('COMPOSER_URL='+page.url());
  const dialogs=page.locator('[role="dialog"]');
  const dn=await dialogs.count().catch(()=>0);
  console.log('COMPOSER_DIALOGS='+dn);
  for(let i=0;i<Math.min(dn,4);i++){
    if(!(await dialogs.nth(i).isVisible().catch(()=>false))) continue;
    console.log('COMPOSER_DIALOG_'+i+'='+JSON.stringify(clean(await dialogs.nth(i).innerText().catch(()=>'' )).slice(0,1800)));
  }
  const fields=page.locator('textarea,[contenteditable="true"],[role="textbox"],input');
  const fn=await fields.count().catch(()=>0);
  const out=[];
  for(let i=0;i<Math.min(fn,120);i++){
    const e=fields.nth(i);
    if(!(await e.isVisible().catch(()=>false))) continue;
    out.push(await e.evaluate(el=>({
      tag:el.tagName,
      role:el.getAttribute('role')||'',
      aria:el.getAttribute('aria-label')||'',
      placeholder:el.getAttribute('placeholder')||'',
      contenteditable:el.getAttribute('contenteditable')||'',
      text:(el.innerText||el.value||'').slice(0,300)
    })).catch(()=>null));
  }
  console.log('COMPOSER_FIELDS='+JSON.stringify(out.filter(Boolean).slice(0,30)));

  const btns=page.locator('button,[role="button"]');
  const bn=await btns.count().catch(()=>0);
  const bo=[];
  for(let i=0;i<Math.min(bn,200);i++){
    const e=btns.nth(i);
    if(!(await e.isVisible().catch(()=>false))) continue;
    const x=await e.evaluate(el=>({
      tag:el.tagName,
      role:el.getAttribute('role')||'',
      aria:el.getAttribute('aria-label')||'',
      text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,160)
    })).catch(()=>null);
    if(x && (x.text||x.aria)) bo.push(x);
  }
  console.log('COMPOSER_BUTTONS='+JSON.stringify(bo.slice(-50)));
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});
try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);

  const edit=page.getByRole('link',{name:/chỉnh sửa trang cá nhân|edit profile/i}).first();
  if(await edit.isVisible({timeout:3000}).catch(()=>false)){
    await edit.click();
    await sleep(2200);
    console.log('DEEP_EDIT_URL='+page.url());
    await dumpAncestors(page,'Tiểu sử','BIO_TITLE');
    await dumpAncestors(page,'Gợi ý món mỗi ngày','BIO_VALUE');
  } else {
    console.log('DEEP_EDIT_LINK=NOT_FOUND');
  }

  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(3500);
  const composer=page.locator('[role="button"]').filter({hasText:/Chia sẻ suy nghĩ/}).first();
  const can=await composer.isVisible({timeout:2500}).catch(()=>false);
  console.log('COMPOSER_TRIGGER_VISIBLE='+can);
  if(can){
    await composer.click();
    await sleep(3000);
    await dumpComposer(page);
  }
} finally {
  await ctx.close();
}
