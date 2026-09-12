'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ab-tools-'));process.env.RUNTIME_ROOT=dir;process.env.DB_PATH=path.join(dir,'test.db');process.env.ENCRYPTION_KEY='54'.repeat(32);process.env.DOCUMENTS_DATA_ROOT=path.join(dir,'data');
const db=require('../src/database'),A=require('../src/modules/contacts/addressbook'),T=require('../frontend/addressbook-contact-tools'),V=require('../frontend/addressbook-vcard'),Trash=require('../src/modules/contacts/addressbook-trash'),D=require('../src/modules/contacts/addressbook-duplicates'),S=require('../src/modules/contacts/addressbook-sync'),P=require('../src/modules/contacts/addressbook-sync-provider');
const admin={userId:1,isAdmin:true},reader={userId:2,canViewCases:true,canEditCases:true};
db.prepare("INSERT INTO users(id,username,password_hash,is_admin,allow_online) VALUES(1,'admin','x',1,1),(2,'reader','x',0,1)").run();db.prepare("INSERT INTO cases(id,label,owner_user_id) VALUES('a','Fall A',1),('b','Fall B',1)").run();
const create=(id,data={},scope='office',caseId='')=>db.prepare('INSERT INTO '+(scope==='office'?'office_contacts':'case_contacts')+'(id,'+(scope==='case'?'case_id,':'')+'data_json) VALUES(?,'+(scope==='case'?'?,':'')+'?)').run(id,...(scope==='case'?[caseId]:[]),JSON.stringify({institution:id,...data}));
const patch=(id,p,scope='office',caseId='')=>A.replace(scope,caseId,id,A.validatePatch(p),admin,A.version(A.get(scope,caseId,id)));
const way=(id,type,value,preferred=false)=>({id,type,value,preferred,label:id});
test('Dubletten erkennen Schreibweisen, benannte E-Mails und normalisierte Rufnummern, ohne fremde Fälle zu zeigen',()=>{
 create('court',{institution:'Amtsgericht Musterstadt',email:'Post@example.org'},'case','a');create('hidden',{email:'privat@example.org'},'case','b');create('alias',{contactWays:[way('Poststelle','email','alias@example.org')],phone:'06131/123456'});
 assert.equal(D.find({scope:'case',caseId:'a',patch:{institution:'Amtsgericht Musterstadt'}},admin).candidates[0].id,'court');assert.equal(D.find({patch:{email:'ALIAS@example.org'}},reader).candidates[0].id,'alias');assert.equal(D.find({patch:{phone:'+49 6131 123456'}},reader).candidates[0].id,'alias');assert.equal(D.find({patch:{email:'privat@example.org'}},reader).candidates.length,0);
});
test('Signatur bleibt Text, erkennt Namen, Anschrift, Rufnummern und mehrere E-Mails zur Prüfung',()=>{
 const c=T.signature('Hallo, hier der Text.\nMit freundlichen Grüßen\nDr. Anna Müller\nPraxis Sonnenhof\nHauptstraße 12a\n01234 Musterstadt\nTel.: +49 1234 987654\nMobil: 0171 1234567\nFax: 01234 900001\nanna@example.org\npost@example.org\n<script>alert(1)</script>');assert.equal(c.lastName,'Müller');assert.equal(c.title,'Dr.');assert.equal(c.postal,'01234');assert.equal(c.houseLetter,'a');assert.equal(c.contactWays.length,5);assert.equal(c.institution,'Praxis Sonnenhof');assert.throws(()=>T.signature('x'.repeat(50001)));
});
test('Beliebig viele benannte Wege bleiben in vCard und Ansprechpartnern erhalten',()=>{
 const ways=Array.from({length:160},(_,i)=>way('mail'+i,'email','mail'+i+'@example.org',i===0));const c={institution:'Test',contactWays:ways,people:[{id:'p',name:'Anna Person',contactWays:[way('Durchwahl','phone','01234/567',true)]}]};const cleaned=A.validatePatch(c);assert.equal(cleaned.contactWays.length,160);assert.equal(cleaned.people[0].phone,'01234/567');const card=V.stringify(c),round=V.parse(card)[0];assert.deepEqual(round.contactWays,ways);assert.deepEqual(round.people[0].contactWays,c.people[0].contactWays);
 const standard=V.parse(card.replace(/\r\n[ \t]/g,'').split(/\r?\n/).filter(l=>!l.startsWith('X-BETREUUNGSBUERO-DATA:')).join('\r\n'))[0];assert.equal(standard.contactWays.filter(x=>x.type==='email').length,160);assert.equal(standard.people[0].contactWays[0].value,'01234/567');assert.throws(()=>T.ways([way('a','email','a@example.org',true),way('b','email','b@example.org',true)]));
});
test('Bevorzugte Wege propagieren zentral, einschließlich alter Telefonfelder und Historie',()=>{
 create('shared',{},'case','a');const assigned=A.assign({scope:'case',caseId:'a',id:'shared',targetCaseId:'b',customerNumber:'0002'},admin),id=assigned.centralId;patch(id,{contactWays:[way('Zentrale','phone','01234/555',true)]});const row=A.data(A.get('case','a','shared'));assert.equal(row.phone,'01234/555');assert.equal(row.phoneNumber,'01234/555');assert.equal(A.details('office','',id,admin).history[0].changes.contactWays.after.length,1);patch(id,{contactWays:[]});assert.equal(A.data(A.get('case','a','shared')).phone,'');
});
test('Papierkorb bewahrt IDs, Fallzuordnungen und Fallnummern; Fremde können nicht löschen oder wiederherstellen',()=>{
 create('trash',{},'case','a');const assigned=A.assign({scope:'case',caseId:'a',id:'trash',targetCaseId:'b',customerNumber:'0010'},admin),central=assigned.centralId;
 assert.throws(()=>Trash.remove({scope:'office',id:central},reader),e=>e.status===403);const t=Trash.remove({scope:'office',id:central,version:A.version(A.get('office','',central))},admin);assert.equal(A.get('case','a','trash'),undefined);assert.equal(Trash.list(reader).items.length,0);assert.throws(()=>Trash.restore({id:t.trashId},reader),e=>e.status===404);Trash.restore({id:t.trashId},admin);assert.equal(A.centralId('case','trash'),central);assert.equal(A.details('office','',central,admin).associations.find(x=>x.caseId==='b').customerNumber,'0010');assert.throws(()=>Trash.restore({id:t.trashId},admin),e=>e.status===409);
});
test('Wiederherstellung verwendet aktuelle zentrale Daten und verdrängt keinen neuen Standardempfänger',()=>{
 create('restore',{},'case','a');const {centralId}=A.assign({scope:'case',caseId:'a',id:'restore',targetCaseId:'b'},admin);A.standard({caseId:'a',id:'restore'},admin);const t=Trash.remove({scope:'case',caseId:'a',id:'restore'},admin);patch(centralId,{email:'aktuell@example.org'});A.standard({caseId:'a',id:'court'},admin);const r=Trash.restore({id:t.trashId},admin);assert.equal(A.data(A.get('case','a','restore')).email,'aktuell@example.org');assert.equal(A.data(A.get('case','a','restore'))._standardRecipients.document,undefined);assert.equal(r.warnings.length,1);
});
function fake(){let records=[],n=0;return {get records(){return records},set records(v){records=v},writes:0,list:async()=>structuredClone(records),save:async function(c,book,b,data,remote){this.writes++;const r={uid:remote?.uid||b.id+'-'+(++n),etag:String(this.writes),marker:b.id,data:P.profile(data)};records=records.filter(x=>x.uid!==r.uid);records.push(r);return {uid:r.uid}}}}
db.prepare("INSERT INTO calendar_connections(id,provider,display_name,enabled,owner_user_id) VALUES('google','google','Google',1,1),('private','microsoft','Privat',1,2)").run();
const bind=id=>S.link({scope:'office',id,connectionId:'google',book:'connections',uid:''},admin).id;
test('Automatik erstellt einmal, synchronisiert beidseitig, bewahrt Fallangaben und pausiert',async()=>{
 create('sync',{email:'eins@example.org',customerNumber:'001',note:'Privat'});const id=bind('sync'),f=fake();assert.equal((await S.run({bindingId:id},admin,f)).ok,true);assert.equal(f.writes,1);assert.equal(f.records[0].data.customerNumber,undefined);assert.equal(f.records[0].data.note,undefined);await S.run({bindingId:id},admin,f);assert.equal(f.writes,1);
 patch('sync',{city:'Lokalstadt'});f.records[0].data.email='zwei@example.org';await S.run({bindingId:id},admin,f);assert.equal(A.data(A.get('office','','sync')).email,'zwei@example.org');assert.equal(f.records[0].data.city,'Lokalstadt');assert.equal(A.data(A.get('office','','sync')).note,'Privat');S.toggle({bindingId:id,enabled:false},admin);patch('sync',{city:'Pausenstadt'});await S.run({bindingId:id},admin,f);assert.equal(f.records[0].data.city,'Lokalstadt');
});
test('Gleichzeitige Änderungen verlangen feldweise Entscheidung; veraltete Entscheidung überschreibt nichts',async()=>{
 create('conflict',{city:'Alt'});const id=bind('conflict'),f=fake();await S.run({bindingId:id},admin,f);patch('conflict',{city:'Hier'});f.records[0].data.city='Online';let r=await S.run({bindingId:id},admin,f);assert.equal(r.conflict,true);const writes=f.writes;
 f.records[0].data.city='Noch neuer';await S.run({bindingId:id,resolution:{city:'local'}},admin,f);assert.equal(f.writes,writes);assert.equal(f.records[0].data.city,'Noch neuer');r=await S.run({bindingId:id,resolution:{city:'local'}},admin,f);assert.equal(r.ok,true);assert.equal(f.records[0].data.city,'Hier');
});
test('Verlorene Anlageantwort wird anhand der Verknüpfung gefunden, nie blind wiederholt',async()=>{
 create('lost');const id=bind('lost'),f=fake(),save=f.save;f.save=async function(...a){await save.apply(this,a);throw Error('Antwort verloren')};await S.run({bindingId:id},admin,f);assert.equal(f.writes,1);f.save=save;await S.run({bindingId:id},admin,f);assert.equal(f.writes,1);assert.equal(S.state({scope:'office',id:'lost'},admin).bindings[0].status,'synced');
 create('uncertain');const id2=bind('uncertain'),empty=fake();empty.save=async function(){this.writes++;throw Error('Zeitüberschreitung')};await S.run({bindingId:id2},admin,empty);await S.run({bindingId:id2},admin,empty);assert.equal(empty.writes,1);
});
test('Entfernter Kontakt fehlt: lokal behalten; Papierkorb pausiert; fehlende Rechte verhindern Netzwerkzugriff',async()=>{
 create('missing');const id=bind('missing'),f=fake();await S.run({bindingId:id},admin,f);f.records=[];await S.run({bindingId:id},admin,f);assert.ok(A.get('office','','missing'));assert.equal(S.state({scope:'office',id:'missing'},admin).bindings[0].status,'missing');const trash=Trash.remove({scope:'office',id:'missing'},admin);Trash.restore({id:trash.trashId},admin);assert.equal(S.state({scope:'office',id:'missing'},admin).bindings[0].enabled,false);
 assert.throws(()=>S.link({scope:'office',id:'missing',connectionId:'google',book:'connections',uid:''},reader),e=>e.status===403);assert.throws(()=>S.link({scope:'office',id:'missing',connectionId:'google',book:'https://evil.example',uid:''},admin),e=>e.status===400);
 create('revoke');const id2=bind('revoke');db.prepare('UPDATE users SET active=0 WHERE id=1').run();let calls=0;await S.run({bindingId:id2},admin,{list:async()=>{calls++;return []}});assert.equal(calls,0);db.prepare('UPDATE users SET active=1 WHERE id=1').run();
});
test('Änderung während Netzrequest wird lokal nicht überschrieben; parallele Aufrufe erzeugen keine Kopie',async()=>{
 create('race');const id=bind('race'),f=fake(),save=f.save;f.save=async function(...a){const r=await save.apply(this,a);patch('race',{city:'Währenddessen'});return r};await Promise.all([S.run({bindingId:id},admin,f),S.run({bindingId:id},admin,f)]);assert.equal(A.data(A.get('office','','race')).city,'Währenddessen');assert.equal(f.records.length,1);
});
test('Google und Microsoft beachten externe native Änderungen trotz erhaltener App-Zusatzdaten',()=>{
 for(const provider of ['google','microsoft']){const data=P.profile({institution:'Institution',firstName:'Anna',lastName:'Alt',email:'old@example.org',contactWays:[way('alias','email','extra@example.org')],people:[{id:'p',name:'Person'}]});const native=P.native(data,provider),extra={bindingId:'b',data,native:P.decodeNative(native,provider)},raw=provider==='google'?{...native,resourceName:'people/123',userDefined:[{key:P.KEY,value:JSON.stringify(extra)}],metadata:{sources:[{type:'CONTACT',etag:'e'}]}}:{...native,id:'123',changeKey:'etag',singleValueExtendedProperties:[{id:P.EXTRA,value:JSON.stringify(extra)}]};if(provider==='google')raw.names[0].familyName='Neu';else raw.surname='Neu';const result=P.record(raw,provider);assert.equal(result.data.lastName,'Neu');assert.deepEqual(result.data.people,data.people);assert.equal(result.marker,'b')}
});

test('CardDAV überträgt benannte Wege und Ansprechpartner, behält fremde Eigenschaften und verwendet Versionsschutz',async()=>{
 const dav=require('../src/integrations/calendar/caldav'),savedRequest=dav.contactRequest,savedFetch=dav.fetchVcards,savedAuth=dav.contactAuth;let body,headers;
 try{dav.contactAuth=()=>'';dav.contactRequest=async(url,options)=>{body=options.body;headers=options.headers;return {ok:true,status:204}};
 const data=P.profile({institution:'DAV',street:'Weg',house:'1',addresses:[{id:'post',label:'Postanschrift',street:'Postweg',house:'2',city:'Ort',country:'Deutschland'}],preferredAddressId:'post',email:'a@example.org',people:[{id:'p',name:'Anna Person',email:'p@example.org'}],contactWays:[way('Zentrale','email','a@example.org',true)]});const raw='BEGIN:VCARD\r\nVERSION:3.0\r\nUID:existing\r\nFN:DAV\r\nBDAY:19800101\r\nX-OTHER:keep\r\nEND:VCARD';
 await P.save({id:'dav',provider:'nextcloud'},'https://dav.example/contacts/',{id:'binding'},data,{uid:'existing',href:'/contacts/existing.vcf',etag:'"old"',rawVcard:raw});assert.equal(headers['If-Match'],'"old"');assert.match(body,/BDAY:19800101/);assert.match(body,/X-OTHER:keep/);assert.equal(V.parse(body)[0].people.length,1);
 dav.fetchVcards=async()=>[{uid:'existing',etag:'"new"',href:'/contacts/existing.vcf',rawVcard:body}];let [round]=await P.list({id:'dav',provider:'nextcloud'},'https://dav.example/contacts/');assert.equal(round.marker,'binding');assert.deepEqual(round.data,data);
 body=body.replace('ORG:DAV','ORG:Extern').replace('Postweg 2','Postweg 3').replace('p@example.org','changed@example.org');[round]=await P.list({id:'dav',provider:'nextcloud'},'https://dav.example/contacts/');assert.equal(round.data.institution,'Extern');assert.equal(round.data.street,'Weg');assert.equal(round.data.addresses[0].id,'post');assert.equal(round.data.addresses[0].house,'3');assert.equal(round.data.preferredAddressId,'post');assert.equal(round.data.people[0].id,'p');assert.equal(round.data.people[0].email,'changed@example.org');await assert.rejects(P.save({provider:'nextcloud'},'https://dav.example/contacts/',{id:'b'},data,{uid:'x',href:'https://other.example/x',etag:'e'}),/außerhalb/);
 }finally{dav.contactRequest=savedRequest;dav.fetchVcards=savedFetch;dav.contactAuth=savedAuth}
});
test('Google und Microsoft erhalten fremde Eigenschaften und senden Anbieter-Versionen beim Update',async()=>{
 for(const provider of ['google','microsoft']){const adapter=require('../src/integrations/calendar/'+(provider==='google'?'google-calendar':'microsoft-calendar')),previous=adapter.contactRequest;let request;
 try{adapter.contactRequest=async(url,uri,opts)=>{request={uri,...opts};return {ok:true,json:async()=>provider==='google'?{resourceName:'people/123'}:{id:'123'}}};
 const data=P.profile({institution:'Test',email:'a@example.org'}),raw=provider==='google'?{resourceName:'people/123',etag:'person-e',metadata:{sources:[{type:'CONTACT',etag:'source-e'}]},organizations:[{name:'Alt',title:'Direktor'}],addresses:[{city:'A'},{city:'Zweite'}],userDefined:[{key:'Other',value:'keep'}]}:{};
 await P.save({id:provider,provider},provider==='google'?'connections':'',{id:'binding'},data,{uid:'123',etag:'source-e',raw});const payload=JSON.parse(request.body);assert.equal(request.method,'PATCH');if(provider==='google'){assert.equal(payload.metadata.sources[0].etag,'source-e');assert.equal(payload.userDefined[0].key,'Other');assert.equal(payload.organizations[0].title,'Direktor');assert.equal(payload.addresses[1].city,'Zweite')}else assert.equal(request.headers['If-Match'],'source-e');
 adapter.contactRequest=async()=>({ok:false,status:412,json:async()=>({})});await assert.rejects(P.save({id:provider,provider},provider==='google'?'connections':'',{id:'b'},data,{uid:'123',etag:'old',raw}),e=>e.status===409);
 }finally{adapter.contactRequest=previous}}
});

test('Bearbeiten eines Hauptkontaktwegs aktualisiert dessen benannten bevorzugten Weg, auch bei Ansprechpartnern',()=>{
 create('main-way',{email:'alt@example.org',contactWays:[way('post','email','alt@example.org',true)],people:[{id:'p',name:'Person',email:'p-alt@example.org',contactWays:[way('person','email','p-alt@example.org',true)]}]});patch('main-way',{email:'neu@example.org'});let c=A.data(A.get('office','','main-way'));assert.equal(c.contactWays[0].value,'neu@example.org');A.savePerson({scope:'office',id:'main-way',personId:'p',baseVersion:A.personVersion(c.people[0]),patch:{...c.people[0],email:'p-neu@example.org'}},admin);c=A.data(A.get('office','','main-way'));assert.equal(c.people[0].email,'p-neu@example.org');assert.equal(c.people[0].contactWays[0].value,'p-neu@example.org');
});
test('Zusätzliche E-Mail-Adressen werden bei Dokumentation und Kommunikation zugeordnet',()=>{
 create('email-ways',{contactWays:[way('alias','email','extra@example.org')],people:[{id:'p',name:'Anna Person',contactWays:[way('person','email','person-alias@example.org')]}]},'case','a');const C=require('../src/modules/mail/contact-documentation');assert.equal(C.resolve(admin,'a','extra@example.org').contactId,'email-ways');assert.equal(C.resolve(admin,'a','person-alias@example.org').personId,'p');assert.equal(C.resolve(admin,'a','person-alias@example.org',{scope:'case',caseId:'a',contactId:'email-ways',personId:'p'}).snapshot.email,'person-alias@example.org');
 db.prepare("INSERT INTO mail_accounts(id,label,kind,email,visibility,owner_user_id) VALUES('ways','Büro','imap','me@example.org','public',1)").run();require('../src/modules/contacts/addressbook-communications').indexMessages('ways','INBOX',[{uid:1,messageId:'<alias>',subject:'Alias-Mail',date:'2026-09-12',from:{address:'extra@example.org'},to:[{address:'me@example.org'}]}]);assert.ok(A.details('case','a','email-ways',admin).communications.some(x=>x.title==='Alias-Mail'));
});
test('Geprüfte Signatur ersetzt gewählte Hauptwege, behält Alternativen und speichert ohne Rücküberschreibung',()=>{
 const before={email:'alt@example.org',phone:'01234/111111',contactWays:[way('mail','email','alt@example.org',true),way('tel','phone','01234/111111',true)]};
 const snapshot=structuredClone(before),proposal=T.signature('neu@example.org\nTel.: 01234/222222\nhttps://example.org');
 const next=T.signaturePatch(before,{email:proposal.email,phone:proposal.phone},proposal.contactWays);
 assert.equal(next.phoneArea,'');assert.equal(next.phoneNumber,'01234/222222');
 assert.deepEqual(before,snapshot);create('signature-overwrite',before);patch('signature-overwrite',next);
 const saved=A.data(A.get('office','','signature-overwrite'));
 assert.equal(saved.email,'neu@example.org');assert.equal(saved.phone,'01234/222222');
 assert.ok(saved.contactWays.some(w=>w.id==='mail'&&!w.preferred));assert.ok(saved.contactWays.some(w=>w.id==='tel'&&!w.preferred));
 assert.equal(saved.contactWays.filter(w=>w.type==='email'&&w.preferred).length,1);
});
test('Signatur berücksichtigt Abwahl, manuelle Angaben und bereits vorhandene Alternativen',()=>{
 const before={email:'alt@example.org',contactWays:[way('old','email','alt@example.org',true),way('other','email','neu@example.org')]};
 assert.deepEqual(T.signaturePatch(before,{},[]),{});
 let next=T.signaturePatch(before,{},[way('web','website','https://example.org',true)]);
 assert.equal(T.withWays({...before,...next},before).email,'alt@example.org');
 next=T.signaturePatch(before,{email:'neu@example.org'},[way('new','email','neu@example.org',true)]);
 assert.equal(next.contactWays.length,2);assert.equal(next.contactWays.find(w=>w.preferred).id,'other');
 next=T.signaturePatch(before,{email:'manuell@example.org'});
 assert.equal(T.withWays({...before,...next},before).email,'manuell@example.org');
 next=T.signaturePatch(before,{email:''},[way('web','website','https://example.org',true)]);
 assert.equal(T.withWays({...before,...next},before).email,'');assert.equal(next.contactWays.filter(w=>w.type==='email').length,2);
});
test('Modulsicherung enthält Papierkorb und Synczuordnungen; portabler Restore pausiert und löst alte Laufsperren',()=>{
 const backup=require('../src/modules/backup/portable-data'),payload=backup.moduleData(db);assert.ok(payload.addressbookTrash.length);assert.ok(payload.addressbookSyncBindings.length);const definitions=backup.restoreDefinitions('module').filter(d=>['addressbook_trash','addressbook_sync_bindings'].includes(d.table));const b=payload.addressbookSyncBindings[0];b.enabled=1;b.lock_token='stale';b.lock_until=Date.now()+100000;backup.restorePayload(db,payload,definitions);const saved=db.prepare('SELECT * FROM addressbook_sync_bindings WHERE id=?').get(b.id);assert.equal(saved.enabled,0);assert.equal(saved.lock_token,'');assert.equal(saved.lock_until,0);assert.equal(backup.moduleData(db).addressbookTrash.length,payload.addressbookTrash.length);
});
test('Wiederholte Kontaktanlage nach verlorener Antwort erzeugt keine zweite Kopie',async()=>{
 const handler=require('../src/modules/contacts/addressbook-routes').stack.find(l=>l.route?.path==='/contact'&&l.route.methods.post).route.stack.at(-1).handle;const body={scope:'office',creationId:require('node:crypto').randomUUID(),patch:{institution:'Einmalig'},allowDuplicates:true};let result;const response={json:v=>{result=v;return response},status:n=>{assert.equal(n,200);return response}};const before=db.prepare('SELECT count(*) n FROM office_contacts').get().n;await handler({body,session:admin},response);const id=result.contact.id;await handler({body,session:admin},response);assert.equal(result.contact.id,id);assert.equal(db.prepare('SELECT count(*) n FROM office_contacts').get().n,before+1);
});
test('Serverautomatik gleicht alle freigegebenen Kontakte ab und lädt ein unverändertes Adressbuch nur einmal',async()=>{
 db.prepare('UPDATE addressbook_sync_bindings SET enabled=0').run();create('auto-one');create('auto-two');const one=bind('auto-one'),two=bind('auto-two'),f=fake();await S.run({bindingId:one},admin,f);await S.run({bindingId:two},admin,f);let reads=0;const original=f.list;f.list=async(...args)=>{reads++;return original(...args)};f.records[0].data.city='Automatisch';const result=await S.runAll(f);assert.deepEqual(result.errors,[]);assert.equal(reads,1);assert.equal(A.data(A.get('office','','auto-one')).city,'Automatisch');
});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
