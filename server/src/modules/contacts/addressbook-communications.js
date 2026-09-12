'use strict';
// Quellen bleiben führend. Keine Kopie von Mailtexten und keine zweite Falldokumentation.
const db=require('../../database'),crypto=require('node:crypto');
const {darfSehen}=require('../cases/case-visibility');
const parse=v=>{try{return JSON.parse(v||'{}')}catch(_){return {}}};
const email=v=>String(v?.address||v||'').trim().toLowerCase();
const emails=c=>new Set([c.email,...(c.people||[]).map(p=>p.email),...(c.oldEmails||[])].map(email).filter(Boolean));
const privateVisible=(r,s)=>r.visibility!=='private'||Number(r.owner_user_id)===Number(s.userId);
function normalizedDate(value){const text=String(value||''),de=text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);if(de)return de[3]+'-'+de[2].padStart(2,'0')+'-'+de[1].padStart(2,'0');if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;const time=Date.parse(text);return Number.isFinite(time)?new Date(time).toISOString():''}
function page({scope,caseId,id,session,cursor,ids,contactRefs,contact}){
 const A=require('./addressbook'),cases=db.prepare('SELECT id,label,stammdaten_json FROM cases').all().filter(c=>darfSehen(session,c.id)),caseMap=new Map(cases.map(c=>[c.id,c])),items=[];
 let after=null;if(cursor){try{after=JSON.parse(Buffer.from(cursor,'base64url').toString())}catch(_){}if(!Array.isArray(after)||after.length!==2||after.some(v=>typeof v!=='string'))A.fail(400,'Ungültige Fortsetzung.')}
 const refKey=(scope,caseId,id)=>JSON.stringify([scope,scope==='office'?'':caseId,id]);
 const linked=(l,cid)=>!!l&&contactRefs.has(refKey(l.scope||'case',l.caseId||cid,l.contactId));
 const allContacts=db.prepare('SELECT id,case_id,data_json FROM case_contacts').all().map(r=>({...parse(r.data_json),id:r.id,caseId:r.case_id,scope:'case'}));
 const office=db.prepare('SELECT id,data_json FROM office_contacts').all().map(r=>({...parse(r.data_json),id:r.id,caseId:'',scope:'office'}));
 const candidates=[...allContacts,...office],target=emails(contact);
 const history=db.prepare('SELECT scope,contact_id,case_id,changes_json FROM addressbook_history WHERE contact_id IN (SELECT value FROM json_each(?))').all(JSON.stringify([...ids]));for(const h of history){if(!contactRefs.has(refKey(h.scope,h.case_id,h.contact_id)))continue;const ch=parse(h.changes_json),oldEmails=[ch.email?.before,ch.email?.after,...(ch.people?.before||[]).map(p=>p.email),...(ch.people?.after||[]).map(p=>p.email)].map(email).filter(Boolean);for(const e of oldEmails)target.add(e);if(oldEmails.length)candidates.push({id:h.contact_id,caseId:h.case_id,scope:h.scope,oldEmails})}
 // Nur eindeutige E-Mail-Zuordnungen; ein gemeinsam genutztes Postfach ist kein Identitätsnachweis.
 const globalEmails=new Map(),caseEmails=new Map();for(const c of candidates)for(const addr of emails(c)){const g=globalEmails.get(addr)||new Set();g.add(refKey(c.scope,c.caseId,c.id));globalEmails.set(addr,g);if(c.caseId){const key=c.caseId+'|'+addr,local=caseEmails.get(key)||new Set();local.add(refKey(c.scope,c.caseId,c.id));caseEmails.set(key,local)}}
 function matches(addresses,cid){for(const addr of addresses){if(!target.has(addr))continue;const hits=cid?caseEmails.get(cid+'|'+addr):globalEmails.get(addr);if(hits?.size&&[...hits].every(key=>contactRefs.has(key)))return true}return false}
 const norm=v=>String(v||'').toLocaleLowerCase('de-DE').replace(/[,;–—]/g,' ').replace(/\s+/g,' ').trim();
 function matchesRecipient(value,cid){const v=norm(value);if(!v)return false;const hits=allContacts.filter(c=>c.caseId===cid).filter(c=>{const person=[c.title,c.firstName,c.lastName].filter(Boolean).join(' '),base=[c.institution,person].filter(Boolean),address=[[c.street,[c.house,c.houseLetter].filter(Boolean).join('')].filter(Boolean).join(' ')||(c.postbox?'Postfach '+c.postbox:''),[c.postal,c.city].filter(Boolean).join(' ')];return [base.join(' '),[...base,...address].filter(Boolean).join(' ')].some(s=>norm(s)===v)});return hits.length>0&&hits.every(c=>contactRefs.has(refKey(c.scope,c.caseId,c.id)))}
 const doku=db.prepare('SELECT * FROM case_doku_entries WHERE case_id IN (SELECT value FROM json_each(?))').all(JSON.stringify([...caseMap.keys()]));
 const documentedMail=new Map(),documentedTerms=new Set(),preferredMailLocations=new Set();
 const addDocumented=(key,item)=>{const entries=documentedMail.get(key)||[];entries.push(item);documentedMail.set(key,entries)};
 for(const r of doku){
  const d=parse(r.data_json);if(!linked(d.contactLink,r.case_id))continue;
  const item={id:r.id,kind:'doku',caseId:r.case_id,caseLabel:caseMap.get(r.case_id).label,date:d.date||r.created_at,title:d.detail||d.type||'Dokumentation',text:d.freeDetail||d.note||'',contactType:d.contactType||'',source:d.source||'',person:d.contactLink?.snapshot?.person||''};items.push(item);
  const account=d.mailAccountId||d.source?.accountId||'';
  if(d.mailSource?.accountId&&d.mailSource.uid)preferredMailLocations.add(JSON.stringify([d.mailSource.accountId,d.mailSource.folder,d.mailSource.uid]));
  if(account&&d.mailDispatchId){addDocumented('dispatch:'+account+'|'+d.mailDispatchId,item);documentedTerms.add(d.mailDispatchId.toLowerCase())}
  for(const key of [d.mailMessageId,d.messageId,d.sourceId,d.source?.id,d.source?.sourceId,d.source?.messageId])if(typeof key==='string'&&key){addDocumented('message:'+(account||'*')+'|'+key,item);documentedTerms.add(key.slice(key.indexOf('|')+1).toLowerCase())}
 }

 for(const c of cases){const state=parse(c.stammdaten_json);for(const h of state.exportHistory||state.ui?.exportHistory||[]){if(h.status!=='sent')continue;const addresses=new Set([email(h.recipientEmail)].filter(Boolean));if(!(h.contactLink?linked(h.contactLink,c.id):(matches(addresses,c.id)||matchesRecipient(h.recipient,c.id))))continue;items.push({id:'document:'+c.id+':'+h.id,sourceId:h.id,kind:'document',caseId:c.id,caseLabel:c.label,date:h.sentAt||h.updatedAt||h.createdAt||'',title:h.documentTitle||h.subject||'Versendetes Schreiben',text:h.note||h.subject||'',contactType:'Versendet · '+(h.channel||'Schreiben')})}}
 const exports=new Map();for(const c of cases)for(const h of parse(c.stammdaten_json).exportHistory||[])if(h.exportRef?.fileId)exports.set(c.id+'|'+h.exportRef.fileId,h);
 const docs=new Map(doku.map(r=>[r.id,{...parse(r.data_json),caseId:r.case_id}]));
 for(const t of db.prepare("SELECT * FROM todos WHERE item_type='followup'").all()){
  if(!privateVisible(t,session)||!caseMap.has(t.case_id))continue;
  let link=parse(t.source_ref).contactLink;const d=docs.get(t.source_id);
  if(!link&&t.source_type==='contact')link={contactId:t.source_id,caseId:t.case_id};
  if(!link&&t.source_type==='doku'&&d?.caseId===t.case_id)link=d.contactLink;
  if(!link&&t.source_type==='document')link=exports.get(t.case_id+'|'+t.source_id)?.contactLink;
  if(!linked(link,t.case_id))continue;
  items.push({id:'followup:'+t.id,sourceId:t.id,kind:'followup',caseId:t.case_id,caseLabel:caseMap.get(t.case_id).label,date:t.due_at||t.created_at,title:t.title||'Vereinbarte Rückmeldung',text:t.description,contactType:t.done?'Rückmeldung erledigt':'Rückmeldung offen',done:!!t.done});
 }
 const links=parse(db.prepare("SELECT data_json FROM office_json WHERE key='mailx_case_links'").get()?.data_json),seen=new Set();
 for(const acc of db.prepare('SELECT * FROM mail_accounts').all().filter(a=>privateVisible(a,session))){
  const rows=[...db.prepare('SELECT folder,uid,env_json FROM addressbook_mail_index WHERE account_id=? AND EXISTS(SELECT 1 FROM json_each(?) WHERE instr(lower(env_json),value)>0)').all(acc.id,JSON.stringify([...target,...documentedTerms])),...db.prepare('SELECT folder,uid,env_json FROM mail_cache WHERE account_id=? AND EXISTS(SELECT 1 FROM json_each(?) WHERE instr(lower(env_json),value)>0)').all(acc.id,JSON.stringify([...target,...documentedTerms]))];
  rows.sort((a,b)=>Number(preferredMailLocations.has(JSON.stringify([acc.id,b.folder,b.uid])))-Number(preferredMailLocations.has(JSON.stringify([acc.id,a.folder,a.uid]))));
  for(const r of rows){const m=parse(r.env_json),key=acc.id+'|'+(m.messageId||r.folder+'|'+r.uid);if(seen.has(key))continue;seen.add(key);if(m.draft||/(^|\/)(drafts|entwürfe)$/i.test(r.folder))continue;
   const own=email(acc.email),outgoing=email(m.from)===own;
   const documented=[...new Set([
    ...(outgoing&&m.dispatchId?documentedMail.get('dispatch:'+acc.id+'|'+m.dispatchId)||[]:[]),
    ...(m.messageId?documentedMail.get('message:'+acc.id+'|'+m.messageId)||[]:[]),
    ...(m.messageId?documentedMail.get('message:*|'+m.messageId)||[]:[]),
    ...(documentedMail.get('message:*|'+key)||[])
   ])];
   const addresses=new Set([m.from,...(m.to||[]),...(m.cc||[])].map(email).filter(Boolean));
   const link=links[acc.id+'|'+m.messageId]||links[acc.id+'|'+r.uid],cid=String(link?.caseId||'');
   if(cid&&!caseMap.has(cid))continue;
   if(!documented.length&&(link?.contactLink?!linked(link.contactLink,cid):!matches(addresses,cid)))continue;
   for(const snooze of db.prepare('SELECT * FROM mail_snoozes WHERE account_id=? AND message_id=? AND owner_user_id=?').all(acc.id,m.messageId||'',session.userId))items.push({id:'snooze:'+snooze.id,workspaceId:'mail:'+snooze.id,kind:'followup',caseId:cid,caseLabel:caseMap.get(cid)?.label||'Ohne Fallzuordnung',date:snooze.wake_at,title:snooze.subject||m.subject||'E-Mail-Rückmeldung',text:'',contactType:'E-Mail zurückgestellt'});
   if(documented.length){for(const item of documented)item.mail={accountId:acc.id,folder:r.folder,uid:r.uid,accountLabel:acc.label||acc.email};continue}
   items.push({id:'mail:'+key,kind:'mail',accountId:acc.id,folder:r.folder,uid:r.uid,caseId:cid,caseLabel:caseMap.get(cid)?.label||'Ohne Fallzuordnung',date:m.date||'',title:m.subject||'E-Mail ohne Betreff',text:'',contactType:outgoing?'E-Mail gesendet':'E-Mail eingegangen',accountLabel:acc.label||acc.email});
  }
 }
 for(const item of items)item.date=normalizedDate(item.date);
 items.sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:a.id>b.id?-1:a.id<b.id?1:0);
 const eligible=after?items.filter(x=>x.date<after[0]||(x.date===after[0]&&x.id<after[1])):items,result=eligible.slice(0,200),last=result.at(-1);
 return {items:result,nextCursor:eligible.length>200?Buffer.from(JSON.stringify([last.date,last.id])).toString('base64url'):null};
}
const jobs=new Map();
const cacheTables=['mail_cache','addressbook_mail_index'];
function cacheSnapshot(accountId){return cacheTables.flatMap(table=>db.prepare(`SELECT folder,uid,env_json${table==='addressbook_mail_index'?',scan_id':''} FROM ${table} WHERE account_id=?`).all(accountId).map(row=>({...row,table})))}
function pruneSnapshot(accountId,snapshot,missing){
 // Ein Abgleich darf nur seinen unveränderten Ausgangsbestand bereinigen. Nachrichten,
 // die parallel durch das Mailmodul oder einen anderen Abgleich eintreffen, bleiben erhalten.
 db.transaction(()=>{for(const row of snapshot||[]){if(!missing(row))continue;const indexed=row.table==='addressbook_mail_index';db.prepare(`DELETE FROM ${row.table} WHERE account_id=? AND folder=? AND uid=? AND env_json=?${indexed?' AND scan_id=?':''}`).run(accountId,row.folder,row.uid,row.env_json,...(indexed?[row.scan_id]:[]))}})();
}
function indexMessages(accountId,folder,messages,scanId=''){
 const stmt=db.prepare('INSERT INTO addressbook_mail_index VALUES(?,?,?,?,?) ON CONFLICT(account_id,folder,uid) DO UPDATE SET env_json=excluded.env_json,scan_id=excluded.scan_id');
 db.transaction(()=>{for(const m of messages){if(m.uid==null)continue;const {uid,messageId,dispatchId,subject,from,to,cc,date,draft}=m;stmt.run(accountId,folder,String(uid),JSON.stringify({uid,messageId,dispatchId,subject,from,to,cc,date,draft}),scanId)}})();
}
// Ein Seitenabruf je Anfrage hält die Oberfläche bedienbar. Keine 200-/1000-Mail-Abschneidung,
// auch bei Graph (dessen Volltextsuche nicht über $skip paginiert werden kann).
async function sync(input,session,engines){
 const A=require('./addressbook');A.authorize(session,input.scope,input.caseId||'');if(!A.get(input.scope,input.caseId||'',input.id))A.fail(404,'Kontakt nicht gefunden.');
 for(const [k,v] of jobs)if(Date.now()-v.at>900000)jobs.delete(k);
 let job,token=input.cursor;
 if(token){job=jobs.get(token);if(!job||job.userId!==session.userId)A.fail(409,'Die Aktualisierung ist abgelaufen. Bitte erneut starten.');if(job.result)return job.result;if(job.pending)return job.pending}
 else{token=crypto.randomUUID();job={userId:session.userId,at:Date.now(),accounts:db.prepare('SELECT id FROM mail_accounts ORDER BY id').all().map(a=>a.id),account:0,folders:null,folder:0,offset:0,scanId:crypto.randomUUID(),seenUids:[],count:0,errors:[]};jobs.set(token,job)}
 job.pending=(async()=>{
  const next={...job,at:Date.now(),errors:[...job.errors],seenUids:job.seenUids};delete next.pending;delete next.result;
  while(next.account<next.accounts.length){
   const acc=db.prepare('SELECT * FROM mail_accounts WHERE id=?').get(next.accounts[next.account]);if(!acc||!privateVisible(acc,session)){next.account++;next.folders=null;continue}
   const engine=engines?.[acc.kind]||(acc.kind==='microsoft'?require('../../integrations/mail/microsoft-graph'):require('../../integrations/mail/imap'));
   try{
    if(!next.folders){next.snapshot=cacheSnapshot(acc.id);next.folders=(await (engine.listFoldersComplete||engine.listFolders)(acc)).filter(f=>f.path&&!f.noSelect);next.folder=0;next.offset=0;next.nextLink=null;next.seenUids=[];next.total=null;next.stable=true}
    if(next.folder>=next.folders.length){const folders=new Set(next.folders.map(f=>f.path));pruneSnapshot(acc.id,next.snapshot,row=>!folders.has(row.folder));next.account++;next.folders=null;next.snapshot=null;continue}
    const folder=next.folders[next.folder].path,result=await engine.listMessages(acc,folder,{offset:next.offset,limit:200,...(next.nextLink?{nextLink:next.nextLink}:{})});const messages=result.messages||[];
    const providerPaging=Object.hasOwn(result,'nextLink');if(next.total!=null&&result.totalKnown!==false&&next.total!==result.total)next.stable=false;next.total=result.totalKnown===false?null:result.total;next.nextLink=result.nextLink||null;
    indexMessages(acc.id,folder,messages,next.scanId);next.seenUids.push(...messages.map(m=>String(m.uid)));next.count+=messages.length;next.offset+=messages.length;
    if(providerPaging?!next.nextLink:(!messages.length||next.offset>=result.total)){const seen=new Set(next.seenUids);if(next.stable&&seen.size===next.seenUids.length&&(next.total==null||seen.size===next.total))pruneSnapshot(acc.id,next.snapshot,row=>row.folder===folder&&!seen.has(row.uid));else next.errors.push((acc.label||acc.email||'Postfach')+': Nachrichtenbestand während des Abgleichs geändert. Bitte erneut aktualisieren.');next.folder++;next.offset=0;next.nextLink=null;next.seenUids=[];next.total=null;next.stable=true}
   }catch(e){next.errors.push((acc.label||acc.email||'Postfach')+': Aktualisierung fehlgeschlagen.');next.account++;next.folders=null}
   break;
  }
  const done=next.account>=next.accounts.length,nextToken=done?null:crypto.randomUUID();if(nextToken)jobs.set(nextToken,next);
  const result={cursor:nextToken,done,checked:next.count,errors:next.errors};job.result=result;return result;
 })();try{return await job.pending}finally{delete job.pending}
}
module.exports={page,sync,indexMessages};
