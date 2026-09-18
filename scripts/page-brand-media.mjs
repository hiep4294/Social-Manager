import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const outDir=path.join(root,'data','brand-media');
const avatarPath=path.join(outDir,'hom-nay-an-gi-avatar.png');
const coverPath=path.join(outDir,'hom-nay-an-gi-cover.png');
const profile=path.join(root,'data','facebook-browser-profile');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

fs.mkdirSync(outDir,{recursive:true});

async function renderAssets(){
  const b=await chromium.launch({executablePath:browser,headless:true});
  try{
    const p=await b.newPage({viewport:{width:1640,height:1024},deviceScaleFactor:1});

    await p.setViewportSize({width:1024,height:1024});
    await p.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box} html,body{margin:0;width:1024px;height:1024px;overflow:hidden;font-family:"Segoe UI",Arial,sans-serif}
      body{background:linear-gradient(145deg,#fff7e8,#f0d6a7);display:grid;place-items:center}
      .ring{width:900px;height:900px;border-radius:50%;background:#fffaf0;border:24px solid #6d3b18;display:grid;place-items:center;position:relative;box-shadow:inset 0 0 0 10px #d69b52}
      .plate{position:absolute;top:112px;width:300px;height:78px;border:14px solid #6d3b18;border-top:0;border-radius:0 0 160px 160px}
      .hat{position:absolute;top:84px;width:220px;height:150px}
      .hat:before,.hat:after{content:"";position:absolute;background:#fffaf0;border:14px solid #6d3b18;border-radius:90px}
      .hat:before{left:20px;top:10px;width:110px;height:110px}.hat:after{right:20px;top:10px;width:110px;height:110px}
      .hat i{position:absolute;left:70px;top:0;width:110px;height:120px;background:#fffaf0;border:14px solid #6d3b18;border-radius:90px;z-index:2}
      .title{text-align:center;color:#4b2712;font-weight:900;font-size:118px;line-height:.92;letter-spacing:-4px;margin-top:110px}
      .sub{text-align:center;color:#8c4f24;font-size:34px;font-weight:700;margin-top:34px;letter-spacing:2px}
      .dot{position:absolute;width:30px;height:30px;border-radius:50%;background:#d9762d}.d1{left:160px;top:260px}.d2{right:160px;top:260px}.d3{left:120px;bottom:250px}.d4{right:120px;bottom:250px}
    </style><body><div class="ring"><div class="hat"><i></i></div><div class="plate"></div><div><div class="title">HÔM NAY<br>ĂN GÌ?</div><div class="sub">MÓN NGON MỖI NGÀY</div></div><span class="dot d1"></span><span class="dot d2"></span><span class="dot d3"></span><span class="dot d4"></span></div></body>`);
    await p.screenshot({path:avatarPath,type:'png'});

    await p.setViewportSize({width:1640,height:624});
    await p.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box} html,body{margin:0;width:1640px;height:624px;overflow:hidden;font-family:"Segoe UI",Arial,sans-serif}
      body{background:linear-gradient(120deg,#fff8eb 0%,#f2d5a7 55%,#eeb26f 100%);position:relative}
      .blob{position:absolute;border-radius:50%;opacity:.32}.b1{width:380px;height:380px;background:#d9762d;right:-90px;top:-90px}.b2{width:250px;height:250px;background:#82a44e;right:280px;bottom:-90px}.b3{width:180px;height:180px;background:#c56b2c;left:520px;top:-70px}
      .card{position:absolute;left:110px;top:82px;width:1280px;height:458px;border-radius:46px;background:rgba(255,255,255,.86);box-shadow:0 22px 60px rgba(83,45,16,.13);display:flex;align-items:center;padding:56px 72px}
      .mark{width:280px;height:280px;border-radius:50%;background:#fffaf0;border:14px solid #6d3b18;display:grid;place-items:center;color:#4b2712;font-weight:900;font-size:62px;line-height:.92;text-align:center;flex:none}
      .copy{margin-left:68px;color:#4b2712}.copy h1{margin:0;font-size:96px;line-height:1;font-weight:900;letter-spacing:-3px}.copy p{margin:28px 0 0;font-size:34px;font-weight:650;color:#7b4a27}.tag{display:inline-block;margin-top:34px;padding:14px 24px;border-radius:999px;background:#6d3b18;color:#fff;font-weight:800;font-size:25px;letter-spacing:.4px}
    </style><body><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="card"><div class="mark">HÔM NAY<br>ĂN GÌ?</div><div class="copy"><h1>Hôm Nay Ăn Gì?</h1><p>Món ngon mỗi ngày • Công thức dễ làm • Mẹo bếp thực tế</p><div class="tag">NHÀ BẾP / NẤU ĂN</div></div></div></body>`);
    await p.screenshot({path:coverPath,type:'png'});
  }finally{
    await b.close();
  }
}

async function clickFirst(page,list,timeout=2500){
  for(const f of list){
    try{
      const l=typeof f==='string'?page.locator(f):f(page);
      if(await l.first().isVisible({timeout})){
        await l.first().click({timeout});
        return true;
      }
    }catch{}
  }
  return false;
}

async function avatarSrc(page){
  const btn=page.getByRole('button',{name:/Hành động với ảnh đại diện|Profile picture actions/i}).last();
  if(!(await btn.isVisible({timeout:1200}).catch(()=>false))) return '';
  return await btn.evaluate(el=>{
    let cur=el;
    for(let i=0;i<6&&cur;i++,cur=cur.parentElement){
      const img=cur.querySelector('img');
      if(img?.src) return img.src;
    }
    return '';
  }).catch(()=> '');
}

async function chooseFileByButton(page,button,file){
  const chooser=page.waitForEvent('filechooser',{timeout:5000}).catch(()=>null);
  await button.click({timeout:3000});
  const fc=await chooser;
  if(!fc) return false;
  await fc.setFiles(file);
  return true;
}

async function saveMediaDialog(page){
  await sleep(2200);
  return await clickFirst(page,[
    p=>p.getByRole('button',{name:/^(Lưu|Lưu thay đổi|Save|Save changes|Xong|Done)$/i}).last(),
    p=>p.getByText(/^(Lưu|Lưu thay đổi|Save|Save changes|Xong|Done)$/i,{exact:true}).last()
  ],2600);
}

await renderAssets();
console.log('BRAND_ASSETS='+JSON.stringify({avatar:avatarPath,cover:coverPath}));

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});

const result={
  target,
  assets:{avatar:avatarPath,cover:coverPath},
  avatar:{status:'NEEDS_REVIEW'},
  cover:{status:'NEEDS_REVIEW'},
  status:'NEEDS_REVIEW'
};

try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);

  const beforeAvatar=await avatarSrc(page);

  // Avatar: actions -> choose profile picture -> upload.
  const avatarAction=page.getByRole('button',{name:/Hành động với ảnh đại diện|Profile picture actions/i}).last();
  if(await avatarAction.isVisible({timeout:2200}).catch(()=>false)){
    await avatarAction.click({timeout:3000});
    await sleep(600);
    const choose=page.getByRole('menuitem',{name:/Chọn ảnh đại diện|Choose profile picture/i}).last();
    if(await choose.isVisible({timeout:1800}).catch(()=>false)){
      await choose.click({timeout:3000});
      await sleep(1000);
      let upload=page.getByRole('button',{name:/^Tải ảnh lên$|^Upload photo$/i}).last();
      if(await upload.isVisible({timeout:1800}).catch(()=>false)){
        result.avatar.uploaded=await chooseFileByButton(page,upload,avatarPath);
        if(result.avatar.uploaded){
          result.avatar.saved=await saveMediaDialog(page);
          await sleep(2800);
        }
      }
    }
  }

  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(3200);
  const afterAvatar=await avatarSrc(page);
  result.avatar.before=beforeAvatar.slice(0,240);
  result.avatar.after=afterAvatar.slice(0,240);
  result.avatar.verified=!!afterAvatar && (!!result.avatar.saved || (!!beforeAvatar && afterAvatar!==beforeAvatar));
  result.avatar.status=result.avatar.verified?'DONE':'NEEDS_REVIEW';

  // Cover: add/edit cover -> upload.
  const coverAction=page.getByRole('button',{name:/Thêm ảnh bìa|Chỉnh sửa ảnh bìa|Add cover photo|Edit cover photo/i}).last();
  if(await coverAction.isVisible({timeout:2200}).catch(()=>false)){
    await coverAction.click({timeout:3000});
    await sleep(600);
    const uploadCover=page.getByRole('menuitem',{name:/Tải ảnh lên|Upload photo/i}).last();
    if(await uploadCover.isVisible({timeout:1800}).catch(()=>false)){
      result.cover.uploaded=await chooseFileByButton(page,uploadCover,coverPath);
      if(result.cover.uploaded){
        result.cover.saved=await saveMediaDialog(page);
        await sleep(3200);
      }
    }
  }

  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(3200);
  const addCoverVisible=await page.getByRole('button',{name:/^Thêm ảnh bìa$|^Add cover photo$/i}).last().isVisible({timeout:1200}).catch(()=>false);
  const editCoverVisible=await page.getByRole('button',{name:/Chỉnh sửa ảnh bìa|Edit cover photo/i}).last().isVisible({timeout:1200}).catch(()=>false);
  result.cover.add_control_visible=addCoverVisible;
  result.cover.edit_control_visible=editCoverVisible;
  result.cover.verified=editCoverVisible && !addCoverVisible;
  result.cover.status=result.cover.verified?'DONE':'NEEDS_REVIEW';

  result.status=result.avatar.status==='DONE'&&result.cover.status==='DONE'?'DONE':'NEEDS_REVIEW';
  console.log('PAGE_BRAND_MEDIA_RESULT='+JSON.stringify(result));
  process.exitCode=result.status==='DONE'?0:4;
}finally{
  await ctx.close();
}
