import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const target=String(process.argv[2]||'https://www.facebook.com/profile.php?id=61594459680780').trim();
const profile=path.join(root,'data','facebook-browser-profile-bg');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function visibleRows(page,selector,limit=120){
  return await page.locator(selector).evaluateAll((els,limit)=>els.map((el,i)=>{
    const r=el.getBoundingClientRect();
    const st=getComputedStyle(el);
    const visible=r.width>0&&r.height>0&&st.visibility!=='hidden'&&st.display!=='none';
    return {
      i,
      tag:el.tagName,
      role:el.getAttribute('role')||'',
      aria:el.getAttribute('aria-label')||'',
      placeholder:el.getAttribute('placeholder')||'',
      contenteditable:el.getAttribute('contenteditable')||'',
      text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,260),
      x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
      visible,
      html:el.outerHTML.slice(0,850)
    };
  }).filter(x=>x.visible).slice(0,limit),limit);
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,
  headless:true,
  viewport:{width:1440,height:980},
  locale:'vi-VN',
  args:['--no-sandbox','--disable-dev-shm-usage']
});

try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);

  const body=clean(await page.locator('body').innerText().catch(()=>''));
  console.log('BG_COMPOSER_PAGE_OK='+(/Công cụ chuyên nghiệp|Professional dashboard/i.test(body)));
  console.log('BG_COMPOSER_URL='+page.url());

  const candidates=(await visibleRows(page,'button,[role="button"],a',220))
    .filter(x=>/Bạn đang nghĩ gì|Chia sẻ suy nghĩ|Tạo bài viết|What.?s on your mind|Create post/i.test([x.aria,x.text].join(' ')));
  console.log('BG_COMPOSER_TRIGGERS='+JSON.stringify(candidates.slice(0,40)));

  let trigger=page.getByRole('button',{name:/^Bạn đang nghĩ gì\??$/i}).first();
  let method='role-exact';
  if(!(await trigger.isVisible({timeout:1500}).catch(()=>false))){
    trigger=page.locator('[role="button"]').filter({hasText:/^Bạn đang nghĩ gì\??$/i}).first();
    method='text-exact';
  }
  if(!(await trigger.isVisible({timeout:1200}).catch(()=>false))){
    trigger=page.locator('[role="button"]').filter({hasText:/Chia sẻ suy nghĩ/i}).first();
    method='share-thoughts';
  }
  if(!(await trigger.isVisible({timeout:1200}).catch(()=>false))){
    const list=page.locator('[role="button"]').filter({hasText:/Tạo bài viết/i});
    trigger=list.last();
    method='create-post-fallback';
  }

  const triggerVisible=await trigger.isVisible({timeout:1500}).catch(()=>false);
  console.log('BG_COMPOSER_TRIGGER_PICK='+JSON.stringify({method,visible:triggerVisible,text:clean(await trigger.innerText().catch(()=>'')),aria:await trigger.getAttribute('aria-label').catch(()=>null)}));
  if(!triggerVisible) process.exitCode=4;
  else {
    await trigger.click({timeout:3500});
    for(const wait of [1200,3000,6500]){
      await sleep(wait===1200?1200:wait===3000?1800:3500);
      const dialogs=await visibleRows(page,'[role="dialog"]',20);
      const fields=await visibleRows(page,'textarea,[contenteditable="true"],[role="textbox"],input',100);
      const buttons=(await visibleRows(page,'button,[role="button"]',180))
        .filter(x=>/Tiếp|Next|Đăng|Post|Hủy|Cancel|Đóng|Close|Ảnh|Photo|video/i.test([x.aria,x.text].join(' ')));
      const active=await page.evaluate(()=>{
        const e=document.activeElement;
        return e?{tag:e.tagName,role:e.getAttribute('role')||'',aria:e.getAttribute('aria-label')||'',text:(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,250),html:e.outerHTML.slice(0,900)}:null;
      }).catch(()=>null);
      console.log('BG_COMPOSER_T'+wait+'_DIALOGS='+JSON.stringify(dialogs));
      console.log('BG_COMPOSER_T'+wait+'_FIELDS='+JSON.stringify(fields));
      console.log('BG_COMPOSER_T'+wait+'_BUTTONS='+JSON.stringify(buttons.slice(-80)));
      console.log('BG_COMPOSER_T'+wait+'_ACTIVE='+JSON.stringify(active));
    }
  }
}finally{
  await ctx.close();
}
