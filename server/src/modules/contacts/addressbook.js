'use strict';
// Zentrale Stammdaten mit rückwärtskompatiblen Fallprojektionen: alle bisherigen Excel-/vCard-
// und Dokumentwege lesen weiterhin case_contacts. Referenzen, Status und Rollen bleiben je Fall.
const db=require('../../database'),crypto=require('node:crypto');
const {darfSehen,darfBearbeiten}=require('../cases/case-visibility');
const events=require('../office/events');
const SHARED=['salutation','title','firstName','lastName','institution','street','house','houseLetter','postal','city','postbox','phoneArea','phoneNumber','phone','mobileArea','mobileNumber','mobile','faxArea','faxNumber','fax','email','iban','bic','bankName','people'];
const FIELDS=[...SHARED,'role','status','fileNumber','processNumber','note','_category'];
let realtime=null;
const fail=(status,message)=>{const e=new Error(message);e.status=status;throw e};
const table=scope=>scope==='office'?'office_contacts':'case_contacts';
function get(scope,caseId,id){if(!['case','office'].includes(scope))fail(400,'Ungültiges Adressbuch.');return scope==='office'?db.prepare('SELECT * FROM office_contacts WHERE id=?').get(id):db.prepare('SELECT * FROM case_contacts WHERE id=? AND case_id=?').get(id,caseId)}
const data=row=>JSON.parse(row.data_json||'{}');
const version=row=>crypto.createHash('sha256').update(row.data_json).digest('hex');
function authorize(session,scope,caseId,write=false){if(scope==='case'&&!(write?darfBearbeiten:darfSehen)(session,caseId))fail(403,'Für diesen Fall fehlt die Berechtigung.');if(!['case','office'].includes(scope))fail(400,'Ungültiges Adressbuch.')}
function rebuildLinks(){db.prepare(`INSERT OR IGNORE INTO addressbook_links(case_contact_id,office_contact_id) SELECT c.id,o.id FROM case_contacts c JOIN office_contacts o ON o.id=json_extract(CASE WHEN json_valid(c.data_json) THEN c.data_json ELSE '{}' END,'$.centralContactId')`).run()}
function centralId(scope,id){rebuildLinks();return scope==='office'?id:db.prepare('SELECT office_contact_id FROM addressbook_links WHERE case_contact_id=?').get(id)?.office_contact_id||''}
function linked(id){rebuildLinks();return db.prepare('SELECT c.* FROM case_contacts c JOIN addressbook_links l ON l.case_contact_id=c.id WHERE l.office_contact_id=?').all(id)}
function record(scope,caseId,id,before,after,session){
 const changes={};for(const k of [...FIELDS,'_standardRecipients','centralContactId'])if(JSON.stringify(before?.[k]??null)!==JSON.stringify(after?.[k]??null))changes[k]={before:before?.[k]??null,after:after?.[k]??null};
 if(Object.keys(changes).length)db.prepare('INSERT INTO addressbook_history VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),scope,caseId||'',id,new Date().toISOString(),String(session?.displayName||session?.username||session?.userId||'System'),JSON.stringify(changes));
}
function notify(scope,caseId,id,next){
 if(scope==='case'&&realtime)realtime.broadcastToCase(caseId,{type:'contact',action:'update',contact:{id,data:next}},null);
 events.emit('officeContacts',{method:'PUT'});
}
function putRow(scope,row,next,session){
 if(next._standardRecipients){next._standardRecipients={...next._standardRecipients};for(const [purpose,id] of Object.entries(next._standardRecipients))if(id&&!(next.people||[]).some(p=>p.id===id))delete next._standardRecipients[purpose];}
 db.prepare(`UPDATE ${table(scope)} SET data_json=?,updated_at=datetime('now'),updated_by=? WHERE id=?`).run(JSON.stringify(next),session?.userId||null,row.id);
 record(scope,row.case_id||'',row.id,data(row),next,session);
}
function validatePatch(patch){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))fail(400,'Ungültige Kontaktdaten.');const out={};
 for(const k of Object.keys(patch)){if(!FIELDS.includes(k))fail(400,'Unbekanntes Kontaktfeld: '+k);if(k==='people'){
  if(!Array.isArray(patch[k])||patch[k].length>100)fail(400,'Ungültige Ansprechpartner.');
  const seen=new Set();out.people=patch.people.map(p=>{const id=String(p.id||crypto.randomUUID());if(seen.has(id))fail(400,'Ansprechpartner doppelt.');seen.add(id);const v={id};for(const f of ['name','department','role','email','phone','fax','salutation'])v[f]=String(p[f]||'').trim().slice(0,1000);if(!v.name)fail(400,'Bitte den Namen des Ansprechpartners angeben.');return v});
 }else{if(typeof patch[k]!=='string')fail(400,'Kontaktfelder müssen Text enthalten.');out[k]=patch[k].trim().slice(0,k==='note'?20000:2000)}}
 return out;
}
function replace(scope,caseId,id,next,session,expected){
 const affected=[];const result=db.transaction(()=>{
  const row=get(scope,caseId,id);if(!row)fail(404,'Kontakt nicht gefunden.');if(expected&&version(row)!==expected)fail(409,'Der Kontakt wurde zwischenzeitlich geändert. Bitte neu laden; Ihre Eingaben bleiben erhalten.');
  const old=data(row),merged={...old,...next};
  const cid=centralId(scope,id),shared={};for(const k of SHARED)if(Object.hasOwn(next,k)&&JSON.stringify(old[k]??null)!==JSON.stringify(next[k]??null))shared[k]=next[k];
  const children=cid?linked(cid):[];
  if(Object.keys(shared).length&&children.some(c=>!darfBearbeiten(session,c.case_id)))fail(403,'Gemeinsame Stammdaten dürfen nur mit Bearbeitungsrecht für alle zugeordneten Fälle geändert werden.');
  putRow(scope,row,merged,session);affected.push([scope,caseId,id,merged]);
  if(cid&&Object.keys(shared).length){
   const central=get('office','',cid);if(central&&!(scope==='office'&&cid===id)){const v={...data(central),...shared};putRow('office',central,v,session);affected.push(['office','',cid,v])}
   for(const child of children){if(scope==='case'&&child.id===id)continue;const v={...data(child),...shared,_pendingWrite:true};putRow('case',child,v,session);affected.push(['case',child.case_id,child.id,v])}
  }
  return get(scope,caseId,id);
 })();for(const args of affected)notify(...args);return result;
}
function details(scope,caseId,id,session){
 authorize(session,scope,caseId);const row=get(scope,caseId,id);if(!row)fail(404,'Kontakt nicht gefunden.');
 const cid=centralId(scope,id),refs=(cid?linked(cid):scope==='case'?[row]:[]).filter(c=>darfSehen(session,c.case_id));
 const associations=refs.map(c=>({caseId:c.case_id,contactId:c.id,label:db.prepare('SELECT label FROM cases WHERE id=?').get(c.case_id)?.label||'',fileNumber:data(c).fileNumber||'',role:data(c).role||'',status:data(c).status||'',standards:data(c)._standardRecipients||{}}));
 const history=db.prepare('SELECT * FROM addressbook_history WHERE scope=? AND contact_id=? ORDER BY at DESC,rowid DESC LIMIT 100').all(scope,id).map(h=>({id:h.id,at:h.at,actor:h.actor,changes:JSON.parse(h.changes_json)}));
 const ids=new Set(refs.map(c=>c.id));ids.add(id);if(cid)ids.add(cid);
 const communications=[];
 for(const c of db.prepare('SELECT id,label FROM cases').all().filter(c=>darfSehen(session,c.id))){
  for(const e of db.prepare('SELECT * FROM case_doku_entries WHERE case_id=? ORDER BY created_at DESC').all(c.id)){
   const d=data(e),link=d.contactLink;
   if(link&&ids.has(String(link.contactId))&&(link.scope==='office'||!link.caseId||link.caseId===c.id))communications.push({id:e.id,caseId:c.id,caseLabel:c.label,date:d.date||e.created_at,title:d.detail||d.type||'Dokumentation',text:d.freeDetail||d.note||'',contactType:d.contactType||'',source:d.source||'',person:link.snapshot?.person||''});
  }
 }
 communications.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 return {contact:{...data(row),id},version:version(row),centralId:cid,associations,history,communications:communications.slice(0,200)};
}
function assign(input,session){
 const {scope,caseId='',id,targetCaseId}=input;authorize(session,scope,caseId,true);authorize(session,'case',targetCaseId,true);
 let cid,result;
 db.transaction(()=>{
  const source=get(scope,caseId,id);if(!source)fail(404,'Kontakt nicht gefunden.');if(!db.prepare('SELECT id FROM cases WHERE id=?').get(targetCaseId))fail(404,'Zielfall nicht gefunden.');
  cid=centralId(scope,id);const s=data(source);
  if(!cid){cid=crypto.randomUUID();const common=Object.fromEntries(SHARED.filter(k=>Object.hasOwn(s,k)).map(k=>[k,s[k]]));common.status='Aktiv';db.prepare('INSERT INTO office_contacts(id,data_json,updated_by) VALUES(?,?,?)').run(cid,JSON.stringify(common),session.userId);record('office','',cid,null,common,session);db.prepare('INSERT INTO addressbook_links VALUES(?,?)').run(id,cid);putRow('case',source,{...s,centralContactId:cid},session)}
  const found=linked(cid).find(c=>c.case_id===targetCaseId);if(found){result=found.id;return}
  result=crypto.randomUUID();const central=data(get('office','',cid));const next={...central,role:String(input.role||s.role||''),status:'Aktiv',fileNumber:String(input.fileNumber||''),processNumber:String(input.processNumber||''),_category:s._category||'soziales',centralContactId:cid,_pendingWrite:true};
  delete next._standardRecipients;delete next.note;delete next.id;delete next.key;delete next._row;
  db.prepare('INSERT INTO case_contacts(id,case_id,data_json,updated_by) VALUES(?,?,?,?)').run(result,targetCaseId,JSON.stringify(next),session.userId);db.prepare('INSERT INTO addressbook_links VALUES(?,?)').run(result,cid);record('case',targetCaseId,result,null,next,session);
 })();notify(scope,caseId,id,data(get(scope,caseId,id)));notify('case',targetCaseId,result,data(get('case',targetCaseId,result)));return details(scope,caseId,id,session);
}
function standard(input,session){
 const {caseId,id,purpose='document',personId='',remove=false}=input;authorize(session,'case',caseId,true);
 if(!['document','mail'].includes(purpose))fail(400,'Unbekannter Empfängerzweck.');
 const affected=[];db.transaction(()=>{
  const selected=get('case',caseId,id);if(!selected)fail(404,'Fallkontakt nicht gefunden.');const p=data(selected).people||[];if(personId&&!p.some(x=>x.id===personId))fail(400,'Ansprechpartner nicht gefunden.');
  for(const row of db.prepare('SELECT * FROM case_contacts WHERE case_id=?').all(caseId)){
   const next=data(row),defaults={...(next._standardRecipients||{})};if(!Object.hasOwn(defaults,purpose)&&row.id!==id)continue;delete defaults[purpose];if(row.id===id&&!remove)defaults[purpose]=personId;next._standardRecipients=defaults;putRow('case',row,next,session);affected.push([row.id,next]);
  }
 })();for(const [contactId,next] of affected)notify('case',caseId,contactId,next);return details('case',caseId,id,session);
}
module.exports={FIELDS,SHARED,get,data,version,authorize,validatePatch,replace,record,notify,details,assign,standard,centralId,linked,setRealtime:r=>{realtime=r},fail};
