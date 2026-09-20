'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bb-polish-'));
process.env.RUNTIME_ROOT=root;process.env.DB_PATH=path.join(root,'test.sqlite3');
process.env.ENCRYPTION_KEY='a'.repeat(64);process.env.SESSION_SECRET='test-only-session-secret-polish';
const db=require('../src/database');
const {DEMO_CASES}=require('../src/modules/demo/data-identities');
const systemTime=require('../src/modules/settings/system-time');
let session={userId:1,isAdmin:true,mode:'online',canViewCases:true,canViewDocuments:true};
let server;
test.before(async()=>{
 assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,0,'Fresh instance has no seeded accounts');
 assert.equal(db.prepare("INSERT INTO users(username,password_hash,is_admin,allow_online,active) VALUES('real-admin','x',1,1,1)").run().lastInsertRowid,1);
 db.prepare("INSERT INTO users(username,password_hash,is_demo,active) VALUES('Demo1','x',1,1)").run();
 db.prepare("INSERT INTO persons(id,user_id,first_name,last_name,aktiv) VALUES('real-person',1,'Real','Admin',1),('demo-person',2,'Demo','Account',1)").run();
 db.prepare("INSERT INTO cases(id,label,created_by) VALUES('real-case','Real case',1),(?,'Demo case',2)").run(DEMO_CASES[0].id);
 db.prepare("INSERT INTO calendar_events(id,title,start_at,end_at,case_id) VALUES('real-event','Real','2026-09-20T10:00:00Z','2026-09-20T11:00:00Z','real-case'),('demo-event','Demo','2026-09-20T10:00:00Z','2026-09-20T11:00:00Z',?)").run(DEMO_CASES[0].id);
 db.prepare("INSERT INTO todos(id,title,case_id) VALUES('real-todo','Real','real-case'),('demo-todo','Demo',?)").run(DEMO_CASES[0].id);
 db.prepare("INSERT INTO audit_log(actor_user_id,actor_username,action,case_id) VALUES(1,'real-admin','test.real','real-case'),(2,'Demo1','test.demo',?)").run(DEMO_CASES[0].id);
 const express=require('express'),app=express();app.use(express.json({limit:'8mb'}));
 const auth=express.Router();auth.use(require('../src/middleware/authentication').createSessionMiddleware());
 auth.get('/start',(req,res)=>{req.session.userId=1;req.session.mode='online';req.session.isAdmin=true;res.json({ok:true})});
 auth.use(require('../src/modules/auth/routes'));app.use('/auth',auth);
 app.use((req,res,next)=>{req.session={...session};next()});
 app.use('/status',require('../src/modules/settings/status-routes'));
 app.use('/admin',require('../src/modules/admin/routes'));
 app.use('/my-settings',require('../src/modules/settings/my-settings-routes'));
 app.use('/office',require('../src/modules/office/profile-routes'));
 app.use('/documents',require('../src/modules/documents/routes'));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
});
async function call(url,method='GET',body){const r=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
test.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(root,{recursive:true,force:true})});
test('Live counts and user case assignment exclude demo rows even for admins',async()=>{
 const {data,status}=await call('/status');assert.equal(status,200);
 for(const [key,n] of Object.entries({faelle:1,nutzer:1,personen:1,termine:1,aufgaben:1,audit:1}))assert.equal(data.status[key],n,key);
 const cases=await call('/admin/users/1/cases');assert.deepEqual(cases.data.faelle.map(x=>x.id),['real-case']);
 const audit=await call('/admin/audit-log');assert.equal(audit.data.gesamt,1);assert.equal(audit.data.entries[0].action,'test.real');
 assert.equal(db.prepare('SELECT count(*) n FROM cases').get().n,2,'Demo source data remains intact');
 const access=require('../src/modules/cases/case-visibility');
 assert.equal(access.darfSehen(session,DEMO_CASES[0].id),false);
 assert.equal(access.darfZuordnungSehen(session,access.fallZuordnung(DEMO_CASES[0].id,'')),false);
 const docs=await call('/documents/tree?area=case&caseId='+DEMO_CASES[0].id);assert.equal(docs.status,403);
});
test('Admin zone persists; invalid zone and non-admin changes are rejected; DST boundaries are correct',async()=>{
 assert.equal((await call('/admin/system-time')).data.timeZone,'Europe/Berlin');
 assert.equal((await call('/admin/system-time','PUT',{timeZone:'Invalid/Nowhere'})).status,400);
 assert.equal((await call('/admin/system-time','PUT',{timeZone:'Europe/Berlin'})).status,200);
 assert.equal(systemTime.get(db).timeZone,'Europe/Berlin');
 assert.equal(systemTime.utcDayBoundary('2026-03-29'),'2026-03-28 23:00:00');
 assert.equal(systemTime.utcDayBoundary('2026-03-29',true),'2026-03-29 22:00:00');
 assert.equal(systemTime.utcDayBoundary('2026-10-25',true),'2026-10-25 23:00:00');
 db.prepare('UPDATE users SET is_admin=0 WHERE id=1').run();session.isAdmin=false;
 try{assert.equal((await call('/admin/system-time','PUT',{timeZone:'UTC'})).status,403)}finally{db.prepare('UPDATE users SET is_admin=1 WHERE id=1').run();session.isAdmin=true;}
});
test('Large office logo uploads, reads and deletes from the persistent document store',async()=>{
 const bytes=Buffer.alloc(400000,42);const body={filename:'test.png',mimeType:'image/png',dataBase64:bytes.toString('base64')};
 const saved=await call('/office/logo','POST',body);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.profile.hasLogo,true);
 const r=await fetch(`http://127.0.0.1:${server.address().port}/office/logo`);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
 assert.ok(db.prepare("SELECT id FROM doc_files WHERE name='test.png'").get());
 assert.equal((await call('/office/logo','DELETE')).data.profile.hasLogo,false);
});
test('Known legacy build login is removed without changing real administrator ID or deleting business data',()=>{
 const password=require('bcrypt').hashSync('Wegwerf-Paketbau-0000!',4);
 const id=db.prepare("INSERT INTO users(username,password_hash,is_admin,active,allow_online) VALUES('paketbau',?,1,1,1)").run(password).lastInsertRowid;
 db.prepare("UPDATE cases SET owner_user_id=? WHERE id='real-case'").run(id);
 db.prepare('INSERT INTO sessions(sid,data,expires_at) VALUES(?,?,?)').run('old-build-session',JSON.stringify({userId:id}),Date.now()+3600000);
 require('../src/modules/demo/retire-build-user').retire(db);
 assert.equal(db.prepare('SELECT id FROM users WHERE id=?').get(id),undefined);
 assert.equal(db.prepare("SELECT sid FROM sessions WHERE sid='old-build-session'").get(),undefined);
 assert.equal(db.prepare("SELECT owner_user_id FROM cases WHERE id='real-case'").get().owner_user_id,1);
 const quarantinedId=db.prepare("INSERT INTO users(username,password_hash,is_admin,active,allow_online) VALUES('paketbau',?,1,1,1)").run(password).lastInsertRowid;
 db.prepare('INSERT INTO sessions(sid,data,expires_at) VALUES(?,?,?)').run('quarantined-build-session',JSON.stringify({userId:quarantinedId}),Date.now()+3600000);
 db.prepare('UPDATE users SET is_admin=0 WHERE id=1').run();
 try {
  require('../src/modules/demo/retire-build-user').retire(db);
  assert.deepEqual(db.prepare('SELECT active,is_demo,allow_online,allow_local FROM users WHERE id=?').get(quarantinedId),{active:0,is_demo:1,allow_online:0,allow_local:0});
  assert.equal(db.prepare("SELECT sid FROM sessions WHERE sid='quarantined-build-session'").get(),undefined);
 } finally { db.prepare('UPDATE users SET is_admin=1 WHERE id=1').run(); }
 require('../src/modules/demo/retire-build-user').retire(db);
 assert.equal(db.prepare('SELECT id FROM users WHERE id=?').get(quarantinedId),undefined,'Quarantined account is retired once a real admin exists');
 db.prepare("INSERT INTO users(username,password_hash) VALUES('paketbau',?)").run(require('bcrypt').hashSync('Real human credential',4));
 require('../src/modules/demo/retire-build-user').retire(db);
 assert.ok(db.prepare("SELECT id FROM users WHERE username='paketbau'").get(),'Same name with different credential is preserved');
});

test('Logout destroys the actual session and the old cookie no longer authenticates',async()=>{
 const url=`http://127.0.0.1:${server.address().port}/auth`;
 const login=await fetch(url+'/start');const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(url+'/me',{headers:{cookie}})).status,200);
 const logout=await fetch(url+'/logout',{method:'POST',headers:{cookie}});assert.equal(logout.status,200);
 assert.equal((await fetch(url+'/me',{headers:{cookie}})).status,401);
});
test('AI configuration persists encrypted and its admin response never returns the key',async()=>{
 const key='synthetic-test-secret';const result=await call('/admin/ai-config/openai','PUT',{apiKey:key});assert.equal(result.status,200);
 assert.ok(!JSON.stringify(result.data).includes(key));
 const row=db.prepare("SELECT api_key_encrypted FROM office_ai_config WHERE provider='openai'").get();assert.ok(!row.api_key_encrypted.includes(key));
 assert.equal(require('../src/security/crypto').decrypt(row.api_key_encrypted),key);
 assert.ok(!JSON.stringify((await call('/admin/ai-config')).data).includes(key));
});

test('One send form persists office values, returns correct URL fields and enforces office precedence per service',async()=>{
 const office={username:'office-fax',password:'synthetic-fax-password',loginUrl:'https://example.invalid/login',inboxUrl:'https://example.invalid/inbox',composeUrl:'https://example.invalid/new'};
 assert.equal((await call('/admin/send-credentials/simplefax','PUT',office)).status,200);
 const data=(await call('/admin/send-credentials')).data;
 const fax=data.services.find(row=>row.service==='simplefax');
 assert.equal(fax.loginUrl,office.loginUrl);assert.equal(fax.inboxUrl,office.inboxUrl);assert.equal(fax.composeUrl,office.composeUrl);assert.equal(fax.hasPassword,true);
 assert.ok(!JSON.stringify(data).includes(office.password));
 assert.equal((await call('/admin/send-credentials/simplefax','PUT',{...office,password:''})).status,200);
 const own={simplefax:{username:'ignored-personal',password:'personal'},ebo:{username:'personal-ebo'}};
 require('../src/modules/settings/user-settings').setOverride(1,'send',own);
 const resolved=require('../src/modules/settings/send-credentials').resolve(db,own);
 assert.equal(resolved.values.simplefax.password,office.password,'Blank means retain saved password');
 assert.equal(resolved.values.simplefax.username,'office-fax');assert.equal(resolved.values.ebo.username,'personal-ebo');
 assert.deepEqual(resolved.sources,{ebo:'user',simplefax:'admin'});
 const status=(await call('/my-settings')).data.areas.send;
 assert.equal(status.services.simplefax,'admin');assert.equal(status.services.ebo,'user');
 assert.equal((await call('/admin/send-credentials/simplefax','DELETE')).status,200);
 assert.equal(require('../src/modules/settings/send-credentials').resolve(db,own).values.simplefax.username,'ignored-personal');
 require('../src/modules/settings/user-settings').clearOverride(1,'send');
});
