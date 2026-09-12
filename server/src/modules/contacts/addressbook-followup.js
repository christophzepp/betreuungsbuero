'use strict';
const db=require('../../database'),A=require('./addressbook'),crypto=require('node:crypto'),events=require('../office/events');
const version=r=>crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const agreement=v=>v.title.replace(/^Wiedervorlage: /,'')+' · bis '+v.due_at.slice(0,10)+(v.description?' · '+v.description:'');
function save(input,session){
 const {scope,caseId='',id,targetCaseId,followupId,personId='',patch,baseVersion=''}=input;
 A.authorize(session,scope,caseId);A.authorize(session,'case',targetCaseId,true);
 const contact=A.get(scope,caseId,id);if(!contact)A.fail(404,'Kontakt nicht gefunden.');if(scope==='case'&&caseId!==targetCaseId)A.fail(400,'Kontakt und Rückmeldung gehören zu verschiedenen Fällen.');
 if(typeof followupId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(followupId)||!patch||typeof patch.name!=='string'||!patch.name.trim()||patch.name.length>500||typeof patch.dueAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(patch.dueAt)||!Number.isFinite(Date.parse(patch.dueAt))||new Date(patch.dueAt).toISOString().slice(0,10)!==patch.dueAt)A.fail(400,'Bitte Anlass und gültiges Rückmeldedatum angeben.');
 const c=A.data(contact),p=(c.people||[]).find(p=>p.id===personId);if(personId&&!p)A.fail(400,'Ansprechpartner nicht gefunden.');
 const link={scope,caseId,contactId:id,personId,snapshot:{label:[c.institution,p?.name||[c.firstName,c.lastName].filter(Boolean).join(' ')].filter(Boolean).join(' – '),role:c.role||'',customerNumber:c.customerNumber||''}};
 const values={title:'Wiedervorlage: '+patch.name.trim(),description:String(patch.description||'').slice(0,20000),due_at:patch.dueAt+'T00:00:00'};
 let changedDoku=null,dokuAction='create';db.transaction(()=>{
  const old=db.prepare('SELECT * FROM todos WHERE id=?').get(followupId);
  if(old){const previousLink=JSON.parse(old.source_ref||'{}').contactLink;if(old.source_module!=='addressbook'||old.case_id!==targetCaseId||old.source_id!==id||previousLink?.scope!==scope||previousLink?.personId!==personId)A.fail(409,'Diese Rückmeldung gehört zu einem anderen Vorgang.');if(old.visibility==='private'&&Number(old.owner_user_id)!==Number(session.userId))A.fail(403,'Rückmeldung nicht verfügbar.');if(Object.keys(values).every(k=>old[k]===values[k]))return;if(version(old)!==baseVersion)A.fail(409,'Die Rückmeldung wurde inzwischen geändert. Bitte neu öffnen.');db.prepare("UPDATE todos SET title=?,description=?,due_at=?,updated_by=?,updated_at=datetime('now') WHERE id=?").run(values.title,values.description,values.due_at,session.userId,followupId);
   // Dasselbe Formular speichert mehrfach. Ergänzungen gehören auch in den erzeugten
   // Doku-Eintrag; inzwischen manuell überarbeitete Dokumentation bleibt erhalten.
   const row=db.prepare('SELECT data_json FROM case_doku_entries WHERE id=? AND case_id=?').get('ab-followup-'+followupId,targetCaseId),d=row&&JSON.parse(row.data_json);
   if(d?.source?.module==='addressbook'&&d.source.id===followupId&&d.freeDetail===agreement(old)){d.freeDetail=agreement(values);db.prepare("UPDATE case_doku_entries SET data_json=?,updated_at=datetime('now'),updated_by=? WHERE id=? AND case_id=?").run(JSON.stringify(d),session.userId,'ab-followup-'+followupId,targetCaseId);changedDoku=d;dokuAction='update'}return}
  if(baseVersion)A.fail(409,'Die ursprüngliche Rückmeldung wurde entfernt.');
  const label=db.prepare('SELECT label FROM cases WHERE id=?').get(targetCaseId)?.label;if(label==null)A.fail(404,'Fall nicht gefunden.');
  db.prepare("INSERT INTO todos(id,title,description,due_at,item_type,case_id,case_label,source_type,source_id,source_module,source_ref,updated_by) VALUES(?,?,?,?,'followup',?,?,'contact',?,'addressbook',?,?)").run(followupId,values.title,values.description,values.due_at,targetCaseId,label,id,JSON.stringify({contactLink:link}),session.userId);
  const date=new Date().toISOString().slice(0,10),d={date,year:date.slice(0,4),type:'Kommunikation & Kontakt',detail:'Rückmeldung vereinbart',freeDetail:agreement(values),contactLink:link,source:{module:'addressbook',id:followupId},contactType:'Vereinbarung'};
  db.prepare('INSERT INTO case_doku_entries(id,case_id,data_json,updated_by) VALUES(?,?,?,?)').run('ab-followup-'+followupId,targetCaseId,JSON.stringify(d),session.userId);changedDoku=d;
 })();if(changedDoku)A.notifyDoku(targetCaseId,'ab-followup-'+followupId,changedDoku,session,dokuAction);events.emit('todos',{method:'PUT'});A.notify(scope,caseId,id,A.data(contact));const row=db.prepare('SELECT * FROM todos WHERE id=?').get(followupId);return {id:followupId,version:version(row)};
}
module.exports={save};
