'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'calendar-sources-'));
process.env.RUNTIME_ROOT=root;process.env.DB_PATH=path.join(root,'test.sqlite3');process.env.ENCRYPTION_KEY='a'.repeat(64);
const db=require('../src/database'),prefs=require('../src/modules/calendar/source-preferences').create(db),sync=require('../src/modules/calendar/sync');
let server,userId=1,failPush=false;const pushes=[];
const settings=()=>({version:1,localCalendar:false,localTasks:false,defaultCalendar:{connectionId:'office',calendarRef:'primary'},defaultTasks:{connectionId:'office',calendarRef:'tasks'}});
test.before(async()=>{
 db.prepare("INSERT INTO users(id,username,password_hash,is_admin,active,allow_online) VALUES(1,'admin','x',1,1,1),(2,'other','x',1,1,1)").run();
 db.prepare("INSERT INTO calendar_connections(id,provider,display_name,enabled,visibility,owner_user_id) VALUES('office','google','Büro',1,'public',1),('private','google','Privat',1,'private',2),('off','google','Ausgeschaltet',0,'public',1),('tasks-only','vikunja-api','Projekte',1,'public',1)").run();
 db.prepare("INSERT INTO connection_calendars(id,connection_id,kind,remote_id,name,selected) VALUES('e','office','event','primary','Termine',1),('t','office','task','tasks','Aufgaben',1),('p','private','event','primary','Termine',1),('off-e','off','event','primary','Termine',1),('vt','tasks-only','task','tasks','Aufgaben',1)").run();
 sync.pushEvent=async(conn,item)=>{if(failPush)throw new Error('Test offline');pushes.push({kind:'event',conn:conn.id,...item});return{calendarRef:item.calendarRef,uid:'external-event'}};
 sync.pushTodo=async(conn,item)=>{if(failPush)throw new Error('Test offline');pushes.push({kind:'task',conn:conn.id,...item});return{calendarRef:item.calendarRef,uid:'external-task'}};
 const app=require('express')();app.use(require('express').json());app.use((req,res,next)=>{req.session={userId,isAdmin:true,mode:'online',canViewCases:true,canEditCases:true};next()});app.use('/calendar',require('../src/modules/calendar/routes'));app.use('/todos',require('../src/modules/calendar/todo-routes'));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 app.use('/documents',require('../src/modules/documents/routes'));
});
test.after(async()=>{if(server)await new Promise(r=>server.close(r));db.close();fs.rmSync(root,{recursive:true,force:true})});
async function call(url,method='GET',body){const r=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()}}
test('Source preferences require usable destinations and are personal and persistent',async()=>{
 assert.equal(prefs.get(1).localCalendar,true);
 assert.equal((await call('/calendar/source-preferences','PUT',{prefs:{...settings(),defaultCalendar:null}})).status,400);
 assert.equal((await call('/calendar/source-preferences','PUT',{prefs:{...settings(),defaultCalendar:{connectionId:'private',calendarRef:'primary'}}})).status,400);
 assert.equal((await call('/calendar/source-preferences','PUT',{prefs:{...settings(),defaultCalendar:{connectionId:'tasks-only',calendarRef:'tasks'}}})).status,400);
 assert.equal((await call('/calendar/source-preferences','PUT',{prefs:settings()})).status,200);
 assert.deepEqual(require('../src/modules/calendar/source-preferences').create(db).get(1),settings());
 assert.equal(prefs.get(2).localCalendar,true);
 const result=await call('/calendar/connections');assert.deepEqual(result.body.sourcePreferences,settings());assert.ok(!result.body.connections.some(c=>['private','off'].includes(c.id)));assert.ok(!JSON.stringify(result.body).includes('password'));
});
test('Disabled local targets reject explicit local writes and route implicit writes to the chosen online lists',async()=>{
 const event={title:'Testtermin',startAt:'2026-09-20T09:00:00',endAt:'2026-09-20T10:00:00'};
 assert.equal((await call('/calendar/events','POST',{...event,connectionId:'local'})).status,409);
 assert.equal((await call('/todos','POST',{title:'Testaufgabe',connectionId:'local'})).status,409);
 const e=await call('/calendar/events','POST',event);assert.equal(e.status,201);assert.equal(e.body.event.connectionId,'office');assert.equal(e.body.event.calendarRef,'primary');
 for(const itemType of ['task','deadline','followup']){const t=await call('/todos','POST',{title:'Test '+itemType,itemType,sourceType:'document',sourceId:'synthetic'});assert.equal(t.status,201);assert.equal(t.body.todo.connectionId,'office');assert.equal(t.body.todo.calendarRef,'tasks')}
 assert.equal(pushes.length,4);
});
test('Provider failure, disconnected default and unsupported recurrence never silently create local entries',async()=>{
 const count=()=>db.prepare('SELECT (SELECT count(*) FROM calendar_events)+(SELECT count(*) FROM todos) n').get().n,before=count();failPush=true;
 assert.equal((await call('/calendar/events','POST',{title:'Offline',startAt:'2026-09-21T10:00:00'})).status,502);
 assert.equal((await call('/todos','POST',{title:'Offline'})).status,502);failPush=false;
 assert.equal((await call('/todos','POST',{title:'Serie',recurrenceRule:'{"freq":"daily"}'})).status,422);
 db.prepare("UPDATE calendar_connections SET enabled=0 WHERE id='office'").run();
 assert.equal((await call('/todos','POST',{title:'Ohne Ziel'})).status,409);
 db.prepare("UPDATE calendar_connections SET enabled=1 WHERE id='office'").run();
 assert.equal(count(),before);
});
test('Deselected lists cannot remain destinations; legacy single-list connections remain usable',()=>{
 db.prepare("UPDATE connection_calendars SET selected=0 WHERE id='t'").run();
 db.prepare("UPDATE calendar_connections SET task_list_id='tasks' WHERE id='office'").run();
 assert.throws(()=>prefs.resolve(1,'task'),e=>e.status===409);
 db.prepare("UPDATE connection_calendars SET selected=1 WHERE id='t'").run();
 db.prepare("INSERT INTO calendar_connections(id,provider,display_name,enabled,calendar_url) VALUES('legacy','nextcloud','Altbestand',1,'https://calendar.invalid/events/')").run();
 assert.ok(prefs.targets(1,'event').some(t=>t.connectionId==='legacy'&&t.calendarRef==='https://calendar.invalid/events/'));
});
test('Local-only document and contact dialogs reject new entries before modifying their originals',async()=>{
 db.prepare("INSERT INTO doc_files(id,area,name) VALUES('doc-local','office','Test.pdf')").run();
 const result=await call('/documents/files/doc-local/wiedervorlage','PATCH',{datum:'2026-10-01',notiz:'Test'});
 assert.equal(result.status,409);assert.match(result.body.error,/lokale Speicherziel ist ausgeschaltet/);
 assert.equal(db.prepare("SELECT resubmit_at FROM doc_files WHERE id='doc-local'").get().resubmit_at,'');
 db.prepare("INSERT INTO cases(id,label,owner_user_id) VALUES('case-local','Testfall',1)").run();
 db.prepare("INSERT INTO case_contacts(id,case_id,data_json) VALUES('contact-local','case-local','{}')").run();
 assert.throws(()=>require('../src/modules/contacts/addressbook-followup').save({scope:'case',caseId:'case-local',id:'contact-local',targetCaseId:'case-local',followupId:'blocked-contact',patch:{name:'Antwort',dueAt:'2026-10-01'}},{userId:1,isAdmin:true}),e=>e.status===409);
 assert.equal(db.prepare("SELECT count(*) n FROM todos WHERE id='blocked-contact' OR source_id='doc-local'").get().n,0);
 assert.equal(db.prepare("SELECT count(*) n FROM case_doku_entries WHERE id='ab-followup-blocked-contact'").get().n,0);
});
test('MCP rejects mixed proposals before any local calendar or task write',async()=>{
 const {callTool}=require('../src/integrations/mcp/tools'),session={userId:1,isAdmin:true},client={id:'test'},scopes=['bb.propose'];
 const proposal=await callTool(session,client,scopes,'bb_vorschlagen',{kind:'paket',fall:'case-local',zeilen:[{modul:'doku_eintrag',detail:'Must not be written'},{modul:'aufgabe',title:'Must not be local'}]});
 const before=db.prepare("SELECT count(*) n FROM case_doku_entries WHERE case_id='case-local'").get().n;
 await assert.rejects(callTool(session,client,scopes,'bb_vorschlag_uebernehmen',{vorschlagId:proposal.vorschlagId}),/lokale Speicherziel ist ausgeschaltet/);
 assert.equal(db.prepare("SELECT count(*) n FROM case_doku_entries WHERE case_id='case-local'").get().n,before);
 assert.equal(db.prepare("SELECT count(*) n FROM todos WHERE title='Must not be local'").get().n,0);
});
test('Existing local entries remain editable and re-enabling local storage permits new local entries',async()=>{
 db.prepare("INSERT INTO calendar_events(id,title,start_at,end_at) VALUES('old-event','Alt','2026-09-20T09:00:00','2026-09-20T10:00:00')").run();db.prepare("INSERT INTO todos(id,title) VALUES('old-task','Alt')").run();
 assert.equal((await call('/calendar/events/old-event','PUT',{title:'Alt geändert'})).status,200);
 assert.equal((await call('/todos/old-task','PUT',{title:'Alt geändert'})).status,200);
 assert.equal((await call('/calendar/source-preferences','PUT',{prefs:{...settings(),localCalendar:true,localTasks:true}})).status,200);
 assert.equal((await call('/todos','POST',{title:'Wieder lokal',connectionId:'local'})).body.todo.connectionId,null);
});
