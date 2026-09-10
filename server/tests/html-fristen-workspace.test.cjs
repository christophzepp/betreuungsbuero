'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
const script=html.split('<script id="fristen-script-v1">')[1].split('</script>')[0];
function source(name,next){const start=script.indexOf('function '+name+'('),end=script.indexOf('function '+next+'(',start);assert.ok(start>=0&&end>start,name);return (name.startsWith('frWorkspace')?'async ':'')+script.slice(start,end).replace(/async $/,'')}
const iso=d=>d?[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'):'';
const parse=d=>d?new Date(d+'T12:00:00'):null;
function fixture(online=false){
 let id=0;const records=[],storage=new Map(),requests=[],links={calendar:[],todos:[]};
 const context={Date,Number,JSON,Math,Error,encodeURIComponent,window:{},parseIso:parse,isoOf:iso,toIso:v=>v||'',frSave:()=>{},refreshInd:()=>{},frData:()=>records,frOnline:()=>online,frMobileCaseId:()=>'local-case',newId:()=>String(++id),frCalPayload:f=>({title:f.title,startAt:f.dueDate}),frTodoPayload:f=>({title:f.title,dueAt:f.dueDate}),frAutoDokuV168:async()=>{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>{if(context.failLocal)throw new Error('Speicher voll');storage.set(k,v)}},fetch:async(url,options)=>{
   const kind=url.includes('/calendar/')?'calendar':'todos',list=links[kind],isItem=/\/[^/]+\/[^/]+$/.test(url)&&!url.endsWith('/events'),rowId=url.split('/').at(-1),row=list.find(x=>x.id===rowId);requests.push({url,...options});
   if(context.fail===kind)return{ok:false,status:503};
   if(options.method==='DELETE'){if(row)list.splice(list.indexOf(row),1);return{ok:!!row,status:row?200:404}}
   if(options.method==='PUT'&&!row)return{ok:false,status:404};
   const entry={...row,...JSON.parse(options.body),id:row?.id||String(++id)};if(row)Object.assign(row,entry);else list.push(entry);
   return{ok:true,status:200,json:async()=>({[kind==='calendar'?'event':'todo']:entry})};
 }};
 context.window.__frAutoDokuCompleteV168=async()=>{};
 vm.createContext(context);
 vm.runInContext(source('advance','addFrist')+source('normFrist','frAutoDokuV168')+source('frWorkspaceReconcile','frWorkspaceNext')+source('frWorkspaceNext','frWorkspaceComplete')+script.slice(script.indexOf('async function frWorkspaceComplete('),script.indexOf('const frWork =')),context);
 return{context,records,storage,requests,links,record:extra=>context.normFrist({id:'frist-1',title:'Belege',dueDate:'2026-01-31',routing:'both',...extra})};
}
test('Wiederholung klemmt Monatsende und Schaltjahr statt Tage zu überspringen',()=>{
 const {context:c}=fixture();for(const [date,interval,want] of [['2026-01-31','monthly','2026-02-28'],['2024-01-31','monthly','2024-02-29'],['2024-02-29','yearly','2025-02-28'],['2026-08-31','quarterly','2026-11-30'],['2026-03-28','weekly','2026-04-04'],['2026-01-31','halfyear','2026-07-31']])assert.equal(iso(c.advance(date,interval)),want);assert.equal(c.advance('2026-09-10',''),null);
});
test('Lokaler Abgleich aktualisiert IDs und erhält fremde Daten und Anlagen',async()=>{
 const {context:c,storage,record}=fixture(),fr=record();await c.frWorkspaceReconcile(fr);const initial=fr.calEventId,key='betreuungsbuero.calendarEvents.v1';let list=JSON.parse(storage.get(key));list[0].attachments=['a'];list.push({id:'unrelated',title:'Anderer Termin'});storage.set(key,JSON.stringify(list));fr.title='Belege aktualisiert';await c.frWorkspaceReconcile(fr);list=JSON.parse(storage.get(key));assert.equal(fr.calEventId,initial);assert.equal(list.length,2);assert.deepEqual(list[0].attachments,['a']);assert.equal(list[0].title,fr.title);
 fr.routing='none';await c.frWorkspaceReconcile(fr);assert.equal(fr.calEventId,'');assert.deepEqual(JSON.parse(storage.get(key)),[{id:'unrelated',title:'Anderer Termin'}]);
});
test('Voller lokaler Speicher meldet Fehler und vergibt keine falschen Verknüpfungen',async()=>{
 const {context:c,record}=fixture(),fr=record();c.failLocal=true;await assert.rejects(()=>c.frWorkspaceReconcile(fr),/Speicher voll/);assert.equal(fr.calEventId,'');assert.equal(fr.todoId,'');c.failLocal=false;await c.frWorkspaceReconcile(fr);assert.ok(fr.calEventId&&fr.todoId);assert.equal(fr.linkSyncError,'');
});
test('Online-Teilfehler wird ohne zusätzliche Kalender-Dublette wiederholt',async()=>{
 const {context:c,links,record,requests}=fixture(true),fr=record();c.fail='todos';await assert.rejects(()=>c.frWorkspaceReconcile(fr),/unvollständig/);const saved=fr.calEventId;assert.ok(saved);assert.equal(fr.todoId,'');c.fail='';await c.frWorkspaceReconcile(fr);assert.equal(fr.calEventId,saved);assert.equal(links.calendar.length,1);assert.equal(links.todos.length,1);assert.ok(requests.some(r=>r.method==='PUT'));
});
test('Entfernte externe Verknüpfung wird nur bei 404 neu angelegt',async()=>{
 const {context:c,links,record}=fixture(true),fr=record({calEventId:'missing',routing:'calendar'});await c.frWorkspaceReconcile(fr);assert.notEqual(fr.calEventId,'missing');assert.equal(links.calendar.length,1);c.fail='calendar';await assert.rejects(()=>c.frWorkspaceReconcile(fr));assert.equal(links.calendar.length,1);
});
test('Abgebrochener Serienabschluss behält seinen Fortschritt und erzeugt eine Folgefrist',async()=>{
 const {context:c,records,record}=fixture(true),fr=record({interval:'monthly',status:'erledigt',pendingCompletion:true});records.push(fr);c.fail='todos';await assert.rejects(()=>c.frWorkspaceComplete(fr));assert.equal(fr.pendingCompletion,true);assert.equal(records.length,2);c.fail='';await c.frWorkspaceComplete(fr);assert.equal(records.length,2);assert.equal(records[1].dueDate,'2026-02-28');assert.equal(records[1].previousId,fr.id);assert.equal(records[1].pendingCompletion,false);assert.equal(fr.pendingCompletion,false);await c.frWorkspaceComplete(fr);assert.equal(records.length,2);
});
test('Bestätigtes Speichern meldet Schreibschutz, falschen Fall und Serverfehler',async()=>{
 const start=html.indexOf('  async function flushStammdatenSync('),end=html.indexOf('  function diffReportFields(',start),ctx={window:{__appMode:'online'},currentCaseId:'case-a',lastSyncedCaseData:{},combinedStammdatenView:()=>({fristen:[{id:'a'}]}),diffTopLevel:()=>[{path:'fristen',value:[{id:'a'}]}],STAMMDATEN_EXCLUDE:[],rememberSent:()=>{},clone:structuredClone,warnPermissionDeniedOnce:()=>{},fetch:async()=>({ok:false,status:503})};vm.createContext(ctx);vm.runInContext(html.slice(start,end),ctx);
 await assert.rejects(()=>ctx.flushStammdatenSync({strict:true,caseId:'case-b'}),/Zielfall/);ctx.window.__mwReadOnly=true;await assert.rejects(()=>ctx.flushStammdatenSync({strict:true,caseId:'case-a'}),/schreibgeschützt/);ctx.window.__mwReadOnly=false;await assert.rejects(()=>ctx.flushStammdatenSync({strict:true,caseId:'case-a'}),/503/);assert.deepEqual(ctx.lastSyncedCaseData,{});await ctx.flushStammdatenSync();ctx.fetch=async()=>({ok:true});await ctx.flushStammdatenSync({strict:true,caseId:'case-a'});assert.equal(ctx.lastSyncedCaseData.fristen[0].id,'a');
});
test('Fristen-Arbeitsbereich initialisiert ohne bereits geöffnetes Dialogelement',()=>{
 const start=script.indexOf('const frWork ='),end=script.indexOf('\nconst frWorkspaceOriginalSave',start),listeners=[];assert.ok(start>=0&&end>start);const ctx={Date,isoOf:iso,window:{addEventListener:(name,fn)=>listeners.push([name,fn])}};vm.createContext(ctx);assert.doesNotThrow(()=>vm.runInContext(script.slice(start,end),ctx));assert.ok(listeners.some(([name])=>name==='mobileBeforeNavigate'));
});
test('Fehlgeschlagenes Nachladen erhält die bisherigen Fristenvorschläge',async()=>{
 const start=script.indexOf('async function loadCases('),end=script.indexOf('window.openFristenModal=',start),ctx={window:{},halfYearStart:()=> '2026-07-01',encodeURIComponent,frItems:[{caseId:'bisher'}],frCasesLoaded:true,fetch:async()=>({ok:false,status:503})};vm.createContext(ctx);vm.runInContext('async '+source('fristCases','__caseDeadlines')+script.slice(start,end),ctx);await assert.rejects(()=>ctx.loadCases(true),/503/);assert.equal(ctx.frItems[0].caseId,'bisher');ctx.fetch=async()=>({ok:true,json:async()=>({items:[{caseId:'neu'}]})});await ctx.loadCases(true);assert.equal(ctx.frItems[0].caseId,'neu');
});

test('Lokale Verknüpfungen mit numerischen IDs werden ohne Dublette aktualisiert',async()=>{
 const {context:c,storage,record}=fixture(),fr=record({calEventId:'42',routing:'calendar'}),key='betreuungsbuero.calendarEvents.v1';storage.set(key,JSON.stringify([{id:42,title:'Bisher',attachments:['anlage']}])) ;await c.frWorkspaceReconcile(fr);const list=JSON.parse(storage.get(key));assert.equal(list.length,1);assert.equal(list[0].title,fr.title);assert.deepEqual(list[0].attachments,['anlage']);fr.routing='none';await c.frWorkspaceReconcile(fr);assert.deepEqual(JSON.parse(storage.get(key)),[]);
});
