'use strict';
const db=require('../../database'),crypto=require('node:crypto'),A=require('./addressbook');
const codec=require('../../../frontend/addressbook-vcard');
const key=(c,scope)=>(scope==='office'?['firstName','lastName','institution','email']:['status','role','institution','title','firstName','lastName','street','house','postal','city','email','fax','fileNumber']).map(k=>String(c[k]||'').trim().toLowerCase()).join('|');
function importContacts(input,session){
 const {scope,caseId='',records}=input;A.authorize(session,scope,caseId,true);
 if(!Array.isArray(records)||!records.length||records.length>5000)A.fail(400,'Bitte eine gültige vCard-Datei auswählen.');
 if(scope==='case'&&!db.prepare('SELECT id FROM cases WHERE id=?').get(caseId))A.fail(404,'Fall nicht gefunden.');
 let clean;try{clean=records.map(rec=>{const data=codec.clean(rec);if(!data.firstName&&!data.lastName&&!data.institution&&!data.email)throw Error('Kontakt ohne Namen oder E-Mail.');if(rec._vcardSourceId!=null&&(typeof rec._vcardSourceId!=='string'||rec._vcardSourceId.length>128))throw Error('Ungültige Herkunftskennung.');data.status=data.status||'Aktiv';return {data,sourceId:rec._vcardSourceId||''}})}catch(e){A.fail(400,e.message)}
 const table=scope==='office'?'office_contacts':'case_contacts',load=()=>db.prepare('SELECT * FROM '+table+(scope==='case'?' WHERE case_id=?':'')).all(...(scope==='case'?[caseId]:[]));
 const added=[],warnings=new Set();let skipped=0;
 db.transaction(()=>{
  const existing=load(),keys=new Map(existing.map(row=>[key(A.data(row),scope),row.id])),sources=new Map(),pending=[];
  for(const entry of clean){const k=key(entry.data,scope),duplicate=keys.get(k),id=duplicate||crypto.randomUUID();if(entry.sourceId){if(sources.has(entry.sourceId)&&sources.get(entry.sourceId)!==id)A.fail(400,'Mehrdeutige Herkunftskennung in der vCard-Datei.');sources.set(entry.sourceId,id)}if(duplicate){skipped++;continue}keys.set(k,id);pending.push({...entry,id})}
  const officeIds=new Set(db.prepare('SELECT id FROM office_contacts').all().map(r=>r.id));if(scope==='office')for(const row of pending)officeIds.add(row.id);
  const occupied=new Set(existing.flatMap(row=>Object.keys(A.data(row)._standardRecipients||{})));
  for(const {id,data} of pending){
   // References to other cards in an office import must follow the newly assigned IDs.
   for(const field of ['centralContactId','substituteContactId'])if(data[field]){
    if(scope==='office'&&field==='centralContactId'){delete data[field];continue}
    const mapped=scope==='office'?sources.get(data[field])||data[field]:data[field];
    if(officeIds.has(mapped)&&mapped!==id)data[field]=mapped;
    else{delete data[field];warnings.add('Eine zentrale Zuordnung oder Vertretung fehlt im Zieladressbuch und muss neu ausgewählt werden.')}
   }
   if(scope==='case'&&data._standardRecipients)for(const purpose of Object.keys(data._standardRecipients)){if(occupied.has(purpose)){delete data._standardRecipients[purpose];warnings.add('Ein Standardempfänger ist im Zielfall bereits belegt und wurde beibehalten.')}else occupied.add(purpose)}
   if(scope==='case'){data._pendingWrite=true;db.prepare('INSERT INTO case_contacts(id,case_id,data_json,updated_by) VALUES(?,?,?,?)').run(id,caseId,JSON.stringify(data),session.userId)}
   else db.prepare('INSERT INTO office_contacts(id,data_json,updated_by) VALUES(?,?,?)').run(id,JSON.stringify(data),session.userId);
   A.record(scope,caseId,id,null,data,session);added.push({id,data});
  }
 })();
 for(const row of added)A.notify(scope,caseId,row.id,row.data);
 return {added:added.length,skipped,warnings:[...warnings],contacts:load().map(r=>({id:r.id,data:A.data(r)}))};
}
module.exports={importContacts};
