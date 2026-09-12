'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ab-expansion-'));process.env.RUNTIME_ROOT=dir;process.env.DB_PATH=path.join(dir,'db.sqlite');process.env.ENCRYPTION_KEY='54'.repeat(32);process.env.DOCUMENTS_DATA_ROOT=path.join(dir,'data');
const db=require('../src/database'),A=require('../src/modules/contacts/addressbook'),V=require('../src/modules/contacts/addressbook-views'),C=require('../src/modules/contacts/addressbook-communications'),F=require('../src/modules/contacts/addressbook-followup');
const s={userId:1,isAdmin:true},reader={userId:2};db.prepare("INSERT INTO users(id,username,password_hash) VALUES(1,'a','x'),(2,'b','x')").run();for(const id of ['a','b'])db.prepare('INSERT INTO cases(id,label,owner_user_id) VALUES(?,?,1)').run(id,id);
db.prepare('INSERT INTO case_contacts(id,case_id,data_json) VALUES(?,?,?)').run('contact','a',JSON.stringify({institution:'Testgericht',email:'contact@example.org',customerNumber:'0001',people:[{id:'p',name:'Test Person',email:'person@example.org'}]}));
let central,projection;
function patch(p){const r=A.get('case','a','contact');return A.replace('case','a','contact',A.validatePatch(p),s,A.version(r))}
test('Kundennummer bleibt je Fall getrennt; Anschriften und Erreichbarkeit sind zentral und versioniert',()=>{
 const b=A.assign({scope:'case',caseId:'a',id:'contact',targetCaseId:'b',customerNumber:'0002'},s);central=b.centralId;projection=b.associations.find(a=>a.caseId==='b').contactId;
 patch({addresses:[{id:'post',label:'Postanschrift',street:'Postweg',postal:'00123',city:'Stadt'}],preferredAddressId:'post',preferredChannel:'post',phoneHours:'Mo 9–12',absentFrom:'2026-09-12',absentUntil:'2026-09-20'});
 assert.equal(A.data(A.get('office','',central)).customerNumber,undefined);assert.equal(A.data(A.get('case','b',projection)).customerNumber,'0002');assert.equal(A.data(A.get('case','b',projection)).addresses[0].postal,'00123');assert.equal(A.details('case','a','contact',s).associations[0].customerNumber,'0001');
 const changes=A.details('case','a','contact',s).history.find(h=>h.changes.addresses).changes;assert.equal(changes.addresses.before,null);assert.equal(changes.addresses.after[0].label,'Postanschrift');
 for(const p of [{absentFrom:'2026-02-30'},{absentFrom:'2026-10-01',absentUntil:'2026-09-12'},{addresses:[{id:'x',label:'A'},{id:'x',label:'B'}]},{preferredChannel:'carrier-pigeon'}])assert.throws(()=>A.validatePatch(p),e=>e.status===400);
 assert.throws(()=>patch({preferredAddressId:'missing'}),e=>e.status===400);assert.throws(()=>patch({substituteContactId:central}),e=>e.status===400);
});
test('Benannte Ansichten sind persönlich; Überschreiben und Löschen prüfen die Version',()=>{
 const b={id:'v',label:'Ohne E-Mail',filters:{status:'active',missingEmail:'yes'},version:0};assert.equal(V.save(b,s).views.length,1);assert.equal(V.list(reader).views.length,0);assert.throws(()=>V.save(b,s),e=>e.status===409);assert.throws(()=>V.remove({id:'v',version:0},s),e=>e.status===409);assert.equal(V.save({...b,label:'Neu',version:1},s).views[0].version,2);assert.equal(V.remove({id:'v',version:2},s).views.length,0);assert.throws(()=>V.save({...b,filters:{injected:{}}},s),e=>e.status===400);
});
test('Rollen- und Schreibentypstandards sind unabhängig; Entfernen eines fremden Standards ändert nichts',()=>{
 A.standard({caseId:'a',id:'contact',purpose:'role:court',personId:'p'},s);A.standard({caseId:'a',id:'contact',purpose:'report:initial'},s);
 db.prepare('INSERT INTO case_contacts(id,case_id,data_json) VALUES(?,?,?)').run('other','a',JSON.stringify({institution:'Andere Institution'}));
 A.standard({caseId:'a',id:'other',purpose:'role:court',remove:true},s);assert.equal(A.data(A.get('case','a','contact'))._standardRecipients['role:court'],'p');assert.equal(A.data(A.get('case','a','contact'))._standardRecipients['report:initial'],'');
 assert.throws(()=>A.standard({caseId:'a',id:'contact',purpose:'__proto__'},s),e=>e.status===400);
});
test('Rückmeldungen sind atomar mit Falldokumentation verknüpft; wiederholte Anfragen erzeugen keine Dubletten',()=>{
 const i={scope:'case',caseId:'a',id:'contact',targetCaseId:'a',followupId:'reply',personId:'p',patch:{name:'Befund',dueAt:'2026-10-01',description:'Rückruf zugesagt'}};
 const first=F.save(i,s);F.save(i,s);assert.equal(db.prepare("SELECT count(*) n FROM todos WHERE id='reply'").get().n,1);assert.equal(db.prepare("SELECT count(*) n FROM case_doku_entries WHERE id='ab-followup-reply'").get().n,1);
 const next=F.save({...i,baseVersion:first.version,patch:{...i.patch,description:'Neue Absprache'}},s);assert.notEqual(next.version,first.version);assert.throws(()=>F.save({...i,baseVersion:first.version},s),e=>e.status===409);
 assert.match(JSON.parse(db.prepare("SELECT data_json FROM case_doku_entries WHERE id='ab-followup-reply'").get().data_json).freeDetail,/Neue Absprache/,'Die Falldokumentation muss spätere Eingaben desselben Autosave-Formulars übernehmen');
 const timeline=A.details('case','a','contact',s).communications;assert.ok(timeline.some(x=>x.kind==='followup'&&x.text==='Neue Absprache'));assert.ok(timeline.some(x=>x.kind==='doku'&&x.title==='Rückmeldung vereinbart'));
 assert.throws(()=>F.save({...i,targetCaseId:'b'},s),e=>e.status===400);
});
test('Kommunikation kombiniert Eingänge, Ausgänge, bestätigten Versand und Rückmeldungen mit Quellrechten',()=>{
 const insert=db.prepare('INSERT INTO mail_accounts(id,label,kind,email,visibility,owner_user_id) VALUES(?,?,?,?,?,?)');insert.run('public','Büro','imap','me@example.org','public',1);insert.run('private','Privat','imap','me@example.org','private',2);
 const m={uid:1,messageId:'<incoming>',subject:'Eingang',date:'2026-09-10',from:{address:'contact@example.org'},to:[{address:'me@example.org'}]};C.indexMessages('public','INBOX',[m,{...m,uid:2,messageId:'<outgoing>',subject:'Ausgang',from:{address:'me@example.org'},to:[{address:'contact@example.org'}]}]);C.indexMessages('private','INBOX',[{...m,subject:'Geheim'}]);
 db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify({exportHistory:[{id:'sent',status:'sent',sentAt:'2026-09-09',documentTitle:'Brief',contactLink:{scope:'case',caseId:'a',contactId:'contact'}},{id:'draft',status:'created',documentTitle:'Kein Versand',contactLink:{contactId:'contact',caseId:'a'}}]}),'a');
 let items=A.details('case','a','contact',s).communications;assert.ok(items.some(x=>x.title==='Eingang'));assert.ok(items.some(x=>x.title==='Ausgang'));assert.ok(items.some(x=>x.title==='Brief'));assert.ok(!items.some(x=>x.title==='Geheim'||x.title==='Kein Versand'));
 db.prepare("INSERT INTO office_json(key,data_json) VALUES('mailx_case_links',?)").run(JSON.stringify({'public|<incoming>':{caseId:'b'}}));
 assert.ok(A.details('case','a','contact',s).communications.some(x=>x.title==='Eingang'),'Zentrale Zuordnung erlaubt sichtbaren anderen Fall');
 db.prepare("UPDATE case_contacts SET data_json=? WHERE id='other'").run(JSON.stringify({institution:'Andere Institution',email:'contact@example.org'}));items=A.details('case','a','contact',s).communications;assert.ok(!items.some(x=>x.title==='Ausgang'),'Geteilte E-Mail-Adresse wird nicht willkürlich zugeordnet');
});
test('Postfachabgleich paginiert vollständig, hält private Konten fern und ist bei verlorener Antwort wiederholbar',async()=>{
 const calls=[];const engine={listFolders:async a=>{calls.push(a.id);return [{path:'INBOX'},{path:'Sent'}]},listMessages:async(a,f,{offset})=>({total:430,messages:Array.from({length:Math.min(200,430-offset)},(_,i)=>({uid:offset+i+1,messageId:'<'+f+(offset+i)+'>',date:'2026-09-01',from:{address:'contact@example.org'},to:[],subject:'Nachricht'}))})};
 const input={scope:'case',caseId:'a',id:'contact'};let r=await C.sync(input,s,{imap:engine}),cursor=r.cursor;const repeated=await C.sync({...input,cursor},s,{imap:engine});assert.deepEqual(await C.sync({...input,cursor},s,{imap:engine}),repeated);r=repeated;while(r.cursor)r=await C.sync({...input,cursor:r.cursor},s,{imap:engine});assert.equal(r.checked,860);assert.deepEqual(calls,['public']);assert.equal(db.prepare("SELECT count(*) n FROM addressbook_mail_index WHERE account_id='public'").get().n,860);
});
test('Historische E-Mail-Adressen, mehrere Empfänger und Entwürfe werden eindeutig behandelt',()=>{
 db.prepare("UPDATE case_contacts SET data_json=? WHERE id='other'").run(JSON.stringify({institution:'Andere Institution',email:'other@example.org'}));
 patch({email:'new-contact@example.org'});
 const message={uid:999,messageId:'<historical-multiple>',subject:'Historische gemeinsame Nachricht',date:'2026-09-12',from:{address:'me@example.org'},to:[{address:'contact@example.org'},{address:'other@example.org'}]};C.indexMessages('public','INBOX',[message]);
 const draft={...message,uid:998,messageId:'<draft>',subject:'Ungesendeter Entwurf',draft:true};C.indexMessages('public','INBOX',[draft]);db.prepare('INSERT OR REPLACE INTO mail_cache(account_id,folder,uid,env_json,msg_date) VALUES(?,?,?,?,?)').run('public','INBOX','998',JSON.stringify({...draft,draft:undefined}),draft.date);
 const items=A.details('case','a','contact',s).communications;assert.ok(items.some(i=>i.title===message.subject));assert.ok(!items.some(i=>i.title===draft.subject));
});
test('Postfachabgleich entfernt keine während der Seitensuche frisch eingegangenen Cache-Daten',async()=>{
 const incoming={uid:9000,messageId:'<just-arrived>',subject:'Gerade eingegangen',from:{address:'contact@example.org'},to:[],date:'2026-09-12'};
 const engine={listFolders:async()=>[{path:'INBOX'}],listMessages:async(a,f,{offset})=>{if(offset===200){C.indexMessages(a.id,f,[incoming]);db.prepare('INSERT OR REPLACE INTO mail_cache(account_id,folder,uid,env_json,msg_date) VALUES(?,?,?,?,?)').run(a.id,f,'9000',JSON.stringify(incoming),incoming.date)}return {total:400,messages:Array.from({length:200},(_,i)=>({...incoming,uid:offset+i+1,messageId:'<existing-'+(offset+i)+'>'}))}}};
 const input={scope:'case',caseId:'a',id:'contact'};let r=await C.sync(input,s,{imap:engine});while(r.cursor)r=await C.sync({...input,cursor:r.cursor},s,{imap:engine});
 assert.ok(db.prepare("SELECT 1 FROM addressbook_mail_index WHERE account_id='public' AND uid='9000'").get());assert.ok(db.prepare("SELECT 1 FROM mail_cache WHERE account_id='public' AND uid='9000'").get());
});
test('Gleichlautende Kontakt-IDs in Büro und Fall vermischen keine verknüpfte Dokumentation',()=>{
 db.prepare('INSERT INTO office_contacts(id,data_json) VALUES(?,?)').run('contact',JSON.stringify({institution:'Unabhängiger Bürokontakt'}));db.prepare('INSERT INTO case_doku_entries(id,case_id,data_json) VALUES(?,?,?)').run('collision','a',JSON.stringify({detail:'Andere Zuordnung',contactLink:{scope:'office',contactId:'contact'}}));assert.ok(!A.details('case','a','contact',s).communications.some(x=>x.id==='collision'));
 db.prepare('INSERT INTO case_contacts(id,case_id,data_json) VALUES(?,?,?)').run(central,'b',JSON.stringify({institution:'Anderer Fallkontakt',email:'collision@example.org'}));
 db.prepare('INSERT INTO case_doku_entries(id,case_id,data_json) VALUES(?,?,?)').run('collision-central','b',JSON.stringify({detail:'Fremder Fallkontakt',contactLink:{scope:'case',caseId:'b',contactId:central}}));
 assert.ok(!A.details('case','a','contact',s).communications.some(x=>x.id==='collision-central'));
});
test('Manuell bearbeitete Rückmeldedokumentation bleibt bei späterem Autosave erhalten',()=>{
 const row=db.prepare("SELECT data_json FROM case_doku_entries WHERE id='ab-followup-reply'").get(),d=JSON.parse(row.data_json);d.freeDetail='Manuelle Gesprächsdokumentation';db.prepare("UPDATE case_doku_entries SET data_json=? WHERE id='ab-followup-reply'").run(JSON.stringify(d));
 const i={scope:'case',caseId:'a',id:'contact',targetCaseId:'a',followupId:'reply',personId:'p',patch:{name:'Befund',dueAt:'2026-10-01',description:'Neue Absprache'}};
 const v=F.save(i,s).version;F.save({...i,baseVersion:v,patch:{...i.patch,dueAt:'2026-10-02'}},s);assert.equal(JSON.parse(db.prepare("SELECT data_json FROM case_doku_entries WHERE id='ab-followup-reply'").get().data_json).freeDetail,d.freeDetail);
 assert.throws(()=>F.save({...i,scope:'office',caseId:'',personId:'',baseVersion:v},s),e=>e.status===409);
});
test('Deutsche Dokumentationsdaten werden im Kommunikationsverlauf chronologisch einsortiert',()=>{
 for(const [id,date] of [['january','31.01.2026'],['february','2026-02-01'],['december','01.12.2026']])db.prepare('INSERT INTO case_doku_entries(id,case_id,data_json) VALUES(?,?,?)').run(id,'a',JSON.stringify({date,detail:id,contactLink:{scope:'case',caseId:'a',contactId:'contact'}}));
 const items=[];let cursor;do{const page=A.communicationPage('case','a','contact',s,cursor);items.push(...page.items);cursor=page.nextCursor}while(cursor);assert.deepEqual(items.filter(x=>['january','february','december'].includes(x.id)).map(x=>x.id),['december','february','january']);
});
test('Zurückgestellte E-Mail bleibt auch nach ihrer Dokumentation als Wiedervorlage sichtbar',()=>{
 db.prepare("INSERT INTO mail_snoozes(id,account_id,folder,message_id,wake_at,owner_user_id) VALUES('snooze-audit','public','INBOX','<just-arrived>','2026-12-31T09:00:00Z',1)").run();
 db.prepare('INSERT INTO case_doku_entries(id,case_id,data_json) VALUES(?,?,?)').run('documented-mail','a',JSON.stringify({date:'2026-12-01',detail:'Dokumentierte Mail',mailMessageId:'<just-arrived>',contactLink:{scope:'case',caseId:'a',contactId:'contact'}}));
 const items=A.details('case','a','contact',s).communications;assert.equal(items.find(x=>x.id==='snooze:snooze-audit')?.workspaceId,'mail:snooze-audit');assert.ok(!items.some(x=>x.kind==='mail'&&x.uid==='9000'));
});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
