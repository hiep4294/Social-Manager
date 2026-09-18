import { chromium } from 'playwright-core';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile=path.join(root,'data','facebook-browser-profile');
const expectedAvatar=path.join(root,'data','brand-media','hom-nay-an-gi-avatar.png');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function locateAvatarImage(page){
  const action=page.getByRole('button',{name:/Hành động với ảnh đại diện|Profile picture actions/i}).last();
  if(!(await action.isVisible({timeout:2200}).catch(()=>false))) return null;
  const ab=await action.boundingBox();
  if(!ab) return null;
  const ac={x:ab.x+ab.width/2,y:ab.y+ab.height/2};

  const imgs=await page.locator('img').evaluateAll(els=>els.map((el,i)=>{
    const r=el.getBoundingClientRect();
    return {
      i,
      src:el.currentSrc||el.src||'',
      alt:el.alt||'',
      x:r.x,y:r.y,w:r.width,h:r.height,
      visible:r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden'
    };
  }).filter(x=>x.visible&&x.src));

  const candidates=imgs
    .filter(x=>x.w>=50&&x.h>=50&&x.w<=400&&x.h<=400&&x.y<900)
    .map(x=>{
      const cx=x.x+x.w/2, cy=x.y+x.h/2;
      const d=Math.hypot(cx-ac.x,cy-ac.y);
      const squarePenalty=Math.abs(x.w-x.h);
      return {...x,score:d+squarePenalty*2};
    })
    .sort((a,b)=>a.score-b.score);

  return candidates[0]||null;
}

async function compareAvatar(ctx,src){
  if(!fs.existsSync(expectedAvatar)) return {ok:false,error:'EXPECTED_AVATAR_MISSING'};
  if(!src) return {ok:false,error:'AVATAR_SRC_MISSING'};

  const res=await ctx.request.get(src,{timeout:15000}).catch(()=>null);
  if(!res||!res.ok()) return {ok:false,error:'AVATAR_DOWNLOAD_FAILED',status:res?.status?.()};

  const remote=Buffer.from(await res.body());
  const base=await sharp(expectedAvatar)
    .resize(72,72,{fit:'fill'})
    .grayscale()
    .blur(0.8)
    .raw()
    .toBuffer();
  const live=await sharp(remote)
    .resize(72,72,{fit:'fill'})
    .grayscale()
    .blur(0.8)
    .raw()
    .toBuffer();

  const n=Math.min(base.length,live.length);
  let sum=0;
  for(let i=0;i<n;i++) sum+=Math.abs(base[i]-live[i]);
  const mae=n?sum/n:999;
  return {ok:mae<38,mae:Number(mae.toFixed(2)),bytes:remote.length};
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,
  headless:false,
  viewport:{width:1440,height:980},
  locale:'vi-VN'
});

const result={
  target,
  checks:{
    bio:false,
    category:false,
    cover:false,
    post:false,
    avatar:false
  },
  avatar:{},
  status:'NEEDS_REVIEW'
};

try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4500);

  const body=clean(await page.locator('body').innerText().catch(()=>'' ));
  result.checks.bio=body.includes('Món ngon mỗi ngày • Công thức dễ làm • Mẹo bếp thực tế cho gia đình.');
  result.checks.category=body.includes('Nhà bếp/Nấu ăn')&&!body.includes('Blog cá nhân');
  result.checks.cover=await page.getByRole('button',{name:/Chỉnh sửa ảnh bìa|Edit cover photo/i}).last().isVisible({timeout:1500}).catch(()=>false);
  result.checks.post=body.includes('Trang chia sẻ công thức dễ làm');

  const avatarImg=await locateAvatarImage(page);
  result.avatar.candidate=avatarImg?{
    src:avatarImg.src.slice(0,240),
    alt:avatarImg.alt,
    x:Math.round(avatarImg.x),y:Math.round(avatarImg.y),
    w:Math.round(avatarImg.w),h:Math.round(avatarImg.h),
    score:Number(avatarImg.score.toFixed(1))
  }:null;

  if(avatarImg?.src){
    result.avatar.compare=await compareAvatar(ctx,avatarImg.src);
    result.checks.avatar=!!result.avatar.compare.ok;
  }

  result.status=Object.values(result.checks).every(Boolean)?'DONE':'NEEDS_REVIEW';
  console.log('PAGE_FINAL_AUDIT='+JSON.stringify(result));
  process.exitCode=result.status==='DONE'?0:4;
}finally{
  await ctx.close();
}
