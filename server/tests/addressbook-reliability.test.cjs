'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'addressbook-reliability-'));
process.env.RUNTIME_ROOT=dir;process.env.DB_PATH=path.join(dir,'test.sqlite3');process.env.DOCUMENTS_DATA_ROOT=path.join(dir,'data');process.env.ENCRYPTION_KEY='54'.repeat(32);
const db=require('../src/database'),A=require('../src/modules/contacts/addressbook'),M=require('../src/modules/contacts/addressbook-merge');
const admin={userId:1,isAdmin:true,displayName:'QA'},reader={userId:2},owner={userId:1};
db.prepare("INSERT INTO users(id,username,password_hash) VALUES(1,'qa','test'),(2,'reader','test')").run();
for(const [id,user] of [['a',1],['b',1],['private',2]])db.prepare('INSERT INTO cases(id,label,owner_user_id) VALUES(?,?,?)').run(id,'Fall '+id,user);
const insert=(id,d={},caseId='a')=>db.prepare('INSERT INTO case_contacts(id,case_id,data_json) VALUES(?,?,?)').run(id,caseId,JSON.stringify({institution:'Kontakt '+id,...d}));
const row=id=>A.get('case','a',id),data=id=>A.data(row(id));
const plans=(ids,survivorId=ids[0])=>({ids,survivorId,versions:Object.fromEntries(ids.map(id=>[id,A.version(row(id))]))});
const merge=(operationId,groups)=>M.merge({caseId:'a',operationId,groups},admin);
const person=p=>A.validatePatch({people:[p]}).people[0];
const save=(id,p,baseVersion,remove=false)=>A.savePerson({scope:'case',caseId:'a',id,personId:p.id,patch:p,baseVersion,remove},admin);
const doku=(id,contactId,caseId='a',extra={})=>db.prepare('INSERT INTO case_doku_entries(id,case_id,data_json) VALUES(?,?,?)').run(id,caseId,JSON.stringify({date:'2026-09-12T12:00:00',detail:id,contactLink:{contactId,caseId,scope:'case'},...extra}));

test('Getrennte Ansprechpartner können parallel gespeichert werden; derselbe Ansprechpartner erkennt Konflikte',()=>{
 const p=person({id:'p',name:'Lea'}),q=person({id:'q',name:'Max'});insert('people',{people:[p,q]});
 const v=A.details('case','a','people',admin).personVersions;
 save('people',{...p,phone:'123'},v.p);save('people',{...q,department:'Verwaltung'},v.q);
 assert.equal(data('people').people.find(x=>x.id==='p').phone,'123');assert.equal(data('people').people.find(x=>x.id==='q').department,'Verwaltung');
 assert.throws(()=>save('people',{...p,phone:'456'},v.p),e=>e.status===409);
 assert.throws(()=>save('people',p,v.p,true),e=>e.status===409);
 // Ein verlorenes Ergebnis darf bei Wiederholung weder neue Person noch Verlauf duplizieren.
 const count=db.prepare("SELECT count(*) n FROM addressbook_history WHERE contact_id='people'").get().n;
 save('people',{...p,phone:'123'},v.p);assert.equal(db.prepare("SELECT count(*) n FROM addressbook_history WHERE contact_id='people'").get().n,count);
 const newP={id:'new',name:'Neue Person'};save('people',newP,'');save('people',newP,'');assert.equal(data('people').people.length,3);
 assert.throws(()=>save('people',{id:'bad',name:'Bad',email:'kein-email'},''),e=>e.status===400);
});
test('Personenänderungen über verschiedene Fallprojektionen erhalten andere Personen und lokale Referenzen',()=>{
 insert('shared-people',{people:[person({id:'p',name:'Lea'}),person({id:'q',name:'Max'})],fileNumber:'A-1'});
 const linked=A.assign({scope:'case',caseId:'a',id:'shared-people',targetCaseId:'b',fileNumber:'B-1'},admin),bid=linked.assignment.contactId;
 const v=linked.personVersions;save('shared-people',{...linked.contact.people[0],phone:'555'},v.p);
 A.savePerson({scope:'case',caseId:'b',id:bid,personId:'q',baseVersion:v.q,patch:{...linked.contact.people[1],department:'Büro'}},admin);
 for(const r of [row('shared-people'),A.get('case','b',bid),A.get('office','',linked.centralId)]){assert.equal(A.data(r).people[0].phone,'555');assert.equal(A.data(r).people[1].department,'Büro')}
 assert.equal(A.data(A.get('case','b',bid)).fileNumber,'B-1');
});
test('Fallzuordnung wird idempotent angelegt, anschließend automatisch und versionsgesichert aktualisiert',()=>{
 insert('assign');const input={scope:'case',caseId:'a',id:'assign',targetCaseId:'b',assignmentId:'target',fileNumber:'B1',role:'Arzt',processNumber:''};
 const first=A.assign(input,admin),again=A.assign(input,admin);assert.equal(first.assignment.contactId,again.assignment.contactId);
 A.assign({...input,fileNumber:'B2',targetVersion:first.assignment.version},admin);
 assert.throws(()=>A.assign({...input,role:'Alt',targetVersion:first.assignment.version},admin),e=>e.status===409);
 assert.equal(A.data(A.get('case','b','target')).fileNumber,'B2');assert.equal(A.linked(first.centralId).length,2);
 assert.throws(()=>A.assign({...input,assignmentId:'other-id'},admin),e=>e.status===409);
 insert('collision');assert.throws(()=>A.assign({...input,id:'collision',assignmentId:'target'},admin),e=>e.status===409);assert.equal(A.centralId('case','collision'),'','Gescheiterte Anlage hinterlässt keinen zentralen Kontakt');
});
test('Ein Fehler im zweiten Merge rollt alle Kontakte, Historien und Benachrichtigungen zurück',()=>{
 for(const id of ['tx1','tx2','tx3','tx4'])insert(id,{phone:id});
 const before=db.prepare('SELECT * FROM case_contacts ORDER BY id').all(),history=db.prepare('SELECT count(*) n FROM addressbook_history').get().n,broadcast=[];
 A.setRealtime({broadcastToCase:(...x)=>broadcast.push(x)});
 db.exec("CREATE TEMP TRIGGER qa_merge_failure BEFORE DELETE ON case_contacts WHEN OLD.id='tx4' BEGIN SELECT RAISE(ABORT,'simulierter Abbruch'); END");
 try{assert.throws(()=>merge('atomic',[plans(['tx1','tx2']),plans(['tx3','tx4'])]),/simulierter Abbruch/)}finally{db.exec('DROP TRIGGER qa_merge_failure');A.setRealtime(null)}
 assert.deepEqual(db.prepare('SELECT * FROM case_contacts ORDER BY id').all(),before);assert.equal(db.prepare('SELECT count(*) n FROM addressbook_history').get().n,history);assert.deepEqual(broadcast,[]);assert.equal(db.prepare("SELECT count(*) n FROM addressbook_merges WHERE operation_id='atomic'").get().n,0);
});
test('Merge und Undo sind bei verlorener Antwort wiederholbar und stellen Originaldaten einschließlich Metadaten wieder her',()=>{
 insert('merge1',{caseRefs:['A'],email:'a@example.org',people:[person({id:'m1',name:'Lea'})]});insert('merge2',{caseRefs:['B','A'],phone:'777',fileNumber:'Original-2',people:[person({id:'m2',name:'Max'})]});
 db.prepare("UPDATE case_contacts SET external_uid='remote-id' WHERE id='merge2'").run();
 const before=[row('merge1'),row('merge2')],groups=[plans(['merge1','merge2'])];
 const first=merge('retry',groups);assert.equal(data('merge1').people.length,2);assert.deepEqual(data('merge1').caseRefs,['A','B']);assert.equal(data('merge1').phone,'777');assert.equal(row('merge2'),undefined);
 const retry=merge('retry',groups);assert.deepEqual(retry,first);assert.throws(()=>merge('retry',[plans(['tx1','tx2'])]),e=>e.status===409);
 const id=first.merges.find(m=>m.id==='retry_0').id;const undone=M.unmerge({caseId:'a',id},admin);M.unmerge({caseId:'a',id},admin);
 assert.deepEqual(data('merge1'),A.data(before[0]));assert.deepEqual(row('merge2'),before[1]);assert.ok(!undone.merges.some(m=>m.id===id));
 merge('retry',groups);assert.ok(row('merge2'),'Verspätete Wiederholung nach Undo darf nicht erneut zusammenführen');
});
test('Veraltete Versionen und spätere Änderungen blockieren Merge bzw. Undo ohne Datenverlust',()=>{
 insert('stale1');insert('stale2');const group=plans(['stale1','stale2']);A.replace('case','a','stale1',{note:'neu'},admin);
 assert.throws(()=>merge('stale',[group]),e=>e.status===409);assert.ok(row('stale2'));
 merge('stale-ok',[plans(['stale1','stale2'])]);A.replace('case','a','stale1',{note:'nachher'},admin);
 assert.throws(()=>M.unmerge({caseId:'a',id:'stale-ok_0'},admin),e=>e.status===409);assert.equal(data('stale1').note,'nachher');assert.equal(row('stale2'),undefined);
 assert.throws(()=>M.merge({caseId:'a',operationId:'forbidden',groups:[]},reader),e=>e.status===403);
});
test('Zentraler Merge und Undo erhalten Fallreferenzen und rollen gemeinsame Stammdaten zurück',()=>{
 insert('central-merge',{fileNumber:'A'});insert('local-merge',{phone:'987'});
 const assigned=A.assign({scope:'case',caseId:'a',id:'central-merge',targetCaseId:'b',fileNumber:'B'},admin),beforeCentral=A.data(A.get('office','',assigned.centralId));
 const original=JSON.stringify(data('central-merge'));
 merge('central',[plans(['central-merge','local-merge'])]);assert.equal(A.data(A.get('case','b',assigned.assignment.contactId)).phone,'987');
 M.unmerge({caseId:'a',id:'central_0'},admin);assert.equal(JSON.stringify(data('central-merge')),original);assert.deepEqual(A.data(A.get('office','',assigned.centralId)),beforeCentral);assert.equal(A.data(A.get('case','b',assigned.assignment.contactId)).fileNumber,'B');
});
test('Altbestände trennen atomar und entfernen beim Zusammenführen ergänzte Felder',()=>{
 insert('old-survivor',{phone:'ergänzt'});const legacy={id:'old-merge',survivorId:'old-survivor',survivorBefore:{institution:'Kontakt old-survivor'},removed:[{id:'old-removed',institution:'Alt',phone:'ergänzt'}]};
 M.unmerge({caseId:'a',id:legacy.id,legacy,versions:{'old-survivor':A.version(row('old-survivor'))}},admin);
 assert.deepEqual(data('old-survivor'),legacy.survivorBefore);assert.equal(data('old-removed').phone,'ergänzt');M.unmerge({caseId:'a',id:legacy.id,legacy},admin);
});
test('Kommunikation folgt mehrfachen Zusammenführungen und kehrt nach Undo zu ihren ursprünglichen Kontakten zurück',()=>{
 for(const id of ['alias-a','alias-b','alias-c']){insert(id);doku('d-'+id,id)}
 merge('alias-first',[plans(['alias-a','alias-b'])]);merge('alias-second',[plans(['alias-c','alias-a'])]);
 assert.equal(A.details('case','a','alias-c',admin).communications.length,3);
 M.unmerge({caseId:'a',id:'alias-second_0'},admin);assert.equal(A.details('case','a','alias-c',admin).communications.length,1);assert.equal(A.details('case','a','alias-a',admin).communications.length,2);
 M.unmerge({caseId:'a',id:'alias-first_0'},admin);assert.equal(A.details('case','a','alias-a',admin).communications.length,1);
});
test('Verlauf und Kommunikation sind bei gleichen Zeitstempeln lückenlos nachladbar; Rechte gelten auf jeder Seite',()=>{
 insert('pages');const history=db.prepare('INSERT INTO addressbook_history VALUES(?,?,?,?,?,?,?)');
 db.transaction(()=>{for(let i=0;i<305;i++)history.run('h'+i,'case','a','pages','2026-09-12T12:00:00','QA',JSON.stringify({note:{before:'',after:String(i)}}));for(let i=0;i<505;i++)doku('d-page-'+String(i).padStart(4,'0'),'pages');doku('private-doku','pages','private')})();
 const collect=(fn)=>{let cursor,items=[];do{const page=fn(cursor);items.push(...page.items);cursor=page.nextCursor}while(cursor);return items};
 const h=collect(c=>A.historyPage('case','a','pages',owner,c)),d=collect(c=>A.communicationPage('case','a','pages',owner,c));
 assert.equal(h.length,305);assert.equal(new Set(h.map(x=>x.id)).size,305);assert.equal(d.length,505);assert.equal(new Set(d.map(x=>x.id)).size,505);assert.ok(!d.some(x=>x.caseId==='private'));
 assert.throws(()=>A.historyPage('case','a','pages',reader,A.details('case','a','pages',admin).historyCursor),e=>e.status===403);
 assert.throws(()=>A.communicationPage('case','a','pages',owner,'not-a-cursor'),e=>e.status===400);
 const first=A.historyPage('case','a','pages',admin);history.run('new-between-pages','case','a','pages','2026-09-13','QA','{}');const next=A.historyPage('case','a','pages',admin,first.nextCursor);assert.equal(next.items.length,100);assert.ok(!next.items.some(x=>first.items.some(y=>y.id===x.id)));
});
test('Zusammenführung aus einem in einen anderen Fall importierten Archiv verändert den Ursprungsfall nicht',()=>{
 insert('import-a');insert('import-b');merge('import-source',[plans(['import-a','import-b'])]);
 const archive=db.prepare("SELECT data_json FROM addressbook_merges WHERE id='import-source_0'").get().data_json;
 db.prepare('INSERT INTO addressbook_merges(id,case_id,operation_id,data_json) VALUES(?,?,?,?)').run('import-copy','b','copy',archive);
 const original=row('import-a');assert.throws(()=>M.unmerge({caseId:'b',id:'import-copy'},admin),e=>e.status===409);assert.deepEqual(row('import-a'),original);
});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
