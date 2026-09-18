import 'dotenv/config';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { decryptSecret } from '../src/security.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const db=new Database(path.join(root,'data','social-manager.db'),{readonly:true,fileMustExist:true});
const repo='hiep4294/Social-Manager';
const wantedPage='61594459680780';

function runGh(args,input=null){
  return spawnSync('gh',args,{
    cwd:root,
    encoding:'utf8',
    input:input ?? undefined,
    windowsHide:true,
    maxBuffer:1024*1024
  });
}

try{
  const auth=runGh(['auth','status']);
  const ghOk=!auth.error && auth.status===0;
  if(!ghOk){
    console.log('CLOUD_SECRET_SETUP='+JSON.stringify({
      ok:false,
      reason:'GH_NOT_AUTHENTICATED',
      detail:String(auth.stderr||auth.stdout||auth.error?.message||'').slice(0,600)
    }));
    process.exitCode=4;
  }else{
    let row=db.prepare(`
      SELECT account_id,account_name,access_token_enc,token_expires_at
      FROM social_accounts
      WHERE platform='facebook' AND account_id=?
      ORDER BY updated_at DESC LIMIT 1
    `).get(wantedPage);
    if(!row){
      row=db.prepare(`
        SELECT account_id,account_name,access_token_enc,token_expires_at
        FROM social_accounts
        WHERE platform='facebook'
        ORDER BY updated_at DESC LIMIT 1
      `).get();
    }

    let token='';
    let source='';
    if(row?.access_token_enc){
      token=decryptSecret(row.access_token_enc);
      source='social_accounts';
    }else if(process.env.FACEBOOK_PAGE_ACCESS_TOKEN){
      token=String(process.env.FACEBOOK_PAGE_ACCESS_TOKEN);
      source='.env';
    }

    if(!token){
      console.log('CLOUD_SECRET_SETUP='+JSON.stringify({
        ok:false,
        reason:'PAGE_TOKEN_NOT_FOUND',
        page_id:wantedPage
      }));
      process.exitCode=5;
    }else{
      const secret=runGh(['secret','set','FACEBOOK_PAGE_ACCESS_TOKEN','--repo',repo],token+'\n');
      const pageVar=runGh(['variable','set','FACEBOOK_PAGE_ID','--repo',repo,'--body',wantedPage]);
      const graphVar=runGh(['variable','set','META_GRAPH_VERSION','--repo',repo,'--body',String(process.env.META_GRAPH_VERSION||'v26.0')]);
      const ok=secret.status===0 && pageVar.status===0 && graphVar.status===0;
      console.log('CLOUD_SECRET_SETUP='+JSON.stringify({
        ok,
        source,
        page_id:row?.account_id||wantedPage,
        page_name:row?.account_name||'Hôm Nay Ăn Gì?',
        token_expires_at:row?.token_expires_at||null,
        secret_set:secret.status===0,
        page_variable_set:pageVar.status===0,
        graph_variable_set:graphVar.status===0,
        repo
      }));
      if(!ok) process.exitCode=6;
    }
  }
}finally{
  db.close();
}
