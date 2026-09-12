'use strict';
// Explicit per-contact opt-in; the existing account connections and timer are reused.
const db=require('../../database'),crypto=require('node:crypto'),A=require('./addressbook');
const provider=require('./addressbook-sync-provider'),old=require('./sync');
const json=s=>JSON.parse(s||'{}'),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const get=id=>db.prepare('SELECT * FROM addressbook_sync_bindings WHERE id=?').get(id);
function sessionFor(id){const u=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!u?.active)A.fail(403,'Das Benutzerkonto ist nicht mehr aktiv.');if(!u.allow_online)A.fail(403,'Der Online-Zugriff dieses Benutzerkontos ist deaktiviert.');const p=require('../../middleware/authorization').parseUserPermissions(u).online;return {userId:u.id,isAdmin:!!u.is_admin,canViewCases:!!p.viewCases,canEditCases:!!p.editCases,canViewAllCases:!!p.viewAllCases,displayName:u.display_name||u.username}}
function target(input,session,write=false){
 if(!session?.userId||(!session.isAdmin&&!(write?session.canEditCases:session.canViewCases)))A.fail(403,'Die Berechtigung für das Adressbuch fehlt.');
 A.authorize(session,input.scope,input.caseId||'',write);if(!A.get(input.scope,input.caseId||'',input.id))A.fail(404,'Kontakt nicht gefunden.');
 const central=A.centralId(input.scope,input.id),r=central?{scope:'office',caseId:'',id:central}:{scope:input.scope,caseId:input.caseId||'',id:input.id};
 // A shared contact must not export data on behalf of cases the activating user cannot edit.
 if(write&&central)for(const child of A.linked(central))A.authorize(session,'case',child.case_id,true);return r;
}
function allowed(c,s){return c&&(c.owner_user_id==null||Number(c.owner_user_id)===Number(s.userId)||s.isAdmin)}
function books(c){const rows=db.prepare("SELECT * FROM connection_calendars WHERE connection_id=? AND kind='contact' ORDER BY position,name").all(c.id);return rows.length?rows:old.listSelectedAddressbooks(c.id)}
function connection(id,ref,s){const c=db.prepare('SELECT * FROM calendar_connections WHERE id=?').get(id);if(!allowed(c,s)||!c.enabled||!['google','microsoft','nextcloud','icloud'].includes(c.provider))A.fail(403,'Diese Kontaktverbindung ist nicht verfügbar.');if(!books(c).some(b=>b.remote_id===ref))A.fail(400,'Bitte ein bekanntes Adressbuch auswählen.');return c}
function publicBinding(b,s){const c=db.prepare('SELECT * FROM calendar_connections WHERE id=?').get(b.connection_id);if(!allowed(c,s))return null;return {id:b.id,connectionId:b.connection_id,label:c.display_name||c.provider,book:books(c).find(x=>x.remote_id===b.addressbook_ref)?.name||'Kontakte',enabled:!!b.enabled,status:b.status,error:b.error,lastSyncedAt:b.last_synced_at,version:b.version,conflict:b.conflict_json?json(b.conflict_json):null,canManage:s.isAdmin||Number(b.owner_user_id)===Number(s.userId)}}
function state(input,s){const r=target(input,s);return {bindings:db.prepare('SELECT * FROM addressbook_sync_bindings WHERE scope=? AND case_id=? AND contact_id=?').all(r.scope,r.caseId,r.id).map(b=>publicBinding(b,s)).filter(Boolean),sources:db.prepare('SELECT * FROM calendar_connections WHERE enabled=1').all().filter(c=>allowed(c,s)&&['google','microsoft','nextcloud','icloud'].includes(c.provider)).map(c=>({id:c.id,label:c.display_name||c.provider,provider:c.provider,books:books(c).map(b=>({ref:b.remote_id,label:b.name||'Kontakte'}))}))}}
async function remoteOptions(input,s,adapter=provider){target(input,s,true);const c=connection(input.connectionId,input.book,s);return {contacts:(await adapter.list(c,input.book)).map(r=>({uid:r.uid,label:require('../../../frontend/addressbook-contact-tools').title(r.data),email:r.data.email||''}))}}
function link(input,s){
 const r=target(input,s,true);connection(input.connectionId,input.book,s);if(typeof input.uid!=='string'||input.uid.length>2048)A.fail(400,'Bitte den Online-Kontakt auswählen.');
 const existing=db.prepare('SELECT * FROM addressbook_sync_bindings WHERE scope=? AND case_id=? AND contact_id=? AND connection_id=? AND addressbook_ref=?').get(r.scope,r.caseId,r.id,input.connectionId,input.book);if(existing)A.fail(409,'Diese Verbindung ist für den Kontakt bereits eingerichtet.');
 if(input.uid&&db.prepare('SELECT 1 FROM addressbook_sync_bindings WHERE connection_id=? AND addressbook_ref=? AND external_uid=?').get(input.connectionId,input.book,input.uid))A.fail(409,'Dieser Online-Kontakt ist bereits verknüpft. Bitte den zugehörigen zentralen Kontakt verwenden.');
 const id=crypto.randomUUID();db.prepare('INSERT INTO addressbook_sync_bindings(id,scope,case_id,contact_id,connection_id,addressbook_ref,external_uid,owner_user_id) VALUES(?,?,?,?,?,?,?,?)').run(id,r.scope,r.caseId,r.id,input.connectionId,input.book,input.uid,s.userId);return {id};
}
function manage(input,s){const b=get(input.bindingId);if(!b)A.fail(404,'Kontaktabgleich nicht gefunden.');target({scope:b.scope,caseId:b.case_id,id:b.contact_id},s,true);if(!allowed(db.prepare('SELECT * FROM calendar_connections WHERE id=?').get(b.connection_id),s))A.fail(403,'Verbindung nicht verfügbar.');if(!s.isAdmin&&Number(s.userId)!==Number(b.owner_user_id))A.fail(403,'Nur die Person, die diesen Abgleich eingerichtet hat, oder die Administration darf ihn ändern.');if(input.version!==undefined&&Number(input.version)!==b.version)A.fail(409,'Der Abgleich wurde inzwischen geändert. Bitte erneut laden.');return b}
function toggle(input,s){const b=manage(input,s);if(typeof input.enabled!=='boolean')A.fail(400,'Bitte den gewünschten Status angeben.');if(input.enabled){connection(b.connection_id,b.addressbook_ref,s);target({scope:b.scope,caseId:b.case_id,id:b.contact_id},sessionFor(b.owner_user_id),true)}db.prepare('UPDATE addressbook_sync_bindings SET enabled=?,version=version+1 WHERE id=?').run(input.enabled?1:0,b.id);return {ok:true}}
function merge(local,remote,baseLocal,baseRemote){const merged={},conflicts=[];for(const k of Object.keys(local)){const l=!same(local[k],baseLocal[k]),r=!same(remote[k],baseRemote[k]);if(l&&r&&!same(local[k],remote[k]))conflicts.push(k);merged[k]=r?remote[k]:local[k]}return {merged,conflicts}}
function errorText(e){return String(e.message||'Kontaktabgleich fehlgeschlagen.').slice(0,1000)}
const queues=new Map();
async function run(input,s,adapter=provider){const b=manage(input,s);return enqueue(b.connection_id,()=>execute(b.id,adapter,input.resolution))}
async function enqueue(key,fn){const previous=queues.get(key)||Promise.resolve(),job=previous.catch(()=>{}).then(fn);queues.set(key,job);try{return await job}finally{if(queues.get(key)===job)queues.delete(key)}}
async function execute(id,adapter=provider,resolution){
 let b=get(id);if(!b?.enabled)return {ok:true,skipped:true};const token=crypto.randomUUID();
 if(!db.prepare('UPDATE addressbook_sync_bindings SET lock_token=?,lock_until=? WHERE id=? AND lock_until<?').run(token,Date.now()+120000,id,Date.now()).changes)return {ok:true,skipped:true};
 const heartbeat=setInterval(()=>db.prepare('UPDATE addressbook_sync_bindings SET lock_until=? WHERE id=? AND lock_token=?').run(Date.now()+120000,id,token),30000);heartbeat.unref();
 const update=patch=>{const keys=Object.keys(patch).filter(k=>patch[k]!==get(id)?.[k]);if(!keys.length)return;db.prepare('UPDATE addressbook_sync_bindings SET '+keys.map(k=>k+'=?').join(',')+',version=version+1 WHERE id=? AND lock_token=?').run(...keys.map(k=>patch[k]),id,token);b=get(id);if(patch.external_uid)db.prepare("UPDATE office_contact_imports SET status='moved' WHERE connection_id=? AND addressbook_ref=? AND external_uid=? AND status='new'").run(b.connection_id,b.addressbook_ref,patch.external_uid)};
 function live(){b=get(id);if(!b?.enabled||b.lock_token!==token)A.fail(409,'Der Kontaktabgleich wurde angehalten.');const s=sessionFor(b.owner_user_id);target({scope:b.scope,caseId:b.case_id,id:b.contact_id},s,true);return {s,c:connection(b.connection_id,b.addressbook_ref,s),row:A.get(b.scope,b.case_id,b.contact_id)}}
 try{
  let {s,c,row}=live(),local=provider.profile(A.data(row)),localVersion=A.version(row);
  const remotes=await adapter.list(c,b.addressbook_ref);({s,c,row}=live());local=provider.profile(A.data(row));localVersion=A.version(row);
  const marked=remotes.filter(r=>r.marker===id);if(marked.length>1)A.fail(409,'Mehrere Online-Kontakte tragen dieselbe Verknüpfung. Bitte beim Anbieter prüfen.');
  let remote=b.external_uid?remotes.find(r=>r.uid===b.external_uid):marked[0];
  if(remote){if(db.prepare('SELECT 1 FROM addressbook_sync_bindings WHERE id!=? AND connection_id=? AND addressbook_ref=? AND external_uid=?').get(id,b.connection_id,b.addressbook_ref,remote.uid))A.fail(409,'Dieser Online-Kontakt ist bereits anderweitig verknüpft.');if(!b.external_uid)update({external_uid:remote.uid,href:remote.href||''});}
  if(!remote&&b.external_uid){update({status:'missing',error:'Der verknüpfte Online-Kontakt fehlt. Lokal bleibt er erhalten. Bitte beim Anbieter wiederherstellen oder den Abgleich pausieren.'});return {ok:false}}
  if(!remote&&['creating','uncertain'].includes(b.status)){update({status:'uncertain',error:'Die Antwort auf die Online-Anlage fehlt. Es wird keine zweite Kopie angelegt. Bitte die Verbindung prüfen; der nächste Abgleich sucht erneut nach der ersten Kopie.'});return {ok:false}}
  const initial=b.base_local_json==='{}',baseLocal=json(b.base_local_json),baseRemote=json(b.base_remote_json);
  let merged=local,conflicts=[];
  if(remote){({merged,conflicts}=initial?{merged:{...remote.data},conflicts:Object.keys(local).filter(k=>!same(local[k],remote.data[k]))}:merge(local,remote.data,baseLocal,baseRemote));
   if(conflicts.length){
    const snapshot={local,remote:remote.data,fields:conflicts};const previous=b.conflict_json?json(b.conflict_json):null;
    if(resolution&&previous&&same(previous.local,local)&&same(previous.remote,remote.data)&&conflicts.every(k=>['local','remote'].includes(resolution[k]))){for(const k of conflicts)merged[k]=resolution[k]==='local'?local[k]:remote.data[k]}
    else{update({status:'conflict',error:'Abweichende Angaben bitte vergleichen und auswählen.',conflict_json:JSON.stringify(snapshot)});return {ok:false,conflict:true}}
   }
  }
  // Validate incoming structures before any provider write, and keep case-specific fields local.
  merged=provider.profile(A.validatePatch(merged));if(!merged.institution&&!merged.lastName)A.fail(400,'Der abgeglichene Kontakt braucht eine Institution oder einen Nachnamen.');
  let saved=remote;
  if(!remote||!same(merged,remote.data)){
   live();if(!remote)update({status:'creating',error:'',conflict_json:''});
   try{const result=await adapter.save(c,b.addressbook_ref,b,merged,remote);if(!result.uid)throw Error('Der Anbieter hat keine Kontaktkennung bestätigt.');update({external_uid:result.uid,href:result.href||remote?.href||''});
    // Persist the acknowledged ID first: a failed read cannot cause a second create.
    saved=(await adapter.list(c,b.addressbook_ref)).find(r=>r.uid===result.uid);if(!saved)throw Error('Der gespeicherte Kontakt ist beim Anbieter noch nicht lesbar. Bitte erneut abgleichen.');
   }catch(e){if(!remote&&!b.external_uid)update({status:e.status&&e.status>=400&&e.status<500&&e.status!==408?'pending':'uncertain'});throw e}
  }
  ({s,row}=live());if(A.version(row)!==localVersion)A.fail(409,'Der lokale Kontakt wurde während des Abgleichs geändert. Beim nächsten Abgleich werden beide Stände erneut verglichen.');
  // Re-read can already include another edit; do not acknowledge it without applying it.
  if(!same(saved.data,merged)&&(!remote||!same(merged,remote.data)))A.fail(409,'Der Anbieter hat die Angaben zwischenzeitlich verändert. Bitte erneut vergleichen.');
  const patch={};for(const [k,v] of Object.entries(merged))if(!same(local[k],v))patch[k]=v;
  // The existing editor also keeps split phone fields; avoid stale legacy output paths.
  for(const kind of ['phone','mobile','fax'])if(Object.hasOwn(patch,kind)){patch[kind+'Area']='';patch[kind+'Number']=patch[kind]}
  if(Object.keys(patch).length)A.replace(b.scope,b.case_id,b.contact_id,patch,s,localVersion);
  const current=provider.profile(A.data(A.get(b.scope,b.case_id,b.contact_id)));
  update({status:'synced',error:'',conflict_json:'',base_local_json:JSON.stringify(current),base_remote_json:JSON.stringify(saved.data),etag:saved.etag||'',last_synced_at:new Date().toISOString()});
  return {ok:true};
 }catch(e){if(get(id)?.enabled)update({...(e.status===404?{enabled:0}:{}),status:['creating','uncertain'].includes(b.status)?'uncertain':'error',error:errorText(e)});return {ok:false,error:errorText(e)}}
 finally{clearInterval(heartbeat);db.prepare("UPDATE addressbook_sync_bindings SET lock_token='',lock_until=0 WHERE id=? AND lock_token=?").run(id,token)}
}
async function runAll(adapter=provider){
 const errors=[],cache=new Map(),key=(c,book)=>JSON.stringify([c.id,book]);
 const batch={
  list:async(c,book)=>{const k=key(c,book);if(!cache.has(k))cache.set(k,await adapter.list(c,book));return structuredClone(cache.get(k))},
  save:async(c,book,...rest)=>{try{return await adapter.save(c,book,...rest)}finally{cache.delete(key(c,book))}}
 };
 for(const b of db.prepare('SELECT b.* FROM addressbook_sync_bindings b JOIN calendar_connections c ON c.id=b.connection_id WHERE b.enabled=1 AND c.enabled=1').all()){
  const r=await enqueue(b.connection_id,()=>execute(b.id,batch));if(r.error)errors.push('Kontaktabgleich: '+r.error);
 }
 return {errors};
}

function unlink(input,s){const b=manage(input,s);if(b.lock_until>Date.now())A.fail(409,'Bitte den laufenden Abgleich abwarten.');db.prepare('DELETE FROM addressbook_sync_bindings WHERE id=?').run(b.id);return {ok:true}}
module.exports={state,remoteOptions,link,toggle,unlink,run,runAll,merge,sessionFor,connection,target};
