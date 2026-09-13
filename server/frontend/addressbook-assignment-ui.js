function assign(c){
 let source={...M.bundle.contact},sourceVersion=M.bundle.version;const sourceRef=ref(c);
 const associated=new Set((M.bundle?.associations||[]).map(a=>a.caseId));
 const entries=[...(DC.enabled()?DC.cases().entries():window.__onlineCaseCache?.entries()||[])].filter(([id])=>!associated.has(id)).map(([id,e])=>[id,e.label||id]);
 if(!entries.length)throw Error('Der Kontakt ist bereits allen verfügbaren Fällen zugeordnet.');
 const helpers=window.__abAssignmentData,assignmentId=crypto.randomUUID(),drafts=new Map();let context=null,loadedCase='',epoch=0,chosen=null,loadError='',saved=false;
 const s=smallForm('Einem weiteren Fall zuordnen',[['targetCaseId','Fall','',entries],...helpers.fields.map(k=>[k,k==='role'?'Rolle im Zielfall':(k==='customerNumber'?'Kundennummer':LABELS[k])+' im Zielfall',k==='role'?source.role:''])],async values=>{
  const controls=[...s.form.querySelectorAll('input,select,button')].map(el=>[el,el.disabled]);for(const [el] of controls)el.disabled=true;
  try{const bundle=await request('assign',{...sourceRef,...values,sourceVersion,assignmentId,targetContactId:chosen?.id||'',targetContactKey:chosen?.localKey||'',targetContactVersion:chosen?.version||''});
   saved=true;await cacheBundle(bundle,sourceRef);M.bundle=bundle;
  }finally{for(const [el,disabled] of controls)el.disabled=disabled}
 },async()=>{
  if(!confirm('Aktuelle Quell- und Zielfalldaten laden? Ihre eigenen Eingaben bleiben für die erneute Prüfung erhalten.'))return false;
  const fresh=await request('contact?'+new URLSearchParams(sourceRef));source={...fresh.contact};sourceVersion=fresh.version;info.querySelector('strong').textContent=name(source);
  for(const b of s.form.querySelectorAll('.am-assignment-copy'))b.textContent='Aus Ausgangsfall übernehmen: '+(source[b.dataset.field]||'—');
  await load();return !!context;
 });
 // Eine neue Verknüpfung wird erst nach Prüfung der vorgeschlagenen Zielfalldaten angelegt.
 s.manual=true;s.form.querySelector('p').textContent='Angaben prüfen und mit „Fertig“ verknüpfen. Weitere Änderungen werden online automatisch gespeichert.';
 const info=E('div','am-assignment-info');info.append(E('strong','',name(source)),E('p','am-sub','Anschriften, Kontaktwege und Ansprechpartner werden gemeinsam gepflegt. Rolle, Aktenzeichen, Vorgangsnummer und Kundennummer gehören jeweils zum gewählten Fall.'));
 const result=E('div','am-assignment-result');result.setAttribute('aria-live','polite');s.form.querySelector('label').before(info);s.form.elements.targetCaseId.closest('label').after(result);
 const notes={},manual=new Set();
 for(const k of helpers.fields){
  const input=s.form.elements[k],label=input.closest('label'),note=E('small','am-sub');note.id='amAssignmentOrigin_'+k;input.setAttribute('aria-describedby',note.id);label.append(note);notes[k]=note;
  input.addEventListener('input',()=>{manual.add(k);notes[k].textContent='Eigene Angabe für den Zielfall'});
  if(k!=='role'&&sourceRef.scope==='case'&&source[k]){const copy=B('Aus Ausgangsfall übernehmen: '+source[k],()=>{input.value=source[k];input.dispatchEvent(new Event('input',{bubbles:true}));notes[k].textContent='Aus Ausgangsfall übernommen – bitte für den Zielfall prüfen'},'quiet am-assignment-copy',true);copy.dataset.field=k;copy.disabled=true;label.after(copy)}
 }
 function remember(){if(loadedCase)drafts.set(loadedCase,{values:Object.fromEntries(helpers.fields.map(k=>[k,s.form.elements[k].value])),manual:[...manual],chosenKey:chosen?.id||chosen?.localKey||'__new__'})}
 function prefill(){const suggestion=helpers.suggest({...source,role:manual.has('role')?s.form.elements.role.value:source.role},context,chosen);for(const k of helpers.fields)if(!manual.has(k)){s.form.elements[k].value=suggestion.values[k];notes[k].textContent=suggestion.origins[k]||'Keine passende Angabe im Zielfall bekannt'}if(!manual.has('fileNumber'))notes.fileNumber.textContent=suggestion.origins.fileNumber||'Kein passendes Aktenzeichen im Zielfall bekannt'}
 function render(){
  result.replaceChildren();const candidates=helpers.matches(source,context.contacts),draft=drafts.get(loadedCase),byKey=k=>candidates.find(x=>(x.id||x.localKey)===k);
  chosen=draft?byKey(draft.chosenKey)||null:candidates.length===1?candidates[0]:null;
  const target=E('select');target.setAttribute('aria-label','Kontakt im Zielfall');target.append(new Option('Neue Fallverknüpfung anlegen','__new__'));for(const x of candidates)target.append(new Option([name(x),x.role,x.fileNumber].filter(Boolean).join(' · '),x.id||x.localKey));
  target.value=chosen?.id||chosen?.localKey||'__new__';
  if(candidates.length){const label=E('label','','Bereits im Zielfall vorhanden');label.append(target);result.append(label);const hint=E('p','am-sub');hint.textContent='Den vorhandenen Eintrag verknüpfen, um doppelte Kontakte zu vermeiden. Seine Fallangaben bleiben erhalten; gemeinsame Kontaktdaten werden aus dem oben genannten Kontakt übernommen.';result.append(hint)}else result.append(E('p','am-sub','Eine neue Fallverknüpfung wird angelegt. Bekannte Angaben des Zielfalls sind vorbelegt.'));
  const differences=E('div');result.append(differences);
  function compare(){differences.replaceChildren();if(!chosen)return;for(const k of Object.keys(LABELS).filter(k=>!helpers.fields.includes(k)&&!['status','note','_category','_standardRecipients'].includes(k))){if(JSON.stringify(chosen[k]??null)===JSON.stringify(source[k]??null))continue;differences.append(E('p','am-sub',(LABELS[k]||k)+': '+displayValue(chosen[k])+' → '+displayValue(source[k])))}if(differences.childElementCount)differences.prepend(E('strong','','Gemeinsame Angaben beim Verknüpfen'))}
  target.onchange=()=>{chosen=byKey(target.value)||null;manual.clear();prefill();compare();s.form.oninput()};
  prefill();if(draft){for(const k of draft.manual){manual.add(k);s.form.elements[k].value=draft.values[k];notes[k].textContent='Eigene Angabe für diesen Zielfall'}}compare();
 }
 async function load(){
  remember();const caseId=s.form.elements.targetCaseId.value,token=++epoch;loadedCase='';context=null;chosen=null;loadError='';manual.clear();result.textContent=caseId?'Bekannte Angaben werden geladen …':'Bitte einen Zielfall wählen.';
  for(const k of helpers.fields){s.form.elements[k].value=k==='role'?source.role||'':'';s.form.elements[k].disabled=true;notes[k].textContent=''}for(const b of s.form.querySelectorAll('.am-assignment-copy'))b.disabled=true;
  if(!caseId)return;
  try{const data=await request('assignment-context?'+new URLSearchParams({...sourceRef,targetCaseId:caseId}));if(token!==epoch||M.small!==s)return;context=data;loadedCase=caseId;render()}
  catch(e){if(token!==epoch||M.small!==s)return;loadError=e.message;result.replaceChildren(E('p','am-error',e.message),B('Angaben erneut laden',()=>{s.processing=load();return s.processing},'',true))}
  finally{if(token===epoch&&M.small===s&&context){for(const k of helpers.fields)s.form.elements[k].disabled=false;for(const b of s.form.querySelectorAll('.am-assignment-copy'))b.disabled=false}}
 }
 s.form.elements.targetCaseId.addEventListener('change',()=>{s.processing=load()});
 s.form.elements.role.addEventListener('change',()=>{if(context&&!manual.has('fileNumber'))prefill()});
 s.validate=()=>{if(saved)throw Error('Die Verknüpfung wurde bereits angelegt. Bitte die Fallansicht neu öffnen.');if(!context||loadedCase!==s.form.elements.targetCaseId.value)throw Error(loadError||'Bitte den Zielfall wählen und die bekannten Angaben abwarten.')};
 s.processing=load();
}
