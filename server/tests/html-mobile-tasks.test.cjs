'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
function source(name,next){const start=html.indexOf('function '+name+'(');assert.ok(start>=0);return html.slice(start,html.indexOf('\nfunction '+next+'(',start))}
function fixture(){
 const hidden=new Set();const ctx={Date,Set,hidden,toLocalInputDate:v=>{const d=new Date(v);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`},calHiddenSet:()=>hidden,itemMatchesCase:(t,id)=>id==='__all__'||t.caseId===id,itemCaseLabel:t=>t.caseLabel,todoItemType:t=>t.itemType||'task',todoFullFilter:'__all__',todoMobileListName:t=>t.calendarRef||'Lokal'};
 vm.createContext(ctx);vm.runInContext(source('todoMobileDay','todoMobileListKey')+source('todoMobileListKey','todoMobileLists')+source('todoMobileFilter','todoMobileSorted'),ctx);
 const base={status:'open',due:'all',priority:'all',type:'all',list:'all',search:''};
 return {hidden,filter:(items,extra={},now=new Date(2026,8,7,17))=>Array.from(ctx.todoMobileFilter(items,{...base,...extra},now),t=>t.id)};
}
const items=[{id:'today',dueAt:'2026-09-07T00:00:00',priority:'high',caseId:'a',caseLabel:'Mara Hoffmann',title:'Arztbrief',calendarRef:'office'}, {id:'overdue',dueAt:'2026-09-06T23:00:00',priority:'normal',caseId:'b',title:'Rückruf'}, {id:'done',dueAt:'2026-09-01T00:00:00',priority:'high',done:true}, {id:'none',priority:'low',caseId:'a',description:'Wohnberatung'}, {id:'followup',itemType:'followup',dueAt:'2026-09-13T00:00:00',caseId:'a'}, {id:'next-week',dueAt:'2026-09-14T00:00:00'}];
test('Heute wird am Nachmittag nicht als überfällig einsortiert',()=>{const f=fixture();assert.deepEqual(f.filter(items,{due:'today'}),['today']);assert.deepEqual(f.filter(items,{due:'overdue',status:'all'}),['overdue'])});
test('Diese Woche endet am Sonntag und überschreitet keine Kalenderwoche',()=>{const f=fixture();assert.deepEqual(f.filter(items,{due:'week'}),['today','followup']);assert.deepEqual(f.filter(items,{due:'week'},new Date(2026,8,13,22)),['followup'])});
test('Suche, Fall-ID, Liste, Priorität und Status lassen sich kombinieren',()=>{const f=fixture();assert.deepEqual(f.filter(items,{search:'HOFFMANN',caseFilter:'a',list:'task::office',priority:'high'}),['today']);assert.deepEqual(f.filter(items,{caseFilter:'b',list:'task::office'}),[]);assert.deepEqual(f.filter(items,{status:'done'}),['done']);assert.deepEqual(f.filter(items,{search:'wohnberatung',due:'none'}),['none'])});
test('Wiedervorlagen und Aufgaben beachten die vorhandenen getrennten Sichtbarkeitsschlüssel',()=>{const f=fixture();f.hidden.add('pseudo::followups');assert.deepEqual(f.filter(items,{type:'followup'}),[]);f.hidden.delete('pseudo::followups');assert.deepEqual(f.filter(items,{type:'followup'}),['followup']);f.hidden.add('task::office');assert.deepEqual(f.filter(items,{priority:'high'}),[])});
test('Ungültige oder fehlende Daten werden als ohne Termin behandelt',()=>{const f=fixture();assert.deepEqual(f.filter([{id:'bad',dueAt:'kaputt'},{id:'none'}],{due:'none'}),['bad','none'])});
test('Mobile Oberfläche nutzt Originalformular und Speicherlogik, keine zweite Aufgaben-Datenbank',()=>{
 const pilot=html.slice(html.indexOf('/* ===== Aufgaben-Pilot:'),html.indexOf('/* ===== Vollständige Aufgabenliste'));
 assert.match(pilot,/window\.__mobileUI\.createView/);assert.match(html,/if\(todoMobileActive\(\)\)todoMobileAdoptForm\(t,formLabel\)/);
 assert.match(pilot,/await todoUpdate\(todoFormEditId,payload\)/);assert.match(pilot,/await todoCreate\(payload\)/);assert.match(pilot,/todoFormPendingFiles=failed/);
 assert.match(pilot,/todoMobileRefreshAttachments/);assert.match(pilot,/mobileBeforeNavigate/);
 const css=html.slice(html.indexOf('/* Aufgaben-Pilot: Dokumentationsstil'),html.indexOf('html.mobile-online-active.mobile-keyboard-open .mobile-ui-nav'));
 assert.match(css,/@media \(max-width: 1024px\)/);for(const line of css.split('\n').filter(l=>l.includes('{')&&!l.startsWith('@')&&!l.startsWith('/*')))assert.ok(line.startsWith('html.mobile-online-active'),line);
});
