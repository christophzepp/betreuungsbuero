/* Fallaktionen verwenden in der Vorführung ausschließlich die vorhandene RAM-Ablage. */
const DC=(()=>{
 const enabled=()=>!online()&&!!window.__demoModus;
 const caseFields=['role','fileNumber','processNumber','customerNumber'];
 const shared=()=>Object.keys(LABELS).filter(k=>!['role','status','fileNumber','processNumber','customerNumber','note','_category','_standardRecipients'].includes(k));
 function guard(){if(!enabled())throw Error('Diese Aktion gehört zur Vorführung.');}
 function cases(){const map=new Map((window.caseRegistry||[]).filter(e=>e?.state?.caseData).map(e=>[String(e.id),{label:e.label||window.caseLabelOf?.(e.state),data:e.state.caseData}]));map.set(activeCase(),{label:window.caseLabelOf?.(state)||'Aktueller Fall',data:state.caseData});return map}
 function find(r){guard();const rows=r.scope==='office'?window.__baModernContacts?.()||[]:cases().get(String(r.caseId))?.data.contacts||[];const c=rows.find(x=>x&&!x.__merged&&(r.id?String(x.id||'')===String(r.id):r.localKey&&api().key(x)===r.localKey));if(!c)throw Error('Der Kontakt ist in diesem Demo-Fall nicht mehr vorhanden.');return c}
 function clean(c){return Object.fromEntries(Object.entries(structuredClone(c)).filter(([k])=>!k.startsWith('__')))}
 function details(r){const c=clean(find(r));return {contact:c,version:JSON.stringify(c),centralId:r.scope==='office'?c.id:c.centralContactId||'',associations:localAssociations({...c,__buero:r.scope==='office',__caseId:r.caseId}).map(a=>({...a,version:JSON.stringify(clean(find({scope:'case',caseId:a.caseId,id:a.contactId,localKey:a.localKey})))})),history:c._addressHistory||[],communications:localCommunications({...c,__buero:r.scope==='office',__caseId:r.caseId})}}
 function persistCase(caseId,rows){const id=String(caseId);if(id===activeCase())state.caseData.contacts=rows;for(const e of window.caseRegistry||[])if(String(e.id)===id&&e.state?.caseData)e.state.caseData.contacts=structuredClone(rows);const cached=window.__onlineCaseCache?.get(id);if(cached?.data)cached.data.contacts=structuredClone(rows);}
 async function put(r,next){guard();next=clean(next);window.__abValidateImport(next);next.id=next.id||r.id||crypto.randomUUID();next.key=window.phase5ContactKey?.(next)||next.key;next._pendingWrite=true;let before;
  if(r.scope==='office'){before=(window.__baModernContacts?.()||[]).find(c=>c.id===next.id);next._addressHistory=localHistory(before,next);await window.__baModernSaveLocal(next)}
  else{const entry=cases().get(String(r.caseId));if(!entry)throw Error('Bitte den gewünschten Demo-Fall zuerst laden.');const rows=[...(entry.data.contacts||[])],i=rows.findIndex(c=>c.id===next.id||!r.id&&r.localKey&&api().key(c)===r.localKey);before=rows[i];next._addressHistory=localHistory(before,next);if(i<0)rows.push(next);else rows[i]=next;persistCase(r.caseId,rows)}
  X.migrateLocal(r,next);window.saveCaseRegistry?.();saveState();return next;
 }
 function common(c){return Object.fromEntries(shared().filter(k=>Object.hasOwn(c,k)).map(k=>[k,structuredClone(c[k])]))}
 async function propagate(c,r){const central=r.scope==='office'?c.id:c.centralContactId;if(!central)return;const fields=common(c),targets=[];
  const office=(window.__baModernContacts?.()||[]).find(x=>x.id===central);if(office&&r.scope!=='office')targets.push([{scope:'office',caseId:'',id:central},office]);
  for(const [caseId,entry] of cases())for(const target of entry.data.contacts||[])if(target.centralContactId===central&&!target.__merged&&!(r.scope==='case'&&caseId===r.caseId&&target.id===c.id))targets.push([{scope:'case',caseId,id:target.id||'',localKey:target.id?'':api().key(target)},target]);
  for(const [target,before] of targets){const next=clean(before);for(const k of shared()){if(Object.hasOwn(fields,k))next[k]=structuredClone(fields[k]);else delete next[k]}if(next._standardRecipients)next._standardRecipients=Object.fromEntries(Object.entries(next._standardRecipients).filter(([,pid])=>!pid||next.people?.some(p=>p.id===pid)));if(JSON.stringify(next)!==JSON.stringify(clean(before)))await put(target,next)}
 }
 async function save(r,next){if(next._standardRecipients)next._standardRecipients=Object.fromEntries(Object.entries(next._standardRecipients).filter(([,pid])=>!pid||next.people?.some(p=>p.id===pid)));const saved=await put(r,next);await propagate(saved,{...r,id:saved.id});return details({...r,id:saved.id,localKey:''})}
 function validateVersion(r,version){const c=find(r);if(version&&JSON.stringify(clean(c))!==version){const e=Error('Der Demo-Kontakt wurde zwischenzeitlich geändert. Bitte den aktuellen Stand prüfen.');e.status=409;throw e}return c}
 async function request(path,body={},method){guard();const [route,query]=path.split('?'),r=query?Object.fromEntries(new URLSearchParams(query)):body;
  if(route==='contact'){if(!body||method==='GET'||query)return details(r);const c=validateVersion(r,body.version);return save(r,{...c,...body.patch})}
  if(route==='assign'){
   const source=find(r),targetCaseId=String(body.targetCaseId||'');if(!cases().has(targetCaseId))throw Error('Bitte einen geladenen Demo-Fall auswählen.');const existing=localAssociations({...source,__buero:r.scope==='office',__caseId:r.caseId}).find(a=>a.caseId===targetCaseId);
   if(existing&&existing.contactId!==body.assignmentId)throw Error('Der Kontakt ist diesem Fall bereits zugeordnet.');
   const patch=Object.fromEntries(caseFields.map(k=>[k,String(body[k]||'')]));if(Object.values(patch).some(v=>v.length>1000))throw Error('Fallangaben dürfen jeweils höchstens 1.000 Zeichen enthalten.');
   if(!body.assignmentId)throw Error('Die neue Zuordnung hat keine Kennung. Bitte das Formular erneut öffnen.');
   const target={scope:'case',caseId:targetCaseId,id:body.assignmentId};const prior=existing?validateVersion(target,body.targetVersion):null;
   if(!prior&&(cases().get(targetCaseId).data.contacts||[]).some(c=>c.id===target.id))throw Error('Diese Zuordnung besteht bereits. Bitte das Formular erneut öffnen.');
   let central=r.scope==='office'?source.id:source.centralContactId,contact=source;
   const promote=!central;central=central||crypto.randomUUID();
   const next={...(prior||{...common(contact),id:body.assignmentId,centralContactId:central,status:'Aktiv',_category:contact._category||'soziales'}),...patch};window.__abValidateImport(next);
   // Alle Zuordnungsangaben prüfen, bevor ein bisher lokaler Kontakt zentral verknüpft wird.
   if(promote){await put({scope:'office',id:central},{...common(source),id:central,status:'Aktiv'});contact=await put(r,{...source,centralContactId:central})}
   await put(target,next);const result=details({...r,id:contact.id,localKey:contact.id?'':r.localKey});result.assignment={contactId:next.id,version:details(target).version};return result;
  }
  if(route==='detach'){const source=find(r),target={scope:'case',caseId:body.targetCaseId,id:body.contactId,localKey:body.localKey},contact=find(target),central=r.scope==='office'?source.id:source.centralContactId;if(!central||contact.centralContactId!==central)throw Error('Diese zentrale Zuordnung besteht nicht mehr.');const next=clean(contact);delete next.centralContactId;await put(target,next);return details(r)}
  if(route==='standard'){
   const target={scope:'case',caseId:body.caseId,id:body.id,localKey:body.localKey},c=find(target),purpose=String(body.purpose||''),pid=body.personId||'';
   if(!/^(document|mail|role:(court|doctor|insurance)|report:[a-zA-Z0-9_.-]{1,150})$/.test(purpose))throw Error('Ungültiger Standardempfänger.');if(pid&&!c.people?.some(p=>p.id===pid))throw Error('Dieser Ansprechpartner gehört nicht zum Kontakt im gewählten Fall.');
   const next=clean(c);next._standardRecipients={...c._standardRecipients};if(body.remove)delete next._standardRecipients[purpose];else next._standardRecipients[purpose]=pid;
   if(!body.remove)for(const other of cases().get(String(body.caseId)).data.contacts||[])if(other!==c&&Object.hasOwn(other._standardRecipients||{},purpose)){const updated=clean(other);delete updated._standardRecipients[purpose];await put({scope:'case',caseId:body.caseId,id:other.id||'',localKey:other.id?'':api().key(other)},updated)}
   const saved=await put(target,next);return details({...target,id:saved.id,localKey:''});
  }
  throw Error('Diese Adressbuchaktion steht in der Vorführung nicht zur Verfügung.');
 }
 return {enabled,cases,find,details,save,request};
})();
