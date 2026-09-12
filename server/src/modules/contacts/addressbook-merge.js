'use strict';
// Zusammenführen/Trennen sind jeweils eine SQLite-Transaktion. Der Server verwahrt
// Originalzeilen und Versionen; verlorene HTTP-Antworten dürfen keine zweite Mutation auslösen.
const db=require('../../database'),crypto=require('node:crypto'),A=require('./addressbook');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const empty=v=>v==null||v===''||(Array.isArray(v)&&!v.length);
const clean=d=>Object.fromEntries(Object.entries(d).filter(([k])=>!['id','key','_row','_pendingWrite','__merged','__mergedInto'].includes(k)));
const read=(caseId,id)=>A.get('case',caseId,id);
function result(caseId,session){A.authorize(session,'case',caseId);const rows=db.prepare('SELECT * FROM case_contacts WHERE case_id=? ORDER BY created_at,id').all(caseId);return {contacts:rows.map(r=>({...A.data(r),id:r.id})),versions:Object.fromEntries(rows.map(r=>[r.id,A.version(r)])),merges:db.prepare('SELECT data_json FROM addressbook_merges WHERE case_id=? AND undone_at IS NULL ORDER BY created_at,id').all(caseId).map(r=>JSON.parse(r.data_json).record)}}
function notify(effects){for(const a of effects)A.notify(...a)}
function snapshots(scope,caseId,id){const row=A.get(scope,caseId,id),cid=A.centralId(scope,id),rows=[{scope,row}];if(cid){const office=A.get('office','',cid);if(scope!=='office'&&office)rows.push({scope:'office',row:office});for(const r of A.linked(cid))if(r.id!==id)rows.push({scope:'case',row:r})}return rows}
function merge(input,session){
 const {caseId,operationId,groups}=input;A.authorize(session,'case',caseId,true);
 if(typeof operationId!=='string'||!operationId.match(/^[a-zA-Z0-9_-]{1,100}$/)||!Array.isArray(groups)||!groups.length||groups.length>200)A.fail(400,'Ungültige Zusammenführung.');
 const signature=hash(groups.map(g=>({ids:g.ids,survivorId:g.survivorId}))),effects=[];
 db.transaction(()=>{
  const previous=db.prepare('SELECT data_json FROM addressbook_merges WHERE case_id=? AND operation_id=?').all(caseId,operationId);
  if(previous.length){if(JSON.parse(previous[0].data_json).signature!==signature)A.fail(409,'Diese Zusammenführung hat eine andere Auswahl.');return}
  const seen=new Set();
  for(const [index,g] of groups.entries()){
   if(!Array.isArray(g.ids)||g.ids.length<2||g.ids.length>500||!g.ids.includes(g.survivorId))A.fail(400,'Mindestens zwei Kontakte und ein verbleibender Kontakt sind erforderlich.');
   const rows=g.ids.map(id=>{if(seen.has(id))A.fail(400,'Kontakt mehrfach in der Auswahl.');seen.add(id);const r=read(caseId,id);if(!r)A.fail(409,'Ein ausgewählter Kontakt fehlt. Bitte die Liste neu laden.');if(!g.versions?.[id]||g.versions[id]!==A.version(r))A.fail(409,'Ein ausgewählter Kontakt wurde geändert. Bitte die Auswahl erneut prüfen.');return r});
   const central=rows.filter(r=>A.centralId('case',r.id));if(central.length>1||central.some(r=>r.id!==g.survivorId))A.fail(409,'Zentrale Zuordnungen vor dem Zusammenführen lösen; ein einzelner zentraler Kontakt muss erhalten bleiben.');
   const survivor=rows.find(r=>r.id===g.survivorId),others=rows.filter(r=>r!==survivor),before=snapshots('case',caseId,survivor.id),merged=clean(A.data(survivor));
   for(const r of others){const d=clean(A.data(r));for(const [k,v] of Object.entries(d))if(empty(merged[k])&&!empty(v))merged[k]=v;
    if(String(d.status||'').toLowerCase()==='aktiv')merged.status='Aktiv';
    if(Array.isArray(d.caseRefs))merged.caseRefs=[...new Set([...(merged.caseRefs||[]),...d.caseRefs])];
    for(const k of ['note','notes'])if(d[k]&&d[k]!==merged[k])merged[k]=[merged[k],d[k]].filter(Boolean).join('\n');
    for(const k of ['tags','groups'])if(d[k]?.length)merged[k]=require('../../../frontend/addressbook-extras-data').labels([...(merged[k]||[]),...d[k]]);
    for(const k of ['customFields','contactWays']){const map=new Map((merged[k]||[]).map(x=>[x.id,x]));for(const x of d[k]||[]){if(map.has(x.id)&&hash(map.get(x.id))!==hash(x))A.fail(409,'Eine Kennung in '+k+' enthält unterschiedliche Angaben. Bitte vor dem Zusammenführen prüfen.');const value={...x};if(k==='contactWays'&&value.preferred&&[...map.values()].some(w=>w.id!==value.id&&w.type===value.type&&w.preferred))value.preferred=false;map.set(x.id,value)}if(map.size)merged[k]=[...map.values()]}
    const addresses=new Map((merged.addresses||[]).map(a=>[a.id,a]));for(const a of d.addresses||[]){if(addresses.has(a.id)&&hash(addresses.get(a.id))!==hash(a))A.fail(409,'Eine Anschriften-ID enthält unterschiedliche Angaben. Bitte vor der Zusammenführung prüfen.');addresses.set(a.id,a)}if(addresses.size>30)A.fail(400,'Höchstens 30 Anschriften sind möglich.');if(addresses.size)merged.addresses=[...addresses.values()];
    const people=new Map((merged.people||[]).map(p=>[p.id,p]));for(const p of d.people||[]){if(people.has(p.id)&&hash(people.get(p.id))!==hash(p))A.fail(409,'Gleich benannte Ansprechpartner-IDs enthalten unterschiedliche Daten. Bitte vor dem Zusammenführen prüfen.');people.set(p.id,p)}if(people.size>100)A.fail(400,'Ein Kontakt kann höchstens 100 Ansprechpartner enthalten. Bitte die Auswahl verkleinern.');if(people.size)merged.people=[...people.values()];
   }
   A.replace('case',caseId,survivor.id,merged,session,A.version(survivor),effects);
   for(const r of others){require('./addressbook-organizer').mergeUsage(caseId,r.id,survivor.id);db.prepare("UPDATE addressbook_sync_bindings SET enabled=0,status='paused',error='Kontakt zusammengeführt. Nach dem Trennen bei Bedarf wieder aktivieren.',version=version+1 WHERE scope='case' AND case_id=? AND contact_id=?").run(caseId,r.id);db.prepare('DELETE FROM case_contacts WHERE id=? AND case_id=?').run(r.id,caseId);effects.push(['case',caseId,r.id,null])}
   const id=operationId+'_'+index,record={id,_serverMerge:true,at:new Date().toISOString(),survivorId:survivor.id,survivorLabel:merged.institution||[merged.firstName,merged.lastName].filter(Boolean).join(' '),survivorBefore:clean(A.data(survivor)),removed:others.map(r=>({...A.data(r),id:r.id}))};
   const payload={caseId,signature,record,before,removedRows:others,after:before.map(x=>({scope:x.scope,caseId:x.row.case_id||'',id:x.row.id,version:A.version(A.get(x.scope,x.row.case_id||'',x.row.id))}))};
   db.prepare('INSERT INTO addressbook_merges(id,case_id,operation_id,data_json) VALUES(?,?,?,?)').run(id,caseId,operationId,JSON.stringify(payload));
  }
 })();notify(effects);return result(caseId,session);
}
function insertRow(row){const columns=db.prepare('PRAGMA table_info(case_contacts)').all().map(c=>c.name).filter(k=>Object.hasOwn(row,k));db.prepare(`INSERT INTO case_contacts (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(k=>row[k]));const cid=A.data(row).centralContactId;if(cid){if(!A.get('office','',cid))A.fail(409,'Die ursprüngliche zentrale Zuordnung fehlt.');db.prepare('INSERT INTO addressbook_links VALUES(?,?)').run(row.id,cid)}}
function unmerge(input,session){
 const {caseId,id,legacy,versions={}}=input;A.authorize(session,'case',caseId,true);const effects=[];
 db.transaction(()=>{
  const saved=db.prepare('SELECT * FROM addressbook_merges WHERE id=? AND case_id=?').get(id,caseId);
  if(saved?.undone_at)return;
  if(!saved){
   // Altbestände besitzen noch keinen Server-Snapshot. Auch ihre Wiederherstellung
   // erfolgt vollständig atomar und überschreibt keinen inzwischen vorhandenen Kontakt.
   if(!legacy||legacy.id!==id||legacy._serverMerge||!Array.isArray(legacy.removed)||legacy.removed.length>500)A.fail(404,'Zusammenführung nicht gefunden.');
   const row=read(caseId,legacy.survivorId);if(!row||versions[row.id]!==A.version(row))A.fail(409,'Verbleibender Kontakt wurde geändert. Bitte neu laden.');
   const original=clean(legacy.survivorBefore||{}),current=A.data(row);
   if(!original.institution&&!original.lastName)A.fail(400,'Die ursprünglichen Kontaktdaten fehlen.');
   if((original.centralContactId||'')!==(A.centralId('case',row.id)||''))A.fail(409,'Die zentrale Zuordnung wurde geändert. Bitte vor dem Trennen prüfen.');
   const patch={...original};for(const k of A.FIELDS)if(Object.hasOwn(current,k)&&!Object.hasOwn(original,k))patch[k]=['people','addresses','contactWays','tags','groups','customFields'].includes(k)?[]:'';
   A.replace('case',caseId,row.id,patch,session,versions[row.id],effects);
   // Anders als ein normales Bearbeiten entfernt Trennen auch nachträglich ergänzte Felder.
   db.prepare('UPDATE case_contacts SET data_json=? WHERE id=?').run(JSON.stringify(original),row.id);effects.push(['case',caseId,row.id,original]);
   for(const d of legacy.removed){if(typeof d.id!=='string'||!d.id||db.prepare('SELECT 1 FROM case_contacts WHERE id=?').get(d.id))A.fail(409,'Eine ursprüngliche Kontakt-ID ist bereits belegt.');insertRow({id:d.id,case_id:caseId,data_json:JSON.stringify(clean(d)),updated_by:session.userId});effects.push(['case',caseId,d.id,clean(d)])}
   db.prepare('INSERT INTO addressbook_merges(id,case_id,operation_id,data_json,undone_at) VALUES(?,?,?,?,datetime(\'now\'))').run(id,caseId,id,JSON.stringify({record:legacy}));return;
  }
  const p=JSON.parse(saved.data_json);
  if(p.caseId!==caseId)A.fail(409,'Diese Zusammenführung stammt aus einem anderen Fall. Sie kann nach dem Import nicht hier getrennt werden.');
  for(const a of p.after){A.authorize(session,a.scope,a.caseId,true);const row=A.get(a.scope,a.caseId,a.id);if(!row||A.version(row)!==a.version)A.fail(409,'Seit der Zusammenführung wurden Kontakte geändert. Trennen würde neuere Daten überschreiben und wurde deshalb nicht ausgeführt.');}
  for(const r of p.removedRows)if(db.prepare('SELECT 1 FROM case_contacts WHERE id=?').get(r.id))A.fail(409,'Eine ursprüngliche Kontakt-ID ist inzwischen belegt.');
  for(const x of p.before){const current=A.get(x.scope,x.row.case_id||'',x.row.id),d=A.data(x.row);db.prepare(`UPDATE ${x.scope==='office'?'office_contacts':'case_contacts'} SET data_json=?,updated_at=datetime('now'),updated_by=? WHERE id=?`).run(x.row.data_json,session.userId,x.row.id);A.record(x.scope,x.row.case_id||'',x.row.id,A.data(current),d,session);effects.push([x.scope,x.row.case_id||'',x.row.id,d])}
  for(const row of p.removedRows){insertRow(row);effects.push(['case',caseId,row.id,A.data(row)])}
  db.prepare("UPDATE addressbook_merges SET undone_at=datetime('now') WHERE id=?").run(id);
 })();notify(effects);return result(caseId,session);
}
module.exports={merge,unmerge,result};
