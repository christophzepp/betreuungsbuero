'use strict';
// Zentrale Stammdaten mit rückwärtskompatiblen Fallprojektionen: alle bisherigen Excel-/vCard-
// und Dokumentwege lesen weiterhin case_contacts. Referenzen, Status und Rollen bleiben je Fall.
const db=require('../../database'),crypto=require('node:crypto');
const {darfSehen,darfBearbeiten}=require('../cases/case-visibility');
const events=require('../office/events');
const SHARED=['salutation','title','firstName','lastName','institution','street','house','houseLetter','postal','city','country','postbox','phoneArea','phoneNumber','phone','mobileArea','mobileNumber','mobile','faxArea','faxNumber','fax','email','iban','bic','bankName','people','contactWays','addresses','preferredAddressId','preferredChannel','phoneHours','absentFrom','absentUntil','absenceNote','substituteContactId','tags','groups','customFields','imageData','imageKind'];
const FIELDS=[...SHARED,'role','status','fileNumber','processNumber','customerNumber','note','_category'];
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
 if(scope==='case'&&realtime)realtime.broadcastToCase(caseId,{type:'contact',action:next===null?'delete':'update',contact:next===null?{id}:{id,data:next}},null);
 events.emit('officeContacts',{method:'PUT'});
}
function putRow(scope,row,next,session){
 if(next.people)next.people=next.people.map(p=>p.substitutePersonId&&!next.people.some(x=>x.id===p.substitutePersonId)?{...p,substitutePersonId:''}:p);
 if(next._standardRecipients){next._standardRecipients={...next._standardRecipients};for(const [purpose,id] of Object.entries(next._standardRecipients))if(id&&!(next.people||[]).some(p=>p.id===id))delete next._standardRecipients[purpose];}
 db.prepare(`UPDATE ${table(scope)} SET data_json=?,updated_at=datetime('now'),updated_by=? WHERE id=?`).run(JSON.stringify(next),session?.userId||null,row.id);
 record(scope,row.case_id||'',row.id,data(row),next,session);
}
function validatePatch(patch){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))fail(400,'Ungültige Kontaktdaten.');const out={};
 for(const k of Object.keys(patch)){if(!FIELDS.includes(k))fail(400,'Unbekanntes Kontaktfeld: '+k);if(['tags','groups','customFields','imageData','imageKind'].includes(k)){try{Object.assign(out,require('../../../frontend/addressbook-extras-data').clean({[k]:patch[k]}))}catch(e){fail(400,e.message)}}else if(k==='contactWays'){try{out.contactWays=require('../../../frontend/addressbook-contact-tools').ways(patch[k])}catch(e){fail(400,e.message)}}else if(k==='addresses'){out.addresses=require('./addressbook-fields').addresses(patch[k]);
 }else if(k==='people'){
  if(!Array.isArray(patch[k])||patch[k].length>100)fail(400,'Ungültige Ansprechpartner.');
  const seen=new Set();out.people=patch.people.map(p=>{if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'Ungültiger Ansprechpartner.');const id=String(p.id||crypto.randomUUID());if(seen.has(id))fail(400,'Ansprechpartner doppelt.');seen.add(id);const v={id};for(const f of ['name','department','role','email','phone','fax','salutation'])v[f]=String(p[f]||'').trim().slice(0,1000);for(const f of ['preferredChannel','phoneHours','absentFrom','absentUntil','absenceNote','substitutePersonId'])if(Object.hasOwn(p,f))v[f]=String(p[f]||'').trim().slice(0,1000);if(Object.hasOwn(p,'contactWays')){try{v.contactWays=require('../../../frontend/addressbook-contact-tools').ways(p.contactWays);for(const w of v.contactWays)if(w.preferred&&['email','phone','mobile','fax'].includes(w.type)&&!v[w.type])v[w.type]=w.value}catch(e){fail(400,e.message)}}require('./addressbook-fields').validate(v);if(!v.name)fail(400,'Bitte den Namen des Ansprechpartners angeben.');return v});
 }else{if(typeof patch[k]!=='string')fail(400,'Kontaktfelder müssen Text enthalten.');out[k]=patch[k].trim().slice(0,k==='note'?20000:2000)}}
 require('./addressbook-fields').validate(out);return out;
}
function replace(scope,caseId,id,next,session,expected,effects){
 const affected=[];const result=db.transaction(()=>{
  const row=get(scope,caseId,id);if(!row)fail(404,'Kontakt nicht gefunden.');if(expected&&version(row)!==expected)fail(409,'Der Kontakt wurde zwischenzeitlich geändert. Bitte neu laden; Ihre Eingaben bleiben erhalten.');
  const old=data(row);if((!Object.hasOwn(next,'contactWays')||JSON.stringify(next.contactWays)===JSON.stringify(old.contactWays))&&old.contactWays?.some(w=>w.preferred&&Object.hasOwn(next,w.type)&&next[w.type]!==old[w.type]))next={...next,contactWays:old.contactWays.flatMap(w=>w.preferred&&Object.hasOwn(next,w.type)?next[w.type]?[{...w,value:next[w.type]}]:[]:[w])};if(Object.hasOwn(next,'contactWays')){try{next={...next,...Object.fromEntries(Object.entries(require('../../../frontend/addressbook-contact-tools').withWays({...old,...next},old)).filter(([k,v])=>JSON.stringify(old[k])!==JSON.stringify(v)))}}catch(e){fail(400,e.message)}}if(next.people)next={...next,people:next.people.map(p=>require('../../../frontend/addressbook-contact-tools').withWays(p,(old.people||[]).find(x=>x.id===p.id)||{}))};const merged={...old,...next};require('./addressbook-fields').validate(merged);if(merged.preferredAddressId&&!(merged.addresses||[]).some(a=>a.id===merged.preferredAddressId))fail(400,'Die bevorzugte Anschrift fehlt.');if(next.substituteContactId){if(next.substituteContactId===id||next.substituteContactId===centralId(scope,id))fail(400,'Ein Kontakt kann sich nicht selbst vertreten.');if(!get('office','',next.substituteContactId))fail(400,'Bitte eine vorhandene zentrale Vertretung auswählen.');}
  const cid=centralId(scope,id),shared={};for(const k of SHARED)if(Object.hasOwn(next,k)&&JSON.stringify(old[k]??null)!==JSON.stringify(next[k]??null))shared[k]=next[k];
  const children=cid?linked(cid):[];
  if(Object.keys(shared).length&&children.some(c=>!darfBearbeiten(session,c.case_id)))fail(403,'Gemeinsame Stammdaten dürfen nur mit Bearbeitungsrecht für alle zugeordneten Fälle geändert werden.');
  putRow(scope,row,merged,session);affected.push([scope,caseId,id,merged]);
  if(cid&&Object.keys(shared).length){
   const central=get('office','',cid);if(central&&!(scope==='office'&&cid===id)){const v={...data(central),...shared};putRow('office',central,v,session);affected.push(['office','',cid,v])}
   for(const child of children){if(scope==='case'&&child.id===id)continue;const v={...data(child),...shared,_pendingWrite:true};putRow('case',child,v,session);affected.push(['case',child.case_id,child.id,v])}
  }
  return get(scope,caseId,id);
 })();if(effects)effects.push(...affected);else for(const args of affected)notify(...args);return result;
}
function personVersion(p){return p?crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex'):''}
function savePerson(input,session){
 const {scope,caseId='',id,personId,baseVersion,patch,remove=false}=input;authorize(session,scope,caseId,true);
 if(typeof personId!=='string'||!personId||personId.length>128||typeof baseVersion!=='string')fail(400,'Ansprechpartner und Ausgangsversion fehlen.');
 const effects=[];
 db.transaction(()=>{
  const row=get(scope,caseId,id);if(!row)fail(404,'Kontakt nicht gefunden.');const people=[...(data(row).people||[])],index=people.findIndex(p=>p.id===personId),current=people[index];
  const next=remove?null:validatePatch({people:[{...patch,id:personId}]}).people[0];
  if(next?.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email))fail(400,'Bitte eine gültige E-Mail-Adresse angeben.');
  // Wiederholte Zustellung nach verlorener Antwort ist ohne zweiten Eintrag erfolgreich.
  if(remove&&!current)return;if(next&&JSON.stringify(next)===JSON.stringify(current))return;
  if(personVersion(current)!==baseVersion)fail(409,'Dieser Ansprechpartner wurde zwischenzeitlich geändert. Bitte den aktuellen Stand prüfen; Ihre Eingaben bleiben erhalten.');
  if(remove)people.splice(index,1);else if(index>=0)people[index]=next;else people.push(next);
  replace(scope,caseId,id,{people},session,version(row),effects);
 })();for(const args of effects)notify(...args);return details(scope,caseId,id,session);
}
function details(scope,caseId,id,session){
 authorize(session,scope,caseId);const row=get(scope,caseId,id);if(!row)fail(404,'Kontakt nicht gefunden.');
 const cid=centralId(scope,id),refs=(cid?linked(cid):scope==='case'?[row]:[]).filter(c=>darfSehen(session,c.case_id));
 const associations=refs.map(c=>({caseId:c.case_id,contactId:c.id,label:db.prepare('SELECT label FROM cases WHERE id=?').get(c.case_id)?.label||'',fileNumber:data(c).fileNumber||'',processNumber:data(c).processNumber||'',customerNumber:data(c).customerNumber||'',version:version(c),role:data(c).role||'',status:data(c).status||'',standards:data(c)._standardRecipients||{}}));
 const history=historyPage(scope,caseId,id,session),communications=communicationPage(scope,caseId,id,session,undefined,refs,cid);
 return {contact:{...data(row),id},version:version(row),personVersions:Object.fromEntries((data(row).people||[]).map(p=>[p.id,personVersion(p)])),centralId:cid,associations,history:history.items,communications:communications.items,historyCursor:history.nextCursor,communicationCursor:communications.nextCursor};
}
function cursorValues(cursor){if(!cursor)return null;try{const v=JSON.parse(Buffer.from(cursor,'base64url').toString());if(Array.isArray(v)&&v.length===2&&v.every(x=>typeof x==='string'))return v}catch(_e){}fail(400,'Ungültige Fortsetzung. Bitte die Ansicht neu laden.')}
const encodeCursor=(a,b)=>Buffer.from(JSON.stringify([String(a),String(b)])).toString('base64url');
function historyPage(scope,caseId,id,session,cursor){
 authorize(session,scope,caseId);if(!get(scope,caseId,id))fail(404,'Kontakt nicht gefunden.');const c=cursorValues(cursor);
 const rows=db.prepare(`SELECT rowid seq,* FROM addressbook_history WHERE scope=? AND case_id=? AND contact_id=? ${c?'AND (at < ? OR (at = ? AND rowid < ?))':''} ORDER BY at DESC,rowid DESC LIMIT 101`).all(scope,caseId||'',id,...(c?[c[0],c[0],c[1]]:[]));
 const page=rows.slice(0,100),last=page.at(-1);return {items:page.map(h=>({id:h.id,at:h.at,actor:h.actor,changes:JSON.parse(h.changes_json)})),nextCursor:rows.length>100?encodeCursor(last.at,last.seq):null};
}
function communicationPage(scope,caseId,id,session,cursor,refs,cid){
 authorize(session,scope,caseId);const row=get(scope,caseId,id);if(!row)fail(404,'Kontakt nicht gefunden.');
 if(!refs){cid=centralId(scope,id);refs=(cid?linked(cid):scope==='case'?[row]:[]).filter(c=>darfSehen(session,c.case_id))}
 const contactRefs=new Set(refs.map(c=>JSON.stringify(['case',c.case_id,c.id])));contactRefs.add(JSON.stringify([scope,caseId||'',id]));if(cid)contactRefs.add(JSON.stringify(['office','',cid]));
 // Merge-Aliasse gehören stets zum ursprünglichen Fall, nie zu gleichlautenden Büro-IDs.
 const merges=db.prepare('SELECT case_id,data_json FROM addressbook_merges WHERE undone_at IS NULL').all().filter(m=>darfSehen(session,m.case_id));
 let expanded;do{expanded=false;for(const m of merges){const r=JSON.parse(m.data_json).record;if(contactRefs.has(JSON.stringify(['case',m.case_id,r.survivorId])))for(const x of r.removed){const key=JSON.stringify(['case',m.case_id,x.id]);if(!contactRefs.has(key)){contactRefs.add(key);expanded=true}}}}while(expanded);
 const ids=new Set([...contactRefs].map(key=>JSON.parse(key)[2]));
 return require('./addressbook-communications').page({scope,caseId,id,session,cursor,ids,contactRefs,contact:data(row)});
}

function assign(input,session){
 const {scope,caseId='',id,targetCaseId}=input;authorize(session,scope,caseId,true);authorize(session,'case',targetCaseId,true);
 let cid,result;const effects=[];
 db.transaction(()=>{
  const source=get(scope,caseId,id);if(!source)fail(404,'Kontakt nicht gefunden.');if(!db.prepare('SELECT id FROM cases WHERE id=?').get(targetCaseId))fail(404,'Zielfall nicht gefunden.');
  cid=centralId(scope,id);const s=data(source);
  if(!cid){cid=crypto.randomUUID();const common=Object.fromEntries(SHARED.filter(k=>Object.hasOwn(s,k)).map(k=>[k,s[k]]));common.status='Aktiv';db.prepare('INSERT INTO office_contacts(id,data_json,updated_by) VALUES(?,?,?)').run(cid,JSON.stringify(common),session.userId);record('office','',cid,null,common,session);db.prepare('INSERT INTO addressbook_links VALUES(?,?)').run(id,cid);db.prepare("UPDATE addressbook_sync_bindings SET scope='office',case_id='',contact_id=?,version=version+1 WHERE scope='case' AND case_id=? AND contact_id=?").run(cid,caseId,id);putRow('case',source,{...s,centralContactId:cid},session);require('./addressbook-organizer').promote(caseId,id,cid)}
  const found=linked(cid).find(c=>c.case_id===targetCaseId);if(found){result=found.id;
   if(input.assignmentId){if(input.assignmentId!==found.id)fail(409,'Dieser Kontakt ist dem Fall bereits zugeordnet. Bitte die vorhandene Zuordnung bearbeiten.');const patch=validatePatch({role:String(input.role||''),fileNumber:String(input.fileNumber||''),processNumber:String(input.processNumber||''),customerNumber:String(input.customerNumber||'')});if(Object.keys(patch).some(k=>patch[k]!==String(data(found)[k]||''))){if(!input.targetVersion)fail(409,'Die Zuordnung wurde bereits gespeichert. Bitte den aktuellen Stand prüfen.');replace('case',targetCaseId,found.id,patch,session,input.targetVersion,effects)}}return}
  if(input.assignmentId&&(typeof input.assignmentId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(input.assignmentId)))fail(400,'Ungültige Zuordnungs-ID.');
  result=input.assignmentId||crypto.randomUUID();if(db.prepare('SELECT 1 FROM case_contacts WHERE id=?').get(result))fail(409,'Die Zuordnungs-ID ist bereits belegt. Bitte die Zuordnung neu öffnen.');const central=data(get('office','',cid)),assignment=validatePatch({role:String(input.role??s.role??''),fileNumber:String(input.fileNumber||''),processNumber:String(input.processNumber||''),customerNumber:String(input.customerNumber||'')});const next={...central,...assignment,status:'Aktiv',_category:s._category||'soziales',centralContactId:cid,_pendingWrite:true};
  delete next._standardRecipients;delete next.note;delete next.id;delete next.key;delete next._row;
  db.prepare('INSERT INTO case_contacts(id,case_id,data_json,updated_by) VALUES(?,?,?,?)').run(result,targetCaseId,JSON.stringify(next),session.userId);db.prepare('INSERT INTO addressbook_links VALUES(?,?)').run(result,cid);record('case',targetCaseId,result,null,next,session);
 })();for(const a of effects)notify(...a);notify(scope,caseId,id,data(get(scope,caseId,id)));notify('case',targetCaseId,result,data(get('case',targetCaseId,result)));return {...details(scope,caseId,id,session),assignment:{caseId:targetCaseId,contactId:result,version:version(get('case',targetCaseId,result))}};
}
function standard(input,session){
 const {caseId,id,purpose='document',personId='',remove=false}=input;authorize(session,'case',caseId,true);
 if(!require('./addressbook-fields').validPurpose(purpose))fail(400,'Unbekannter Empfängerzweck.');
 const affected=[];db.transaction(()=>{
  const selected=get('case',caseId,id);if(!selected)fail(404,'Fallkontakt nicht gefunden.');const p=data(selected).people||[];if(personId&&!p.some(x=>x.id===personId))fail(400,'Ansprechpartner nicht gefunden.');
  for(const row of db.prepare('SELECT * FROM case_contacts WHERE case_id=?').all(caseId)){
   const next=data(row),defaults={...(next._standardRecipients||{})};if(remove&&row.id!==id)continue;if(!Object.hasOwn(defaults,purpose)&&row.id!==id)continue;delete defaults[purpose];if(row.id===id&&!remove)defaults[purpose]=personId;next._standardRecipients=defaults;putRow('case',row,next,session);affected.push([row.id,next]);
  }
 })();for(const [contactId,next] of affected)notify('case',caseId,contactId,next);return details('case',caseId,id,session);
}
function notifyDoku(caseId,id,data,session,action='create'){if(realtime)realtime.broadcastToCase(caseId,{type:'doku-entry',action,entry:{id,data},updatedBy:session.displayName},null)}
module.exports={notifyDoku,FIELDS,SHARED,personVersion,savePerson,historyPage,communicationPage,get,data,version,authorize,validatePatch,replace,record,notify,details,assign,standard,centralId,linked,setRealtime:r=>{realtime=r},fail};
