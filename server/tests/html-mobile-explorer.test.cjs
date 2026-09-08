'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
function source(from,to){const a=html.indexOf(from),b=html.indexOf(to,a);assert.ok(a>0&&b>a);return html.slice(a,b)}
function navigation(){const state={bereich:'case',caseId:'a',ordner:'old',dateien:[{id:'a'}],baum:{folders:[{id:'old',parentId:''}]},auswahl:{a:1},histBack:[{ordner:'first'}]};const root={inert:false,setAttribute(){},removeAttribute(){}};const context={D:state,DM:{detail:'a',scroll:120,view:{root}},window:{__mobileUI:{closeSheet(){}}},__dok:{},renders:0,render(){context.renders++}};vm.createContext(context);vm.runInContext(source('function dmStateCopy(){','/* Der Desktop-Verlauf'),context);return context}
test('Explorer: fehlgeschlagener Ortswechsel stellt Fall, Baum, Dateien, Auswahl und Verlauf gemeinsam wieder her',async()=>{
 const c=navigation(),before=JSON.stringify(c.D);await c.dmNavigate(async()=>{c.D.caseId='b';c.D.ordner='new';c.D.baum.folders.push({id:'new'});c.D.dateien=[];c.D.auswahl={};c.D.histBack.push({ordner:'old'});c.DM.navigation.error=Error('offline')},[]);assert.equal(JSON.stringify(c.D),before);assert.equal(c.DM.detail,'a');assert.equal(c.DM.scroll,120);assert.equal(c.DM.view.root.inert,false);assert.match(c.DM.error,/offline/);
});
test('Explorer: Wiederholen verwendet dasselbe Ziel und hebt nach Erfolg die Fehlermeldung auf',async()=>{
 const c=navigation();let fail=true;const move=async target=>{c.D.ordner=target;if(fail)throw Error('offline');c.D.dateien=[{id:'new'}]};await c.dmNavigate(move,['next']);fail=false;await c.DM.retry();assert.equal(c.D.ordner,'next');assert.equal(c.DM.error,'');assert.equal(c.DM.navigation,null);assert.equal(c.DM.detail,null);
});
test('Explorer: ein zweiter Touch startet während eines laufenden Ortswechsels keine parallele Navigation',async()=>{
 const c=navigation();let release,count=0;const first=c.dmNavigate(()=>new Promise(resolve=>{count++;release=resolve}),[]);assert.equal(c.DM.view.root.inert,true);await c.dmNavigate(async()=>{count++},[]);assert.equal(count,1);release();await first;assert.equal(c.DM.view.root.inert,false);
});
function loader(api){const c={D:{bereich:'case',caseId:'a',ordner:'old',dateien:[{id:'old'}],mntTeile:[],spOrdner:[],mntOrdner:[],korbDateien:[]},dokMobil:()=>true,ladeListe(){},api,scopeQuery:()=>`area=case&caseId=${c.D.caseId}`,ortSchluessel:JSON.stringify,ortAktuell:()=>({caseId:c.D.caseId,ordner:c.D.ordner,mntId:c.D.mntId,imMount:c.D.imMount})};vm.createContext(c);vm.runInContext(source('var dmOriginalLoadList=ladeListe;','function dmStateCopy(){'),c);return c}
test('Explorer: verspätete Antwort eines verlassenen Ordners überschreibt keine neueren Dateien',async()=>{
 const pending=[];const c=loader(url=>new Promise(resolve=>pending.push({url,resolve})));const old=c.ladeListe();c.D.ordner='new';const next=c.ladeListe();pending[1].resolve({files:[{id:'new'}]});await next;pending[0].resolve({files:[{id:'old'}]});await old;assert.equal(c.D.dateien[0].id,'new');assert.match(pending[1].url,/folderId=new/);
});
test('Explorer: fehlgeschlagener Abruf leert die bisher angezeigte Dateiliste nicht',async()=>{
 const c=loader(async()=>{throw Error('offline')});await assert.rejects(c.ladeListe(),/offline/);assert.equal(c.D.dateien[0].id,'old');
});
test('Explorer: externe Ablage erhält vollständige Dateipfade und Kennzeichnung',async()=>{
 let url;const c=loader(async u=>{url=u;return{folders:[{name:'Sub'}],files:[{name:'Beleg.txt',mime:'text/plain',size:42,date:'2026-09-07'}]}});Object.assign(c.D,{imMount:true,mntId:'mount',mntTeile:['Post & Briefe']});await c.ladeListe();assert.match(url,/pfad=Post%20%26%20Briefe/);assert.equal(c.D.dateien[0].id,'Post & Briefe/Beleg.txt');assert.equal(c.D.dateien[0].mount,true);assert.equal(c.D.mntOrdner[0].name,'Sub');
});
