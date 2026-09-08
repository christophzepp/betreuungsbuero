'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
function source(name,next){const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);const end=html.indexOf('function '+next+'(',start);assert.ok(end>start,next);return html.slice(start,end)}
const day=date=>date?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`:'';
const today=new Date(2026,8,7),parse=value=>value?new Date(value+'T00:00:00'):null;
function deadlineFixture(){
 const ctx={Date,today0:()=>today,isoOf:day,parseIso:parse,daysUntil:d=>d?Math.round((d-today)/86400000):null,frMobileCaseId:()=> 'case-a',frScope:'all',catLabel:value=>value==='widerspruch'?'Widerspruch':value};
 vm.createContext(ctx);vm.runInContext(source('frMobileFilter','frMobileMount'),ctx);
 const base={scope:'all',status:'all',due:'all',category:'all',priority:'all',source:'all',search:''};
 return (rows,filter={})=>Array.from(ctx.frMobileFilter(rows,{...base,...filter}),row=>row.key);
}
const deadline=(key,date,extra={})=>({key,kind:'own',caseId:'case-a',caseLabel:'Mara Hoffmann',fr:{dueDate:date,status:'offen',category:'widerspruch',...extra}});
const deadlines=[deadline('today','2026-09-07',{priority:'high'}),deadline('past','2026-09-06'),deadline('next7','2026-09-14'),deadline('later','2026-09-15'),deadline('done','2026-09-01',{status:'erledigt'}),deadline('undated',''),{...deadline('other','2026-09-07'),caseId:'case-b'}, {...deadline('derived','2026-09-07',{source:'derived'}),kind:'derived'},deadline('debt','2026-09-07',{source:'schuldenregulierung'}),deadline('ki','2026-09-07',{source:'ki',institution:'Pflegekasse'})];
test('Fristen unterscheiden heute, überfällig und die nächsten sieben Tage',()=>{
 const filter=deadlineFixture();assert.deepEqual(filter(deadlines,{due:'overdue'}),['past']);assert.deepEqual(filter(deadlines,{due:'next7',priority:'high'}),['today']);assert.ok(filter(deadlines,{due:'next7'}).includes('next7'));assert.ok(!filter(deadlines,{due:'next7'}).includes('later'));assert.ok(!filter(deadlines,{due:'overdue'}).includes('undated'));
});
test('Fristen wählen Fälle über IDs auch bei gleichem Namen',()=>{
 const filter=deadlineFixture();assert.deepEqual(filter(deadlines,{scope:'case-b'}),['other']);assert.ok(!filter(deadlines,{scope:'self'}).includes('other'));
});
test('Fristen lassen Herkunft, fachliche Kategorie, Priorität und Suche kombinieren',()=>{
 const filter=deadlineFixture();assert.deepEqual(filter(deadlines,{source:'derived'}),['derived']);assert.deepEqual(filter(deadlines,{source:'debt'}),['debt']);assert.deepEqual(filter(deadlines,{source:'ki',search:'PFLEGEKASSE',category:'widerspruch'}),['ki']);assert.deepEqual(filter(deadlines,{status:'done'}),['done']);assert.deepEqual(filter(deadlines,{category:'jahresbericht'}),[]);
});
function followFixture(){
 const ctx={Date,text:v=>String(v||'').trim(),todayIso:()=>day(today),isoPlusDays:(iso,n)=>{const d=parse(iso);d.setDate(d.getDate()+n);return day(d)},ALL_CASES:'all',followupSourceLabel:raw=>raw.sourceType||'Ohne Quelle'};
 vm.createContext(ctx);vm.runInContext(source('followMobileFilter','followMobileRender'),ctx);
 const base={caseId:'all',segment:'all',due:'all',priority:'all',origin:'all',query:''};
 return (rows,filter={})=>Array.from(ctx.followMobileFilter(rows,{...base,...filter}),row=>row.id);
}
const follow=(id,date,extra={})=>({id,date,caseId:'case-a',status:'open',title:'Rückmeldung prüfen',raw:{priority:'normal',sourceType:'doku'},...extra});
const followups=[follow('today','2026-09-07'),follow('past','2026-09-06'),follow('future','2026-09-14'),follow('undated',''),follow('done','2026-09-01',{status:'done'}),follow('other','2026-09-07',{caseId:'case-b',caseLabel:'Mara Hoffmann',raw:{priority:'high',sourceType:'document'}})];
test('Wiedervorlagen teilen fällige, geplante und abgeschlossene Vorgänge ohne Lücken auf',()=>{
 const filter=followFixture();assert.deepEqual(filter(followups,{segment:'due'}),['past','today','other']);assert.deepEqual(filter(followups,{segment:'planned'}),['future','undated']);assert.deepEqual(filter(followups,{segment:'done'}),['done']);assert.equal(new Set(['due','planned','done'].flatMap(segment=>filter(followups,{segment}))).size,followups.length);
});
test('Wiedervorlagen kombinieren Ursprungsmodul, Fall-ID, Priorität und Suche',()=>{
 const filter=followFixture();assert.deepEqual(filter(followups,{origin:'document',caseId:'case-b',priority:'high',query:'hoffmann'}),['other']);assert.deepEqual(filter(followups,{due:'overdue'}),['past']);assert.deepEqual(filter(followups,{due:'next7',origin:'doku'}),['today','future']);assert.deepEqual(filter(followups,{origin:'document',caseId:'case-a'}),[]);
});
