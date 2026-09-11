'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
const start=html.indexOf('  function handleMessage(msg){'),end=html.indexOf('  function updatePresenceUI(users){',start),source=html.slice(start,end);
assert.ok(start>0&&end>start);
function client(){const notices=[],selection=new Set(['c']),state={caseData:{contacts:[{id:'c',institution:'Vorher'}]}};
 const c={state,window:{__abModernLegacy:{key:x=>x.id},__abCsvToggle:(id,on)=>on?selection.add(id):selection.delete(id)},document:{getElementById:()=>null},stableJson:JSON.stringify,contactEchoKeyV162:()=>'',uiSyncWhenIdle:()=>{},broadcastRemoteChange:()=>notices.push('changed'),saveState:()=>notices.push('saved')};vm.runInNewContext(source,c);return {...c,notices,selection};}
test('Echtzeit-Nachrichten entfernen zusammengeführte Kontakte samt Auswahl und speichern den neuen Stand',()=>{const c=client();c.handleMessage({type:'contact',action:'delete',contact:{id:'c'}});assert.equal(c.state.caseData.contacts.length,0);assert.equal(c.selection.size,0);assert.deepEqual(c.notices,['changed','saved']);c.handleMessage({type:'contact',action:'delete',contact:{id:'c'}});assert.equal(c.notices.length,2)});
test('Wiederhergestellte und neue Kontakte erscheinen in anderen Fenstern genau einmal',()=>{const c=client(),message={type:'contact',action:'update',contact:{id:'restored',data:{institution:'Zurück'}}};c.handleMessage(message);c.handleMessage(message);assert.equal(c.state.caseData.contacts.filter(x=>x.id==='restored').length,1);assert.equal(c.notices.length,2);c.handleMessage({...message,contact:{id:'restored',data:{institution:'Geändert'}}});assert.equal(c.state.caseData.contacts.find(x=>x.id==='restored').institution,'Geändert')});
test('Bestehende Create-Nachrichten erzeugen weiterhin keine zweite Kopie',()=>{const c=client(),message={type:'contact',action:'create',contact:{id:'new',data:{institution:'Neu'}}};c.handleMessage(message);c.handleMessage(message);assert.equal(c.state.caseData.contacts.filter(x=>x.id==='new').length,1);assert.equal(c.notices.length,2)});

test('Dubletten mit verbindenden Merkmalen bilden disjunkte Gruppen und lassen sich gemeinsam zusammenführen',()=>{
 const c={};vm.runInNewContext(html.slice(html.indexOf('  function abNorm(s){'),html.indexOf('  const AB_SYS_KEYS=')),c);
 const contacts=[{institution:'X',email:'a@example.org',postal:'1'},{institution:'X',email:'b@example.org',postal:'2'},{institution:'X',email:'a@example.org',postal:'9'},{institution:'X',email:'b@example.org',postal:'9'}];
 const groups=c.abGroupDuplicates(contacts);assert.equal(groups.length,1);assert.equal(groups[0].length,4);assert.equal(new Set(groups.flat()).size,4);
 const separate=c.abGroupDuplicates([{institution:'Gericht A',email:'sammel@example.org'},{institution:'Gericht B',email:'sammel@example.org'}]);assert.equal(separate.length,0,'Eine gemeinsame E-Mail allein reicht weiterhin nicht');
});
