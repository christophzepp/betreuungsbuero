'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'addressbook-modern-test-'));
process.env.RUNTIME_ROOT=dir;process.env.DB_PATH=path.join(dir,'test.sqlite3');process.env.DOCUMENTS_DATA_ROOT=path.join(dir,'data');process.env.ENCRYPTION_KEY='54'.repeat(32);
const db=require('../src/database'),A=require('../src/modules/contacts/addressbook');
const admin={userId:1,isAdmin:true,displayName:'Testbearbeiterin'},reader={userId:2};
db.prepare("INSERT INTO users(id,username,password_hash) VALUES(1,'admin','test'),(2,'reader','test')").run();
for(const [id,owner] of [['a',1],['b',1],['private',2]])db.prepare('INSERT INTO cases(id,label,owner_user_id) VALUES(?,?,?)').run(id,'Fall '+id,owner);
const insert=(id,caseId,d)=>db.prepare('INSERT INTO case_contacts(id,case_id,data_json,updated_by) VALUES(?,?,?,1)').run(id,caseId,JSON.stringify(d));
insert('c-a','a',{institution:'Praxis Muster',role:'Hausarzt',fileNumber:'A-123',email:'alt@example.org',_category:'gesundheit',people:[{id:'person-1',name:'Lea Muster',email:'lea@example.org'}]});
let cid,bid;
test('Zentral zuordnen erzeugt eine vollständige Exportprojektion mit eigenem Aktenzeichen',()=>{
 const result=A.assign({scope:'case',caseId:'a',id:'c-a',targetCaseId:'b',role:'Facharzt',fileNumber:'B-456'},admin);
 cid=result.centralId;bid=result.associations.find(x=>x.caseId==='b').contactId;
 assert.ok(cid);assert.equal(result.associations.length,2);
 assert.equal(A.data(A.get('case','a','c-a')).fileNumber,'A-123');
 assert.equal(A.data(A.get('case','b',bid)).fileNumber,'B-456');
 assert.equal(A.data(A.get('case','b',bid)).email,'alt@example.org');
 assert.equal(A.data(A.get('office','',cid)).fileNumber,undefined,'Fallreferenzen dürfen nicht in die zentrale Karte gelangen');
 A.assign({scope:'case',caseId:'a',id:'c-a',targetCaseId:'b',fileNumber:'Kein Überschreiben'},admin);
 assert.equal(A.linked(cid).length,2);assert.equal(A.data(A.get('case','b',bid)).fileNumber,'B-456');
});
test('Autosave aktualisiert gemeinsame Felder in allen Fällen, ohne deren Einordnung/Referenzen zu ändern',()=>{
 const row=A.get('case','a','c-a');A.replace('case','a','c-a',{email:'neu@example.org',fileNumber:'A-789'},admin,A.version(row));
 assert.equal(A.data(A.get('office','',cid)).email,'neu@example.org');
 const b=A.data(A.get('case','b',bid));assert.equal(b.email,'neu@example.org');assert.equal(b.role,'Facharzt');assert.equal(b.fileNumber,'B-456');
 assert.ok(A.details('case','a','c-a',admin).history.some(h=>h.changes.email?.before==='alt@example.org'&&h.actor==='Testbearbeiterin'));
});
test('Konfliktprüfung schützt parallele Änderungen',()=>{
 const v=A.version(A.get('case','a','c-a'));A.replace('case','a','c-a',{note:'Neue Notiz'},admin,v);
 assert.throws(()=>A.replace('case','a','c-a',{note:'Veraltete Notiz'},admin,v),e=>e.status===409);
 assert.equal(A.data(A.get('case','a','c-a')).note,'Neue Notiz');
});
test('Standards sind pro Fall und Zweck eindeutig, einschließlich gewähltem Ansprechpartner',()=>{
 A.standard({caseId:'a',id:'c-a',purpose:'document',personId:'person-1'},admin);
 insert('c-other','a',{institution:'Anderer Kontakt'});
 A.standard({caseId:'a',id:'c-other',purpose:'document'},admin);
 assert.equal(A.data(A.get('case','a','c-a'))._standardRecipients.document,undefined);
 assert.equal(A.data(A.get('case','a','c-other'))._standardRecipients.document,'');
 A.standard({caseId:'a',id:'c-a',purpose:'mail',personId:'person-1'},admin);
 assert.equal(A.data(A.get('case','a','c-a'))._standardRecipients.mail,'person-1');
 assert.equal(A.data(A.get('case','b',bid))._standardRecipients,undefined);
 A.replace('case','a','c-a',{people:[]},admin);
 assert.equal(A.data(A.get('case','a','c-a'))._standardRecipients.mail,undefined);
 assert.throws(()=>A.standard({caseId:'a',id:'c-a',purpose:'mail',personId:'missing'},admin),e=>e.status===400);
});
test('Verknüpfte Dokumentation erscheint einmal; fremde Fälle und deren Kommunikation bleiben verborgen',()=>{
 db.prepare('INSERT INTO case_doku_entries(id,case_id,data_json) VALUES(?,?,?)').run('d-a','a',JSON.stringify({contactLink:{scope:'case',caseId:'a',contactId:'c-a'},detail:'Telefonat',freeDetail:'Besprochen'}));
 const visible=A.details('case','a','c-a',admin);assert.equal(visible.communications.length,1);
 assert.throws(()=>A.details('case','a','c-a',reader),e=>e.status===403);
 const office=A.details('office','',cid,reader);assert.deepEqual(office.associations,[]);assert.deepEqual(office.communications,[]);
 const old=A.data(A.get('office','',cid)).email;
 assert.throws(()=>A.replace('office','',cid,{email:'unberechtigt@example.org'},reader),e=>e.status===403);
 assert.equal(A.data(A.get('office','',cid)).email,old,'abgelehnte Änderung muss atomar zurückrollen');
});
test('Unbekannte Felder, leere Ansprechpartner und doppelte IDs werden zurückgewiesen',()=>{
 assert.throws(()=>A.validatePatch(JSON.parse('{"__proto__":{"polluted":true}}')),e=>e.status===400);
 assert.throws(()=>A.validatePatch({people:[{name:''}]}),e=>e.status===400);
 assert.throws(()=>A.validatePatch({people:[{id:'x',name:'A'},{id:'x',name:'B'}]}),e=>e.status===400);
 assert.equal({}.polluted,undefined);
});
test('Zentrale Zuordnungen lassen sich nach einer portablen Wiederherstellung aus den Kontaktprojektionen aufbauen',()=>{
 const office=A.get('office','',cid);db.prepare('DELETE FROM office_contacts WHERE id=?').run(cid);
 assert.equal(db.prepare('SELECT count(*) n FROM addressbook_links').get().n,0);
 db.prepare('INSERT INTO office_contacts(id,data_json) VALUES(?,?)').run(cid,office.data_json);
 assert.equal(A.centralId('case','c-a'),cid);assert.equal(A.linked(cid).length,2);
 A.replace('case','a','c-a',{phone:'0123/999'},admin);
 assert.equal(A.data(A.get('case','b',bid)).phone,'0123/999');
});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
