'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
function source(name,next){const start=html.indexOf('function '+name+'('),end=html.indexOf('function '+next+'(',start);assert.ok(start>=0&&end>start);return html.slice(start,end)}
function context(){
 const ctx={Date,calFullFilter:'__all__',calMobile:{type:'all',calendar:'all'},itemMatchesCase:(e,id)=>id==='__all__'||e.caseId===id,calPseudoVisible:e=>!e.hidden,calEventVisible:e=>!e.hidden,calEventMatchesSearch:()=>true,calEventMatchesKeyword:()=>true,dateToLocalIso:date=>{const pad=n=>String(n).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`}};
 vm.createContext(ctx);vm.runInContext(source('calMobileFiltered','calMobileOpen').replace(/async\s*$/,'')+source('calMobileRangeEvents','calMobileMove'),ctx);return ctx;
}
test('Kalenderfilter kombiniert Fall-ID, Kalender und Eintragsart mit persönlichen Sichtbarkeiten',()=>{
 const ctx=context(),rows=[{id:'a',caseId:'a',calendarRef:'office',startAt:'2026-09-07T10:00:00'},{id:'b',caseId:'b',calendarRef:'office',startAt:'2026-09-07T11:00:00'},{id:'hidden',caseId:'a',calendarRef:'office',hidden:true,startAt:'2026-09-07T12:00:00'},{id:'task',caseId:'a',__calItemKind:'todo',__pseudoList:'tasks',calendarRef:'office',startAt:'2026-09-07T00:00:00'}];
 const filter=extra=>Array.from(ctx.calMobileFiltered(rows,{caseId:'__all__',calendar:'all',type:'all',...extra}),e=>e.id);
 assert.deepEqual(filter({caseId:'a',calendar:'office'}),['a']);assert.deepEqual(filter({type:'tasks'}),['task']);assert.deepEqual(filter({caseId:'b',type:'events'}),['b']);assert.deepEqual(filter({caseId:'a',calendar:'office',type:'tasks'}),[]);
});
test('Agenda schließt die vorherige Ganztagsbuchung am exklusiven Ende aus, zeigt aber den gesamten Endtag',()=>{
 const ctx=context(),range={start:new Date('2026-09-07T00:00:00'),end:new Date('2026-09-08T00:00:00')};
 const events=[{id:'previous',startAt:'2026-09-06T00:00:00',endAt:'2026-09-07T00:00:00'},{id:'today',startAt:'2026-09-07T00:00:00',endAt:'2026-09-08T00:00:00'},{id:'last-minute',startAt:'2026-09-07T23:59:00',endAt:'2026-09-08T00:30:00'},{id:'next',startAt:'2026-09-08T00:00:00',endAt:'2026-09-08T01:00:00'},{id:'instant',startAt:'2026-09-07T00:00:00',endAt:'2026-09-07T00:00:00'}];
 assert.deepEqual(Array.from(ctx.calMobileRangeEvents(events,range),e=>e.id),['today','last-minute','instant']);
});
test('Verschieben erhält Termindauer und Abstand der Erinnerung',()=>{
 const ctx=context(),patch=ctx.calMobileMovePatch({startAt:'2026-09-07T10:30:00',endAt:'2026-09-07T11:45:00',reminderAt:'2026-09-07T10:00:00'},'2026-09-09','14:15');
 assert.equal(patch.startAt,'2026-09-09T14:15:00');assert.equal(patch.endAt,'2026-09-09T15:30:00');assert.equal(patch.reminderAt,'2026-09-09T13:45:00');assert.equal(patch.allDay,false);
});
test('Mehrtagstermine behalten beim Verschieben die Anzahl ganzer Kalendertage über Zeitumstellungen',()=>{
 const previous=process.env.TZ;process.env.TZ='Europe/Berlin';
 try{const ctx=context(),patch=ctx.calMobileMovePatch({startAt:'2026-03-28T00:00:00',endAt:'2026-03-31T00:00:00',allDay:true},'2026-10-24','12:00');assert.equal(patch.startAt,'2026-10-24T00:00:00');assert.equal(patch.endAt,'2026-10-27T00:00:00');assert.equal(patch.allDay,true)}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
});
