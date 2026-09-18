import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { foodPageBlueprints, localDateInVietnam } from '../src/food-network-core.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const dataDir=path.join(root,'data');
const dbFile=path.join(dataDir,'social-manager.db');
const marker=path.join(dataDir,'food-network-auto.enabled');
const pageUrl=String(process.argv[2]||'https://www.facebook.com/profile.php?id=61594459680780').trim();
const pageName='Hôm Nay Ăn Gì?';
const pageSlot=5;
const now=new Date().toISOString();
const today=localDateInVietnam();

fs.mkdirSync(dataDir,{recursive:true});
const db=new Database(dbFile);
db.pragma('journal_mode = WAL');

try{
  db.exec(`
    CREATE TABLE IF NOT EXISTS food_network_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS food_network_pages (
      slot INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      theme TEXT NOT NULL,
      voice TEXT NOT NULL,
      planned_create_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PLANNED',
      page_url TEXT,
      create_job_id TEXT,
      last_error TEXT,
      activated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS food_network_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      page_slot INTEGER NOT NULL,
      recipe_id INTEGER NOT NULL,
      recipe_title TEXT NOT NULL,
      content TEXT NOT NULL,
      image_prompt TEXT NOT NULL,
      image_url TEXT,
      image_source_url TEXT,
      image_attribution TEXT,
      post_job_id TEXT,
      status TEXT NOT NULL DEFAULT 'PLANNED',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(date,page_slot)
    );
  `);

  // Archive stale page-creation attempts from the earlier experimental run.
  const staleJobs=db.prepare(`
    UPDATE facebook_operator_jobs
    SET status='CANCELLED',
        error='Archived after switching to single-Page background mode',
        locked_at=NULL,
        updated_at=?
    WHERE id IN ('food-create-page-01','food-create-page-02')
      AND status IN ('NEEDS_REVIEW','WAITING_USER','FAILED','QUEUED','PROCESSING','EXTENSION_QUEUED')
  `).run(now);

  // Ensure all blueprints exist but keep non-current Pages dormant.
  const ins=db.prepare(`
    INSERT OR IGNORE INTO food_network_pages
      (slot,name,theme,voice,planned_create_at,status,created_at,updated_at)
    VALUES(?,?,?,?,?,'PLANNED',?,?)
  `);
  for(const p of foodPageBlueprints()){
    ins.run(p.slot,p.name,p.theme,p.voice,now,now,now);
  }

  db.prepare(`
    UPDATE food_network_pages
    SET status='PLANNED',page_url=NULL,create_job_id=NULL,last_error=NULL,activated_at=NULL,updated_at=?
    WHERE slot<>?
  `).run(now,pageSlot);

  db.prepare(`
    UPDATE food_network_pages
    SET name=?,status='ACTIVE',page_url=?,create_job_id=NULL,last_error=NULL,
        activated_at=COALESCE(activated_at,?),updated_at=?
    WHERE slot=?
  `).run(pageName,pageUrl,now,now,pageSlot);

  // Prevent an immediate extra recipe post on the onboarding day.
  const existing=db.prepare('SELECT id FROM food_network_daily WHERE date=? AND page_slot=?').get(today,pageSlot);
  if(!existing){
    db.prepare(`
      INSERT INTO food_network_daily
        (date,page_slot,recipe_id,recipe_title,content,image_prompt,status,created_at,updated_at)
      VALUES(?,?,0,'ONBOARDING_SKIP','','','SKIPPED_ONBOARDING',?,?)
    `).run(today,pageSlot,now,now);
  }

  fs.writeFileSync(marker,'enabled\n','utf8');

  const current=db.prepare('SELECT slot,name,status,page_url,activated_at FROM food_network_pages WHERE slot=?').get(pageSlot);
  const counts=db.prepare('SELECT status,COUNT(*) n FROM food_network_pages GROUP BY status ORDER BY status').all();
  const waiting=db.prepare(`
    SELECT id,action,status,error
    FROM facebook_operator_jobs
    WHERE status IN ('WAITING_USER','NEEDS_REVIEW')
    ORDER BY updated_at DESC
    LIMIT 10
  `).all();

  const result={
    enabled_marker:marker,
    stale_jobs_archived:Number(staleJobs.changes||0),
    current_page:current,
    page_counts:counts,
    today,
    today_skipped:true,
    unresolved_jobs:waiting
  };
  console.log('LOCAL_FOOD_ONBOARD_RESULT='+JSON.stringify(result));
}finally{
  db.close();
}
