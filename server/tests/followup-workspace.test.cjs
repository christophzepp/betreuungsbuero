'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
const moduleSource=html.match(/<script id="followup-workspace-v1">([\s\S]*?)<\/script>/)[1];
const extract=(start,end)=>moduleSource.slice(moduleSource.indexOf(start),moduleSource.indexOf(end,moduleSource.indexOf(start)));
test('Shipped followup module and all other scripts compile',()=>require('./helpers/html-scripts.cjs').assertScriptInventory(html));
test('Central original picker includes all case sources while ordinary overview retains its selected case',()=>{
 const contexts=[{id:'a',label:'Alpha'},{id:'b',label:'Beta'}];
 const context={S:{workspaceCollect:false},text:v=>String(v||''),arr:v=>v,caseContexts:()=>contexts,allCasesSelected:()=>false,objectCaseContext:(row,allowed)=>allowed.find(c=>c.id===row.caseId)};
 const start=html.indexOf('function externalRows(source,contexts){');
 vm.runInNewContext(html.slice(start,html.indexOf('function makeItem(',start))+';this.rows=externalRows;',context);
 const sources=[{id:'doc-a',caseId:'a'},{id:'doc-b',caseId:'b'}];
 assert.deepEqual(Array.from(context.rows(sources,contexts),x=>x.obj.id),['doc-a']);
 context.S.workspaceCollect=true;
 assert.deepEqual(Array.from(context.rows(sources,contexts),x=>x.obj.id),['doc-a','doc-b']);
 context.S.workspaceCollect=false;
 assert.deepEqual(Array.from(context.rows(sources,contexts.slice(1)),x=>x.obj.id),['doc-b']);
});
test('Only genuine followups, including legacy records; deadline links excluded',()=>{
 const context={window:{__todoItemType:x=>x.itemType||(/^Wiedervorlage:/.test(x.title)?'followup':'task')}};
 vm.runInNewContext(extract('function isFollowup','let loadPromise')+';this.accept=isFollowup',context);
 for(const x of [{itemType:'followup'},{title:'Wiedervorlage: Dokument'},{itemType:'followup',sourceModule:'goalDecisionPlanning'}])assert.equal(context.accept(x),true);
 for(const x of [{itemType:'task'},{itemType:'deadline'},{itemType:'followup',sourceType:'frist'},{itemType:'followup',sourceModule:'deadlines'},{itemType:'followup',title:'Erinnerung vor Fristablauf: Antwort'},{itemType:'followup',id:'linked'}])assert.equal(context.accept(x,['linked']),false);
});
test('Date validation rejects impossible dates and preserves leap days',()=>{const c={};vm.runInNewContext(extract('function validDate','async function save')+';this.valid=validDate',c);for(const s of ['2026-02-30','2026-02-29','2026-13-12','2026-09-00',''])assert.equal(c.valid(s),false,s);for(const s of ['2028-02-29','2026-12-31'])assert.equal(c.valid(s),true,s)});
test('Optimistic conflict check protects updated records without blocking irrelevant timestamps',()=>{const c={};vm.runInNewContext(extract('function hasChanged','async function fresh')+';this.changed=hasChanged',c);assert.equal(c.changed({title:'A',updatedAt:'x'},{title:'A',updatedAt:'y'}),false);assert.equal(c.changed({dueAt:'2026-09-12'},{dueAt:'2026-09-13'}),true);assert.equal(c.changed({done:false},{done:true}),true)});
const outboxSource=fs.readFileSync(path.resolve(__dirname,'../src/modules/mail/outbox.js'),'utf8');
function wakeFixture(){
 let row={id:'s1',account_id:'a1',folder:'Wiedervorlage',message_id:'m1',wake_at:'2026-09-01T12:00:00Z',attempts:0},position='Wiedervorlage',fail=false,release=null,moves=0;
 const db={prepare(sql){return {get:()=>sql.includes('mail_accounts')?{id:'a1',kind:'imap'}:row,all:()=>row?[row]:[],run(...args){if(sql.startsWith('DELETE FROM mail_snoozes'))row=null;else if(sql.includes('SET attempts')){row.attempts++;row.wake_at=args[0]}}}}};
 const engine={findByMessageId:async(acc,folder)=>{if(fail)throw Error('Provider offline');return folder===position?'17':null},moveMessage:async(acc,from,uid,to)=>{moves++;if(release)await release;position=to},setFlags:async()=>({})};
 const context={db,mailSend:{},imapEngine:engine,graphEngine:engine,applicationWriteBarrier:{},module:{exports:{}},process:{env:{MAILBOX_WATCH:'0'}},require:id=>id.includes('database')?db:id.includes('imap')||id.includes('microsoft-graph')?engine:{},setInterval:()=>0,clearInterval:()=>{}};
 vm.runInNewContext(outboxSource,context);
 // Account query shares the fixture DB above; return the right shape.
 return {api:context.module.exports,get row(){return row},get moves(){return moves},get position(){return position},setFail(v){fail=v},block(){let done;release=new Promise(r=>done=r);return done}};
}
test('Mail return moves the actual message and removes schedule after success',async()=>{const f=wakeFixture();const r=await f.api.wakeSnooze('s1');assert.equal(f.position,'INBOX');assert.equal(f.moves,1);assert.equal(f.row,null);assert.equal(r.folder,'INBOX')});
test('Provider errors preserve schedule for retry, even beyond old retry cap',async()=>{const f=wakeFixture();f.setFail(true);await assert.rejects(f.api.wakeSnooze('s1'),/offline/);assert.ok(f.row);for(let i=0;i<7;i++)await f.api.wakeSnoozes('2026-09-11T12:00:00Z');assert.ok(f.row);assert.equal(f.row.attempts,7);assert.equal(f.row.wake_at,'2026-09-11T12:05:00.000Z')});
test('Scheduler and manual return cannot move the same message concurrently',async()=>{const f=wakeFixture(),release=f.block();const first=f.api.wakeSnooze('s1');await Promise.resolve();assert.equal(f.api.snoozeBusy('s1'),true);await assert.rejects(f.api.wakeSnooze('s1'),/bereits/);release();await first;assert.equal(f.moves,1);assert.equal(f.api.snoozeBusy('s1'),false)});
const routesSource=fs.readFileSync(path.resolve(__dirname,'../src/modules/mail/mailbox-routes.js'),'utf8');
function routeFixture(){const rows=[{id:'s1',owner_user_id:1,account_id:'a1',folder:'Wiedervorlage',message_id:'m1'}],handlers={};let visible=true,wakes=0,viewCases=true,caseVisible=true;const db={prepare(sql){return {get:id=>sql.includes('office_json')?{data_json:JSON.stringify({'a1|m1':{caseId:'case-a',caseLabel:'Fall A',messageId:'m1',uid:'old-uid'}})}:rows.find(x=>x.id===id),all:id=>rows.filter(x=>x.owner_user_id===id),run(...a){if(sql.startsWith('UPDATE'))rows[0].wake_at=a[0];if(sql.startsWith('DELETE'))rows.splice(0)}}}};const router=Object.fromEntries(['get','patch','post','delete'].map(m=>[m,(url,fn)=>handlers[m+' '+url]=fn]));const ctx={router,db,hasPermission:()=>viewCases,darfSehen:()=>caseVisible,visibleAccount:()=>visible?{id:'a1'}:null,outbox:{snoozeBusy:()=>false,wakeSnooze:async()=>{wakes++;return {folder:'INBOX'}}},engineFor:()=>({findByMessageId:async()=>1})};vm.runInNewContext(routesSource.slice(routesSource.indexOf("router.get('/snoozes'"),routesSource.indexOf('// Abwesenheitsnotiz')),ctx);return {async call(method,url,user,body={}){let status=200,data;await handlers[method+' '+url]({params:{id:'s1'},session:{userId:user},body},{status(n){status=n;return this},json(d){data=d;return this}});return {status,data}},hide(){visible=false},hideCases(){viewCases=false},hideCase(){caseVisible=false},get wakes(){return wakes},rows}}
test('Mail source, update, return and cancel require both ownership and account visibility',async()=>{for(const [m,p] of [['get','/snoozes/:id/source'],['patch','/snoozes/:id'],['post','/snoozes/:id/wake'],['delete','/snoozes/:id']]){const f=routeFixture();assert.equal((await f.call(m,p,2)).status,404);f.hide();assert.equal((await f.call(m,p,1)).status,404);assert.equal(f.wakes,0)}});
test('Rescheduling rejects past dates and persists future ISO timestamp',async()=>{const f=routeFixture();assert.equal((await f.call('patch','/snoozes/:id',1,{wakeAt:'2020-01-01'})).status,400);const wakeAt=new Date(Date.now()+864e5).toISOString();assert.equal((await f.call('patch','/snoozes/:id',1,{wakeAt})).status,200);assert.equal(f.rows[0].wake_at,wakeAt)});

test('Local creation and deletion propagate storage failure instead of claiming success',async()=>{
 const from=html.indexOf('async function todoCreate(t)'),to=html.indexOf('window.__gdpTodoGet=',from),context={window:{},isOnline:()=>false,normalizeTodoRecord:x=>x,loadLocal:()=>[{id:'one'}],uid:()=> 'new',TODO_STORAGE_KEY:'todos',autoDokuTodoV168:async()=>{},saveLocal:(key,list,strict)=>{if(strict)throw Error('Speicher voll')}};
 vm.runInNewContext(html.slice(from,to)+';this.create=todoCreate;this.remove=todoRemove;',context);
 await assert.rejects(context.create({title:'Wiedervorlage: Prüfen',itemType:'followup'}),/Speicher voll/);
 await assert.rejects(context.remove('one'),/Speicher voll/);
});

test('Source mapping keeps planning originals and resolves only unambiguous legacy cases',async()=>{
 const context={window:{__appMode:'local',__todoItemType:x=>x.itemType,__caseRefMatches:(t,id,name)=>t.caseLabel===name,__caseOverview:{workspaceData:async()=>({cases:[{id:'a',label:'Alpha'},{id:'b',label:'Beta'}],deadlineTodoIds:[],sources:[{id:'a::planning-plan',kind:'planning',caseId:'a',title:'Ziel',raw:{id:'plan'}}],todos:[{id:'one',itemType:'followup',caseLabel:'Alpha',sourceModule:'goalDecisionPlanning',sourceType:'wish',sourceId:'plan',dueAt:'2026-09-12'},{id:'two',itemType:'followup',caseId:'b',caseLabel:'Alpha',sourceType:'note',sourceId:'n2'}]})}},renderMini:()=>{},fetch:()=>{throw Error('No network in local mode')},document:{getElementById:()=>null}};
 const runtime=moduleSource.slice(moduleSource.indexOf('const esc='),moduleSource.indexOf('const origins='));
 vm.runInNewContext(runtime+';this.load=load;this.snapshot=()=>({items,sources});',context);
 await context.load();const {items,sources}=context.snapshot();assert.equal(items.length,2);
 const first=sources.find(x=>x.id===items[0].sourceId),second=sources.find(x=>x.id===items[1].sourceId);
 assert.equal(first.caseId,'a');assert.equal(first.available,true);assert.equal(first.origin,'planning');assert.equal(first.ref,'a::planning-plan');assert.equal(second.caseId,'b');
});

test('Mail case assignment survives moved UIDs and respects case permissions',async()=>{
 const f=routeFixture();assert.equal((await f.call('get','/snoozes',1)).data.snoozes[0].caseId,'case-a');
 f.hideCase();assert.equal((await f.call('get','/snoozes',1)).data.snoozes[0].caseId,'');
 const g=routeFixture();g.hideCases();assert.equal((await g.call('get','/snoozes',1)).data.snoozes[0].caseId,'');
});
