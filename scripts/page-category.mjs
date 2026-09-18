import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile=path.join(root,'data','facebook-browser-profile');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function clickFirst(page,list,timeout=2500){
  for(const f of list) try{
    const l=typeof f==='string'?page.locator(f):f(page);
    if(await l.first().isVisible({timeout})){
      await l.first().click({timeout});
      return true;
    }
  }catch{}
  return false;
}

async function visibleControls(page,limit=60){
  const out=[];
  const nodes=page.locator('button,[role="button"],a,input,textarea,[contenteditable="true"]');
  const n=Math.min(await nodes.count().catch(()=>0),250);
  for(let i=0;i<n&&out.length<limit;i++){
    const el=nodes.nth(i);
    if(!(await el.isVisible().catch(()=>false))) continue;
    const text=clean(
      await el.innerText().catch(()=>'' ) ||
      await el.getAttribute('aria-label').catch(()=>'' ) ||
      await el.getAttribute('placeholder').catch(()=>'' )
    );
    if(text) out.push(text.slice(0,180));
  }
  return [...new Set(out)];
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,
  headless:false,
  viewport:{width:1440,height:980},
  locale:'vi-VN'
});

const result={
  target,
  category_page:'',
  current:'',
  desired:'',
  changed:false,
  verified:false,
  status:'NEEDS_REVIEW'
};

try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);

  const resolved=new URL(page.url());
  const pageId=resolved.searchParams.get('id');
  if(!pageId) throw new Error('Không lấy được Facebook Page ID từ URL');

  const categoryUrl='https://www.facebook.com/profile.php?id='+encodeURIComponent(pageId)+'&sk=directory_category';
  result.category_page=categoryUrl;
  await page.goto(categoryUrl,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(3500);

  const before=clean(await page.locator('body').innerText().catch(()=>'' ));
  result.current=before.slice(0,1800);

  const desiredPatterns=/Nhà bếp\s*\/\s*Nấu ăn|Ẩm thực|Food\s*&\s*beverage|Kitchen\s*\/\s*Cooking|Food & Drink/i;
  if(desiredPatterns.test(before) && !/Blog cá nhân/i.test(before)){
    result.status='DONE';
    result.verified=true;
    console.log('PAGE_CATEGORY_RESULT='+JSON.stringify(result));
    process.exitCode=0;
  }else{
    let opened=await clickFirst(page,[
      p=>p.getByRole('button',{name:/chỉnh sửa.*hạng mục|chỉnh sửa.*danh mục|edit.*categor/i}),
      p=>p.locator('[role="button"][aria-label*="Hạng mục" i]'),
      p=>p.locator('[role="button"][aria-label*="danh mục" i]')
    ],2200);

    if(!opened){
      const current=page.getByText(/Blog cá nhân|Personal blog/i,{exact:true}).first();
      if(await current.isVisible({timeout:1600}).catch(()=>false)){
        const section=current.locator('xpath=ancestor::section[1]');
        const btn=section.getByRole('button',{name:/chỉnh sửa|edit/i}).last();
        if(await btn.isVisible({timeout:1200}).catch(()=>false)){
          await btn.click();
          opened=true;
        }
      }
    }

    result.opened=opened;
    if(!opened){
      result.controls=await visibleControls(page);
      console.log('PAGE_CATEGORY_RESULT='+JSON.stringify(result));
      process.exitCode=4;
    }else{
      await sleep(1200);

      let box=page.getByRole('combobox').last();
      if(!(await box.isVisible({timeout:2500}).catch(()=>false))){
        box=page.getByRole('textbox').last();
      }
      result.editor_visible=await box.isVisible({timeout:2000}).catch(()=>false);

      if(!result.editor_visible){
        result.controls=await visibleControls(page);
        console.log('PAGE_CATEGORY_RESULT='+JSON.stringify(result));
        process.exitCode=4;
      }else{
        const queries=['Nhà bếp/Nấu ăn','Ẩm thực','Food & beverage'];
        let selected='';
        for(const q of queries){
          await box.fill(q);
          await sleep(1100);
          const opt=page.getByRole('option').filter({hasText:/Nhà bếp|Nấu ăn|Ẩm thực|Food|Kitchen/i}).first();
          if(await opt.isVisible({timeout:1500}).catch(()=>false)){
            selected=clean(await opt.innerText().catch(()=>q));
            await opt.click();
            break;
          }
        }

        result.desired=selected;
        if(!selected){
          result.controls=await visibleControls(page);
          console.log('PAGE_CATEGORY_RESULT='+JSON.stringify(result));
          process.exitCode=4;
        }else{
          const saved=await clickFirst(page,[
            p=>p.getByRole('button',{name:/^(Lưu|Save|Xong|Done)$/i}),
            p=>p.getByText(/^(Lưu|Save|Xong|Done)$/i,{exact:true})
          ],3000);
          result.saved=saved;
          if(!saved){
            result.controls=await visibleControls(page);
            console.log('PAGE_CATEGORY_RESULT='+JSON.stringify(result));
            process.exitCode=4;
          }else{
            await sleep(2200);
            await page.goto(categoryUrl,{waitUntil:'domcontentloaded',timeout:30000});
            await sleep(3000);
            const after=clean(await page.locator('body').innerText().catch(()=>'' ));
            result.after=after.slice(0,1800);
            result.verified=desiredPatterns.test(after) && !/Blog cá nhân/i.test(after);
            result.changed=result.verified;
            result.status=result.verified?'DONE':'NEEDS_REVIEW';
            console.log('PAGE_CATEGORY_RESULT='+JSON.stringify(result));
            process.exitCode=result.verified?0:4;
          }
        }
      }
    }
  }
}finally{
  await ctx.close();
}
