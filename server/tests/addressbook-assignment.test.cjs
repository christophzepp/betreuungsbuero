'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ab-assignment-'));process.env.RUNTIME_ROOT=dir;process.env.DB_PATH=path.join(dir,'db.sqlite');process.env.DOCUMENTS_DATA_ROOT=path.join(dir,'data');process.env.ENCRYPTION_KEY='54'.repeat(32);
const db=require('../src/database'),A=require('../src/modules/contacts/addressbook'),H=require('../frontend/addressbook-assignment-data');
db.prepare("INSERT INTO users(id,username,password_hash) VALUES(1,'qa','x'),(2,'other','x')").run();
const admin={userId:1,isAdmin:true},reader={userId:2};let serial=0;
function fixture(extra={}){const p='p'+(++serial),a=p+'a',b=p+'b',source=p+'source',target=p+'target';for(const id of [a,b])db.prepare('INSERT INTO cases(id,label,owner_user_id,stammdaten_json) VALUES(?,?,1,?)').run(id,'Fall '+id,JSON.stringify({care:{courtName:'Amtsgericht Musterstadt',fileNumber:'ZIEL-AZ'},health:{private:'nicht benötigt'},benefits:[]}));const s={institution:'Amtsgericht Musterstadt',role:'Betreuungsgericht',email:'zentral@example.org',fileNumber:'QUELLE-AZ',processNumber:'QUELLE-V',customerNumber:'QUELLE-K',note:'Nur Ausgangsfall',status:'Aktiv',people:[{id:'lea',name:'Lea',email:'lea@example.org'}],...extra};db.prepare('INSERT INTO case_contacts(id,case_id,data_json) VALUES(?,?,?)').run(source,a,JSON.stringify(s));return {a,b,source,target,s,input:{scope:'case',caseId:a,id:source,targetCaseId:b,assignmentId:p+'assignment'}}}
const add=(f,d)=>db.prepare('INSERT INTO case_contacts(id,case_id,data_json) VALUES(?,?,?)').run(f.target,f.b,JSON.stringify(d));
const val=(c,id)=>A.data(A.get('case',c,id));
test('Betreuungsaktenzeichen stammt aus dem passenden Zielfall; Ausgangsnummern bleiben leer',()=>{
 const source={institution:'Amtsgericht Musterstadt',role:'Betreuungsgericht',fileNumber:'ALT',customerNumber:'ALT-K',processNumber:'ALT-V'};
 const context={caseData:{care:{courtName:source.institution,fileNumber:'NEU'}}};assert.deepEqual(H.suggest(source,context).values,{role:'Betreuungsgericht',fileNumber:'NEU',processNumber:'',customerNumber:''});
 assert.equal(H.suggest({...source,institution:'Anderes Gericht'},context).values.fileNumber,'');assert.equal(H.suggest({...source,role:'Familiengericht'},context).values.fileNumber,'');
});
test('Bekannte Kontaktreferenzen haben Vorrang; mehrdeutige Leistungsträgernummern werden nicht geraten',()=>{
 const c={institution:'Kasse',role:'Versicherung'},context={caseData:{benefits:[{provider:'Kasse',fileNumber:'LEISTUNG'}]}};
 assert.equal(H.suggest(c,context).values.fileNumber,'LEISTUNG');context.caseData.benefits.push({provider:'Kasse',fileNumber:'ANDERE'});assert.equal(H.suggest(c,context).values.fileNumber,'');assert.equal(H.suggest(c,context,{fileNumber:'BEKANNT',customerNumber:'KD'}).values.fileNumber,'BEKANNT');
});
test('Namensähnlichkeit führt nur zu Vorschlägen; Personen benötigen passende Identität und E-Mail',()=>{
 assert.equal(H.matches({institution:'Amtsgericht Musterstadt'},[{institution:'Amtsgericht Musterstadt'},{institution:'Amtsgericht Musterstadt – Familiengericht'}]).length,1);
 assert.equal(H.matches({firstName:'Lea',lastName:'Test',email:'a@b.de'},[{firstName:'Lea',lastName:'Test',email:'c@d.de'}]).length,0);
 assert.equal(H.matches({firstName:'Lea',lastName:'Test',email:'a-b@c.de'},[{firstName:'Lea',lastName:'Test',email:'a.b@c.de'}]).length,0);
 assert.equal(H.matches({institution:'  '},[{institution:''}]).length,0);
});
test('Vorbelegung liest ausschließlich sichtbare Zielfalldaten und passende Kontakte',()=>{
 const f=fixture();add(f,{...f.s,fileNumber:'BEKANNT'});const c=A.assignmentContext(f.input,admin);assert.equal(c.contacts[0].fileNumber,'BEKANNT');assert.equal(c.caseData.care.fileNumber,'ZIEL-AZ');assert.equal(c.caseData.health,undefined);assert.throws(()=>A.assignmentContext(f.input,reader),e=>e.status===403);
});
test('Bestehender Zielkontakt wird ohne Dublette verknüpft; Referenzen, Status, Notizen und Standards bleiben lokal',()=>{
 const f=fixture();add(f,{...f.s,email:'altziel@example.org',fileNumber:'ZIEL',processNumber:'ZIEL-V',customerNumber:'ZIEL-K',status:'Beendet',note:'Nur Ziel',_standardRecipients:{mail:'lea'}});const input={...f.input,targetContactId:f.target,targetContactVersion:A.version(A.get('case',f.b,f.target)),sourceVersion:A.version(A.get('case',f.a,f.source))};
 const r=A.assign(input,admin);assert.equal(r.assignment.contactId,f.target);assert.equal(db.prepare('SELECT count(*) n FROM case_contacts WHERE case_id=?').get(f.b).n,1);const target=val(f.b,f.target);assert.equal(target.email,f.s.email);for(const [k,v] of Object.entries({fileNumber:'ZIEL',processNumber:'ZIEL-V',customerNumber:'ZIEL-K',status:'Beendet',note:'Nur Ziel'}))assert.equal(target[k],v);assert.deepEqual(target._standardRecipients,{mail:'lea'});assert.equal(val(f.a,f.source).fileNumber,'QUELLE-AZ');assert.equal(val(f.a,f.source).note,'Nur Ausgangsfall');
 A.replace('case',f.b,f.target,{email:'gemeinsam@example.org',customerNumber:'ZIEL-EDIT'},admin,A.version(A.get('case',f.b,f.target)));assert.equal(val(f.a,f.source).email,'gemeinsam@example.org');assert.equal(val(f.a,f.source).customerNumber,'QUELLE-K');assert.equal(A.data(A.get('office','',r.centralId)).customerNumber,undefined);
});
test('Unbestätigte oder veraltete Ziel- und Quellstände ändern keine Daten',()=>{
 for(const which of ['target','source']){const f=fixture();add(f,{...f.s,fileNumber:'BEKANNT'});const input={...f.input,targetContactId:f.target,targetContactVersion:A.version(A.get('case',f.b,f.target)),sourceVersion:A.version(A.get('case',f.a,f.source))};A.replace('case',which==='source'?f.a:f.b,which==='source'?f.source:f.target,{note:'Neuer Stand'},admin);assert.throws(()=>A.assign(input,admin),e=>e.status===409);assert.equal(A.centralId('case',f.source),'');assert.equal(A.centralId('case',f.target),'')}
});
test('Nicht übertragbare persönliche Standards rollen die gesamte Verknüpfung zurück',()=>{
 const f=fixture();add(f,{institution:f.s.institution,people:[{id:'other',name:'Andere Person'}],_standardRecipients:{mail:'other'}});assert.throws(()=>A.assign({...f.input,targetContactId:f.target,targetContactVersion:A.version(A.get('case',f.b,f.target))},admin),e=>e.status===409);assert.equal(A.centralId('case',f.source),'');assert.equal(val(f.b,f.target)._standardRecipients.mail,'other');
});
test('Verlorene Antwort erzeugt beim Wiederholen keine zweite Zuordnung oder Überschreibung',()=>{
 const f=fixture();add(f,{...f.s,fileNumber:'ZIEL'});const input={...f.input,targetContactId:f.target,targetContactVersion:A.version(A.get('case',f.b,f.target)),sourceVersion:A.version(A.get('case',f.a,f.source)),role:'Betreuungsgericht',fileNumber:'ZIEL',processNumber:f.s.processNumber,customerNumber:f.s.customerNumber};A.assign(input,admin);A.assign(input,admin);assert.equal(db.prepare('SELECT count(*) n FROM case_contacts WHERE case_id=?').get(f.b).n,1);A.replace('case',f.b,f.target,{customerNumber:'PARALLEL'},admin);assert.throws(()=>A.assign(input,admin),e=>e.status===409);assert.equal(val(f.b,f.target).customerNumber,'PARALLEL');
});
test('Synchronisation und letzte Verwendung des Zielkontakts folgen der zentralen Verknüpfung; Fallfavorit bleibt lokal',()=>{
 const f=fixture();add(f,{...f.s,fileNumber:'ZIEL'});db.prepare("INSERT INTO calendar_connections(id,provider,display_name) VALUES('assign-sync','google','Test')").run();
 db.prepare("INSERT INTO addressbook_sync_bindings(id,scope,case_id,contact_id,connection_id,owner_user_id) VALUES('assign-binding','case',?,?,'assign-sync',1)").run(f.b,f.target);
 db.prepare("INSERT INTO addressbook_preferences VALUES(1,'case',?,?,0,'2026-09-13')").run(f.b,f.target);db.prepare('INSERT INTO addressbook_case_favorites VALUES(?,?,1)').run(f.b,f.target);
 const r=A.assign({...f.input,targetContactId:f.target,targetContactVersion:A.version(A.get('case',f.b,f.target))},admin),binding=db.prepare("SELECT * FROM addressbook_sync_bindings WHERE id='assign-binding'").get();assert.equal(binding.scope,'office');assert.equal(binding.contact_id,r.centralId);assert.equal(binding.case_id,'');assert.equal(binding.enabled,1);assert.equal(db.prepare("SELECT last_used_at FROM addressbook_preferences WHERE scope='office' AND contact_id=?").get(r.centralId).last_used_at,'2026-09-13');assert.ok(db.prepare('SELECT 1 FROM addressbook_case_favorites WHERE case_id=? AND contact_id=?').get(f.b,f.target));
});
test('Doppelte Synchronisationsverbindungen verhindern eine verlustbehaftete Zusammenführung',()=>{
 const f=fixture();add(f,{...f.s,fileNumber:'ZIEL'});for(const [id,caseId,cid] of [['assign-sync-source',f.a,f.source],['assign-sync-target',f.b,f.target]])db.prepare("INSERT INTO addressbook_sync_bindings(id,scope,case_id,contact_id,connection_id,owner_user_id) VALUES(?,'case',?,?,'assign-sync',1)").run(id,caseId,cid);
 assert.throws(()=>A.assign({...f.input,targetContactId:f.target,targetContactVersion:A.version(A.get('case',f.b,f.target))},admin),e=>e.status===409&&/Synchronisation/.test(e.message));assert.equal(A.centralId('case',f.source),'');assert.equal(val(f.b,f.target).fileNumber,'ZIEL');assert.equal(db.prepare("SELECT scope FROM addressbook_sync_bindings WHERE id='assign-sync-source'").get().scope,'case');
});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
