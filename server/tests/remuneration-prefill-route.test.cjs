'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'remuneration-prefill-'));
process.env.RUNTIME_ROOT=root;process.env.DB_PATH=path.join(root,'test.sqlite3');process.env.ENCRYPTION_KEY='b'.repeat(64);
const db=require('../src/database');let server;
let session={userId:1,isAdmin:false,mode:'online',canViewCases:true,canEditCases:true};
test.before(async()=>{
 db.prepare("INSERT INTO users(id,username,password_hash,active,allow_online) VALUES(1,'reader','x',1,1),(2,'guardian','x',1,1)").run();
 db.prepare("INSERT INTO persons(id,first_name,last_name,user_id) VALUES('guardian','Bea','Beispiel',2),('reader','Ina','Login',1)").run();
 db.prepare("INSERT INTO cases(id,label,owner_user_id,stammdaten_json) VALUES('mine','Sichtbarer Fall',1,?),('foreign','Fremder Fall',2,?),('de300001-0000-4000-8000-000000000001','Demo Fall',1,?)").run(...Array(3).fill(JSON.stringify({rechtlicherBetreuer:'guardian'})));
 db.prepare("INSERT INTO office_json(key,data_json) VALUES('qualifikationen',?)").run(JSON.stringify({entries:{guardian:{einstufung:'C',qualification:'PRIVATE QUALIFICATION',stundenumfang:'PRIVATE HOURS',qualiFiles:['PRIVATE FILE'],notes:'PRIVATE NOTES'},reader:{einstufung:'A'}}}));
 const express=require('express'),app=express();app.use(express.json());app.use((req,res,next)=>{req.session={...session};next()});app.use('/cases',require('../src/modules/cases/routes'));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
});
test.after(async()=>{if(server)await new Promise(r=>server.close(r));db.close();fs.rmSync(root,{recursive:true,force:true})});
async function call(id){const r=await fetch(`http://127.0.0.1:${server.address().port}/cases/${id}/remuneration-prefill`);return{status:r.status,body:await r.json(),cache:r.headers.get('cache-control')}}
test('Visible case exposes only the assigned guardian stage, without qualification viewing rights',async()=>{
 const r=await call('mine');assert.equal(r.status,200);assert.equal(r.body.guardian,'guardian');assert.equal(r.body.stage.value,'2');assert.equal(r.cache,'no-store');assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE/);
});
test('Fall permissions, module permission, and demo isolation apply to the new endpoint',async()=>{
 assert.equal((await call('foreign')).status,403);assert.equal((await call('de300001-0000-4000-8000-000000000001')).status,403);
 session.canViewCases=false;assert.equal((await call('mine')).status,403);session.canViewCases=true;
 session.isAdmin=true;assert.equal((await call('missing')).status,404);session.isAdmin=false;
});
test('Reassignment and qualification updates are immediately reflected; absent or damaged sources are distinct',async()=>{
 db.prepare("UPDATE cases SET stammdaten_json=? WHERE id='mine'").run(JSON.stringify({rechtlicherBetreuer:'reader'}));assert.equal((await call('mine')).body.stage.value,'1');
 db.prepare("UPDATE office_json SET data_json=? WHERE key='qualifikationen'").run(JSON.stringify({entries:{reader:{einstufung:'2'}}}));assert.equal((await call('mine')).body.stage.value,'2');
 db.prepare("UPDATE cases SET stammdaten_json='{}' WHERE id='mine'").run();assert.equal((await call('mine')).body.stage.value,'');
 db.prepare("UPDATE office_json SET data_json='broken' WHERE key='qualifikationen'").run();assert.equal((await call('mine')).status,503);
});
