'use strict';
const db=require('../../database'),A=require('./addressbook'),D=require('../../../frontend/addressbook-extras-data'),T=require('../../../frontend/addressbook-contact-tools');
function canRead(scope,caseId,s){try{A.authorize(s,scope,caseId);return true}catch(_){return false}}
function target(b,s){const scope=b.scope,caseId=b.caseId||'';A.authorize(s,scope,caseId);if(!A.get(scope,caseId,b.id))A.fail(404,'Kontakt nicht gefunden.');const id=A.centralId(scope,b.id);return id?{scope:'office',caseId:'',id}:{scope,caseId,id:b.id}}
function preferences(s){return {
 personal:db.prepare('SELECT scope,case_id caseId,contact_id id,favorite,last_used_at lastUsedAt FROM addressbook_preferences WHERE user_id=?').all(s.userId).filter(r=>canRead(r.scope,r.caseId,s)&&A.get(r.scope,r.caseId,r.id)),
 cases:db.prepare('SELECT case_id caseId,contact_id id FROM addressbook_case_favorites').all().filter(r=>canRead('case',r.caseId,s)&&A.get('case',r.caseId,r.id))
}}
function save(b,s){
 if(!s.userId)A.fail(401,'Bitte anmelden.');
 if(!['favorite','used','caseFavorite'].includes(b.action))A.fail(400,'Ungültige Favoritenaktion.');
 const r=target(b,s);if(b.action!=='used'&&typeof b.value!=='boolean')A.fail(400,'Bitte den gewünschten Zustand angeben.');
 if(b.action==='caseFavorite'){
  if(b.scope!=='case')A.fail(400,'Bitte den Kontakt in einem Fall auswählen.');
  if(!s.isAdmin&&!s.canEditCases)A.fail(403,'Bearbeitungsrecht fehlt.');A.authorize(s,'case',b.caseId,true);
  if(b.value)db.prepare('INSERT INTO addressbook_case_favorites VALUES(?,?,?) ON CONFLICT(case_id,contact_id) DO NOTHING').run(b.caseId,b.id,s.userId);
  else db.prepare('DELETE FROM addressbook_case_favorites WHERE case_id=? AND contact_id=?').run(b.caseId,b.id);
 }else db.transaction(()=>{
  const old=db.prepare('SELECT * FROM addressbook_preferences WHERE user_id=? AND scope=? AND case_id=? AND contact_id=?').get(s.userId,r.scope,r.caseId,r.id);
  db.prepare('INSERT INTO addressbook_preferences VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,scope,case_id,contact_id) DO UPDATE SET favorite=excluded.favorite,last_used_at=excluded.last_used_at').run(s.userId,r.scope,r.caseId,r.id,b.action==='favorite'?Number(b.value):old?.favorite||0,b.action==='used'?new Date().toISOString():old?.last_used_at||'');
  // Nur die letzten 100 Verwendungen behalten; Favoriten bleiben unabhängig davon bestehen.
  db.prepare("UPDATE addressbook_preferences SET last_used_at='' WHERE user_id=? AND rowid NOT IN (SELECT rowid FROM addressbook_preferences WHERE user_id=? AND last_used_at!='' ORDER BY last_used_at DESC,rowid DESC LIMIT 100)").run(s.userId,s.userId);
  db.prepare("DELETE FROM addressbook_preferences WHERE user_id=? AND favorite=0 AND last_used_at=''").run(s.userId);
 })();
 return preferences(s);
}
function clearRecent(s){db.transaction(()=>{db.prepare("UPDATE addressbook_preferences SET last_used_at='' WHERE user_id=?").run(s.userId);db.prepare('DELETE FROM addressbook_preferences WHERE user_id=? AND favorite=0').run(s.userId)})();return preferences(s)}
function quality(b,s){
 A.centralId('office',''); // Vorhandenen Verknüpfungsindex einmal vor dem Gesamtlauf aktualisieren.
 const records=[...db.prepare('SELECT id,data_json FROM office_contacts').all().map(r=>({...r,scope:'office',caseId:''})),...db.prepare('SELECT c.id,c.case_id,c.data_json FROM case_contacts c LEFT JOIN addressbook_links l ON l.case_contact_id=c.id WHERE l.case_contact_id IS NULL').all().filter(r=>canRead('case',r.case_id,s)).map(r=>({...r,scope:'case',caseId:r.case_id}))];
 const counts={},items=[];for(const r of records){const c=A.data(r),issues=D.quality(c);for(const issue of issues)counts[issue.code]=(counts[issue.code]||0)+1;if(issues.length)items.push({scope:r.scope,caseId:r.caseId,id:r.id,label:T.title(c),issues})}
 const query=String(b.query||'').toLocaleLowerCase('de'),filtered=items.filter(r=>(!b.issue||r.issues.some(i=>i.code===b.issue))&&(!query||r.label.toLocaleLowerCase('de').includes(query))).sort((a,b)=>a.label.localeCompare(b.label,'de')||a.id.localeCompare(b.id));
 const offset=Math.max(0,parseInt(b.offset,10)||0);return {totalContacts:records.length,affected:items.length,counts,total:filtered.length,items:filtered.slice(offset,offset+100),nextOffset:filtered.length>offset+100?offset+100:null};
}
function promote(caseId,id,centralId){
 for(const p of db.prepare("SELECT * FROM addressbook_preferences WHERE scope='case' AND case_id=? AND contact_id=?").all(caseId,id)){
  db.prepare("INSERT INTO addressbook_preferences VALUES(?,'office','',?,?,?) ON CONFLICT(user_id,scope,case_id,contact_id) DO UPDATE SET favorite=max(favorite,excluded.favorite),last_used_at=max(last_used_at,excluded.last_used_at)").run(p.user_id,centralId,p.favorite,p.last_used_at);
 }
 db.prepare("DELETE FROM addressbook_preferences WHERE scope='case' AND case_id=? AND contact_id=?").run(caseId,id);
}
function mergeUsage(caseId,fromId,survivorId){
 const central=A.centralId('case',survivorId),scope=central?'office':'case',targetCase=central?'':caseId,id=central||survivorId;
 for(const p of db.prepare("SELECT * FROM addressbook_preferences WHERE scope='case' AND case_id=? AND contact_id=?").all(caseId,fromId))db.prepare('INSERT INTO addressbook_preferences VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,scope,case_id,contact_id) DO UPDATE SET favorite=max(favorite,excluded.favorite),last_used_at=max(last_used_at,excluded.last_used_at)').run(p.user_id,scope,targetCase,id,p.favorite,p.last_used_at);
 const favorite=db.prepare('SELECT * FROM addressbook_case_favorites WHERE case_id=? AND contact_id=?').get(caseId,fromId);if(favorite)db.prepare('INSERT OR IGNORE INTO addressbook_case_favorites VALUES(?,?,?)').run(caseId,survivorId,favorite.actor_id);
 // Originalmarkierungen bleiben für das bestehende Trennen einer Zusammenführung erhalten.
}
module.exports={preferences,save,clearRecent,quality,promote,mergeUsage};
