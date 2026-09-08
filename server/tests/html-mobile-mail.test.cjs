'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
const start=html.indexOf('function mxVisibleMessages(){'),end=html.indexOf('/* ---- Externe Bilder blockieren',start);assert.ok(start>0&&end>start);
function visible(rows,adv={},filter=''){
 const ctx={MX:{list:{messages:rows,filter,sort:'date',adv}},addrLabel:a=>a?.name||a?.address||'',mxMsgLabels:m=>m.labels||[],mxFiledCase:m=>m.filedCase||null,mxMatchCase:address=>address==='matched@example.org'?{caseId:'case-b'}:null};vm.createContext(ctx);vm.runInContext(html.slice(start,end),ctx);return Array.from(ctx.mxVisibleMessages(),m=>m.uid);
}
const rows=[{uid:'1',__acc:'office',seen:false,hasAttachments:true,priority:'high',labels:[1],subject:'Bescheid',date:'2026-09-07',from:{address:'amt@example.org'},filedCase:{caseId:'case-a'}},{uid:'2',__acc:'office',seen:true,hasAttachments:true,subject:'Arztbrief',date:'2026-09-06',from:{address:'matched@example.org'}},{uid:'3',__acc:'personal',seen:false,hasAttachments:false,flagged:true,subject:'Rückfrage',date:'2026-09-05',from:{address:'unassigned@example.org'}}];
test('Mobile Mailfilter kombinieren Lesestatus, Anlagen, Konto, Priorität und Label',()=>{
 assert.deepEqual(visible(rows,{seen:'unseen',attachments:'yes'}),['1']);assert.deepEqual(visible(rows,{seen:'seen',attachments:'yes',acc:'office'}),['2']);assert.deepEqual(visible(rows,{prio:'high',label:1}),['1']);assert.deepEqual(visible(rows,{attachments:'no'},'flagged'),['3']);
});
test('Fallfilter berücksichtigt Ablagezuordnung und Absenderbezug sowie fehlende Zuordnung',()=>{
 assert.deepEqual(visible(rows,{caseId:'case-a'}),['1']);assert.deepEqual(visible(rows,{caseId:'case-b'}),['2']);assert.deepEqual(visible(rows,{caseId:'__none__'}),['3']);assert.deepEqual(visible(rows,{caseId:'unknown'}),[]);
});
test('Vorhandene Schnellfilter und Betreff-/Absendersuche bleiben kombinierbar',()=>{
 assert.deepEqual(visible(rows,{word:'brief'},'attach'),['2']);assert.deepEqual(visible(rows,{from:'amt@'},'unseen'),['1']);assert.deepEqual(visible(rows),['1','2','3']);
});
test('Empfänger-Commit übersteht den erneuten Blur beim Ersetzen der Adresschips',()=>{
 const a=html.indexOf('  chipCommit(input){'),b=html.indexOf('  async chipSuggest(',a);assert.ok(a>0&&b>a);let calls=0;
 const input={value:'neu@example.org;',dataset:{f:'to'}},ctx={MX:{compose:{to:[]}},parseAddrList:v=>[{name:'',address:v}],document:{querySelector:()=>null}};
 ctx.renderChips=()=>{calls++;ctx.C.chipCommit(input)};vm.createContext(ctx);vm.runInContext('this.C={'+html.slice(a,b)+'};',ctx);ctx.C.chipCommit(input);assert.equal(calls,1);assert.equal(ctx.MX.compose.to.length,1);assert.equal(ctx.MX.compose.to[0].address,'neu@example.org');
});

test('Entwurfsfilter verwendet gespeicherten Fallkontext oder Dokumentationsfall',()=>{
 const drafts=[{uid:'a',__acc:'office',__draft:{data:{caseContext:{id:'case-a'}}}},{uid:'b',__acc:'personal',__draft:{data:{dokuCase:'case-b'}}},{uid:'c',__acc:'personal',__draft:{data:{}}}];
 assert.deepEqual(visible(drafts,{acc:'office',caseId:'case-a'}),['a']);assert.deepEqual(visible(drafts,{caseId:'case-b'}),['b']);assert.deepEqual(visible(drafts,{caseId:'__none__'}),['c']);
});
