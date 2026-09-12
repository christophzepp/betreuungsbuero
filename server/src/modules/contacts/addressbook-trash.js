'use strict';
const db=require('../../database'),crypto=require('node:crypto'),A=require('./addressbook');
const read=row=>JSON.parse(row.data_json);
function visible(item,session,write=false){try{for(const row of read(item).rows)A.authorize(session,row.scope,row.case_id||'',write);return true}catch(_){return false}}
function list(session){return {items:db.prepare('SELECT * FROM addressbook_trash WHERE restored_at IS NULL ORDER BY deleted_at DESC').all().filter(x=>visible(x,session)).map(x=>({id:x.id,scope:x.scope,caseId:x.case_id,contactId:x.contact_id,deletedAt:x.deleted_at,actor:x.actor,label:require('../../../frontend/addressbook-contact-tools').title(JSON.parse(read(x).rows[0].data_json)),cases:read(x).rows.filter(r=>r.scope==='case').map(r=>({id:r.case_id,label:db.prepare('SELECT label FROM cases WHERE id=?').get(r.case_id)?.label||r.case_id}))}))}}
function remove(input,session){
 const {scope,caseId='',id,version}=input;A.authorize(session,scope,caseId,true);const events=[];let trashId;
 db.transaction(()=>{const main=A.get(scope,caseId,id);if(!main)A.fail(404,'Kontakt nicht gefunden.');if(version&&A.version(main)!==version)A.fail(409,'Der Kontakt wurde inzwischen geändert. Bitte neu laden.');
 const rows=[{...main,scope},...(scope==='office'?A.linked(id).map(r=>({...r,scope:'case'})):[])];for(const r of rows)A.authorize(session,r.scope,r.case_id||'',true);
 const links=rows.filter(r=>r.scope==='case').map(r=>({caseContactId:r.id,officeContactId:A.centralId('case',r.id)})).filter(l=>l.officeContactId);
 trashId=crypto.randomUUID();db.prepare('INSERT INTO addressbook_trash(id,scope,case_id,contact_id,deleted_at,actor,data_json) VALUES(?,?,?,?,?,?,?)').run(trashId,scope,caseId,id,new Date().toISOString(),String(session.displayName||session.username||session.userId),JSON.stringify({rows,links}));
 for(const r of [...rows].reverse()){db.prepare("UPDATE addressbook_sync_bindings SET enabled=0,status='trash',error='',version=version+1 WHERE scope=? AND case_id=? AND contact_id=?").run(r.scope,r.case_id||'',r.id);db.prepare('DELETE FROM '+(r.scope==='office'?'office_contacts':'case_contacts')+' WHERE id=?').run(r.id);A.record(r.scope,r.case_id||'',r.id,A.data(r),null,session);events.push([r.scope,r.case_id||'',r.id,null])}
 })();for(const args of events)A.notify(...args);return {ok:true,trashId};
}
function restore(input,session){const events=[],warnings=[];let target;
 db.transaction(()=>{const item=db.prepare('SELECT * FROM addressbook_trash WHERE id=?').get(input.id);if(!item||!visible(item,session,true))A.fail(404,'Dieser Papierkorbeintrag ist nicht verfügbar.');if(item.restored_at)A.fail(409,'Dieser Kontakt wurde bereits wiederhergestellt.');
 const {rows,links}=read(item);for(const r of rows){if(r.scope==='case'&&!db.prepare('SELECT id FROM cases WHERE id=?').get(r.case_id))A.fail(409,'Ein zugehöriger Fall existiert nicht mehr.');if(A.get(r.scope,r.case_id||'',r.id))A.fail(409,'Die ursprüngliche Kontakt-ID ist bereits belegt. Es wurden keine Daten überschrieben.')}
 for(const r of rows){let next=A.data(r);const link=links.find(l=>l.caseContactId===r.id);if(link&&r.scope==='case'){
  const parent=A.get('office','',link.officeContactId);if(!parent&&!rows.some(x=>x.scope==='office'&&x.id===link.officeContactId))A.fail(409,'Der zentrale Kontakt liegt ebenfalls im Papierkorb. Bitte diesen zuerst wiederherstellen.');
  if(parent)for(const key of A.SHARED){if(Object.hasOwn(A.data(parent),key))next[key]=A.data(parent)[key];else delete next[key]}
  next.centralContactId=link.officeContactId;
 }
 const standards={...next._standardRecipients};for(const [key,person] of Object.entries(standards))if(person&&!(next.people||[]).some(p=>p.id===person))delete standards[key];if(r.scope==='case')for(const existing of db.prepare('SELECT data_json FROM case_contacts WHERE case_id=?').all(r.case_id))for(const purpose of Object.keys(A.data(existing)._standardRecipients||{}))if(Object.hasOwn(standards,purpose)){delete standards[purpose];warnings.push('Ein inzwischen belegter Standardempfänger bleibt erhalten.')}if(next._standardRecipients)next._standardRecipients=standards;
 const fields=['id',...(r.scope==='case'?['case_id']:[]),'data_json','created_at','updated_by','external_uid','connection_id'],values=fields.map(k=>k==='data_json'?JSON.stringify(next):k==='updated_by'?session.userId:r[k]??'');
 db.prepare('INSERT INTO '+(r.scope==='office'?'office_contacts':'case_contacts')+'('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...values);A.record(r.scope,r.case_id||'',r.id,null,next,session);events.push([r.scope,r.case_id||'',r.id,next]);
 }
 for(const link of links)db.prepare('INSERT OR REPLACE INTO addressbook_links VALUES(?,?)').run(link.caseContactId,link.officeContactId);
 db.prepare('UPDATE addressbook_trash SET restored_at=? WHERE id=?').run(new Date().toISOString(),item.id);target={scope:item.scope,caseId:item.case_id,id:item.contact_id};
 })();for(const args of events)A.notify(...args);return {ok:true,target,warnings:[...new Set(warnings)]};
}
module.exports={list,remove,restore};
