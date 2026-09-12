'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ab-mail-vcard-'));process.env.RUNTIME_ROOT=temp;process.env.DB_PATH=path.join(temp,'db.sqlite');process.env.ENCRYPTION_KEY='54'.repeat(32);process.env.MAILBOX_WATCH='0';process.env.DOCUMENTS_DATA_ROOT=path.join(temp,'data');
const db=require('../src/database'),A=require('../src/modules/contacts/addressbook'),C=require('../src/modules/contacts/addressbook-communications'),codec=require('../frontend/addressbook-vcard'),V=require('../src/modules/contacts/addressbook-vcard-import'),D=require('../src/modules/mail/contact-documentation'),send=require('../src/modules/mail/send'),outbox=require('../src/modules/mail/outbox'),graph=require('../src/integrations/mail/microsoft-graph'),msMail=require('../src/integrations/mail/microsoft-mail'),identity=require('../src/modules/mail/identity');
const session={userId:1,isAdmin:true,displayName:'Test'},personLink={scope:'case',caseId:'a',contactId:'court',personId:'p'};
db.prepare("INSERT INTO users(id,username,password_hash,is_admin,active) VALUES(1,'admin','fixture',1,1),(2,'reader','fixture',0,1)").run();
for(const id of ['a','b','c'])db.prepare('INSERT INTO cases(id,label,owner_user_id) VALUES(?,?,1)').run(id,id);
const contact={institution:'Gericht; Nord, „Büro“',firstName:'Eva',lastName:'Müller',role:'Betreuungsgericht',status:'Aktiv',email:'gericht@example.org',street:'Hauptstraße',house:'7',houseLetter:'a',postal:'00123',city:'Köln',postbox:'0042',phoneArea:'0049',phoneNumber:'022155',customerNumber:'000123',fileNumber:'Az-1',processNumber:'V-9',note:'Zeile 1\nZeile 2; \\n bleibt wörtlich, Köln 🏡'.repeat(4),iban:'DE00123',bic:'TESTDE',bankName:'Testbank',_category:'justiz',addresses:[{id:'visit',label:'Besuch; Empfang',street:'Besuchsweg',house:'12',postal:'04567',city:'Dorf',country:'Deutschland'},{id:'post',label:'Poststelle',postbox:'0007',postal:'04568',city:'Dorf',country:'Deutschland'}],preferredAddressId:'post',preferredChannel:'email',phoneHours:'Mo–Do 09–12',absentFrom:'2026-10-01',absentUntil:'2026-10-08',absenceNote:'Urlaub',people:[{id:'p',name:'Lea Schäfer',department:'Betreuung',role:'Sachbearbeitung',email:'person@example.org',phone:'0123/99',fax:'0123/88',salutation:'Frau',preferredChannel:'phone',phoneHours:'Di 10–11',absentFrom:'2026-10-02',absentUntil:'2026-10-04',absenceNote:'Seminar',substitutePersonId:'q'},{id:'q',name:'Max Ersatz',email:'ersatz@example.org'}],_standardRecipients:{mail:'p','role:court':'p','report:initial':''}};
db.prepare('INSERT INTO case_contacts(id,case_id,data_json) VALUES(?,?,?)').run('court','a',JSON.stringify(contact));
db.prepare("INSERT INTO mail_accounts(id,label,kind,email,visibility,owner_user_id) VALUES('ms','Microsoft','microsoft','me@example.org','public',1),('other','Anderes Konto','microsoft','me@example.org','public',1),('private','Privat','microsoft','me@example.org','private',2)").run();
const getDraft=id=>{const row=db.prepare('SELECT * FROM mail_drafts WHERE id=?').get(id);return row&&{...row,data:JSON.parse(row.data_json)}};
const plan=(id,data,owner=1)=>db.prepare("INSERT INTO mail_drafts(id,account_id,kind,send_at,data_json,owner_user_id) VALUES(?,'ms','scheduled','2026-09-01T10:00:00.000Z',?,?)").run(id,JSON.stringify(data),owner);
const doc=id=>JSON.parse(db.prepare('SELECT data_json FROM case_doku_entries WHERE id=?').get(id).data_json);
const mailEnvelope=(dispatchId,uid='graph-id')=>({uid,messageId:'<microsoft-id>',dispatchId,subject:'Microsoft-Nachricht',date:'2026-09-12T09:00:00Z',from:{address:'me@example.org'},to:[{address:'person@example.org'}],cc:[]});
test('vCard überträgt sämtliche neuen Kontaktfelder, Unicode und literale Escapezeichen verlustfrei',()=>{
 const text=codec.stringify({...contact,id:'original'}),[roundtrip]=codec.parse(text);assert.deepEqual(roundtrip,{...contact,_vcardSourceId:'original'});
 assert.ok(text.split('\r\n').every(l=>Buffer.byteLength(l)<=75));assert.match(text,/ADR;TYPE=WORK,PREF/);assert.match(text,/AGENT:/);assert.match(text,/EMAIL;TYPE=INTERNET,PREF/);
 const unfolded=text.replace(/\r\n /g,'');const standard=unfolded.split('\r\n').filter(l=>!l.startsWith('X-BETREUUNGSBUERO-DATA:')).join('\r\n');const external=codec.parse(standard)[0];assert.equal(external.addresses.length,3);assert.equal(external.addresses[2].label,'Poststelle');assert.equal(external.postbox,'0007');assert.equal(external.people[0].name,'Lea Schäfer');assert.equal(external.people[0].department,'Betreuung');assert.equal(external.phone,'0049/022155');
});
test('Fremde vCards: strukturierte Escapezeichen, Postfach, Gruppennamen und bevorzugte Kontaktwege',()=>{
 const [c]=codec.parse('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Test\r\nN:Name\\;Zusatz;Vor\\,name;;;\r\nitem1.ADR;TYPE=WORK;LABEL="Büro: Nord":003;;Weg\\; 5;Dorf;;00123;DE\r\nitem1.X-ABLABEL:Büro Nord\r\nEMAIL:alt@example.org\r\nEMAIL;PREF=1:neu@example.org\r\nTEL;TYPE=CELL;VALUE=uri:tel:+49001\r\nEND:VCARD');
 assert.equal(c.lastName,'Name;Zusatz');assert.equal(c.firstName,'Vor,name');assert.equal(c.street,'Weg; 5');assert.equal(c.email,'neu@example.org');assert.equal(c.mobile,'+49001');assert.equal(c.preferredChannel,'email');
});
test('Ungültige Erweiterungen, unvollständige Dateien und doppelte Kennungen werden abgelehnt',()=>{
 const card=data=>'BEGIN:VCARD\nVERSION:3.0\nFN:Test\nX-BETREUUNGSBUERO-DATA:'+JSON.stringify(data)+'\nEND:VCARD';
 for(const data of [{version:2,contact},{version:1,sourceId:'x',contact:{...contact,preferredAddressId:'missing'}},{version:1,sourceId:'x',contact:{...contact,people:[contact.people[0],contact.people[0]]}},{version:1,sourceId:'x',contact:{...contact,absentFrom:'2026-02-30'}}])assert.throws(()=>codec.parse(card(data)),/vCard:/);
 assert.throws(()=>codec.parse(codec.stringify(contact)+'\nBEGIN:VCARD\nFN:Unvollständig'),/Unvollständig/);
 const polluted=JSON.parse('{"institution":"Test","__proto__":{"admin":true},"people":[{"id":"p","name":"Person","password":"secret"}]}');assert.equal(codec.clean(polluted).admin,undefined);assert.equal(codec.clean(polluted).people[0].password,undefined);
});
test('Online-Import speichert vollständig, atomar und ohne Duplikate; Standards bleiben je Fall eindeutig',()=>{
 const records=codec.parse(codec.stringify({...contact,id:'original'})),input={scope:'case',caseId:'b',records};const imported=V.importContacts(input,session);assert.equal(imported.added,1);assert.deepEqual(imported.contacts[0].data,{...contact,_pendingWrite:true});assert.equal(V.importContacts(input,session).skipped,1);
 const before=db.prepare('SELECT count(*) n FROM case_contacts').get().n;assert.throws(()=>V.importContacts({...input,records:[{institution:'Wäre neu'},{...contact,addresses:'broken'}]},session),e=>e.status===400);assert.equal(db.prepare('SELECT count(*) n FROM case_contacts').get().n,before);
 const conflict=V.importContacts({...input,records:[{...contact,institution:'Zweites Gericht'}]},session);assert.ok(conflict.warnings.length);assert.deepEqual(conflict.contacts.find(c=>c.data.institution==='Zweites Gericht').data._standardRecipients,{});
 assert.throws(()=>V.importContacts({...input,caseId:'a'}, {userId:2}),e=>e.status===403);
});
test('Büro-Import erhält Ansprechpartner und remappt Vertretung auf neue oder bereits vorhandene Kontakte',()=>{
 const records=codec.parse(codec.stringify({...contact,id:'institution-source',substituteContactId:'sub-source'})+'\r\n'+codec.stringify({id:'sub-source',institution:'Vertretungsbüro',email:'vertretung@example.org'}));
 const result=V.importContacts({scope:'office',records},session),institution=result.contacts.find(r=>r.data.institution===contact.institution),sub=result.contacts.find(r=>r.data.institution==='Vertretungsbüro');assert.equal(institution.data.substituteContactId,sub.id);assert.deepEqual(institution.data.people,contact.people);
 const again=V.importContacts({scope:'office',records:codec.parse(codec.stringify({...contact,id:'more',institution:'Noch ein Büro',substituteContactId:'sub-source'})+'\r\n'+codec.stringify({id:'sub-source',institution:'Vertretungsbüro',email:'vertretung@example.org'}))},session);assert.equal(again.skipped,1);assert.equal(again.contacts.find(r=>r.data.institution==='Noch ein Büro').data.substituteContactId,sub.id);
});
test('Geplante Kontaktverknüpfung verwendet geprüfte Stammdaten statt übergebener Snapshots',()=>{
 const resolved=D.resolve(session,'a','Lea <person@example.org>',{...personLink,snapshot:{label:'Gefälscht'}});assert.equal(resolved.snapshot.person,'Lea Schäfer');assert.equal(resolved.snapshot.customerNumber,'000123');assert.equal(resolved.personId,'p');
 assert.throws(()=>D.resolve(session,'b','person@example.org',personLink),e=>e.status===400);assert.throws(()=>D.resolve(session,'a','anders@example.org',personLink),/erneut auswählen/);assert.throws(()=>D.resolve({userId:2,canEditCases:true},'a','person@example.org',personLink),e=>e.status===403);
 assert.equal(D.resolve(session,'a','person@example.org').personId,'p');db.prepare('INSERT INTO case_contacts(id,case_id,data_json) VALUES(?,?,?)').run('ambiguous','a',JSON.stringify({institution:'Zweites Gericht',email:'person@example.org'}));assert.equal(D.resolve(session,'a','person@example.org'),null);assert.equal(D.resolve(session,'a','person@example.org',personLink).personId,'p');
});
test('Geplanter Versand läuft ohne Browser und dokumentiert einmal mit Kontakt und Mailkennung',async t=>{
 let sends=0;const original=send.sendViaAccount;t.after(()=>send.sendViaAccount=original);send.sendViaAccount=async(acc,m)=>{sends++;assert.equal(m.to,'person@example.org');assert.ok(identity.dispatchId(m.dispatchId));return {sentVia:'graph',dispatchId:m.dispatchId}};
 const contactLink=D.resolve(session,'a','person@example.org',personLink);plan('scheduled',{to:'person@example.org',dokuCase:'a',contactLink,subject:'Geplant'});
 await outbox.tick('2026-09-12T09:00:00Z');await outbox.tick('2026-09-12T09:00:00Z');assert.equal(sends,1);assert.equal(getDraft('scheduled'),undefined);const d=doc('scheduled-mail-scheduled');assert.deepEqual(d.contactLink,contactLink);assert.ok(identity.dispatchId(d.mailDispatchId));assert.equal(d.mailAccountId,'ms');
 C.indexMessages('ms','sentitems',[mailEnvelope(d.mailDispatchId)]);const items=A.details('case','a','court',session).communications;const combined=items.find(i=>i.id==='scheduled-mail-scheduled');assert.equal(combined.mail.uid,'graph-id');assert.ok(!items.some(i=>i.kind==='mail'&&i.uid==='graph-id'),'Dokumentation und Microsoft-Mail erscheinen gemeinsam trotz geteilter Empfängeradresse');
});
test('Dokumentierte Microsoft-Mails werden kontogebunden zugeordnet; eingehende Kopien erben keine Versandidentität',()=>{
 const d=doc('scheduled-mail-scheduled');C.indexMessages('other','sentitems',[mailEnvelope(d.mailDispatchId,'other-id')]);C.indexMessages('private','sentitems',[mailEnvelope(d.mailDispatchId,'private-id')]);C.indexMessages('ms','inbox',[{...mailEnvelope(d.mailDispatchId,'reply-id'),messageId:'<reply>',from:{address:'person@example.org'},to:[{address:'me@example.org'}]}]);
 const item=A.details('case','a','court',session).communications.find(i=>i.id==='scheduled-mail-scheduled');assert.equal(item.mail.accountId,'ms');assert.equal(item.mail.uid,'graph-id');
});
test('Dokumentationsfehler nach Versand führen bei Wiederholung zu keiner zweiten E-Mail',async t=>{
 let sends=0;const original=send.sendViaAccount;t.after(()=>send.sendViaAccount=original);send.sendViaAccount=async()=>{sends++;return {messageId:'<once>'}};
 plan('doku-retry',{to:'person@example.org',dokuCase:'a',contactLink:D.resolve(session,'a','person@example.org',personLink)});
 db.exec("CREATE TRIGGER fail_mail_doku BEFORE INSERT ON case_doku_entries WHEN NEW.id='scheduled-mail-doku-retry' BEGIN SELECT RAISE(ABORT,'Simulierter Schreibfehler'); END");
 await outbox.tick('2026-09-12T10:00:00Z');assert.equal(sends,1);assert.ok(getDraft('doku-retry').data.__sentReceipt);assert.match(getDraft('doku-retry').data.__error,/Bereits gesendet/);
 db.exec('DROP TRIGGER fail_mail_doku');await outbox.tick('2026-09-12T10:06:00Z');assert.equal(sends,1);assert.equal(getDraft('doku-retry'),undefined);assert.equal(doc('scheduled-mail-doku-retry').mailMessageId,'<once>');
});
test('Parallel laufende Scheduler senden nur einmal; entzogene Fallrechte verhindern Versand',async t=>{
 const original=send.sendViaAccount;t.after(()=>send.sendViaAccount=original);let release,entered;const start=new Promise(r=>entered=r);let sends=0;send.sendViaAccount=async()=>{sends++;entered();await new Promise(r=>release=r);return {}};
 plan('concurrent',{to:'person@example.org'});const first=outbox.tick('2026-09-12T11:00:00Z');await start;await outbox.tick('2026-09-12T11:00:00Z');assert.equal(sends,1);release();await first;
 plan('unauthorized',{to:'person@example.org',dokuCase:'a'},2);await outbox.tick('2026-09-12T11:00:00Z');assert.equal(sends,1);assert.match(getDraft('unauthorized').data.__error,/berechtigung/i);
 db.prepare("DELETE FROM mail_drafts WHERE id='unauthorized'").run();
});
test('Microsoft sendMail liefert eine opaque Kennung, die Liste und Einzelabruf wieder auslesen',async t=>{
 const helper=require('../src/security/crypto');db.prepare("INSERT INTO calendar_connections(id,provider,display_name,access_token_encrypted,refresh_token_encrypted) VALUES('conn','microsoft','Test',?,?)").run(helper.encrypt('test-access'),helper.encrypt('test-refresh'));const acc={id:'ms',kind:'microsoft',graph_connection_id:'conn'};const original=global.fetch;t.after(()=>global.fetch=original);let payload;
 global.fetch=async(url,opts)=>{payload=JSON.parse(opts.body);return {ok:true,status:202}};const result=await send.sendViaAccount(acc,{to:'person@example.org',subject:'Test',html:'<p>Test</p>'});assert.equal(payload.message.internetMessageHeaders[0].name,identity.HEADER);assert.equal(payload.message.internetMessageHeaders[0].value,result.dispatchId);assert.ok(!JSON.stringify(payload).includes('court'));
 const m={id:'m',subject:'Test',internetMessageId:'<m>',internetMessageHeaders:[{name:identity.HEADER.toUpperCase(),value:result.dispatchId}]};global.fetch=async url=>{assert.ok(url.includes('internetMessageHeaders'));return {ok:true,status:200,json:async()=>url.includes('mailFolders')?{value:[m],'@odata.count':1}:m}};
 assert.equal((await graph.listMessages(acc,'sentitems')).messages[0].dispatchId,result.dispatchId);assert.equal((await graph.getMessage(acc,'sentitems','m')).dispatchId,result.dispatchId);
 assert.equal(identity.fromHeaders(Buffer.from(identity.HEADER+': '+result.dispatchId+'\r\n')),result.dispatchId);assert.equal(identity.fromHeaders(new Map([[identity.HEADER,result.dispatchId]])),result.dispatchId);assert.equal(identity.fromHeaders([{name:identity.HEADER,value:'bad\r\nInjected: yes'}]),'');
});
test('SMTP gesendete Nachricht und Gesendet-Kopie tragen dieselbe Dokumentationskennung',async t=>{
 const nodemailer=require('nodemailer'),imap=require('../src/integrations/mail/imap'),parser=require('mailparser').simpleParser;const original=nodemailer.createTransport,append=imap.appendSent;t.after(()=>{nodemailer.createTransport=original;imap.appendSent=append});let sent,copy;
 nodemailer.createTransport=()=>({sendMail:async m=>{sent=m.raw}});imap.appendSent=async(acc,raw)=>{copy=raw;return {ok:true}};
 const result=await send.sendViaAccount({id:'smtp',kind:'imap',smtp_host:'test.invalid',email:'me@example.org'},{to:'person@example.org',text:'Test'});assert.ok(sent.equals(copy));const mail=await parser(sent);assert.equal(mail.messageId,result.messageId);assert.equal(mail.headers.get(identity.HEADER),result.dispatchId);
});
test('Microsoft-Abgleich folgt unveränderten nextLink-Seiten auch bei abweichendem skip',async t=>{
 const orig=global.fetch;t.after(()=>global.fetch=orig);const calls=[],next='https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$skip=207&$select=id,internetMessageHeaders';const acc={id:'ms',kind:'microsoft',graph_connection_id:'conn'};
 global.fetch=async url=>{calls.push(url);return {ok:true,status:200,json:async()=>({value:[{id:calls.length===1?'first':'last'}],...(calls.length===1?{'@odata.nextLink':next}:{})})}};
 const first=await graph.listMessages(acc,'sentitems');assert.equal(first.nextLink,next);const second=await graph.listMessages(acc,'sentitems',{nextLink:first.nextLink,offset:1});assert.equal(calls[1],next);assert.equal(second.nextLink,null);await assert.rejects(()=>graph.listMessages(acc,'sentitems',{nextLink:'https://example.org/steal'}),/Ungültige/);
 const pages=[];const engine={listFolders:async()=>[{path:'sentitems'}],listMessages:async(a,f,options)=>{pages.push(options);return {messages:[{uid:options.nextLink?'last':'first'}],total:1,totalKnown:false,nextLink:options.nextLink?null:next}}};let r=await C.sync({scope:'case',caseId:'a',id:'court'},session,{microsoft:engine});while(r.cursor)r=await C.sync({scope:'case',caseId:'a',id:'court',cursor:r.cursor},session,{microsoft:engine});assert.equal(pages[1].nextLink,next);assert.ok(pages.some(p=>p.nextLink));assert.equal(r.errors.length,0);
});
test('Eingehende Microsoft-Mail wird mit Ansprechpartner dokumentiert und nach Verschieben nicht erneut angelegt',()=>{
 const account=db.prepare("SELECT * FROM mail_accounts WHERE id='ms'").get();
 const message={uid:'received-old',messageId:'<incoming-document>',subject:'Eingang dokumentieren',date:'2026-09-12T09:15:00Z',from:{address:'ersatz@example.org',name:'Max Ersatz'},to:[{address:'me@example.org'}],text:'Sachstand',attachments:[{filename:'Befund.pdf'}]};
 const first=D.documentMessage(account,message,{caseId:'a',folder:'inbox',uid:message.uid},session);assert.equal(first.data.contactLink.personId,'q');assert.equal(first.data.mailMessageId,message.messageId);assert.equal(first.data.mailAccountId,'ms');assert.match(first.data.freeDetail,/Befund.pdf/);
 const moved=D.documentMessage(account,{...message,uid:'received-new'},{caseId:'a',folder:'archive'},session);assert.equal(moved.id,first.id);assert.equal(db.prepare("SELECT count(*) n FROM case_doku_entries WHERE json_extract(data_json,'$.mailMessageId')=?").get(message.messageId).n,1);
 const items=A.details('case','a','court',session).communications;assert.equal(items.find(i=>i.id===first.id).mail.accountId,'ms');assert.equal(items.find(i=>i.id===first.id).mail.uid,'received-new');assert.ok(!items.some(i=>i.kind==='mail'&&['received-old','received-new'].includes(i.uid)));
 assert.throws(()=>D.documentMessage(account,message,{caseId:'a',folder:'inbox'},{userId:2,canEditCases:true}),e=>e.status===403);
});
test('Nachträgliches Ablegen einer geplanten Microsoft-Mail ergänzt denselben Doku-Eintrag',()=>{
 const account=db.prepare("SELECT * FROM mail_accounts WHERE id='ms'").get(),previous=doc('scheduled-mail-scheduled');const result=D.documentMessage(account,{...mailEnvelope(previous.mailDispatchId),text:'Versand'}, {caseId:'a',folder:'sentitems'},session);assert.equal(result.id,'scheduled-mail-scheduled');assert.equal(result.data.mailMessageId,'<microsoft-id>');assert.equal(result.data.contactLink.personId,'p');
});
test('Lokaler Büro-vCard-Import erhält strukturierte Daten und Vertretungsverknüpfungen',async()=>{
 const vm=require('node:vm'),html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8'),start=html.indexOf('window.__baImportBueroContacts=async function'),end=html.indexOf('\nfunction render(){',start);let store={contacts:[]},count=0;
 const context={window:{__abVcardCodec:codec},baOnline:()=>false,baStore:()=>structuredClone(store),baSave:v=>store=structuredClone(v),baNorm:v=>v.toLowerCase(),newId:()=>String(++count),document:{getElementById:()=>null}};vm.runInNewContext(html.slice(start,end),context);
 const records=codec.parse(codec.stringify({...contact,id:'original',substituteContactId:'replacement'})+'\r\n'+codec.stringify({id:'replacement',institution:'Lokale Vertretung'}));const result=await context.window.__baImportBueroContacts(records);assert.equal(result.added,2);assert.deepEqual(store.contacts[0].people,contact.people);assert.equal(store.contacts[0].substituteContactId,store.contacts[1].id);assert.equal((await context.window.__baImportBueroContacts(records)).skipped,2);
});
test.after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true})});
