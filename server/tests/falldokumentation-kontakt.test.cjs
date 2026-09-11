'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
function funktion(name){
 const start=html.indexOf('\n  function '+name+'(');assert.ok(start>=0,name);
 let i=html.indexOf('{',start),depth=0;
 for(;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&!--depth)return html.slice(start,i+1)}
 throw new Error(name+' incomplete');
}
function api(extra={}){
 const ctx={window:{},...extra};vm.createContext(ctx);
 vm.runInContext(['fdKontaktName','fdKontaktVorschlag','fdKontaktVorbelegung','fdKontaktLink','fdKontaktAktuell'].map(funktion).join('\n'),ctx);
 return ctx;
}
const plain=x=>JSON.parse(JSON.stringify(x));
test('Nur die Rolle bestimmt Bereich und Gegenüber; keine Ereignisdaten werden erfunden',()=>{
 const a=api();
 assert.deepEqual(plain(a.fdKontaktVorschlag({role:'Hausärztin',institution:'Praxis Dr. Müller',email:'arzt@example.org'})),{actorGroup:'Gesundheit, Pflege & Rehabilitation',actor:'Hausärzt:in'});
 assert.deepEqual(plain(a.fdKontaktVorschlag({role:'Familiengericht',institution:'Amtsgericht Musterstadt'})),{});
 assert.deepEqual(plain(a.fdKontaktVorschlag({institution:'Praxis Dr. Müller',phone:'123'})),{});
 assert.deepEqual(Object.keys(a.fdKontaktVorschlag({role:'Betreuungsgericht'})).sort(),['actor','actorGroup']);
});
test('Kontaktwechsel ersetzt eigene Vorbelegung und bewahrt manuelle Einordnung und Inhalt',()=>{
 const a=api(),arzt=a.fdKontaktVorschlag({role:'Hausarzt'}),bank=a.fdKontaktVorschlag({role:'Bank'});
 const input={actorGroup:'',actor:'',type:'Eigener Anlass',detail:'Termin vereinbart',freeDetail:'Text',contactType:'Schriftlich (E-Mail)',date:'2026-09-11',reportRelevant:true};
 const initial=a.fdKontaktVorbelegung(input,{},arzt);
 assert.equal(initial.werte.actor,'Hausärzt:in');
 const changed=a.fdKontaktVorbelegung(initial.werte,initial.auto,bank);
 assert.equal(changed.werte.actor,'Bank / Sparkasse');
 for(const k of ['type','detail','freeDetail','contactType','date','reportRelevant'])assert.equal(changed.werte[k],input[k],k);
 const manual={...initial.werte,actor:'Eigene Einordnung'};
 const kept=a.fdKontaktVorbelegung(manual,{actorGroup:arzt.actorGroup},bank);
 assert.equal(kept.werte.actor,'Eigene Einordnung');assert.equal(kept.werte.actorGroup,'');
 const cleared=a.fdKontaktVorbelegung(changed.werte,changed.auto,{});
 assert.equal(cleared.werte.actor,'');assert.equal(cleared.werte.actorGroup,'');
 const edited=a.fdKontaktVorbelegung(initial.werte,{},bank);
 assert.equal(edited.werte.actor,'Hausärzt:in','gespeicherte Einordnung gilt beim Bearbeiten als eigenständig');
});
test('Verknüpfung hält ID, Gültigkeitsbereich, Ansprechpartner und damalige Referenz getrennt',()=>{
 const a=api(),contact={id:'contact-1',institution:'Amtsgericht',firstName:'Sabine',lastName:'Müller',role:'Betreuungsgericht',fileNumber:'12 XVII 5/26'};
 const link=a.fdKontaktLink(contact,'case','case-a');
 contact.fileNumber='neu';contact.lastName='geändert';
 assert.equal(link.contactId,'contact-1');assert.equal(link.caseId,'case-a');assert.equal(link.snapshot.person,'Sabine Müller');assert.equal(link.snapshot.fileNumber,'12 XVII 5/26');
 assert.equal(a.fdKontaktLink(contact,'office','case-a').caseId,'');
});
test('Fallfremde Referenz wird auch bei einem Fallwechsel ohne DOM-Ereignis nicht gespeichert',()=>{
 let chosen='case-a';const link={scope:'case',caseId:'case-a',snapshot:{label:'Test'}};
 const a=api({fdState:{form:{werte:{contactLink:link}}},document:{getElementById:()=>({value:chosen})},dokuServerCaseIdV166:id=>id,dokuTargetV161:()=>({})});
 assert.equal(a.fdKontaktAktuell(),link);chosen='case-b';assert.equal(a.fdKontaktAktuell(),null);
 a.fdState.form.werte.contactLink=null;assert.equal(a.fdKontaktAktuell(),null);
 a.fdState.form.werte={};a.fdState.form.basis={contactLink:{...link,scope:'office',caseId:''}};assert.equal(a.fdKontaktAktuell().scope,'office');
});
test('Ähnliche Einträge verschiedener Kontakte bleiben getrennt und über Namen/Referenz auffindbar',()=>{
 const list=[{id:'d1',date:'2026-09-11',actor:'Hausärzt:in',actorGroup:'Gesundheit',freeDetail:'Befund angefordert',contactLink:{scope:'case',caseId:'a',contactId:'c1',snapshot:{label:'Praxis Sommer',fileNumber:'A-100'}}},
 {id:'d2',date:'2026-09-11',actor:'Hausärzt:in',actorGroup:'Gesundheit',freeDetail:'Befund angefordert',contactLink:{scope:'case',caseId:'a',contactId:'c2',snapshot:{label:'Praxis Winter',fileNumber:'A-200'}}}];
 const filters={caseId:'a',year:'all',actorGroup:'all',type:'all',contactType:'all',planning:'all',sortDir:'newest'};
 const a=api({dokuFilterStateV162:filters,dokuTargetV161:()=>({caseData:{documentationEntries:list}}),dokuNormalizeAutoEntriesV164:()=>{},norm:s=>String(s||'').toLowerCase(),fdSortKey:e=>e.date,dokuPhotosV166:()=>[]});
 vm.runInContext(funktion('fdKontaktInfo')+funktion('dokuFilteredEntriesV166'),a);
 assert.equal(a.dokuFilteredEntriesV166('a').list.length,2);
 filters.query='winter';assert.equal(a.dokuFilteredEntriesV166('a').list[0].id,'d2');
 filters.query='A-100';assert.equal(a.dokuFilteredEntriesV166('a').list[0].id,'d1');
});
