'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
function block(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a);return html.slice(a,b)}
function context(){
 const values=new Map(),ctx={window:{},isOnline:()=>true,todoItemType:t=>t.itemType||'task',localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}};
 vm.createContext(ctx);vm.runInContext('let calConnectionsCache=[],promptEventsCache=[],promptTodosCache=[];'+block('const CAL_PROVIDER_LABELS=','async function loadCalConnections(')+block("const CAL_VIS_KEY=",'function calRefreshAfterVis(')+block('function calCatalog(', '// Kalenderfarbe zu einem calendar_ref'),ctx);
 vm.runInContext("calConnectionsCache=['a','b'].map(id=>({id,provider:'google',displayName:id==='a'?'Büro':'Persönlich',calendars:[{kind:'event',remoteId:'primary',name:'Termine'},{kind:'task',remoteId:'same',name:'Aufgaben'}]}));",ctx);return ctx;
}
test('Gleichnamige Kalender verschiedener Konten behalten getrennte Identität, Farbe und Sichtbarkeit',()=>{
 const c=context(),a={connectionId:'a',calendarRef:'primary'},b={connectionId:'b',calendarRef:'primary'};
 assert.equal(c.calCatalog('event').length,2);assert.match(c.calSourceLabel(c.calCatalog('event')[0]),/Termine · Google Kalender · Büro/);
 c.calSaveHidden(new Set(['event::'+c.calItemSourceRef('event',a)]));assert.equal(c.calEventVisible(a),false);assert.equal(c.calEventVisible(b),true);
 c.calSaveColorPrefs({event:{[c.calItemSourceRef('event',a)]:'#ff0000'},default:'#112233'});assert.equal(c.calColorFor('event',c.calItemSourceRef('event',a)),'#ff0000');assert.equal(c.calColorFor('event',c.calItemSourceRef('event',b)),'#112233');
 const ref=c.calSourceRef("Konto'|/@",'https://example.test/a/?b=1&c=2');assert.deepEqual(JSON.parse(JSON.stringify(c.calSourceParts(ref))),{connectionId:"Konto'|/@",calendarRef:'https://example.test/a/?b=1&c=2'});
});
test('Lokale Filter und abgeschaltete Speicherziele lassen Online-Aufgaben, Fristen und Wiedervorlagen sichtbar',()=>{
 const c=context();
 for(const itemType of ['task','deadline','followup']){const local={itemType},remote={itemType,connectionId:'a',calendarRef:'same'};c.calSaveHidden(new Set([c.calTodoSourceKey(local)]));assert.equal(c.calTodoVisible(local),false);assert.equal(c.calTodoVisible(remote),true)}
 c.calSaveHidden(new Set());vm.runInContext('calSourcePreferences.localTasks=false;calSourcePreferences.localCalendar=false;',c);
 for(const itemType of ['task','deadline','followup']){assert.equal(c.calTodoVisible({itemType}),false);assert.equal(c.calTodoVisible({itemType,connectionId:'a',calendarRef:'same'}),true)}
 assert.equal(c.calEventVisible({}),false);assert.equal(c.calEventVisible({connectionId:'a',calendarRef:'primary'}),true);
 c.isOnline=()=>false;assert.equal(c.calEventVisible({}),true);assert.equal(c.calTodoVisible({}),true);
});
test('Alte Sichtbarkeiten und Farben werden für alle betroffenen Konten übernommen und bleiben danach getrennt',()=>{
 const c=context();c.calSaveHidden(new Set(['event::primary']));c.calSaveColorPrefs({event:{primary:'#abcdef','@b|primary':'#ff0000'}});c.calMigrateSourcePrefs();
 assert.equal(c.calEventVisible({connectionId:'a',calendarRef:'primary'}),false);assert.equal(c.calEventVisible({connectionId:'b',calendarRef:'primary'}),false);assert.equal(c.calColorFor('event','@a|primary'),'#abcdef');assert.equal(c.calColorFor('event','@b|primary'),'#ff0000');
 const hidden=c.calHiddenSet();hidden.delete('event::@a|primary');c.calSaveHidden(hidden);c.calMigrateSourcePrefs();assert.equal(c.calEventVisible({connectionId:'a',calendarRef:'primary'}),true);assert.equal(c.calEventVisible({connectionId:'b',calendarRef:'primary'}),false);
});
