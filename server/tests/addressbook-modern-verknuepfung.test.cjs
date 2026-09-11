'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/addressbook-modern.js'),'utf8');
function fixture(entries){const context={state:{caseData:{documentationEntries:entries}},window:{},activeCase:()=> 'a',ref:c=>({scope:c.__buero?'office':'case',caseId:c.__caseId||'a'}),api:()=>({key:c=>c.key})};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function localCommunications(c)'),source.indexOf('function info(')),context);return context}
test('Lokale Kontakte ohne ID erhalten keine fremden oder unverknüpften Dokumentationen',()=>{
 const c=fixture([{id:'unlinked',detail:'Ohne Kontakt'},{id:'match',contactLink:{scope:'case',caseId:'a',contactKey:'kontakt'}},{id:'foreign',contactLink:{scope:'case',caseId:'b',contactKey:'kontakt'}}]);
 assert.deepEqual(Array.from(c.localCommunications({key:'kontakt'}),e=>e.id),['match']);
 assert.equal(c.localCommunications({}).length,0);
});
test('Kontakt-ID und Gültigkeitsbereich bestimmen die lokale Kommunikationszuordnung',()=>{
 const c=fixture([{id:'case',contactLink:{scope:'case',caseId:'a',contactId:'id'}},{id:'office',contactLink:{scope:'office',contactId:'id'}},{id:'foreign',contactLink:{scope:'case',caseId:'b',contactId:'id'}}]);
 assert.deepEqual(Array.from(c.localCommunications({id:'id'}),e=>e.id),['case']);
 assert.deepEqual(Array.from(c.localCommunications({id:'id',__buero:true}),e=>e.id),['office']);
});
