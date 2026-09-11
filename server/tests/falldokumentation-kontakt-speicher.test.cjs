'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('Echte Doku-Routen erhalten Kontaktverknüpfung und Snapshot dauerhaft in einer isolierten Datenbank',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'doku-kontakt-test-'));
 const keys=['RUNTIME_ROOT','DB_PATH','DOCUMENTS_DATA_ROOT','ENCRYPTION_KEY'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.RUNTIME_ROOT=temp;process.env.DB_PATH=path.join(temp,'test.sqlite3');process.env.DOCUMENTS_DATA_ROOT=path.join(temp,'data');process.env.ENCRYPTION_KEY='42'.repeat(32);
 let db;
 try{
  db=require('../src/database');
  db.prepare("INSERT INTO users(id,username,password_hash) VALUES(1,'kontakt-test','fixture')").run();
  db.prepare("INSERT INTO cases(id,label,created_by) VALUES('case-a','Testfall',1)").run();
  const routes=require('../src/modules/cases/routes');
  function call(route,method,params,data){
   const layer=routes.stack.find(l=>l.route?.path===route&&l.route.methods[method]);assert.ok(layer,route);let result,status=200;
   const res={status(s){status=s;return this},json(d){result=d;return this}};
   layer.route.stack.at(-1).handle({params,body:{data},session:{userId:1},get:()=>null},res);
   return {result,status};
  }
  const contact=call('/:id/contacts','post',{id:'case-a'},{institution:'Testpraxis',role:'Hausarzt'}).result.id;
  const link={scope:'case',caseId:'case-a',contactId:contact,contactKey:'',snapshot:{label:'Testpraxis – Lea Muster',person:'Lea Muster',fileNumber:'A-100'}};
  const original={date:'2026-09-11',actor:'Hausärzt:in',freeDetail:'Befund angefordert',contactLink:link,sourceMailId:'mail-1'};
  const created=call('/:id/doku-entries','post',{id:'case-a'},original);assert.equal(created.status,201);
  const id=created.result.id;
  const changed={...original,note:'Rückruf vormerken'};
  assert.equal(call('/:id/doku-entries/:entryId','put',{id:'case-a',entryId:id},changed).status,200);
  // Das spätere Löschen des Adressbucheintrags verändert keine historische Dokumentation.
  call('/:id/contacts/:contactId','delete',{id:'case-a',contactId:contact});
  const loaded=call('/:id/doku-entries','get',{id:'case-a'}).result.entries[0];
  assert.deepEqual(loaded.data,changed);
  db.close();db=null;
  const Database=require('better-sqlite3'),reopened=new Database(process.env.DB_PATH,{readonly:true});
  try{const row=reopened.prepare('SELECT data_json FROM case_doku_entries WHERE id=?').get(id);assert.deepEqual(JSON.parse(row.data_json),changed)}finally{reopened.close()}
 }finally{if(db)db.close();for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k]}fs.rmSync(temp,{recursive:true,force:true})}
});
