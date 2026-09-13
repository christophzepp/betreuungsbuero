/* Gemeinsame Kontaktpflege und lesende Übersicht. Wird innerhalb des Adressbuchmoduls geladen. */
const CE=(()=>{
 const T=window.__abContactTools,D=window.__abExtrasData;
 const addressKeys=['street','house','houseLetter','postal','city','postbox','country'];
 const ownButton=(label,fn,cls='')=>B(label,fn,cls,true);
 function field(parent,label,value,oninput,{id='',type='text',options,required=false,maxLength}={}){
  const wrap=E('label','',label),input=E(options?'select':type==='textarea'?'textarea':'input');
  if(options)for(const [v,text] of options)input.append(new Option(text,v));else if(type!=='textarea')input.type=type;
  input.setAttribute('aria-label',label);if(type==='textarea')input.rows=2;input.value=value??'';input.required=required;if(id){input.id=id;input.name=id.startsWith('amEdit_')?id.slice(7):id}if(maxLength)input.maxLength=maxLength;
  input.oninput=()=>oninput(input.value);input.onchange=input.oninput;wrap.append(input);parent.append(wrap);return input;
 }
 function fold(form,key,title,open){const box=E('details','am-editor-section');box.dataset.section=key;box.open=!!open;box.append(E('summary','',title));const body=E('div','am-editor-section-body');box.append(body);form.append(box);return body}
 function go(form,key){const target=form.querySelector('[data-section="'+key+'"]');if(!target)return;target.open=true;requestAnimationFrame(()=>{target.scrollIntoView({block:'start'});target.querySelector('input,select,textarea,button')?.focus({preventScroll:true})})}
 const changedArray=(key,id,k,v)=>changed(key,(M.editor.draft[key]||[]).map(x=>x.id===id?{...x,[k]:v}:x));
 function addresses(body,e){
  const preferred=field(body,'Bevorzugte Anschrift',e.draft.preferredAddressId||'',v=>changed('preferredAddressId',v),{id:'amEdit_preferredAddressId',options:[['','Hauptanschrift']]});
  const list=E('div','am-editor-cards');body.append(list);
  function choices(){const selected=e.draft.preferredAddressId||'';preferred.replaceChildren(new Option('Hauptanschrift',''),...(e.draft.addresses||[]).map(a=>new Option(a.label||'Neue Anschrift',a.id)));preferred.value=selected}
  function render(){list.replaceChildren();choices();for(const a of e.draft.addresses||[]){const card=E('fieldset','am-editor-card');card.dataset.addressId=a.id;card.append(E('legend','','Weitere Anschrift'));const grid=E('div','am-form-grid');field(grid,'Bezeichnung',a.label,v=>{changedArray('addresses',a.id,'label',v);choices()},{required:true,maxLength:1000});for(const k of addressKeys)field(grid,LABELS[k],a[k],v=>changedArray('addresses',a.id,k,v),{maxLength:1000});card.append(grid,ownButton('Anschrift entfernen',()=>{if(!confirm('Diese Anschrift entfernen?'))return;changed('addresses',e.draft.addresses.filter(x=>x.id!==a.id));if(e.draft.preferredAddressId===a.id)changed('preferredAddressId','');render()},'danger'));list.append(card)}}
  body.append(ownButton('+ Anschrift',()=>{if((e.draft.addresses||[]).length>=30)throw Error('Höchstens 30 Anschriften sind möglich.');changed('addresses',[...(e.draft.addresses||[]),{id:crypto.randomUUID(),label:''}]);render();list.lastElementChild.querySelector('input').focus()},'primary'));render();
 }
 // Derselbe Editor für allgemeine Kontaktwege und Wege eines Ansprechpartners.
 function ways(body,get,set){
  const list=E('div','am-editor-cards');body.append(list);
  function update(id,k,v){set(get().map(x=>x.id===id?{...x,[k]:v}:x))}
  function render(){list.replaceChildren();for(const w of get()){const card=E('fieldset','am-editor-card');card.dataset.wayId=w.id;card.append(E('legend','',w.label||'Kontaktweg'));const grid=E('div','am-form-grid');field(grid,'Art',w.type,v=>{set(get().map(x=>x.id===w.id?{...x,type:v,preferred:false}:x));render()},{options:Object.entries(T.TYPES)});field(grid,'Bezeichnung',w.label,v=>update(w.id,'label',v),{required:true,maxLength:200});const val=field(grid,'Adresse, Rufnummer oder Kennung',w.value,v=>update(w.id,'value',v),{type:w.type==='email'?'email':'text',required:true,maxLength:1000});val.parentElement.classList.add('am-wide');const label=E('label','am-check-label'),check=E('input');check.type='checkbox';check.checked=!!w.preferred;check.setAttribute('aria-label','Bevorzugter Kontaktweg: '+(w.label||T.TYPES[w.type]));check.onchange=()=>{set(get().map(x=>({...x,preferred:x.id===w.id?check.checked:x.type===w.type&&check.checked?false:x.preferred})));render()};label.append(check,document.createTextNode('Bevorzugt für '+T.TYPES[w.type]));card.append(grid,label,ownButton('Kontaktweg entfernen',()=>{if(!confirm('Diesen Kontaktweg entfernen?'))return;set(get().filter(x=>x.id!==w.id));render()},'danger'));list.append(card)}}
  body.append(ownButton('+ Kontaktweg',()=>{set([...get(),{id:crypto.randomUUID(),type:'email',label:'',value:'',preferred:false}]);render();list.lastElementChild.querySelectorAll('input')[0].focus()},'primary'));render();return render;
 }
 function labels(body,e,key,title){
  const box=E('div','am-label-editor'),chips=E('div','am-chips'),line=E('div','am-label-entry');box.append(E('h3','',title),chips,line);body.append(box);const input=field(line,'Neue Bezeichnung','',()=>{},{id:'amLabel_'+key,maxLength:100});
  function render(){chips.replaceChildren();for(const text of e.draft[key]||[]){const b=ownButton(text+' ×',()=>{changed(key,e.draft[key].filter(x=>x!==text));render()},'am-chip');b.setAttribute('aria-label',title+': '+text+' entfernen');chips.append(b)}}
  const add=()=>{if(!input.value.trim())return;changed(key,D.labels([...(e.draft[key]||[]),input.value]));input.value='';if(e.unfinishedLabels)e.unfinishedLabels[key]='';render()};line.append(ownButton('Hinzufügen',add));input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();add()}};
  const suggestions=[...new Set(api().contacts().flatMap(c=>c[key]||[]))],dl=E('datalist');dl.id='amSuggestions_'+key;for(const s of suggestions)dl.append(new Option(s,s));input.setAttribute('list',dl.id);box.append(dl);render();
  // Noch nicht mit Enter bestätigte Bezeichnungen gehören ebenfalls zum Formularentwurf.
  input.oninput=()=>{e.unfinishedLabels=e.unfinishedLabels||{};e.unfinishedLabels[key]=input.value};input.onchange=()=>{add();if(e.unfinishedLabels)e.unfinishedLabels[key]=''};
  e.commitLabels=e.commitLabels||[];e.commitLabels.push(()=>{add();if(e.unfinishedLabels)e.unfinishedLabels[key]=''});
 }
 function extras(body,e){
  const list=E('div','am-editor-cards');body.append(list);
  function render(){list.replaceChildren();for(const f of e.draft.customFields||[]){const card=E('fieldset','am-editor-card');card.dataset.customFieldId=f.id;card.append(E('legend','','Zusatzfeld'));const grid=E('div','am-form-grid');field(grid,'Feldname',f.label,v=>changedArray('customFields',f.id,'label',v),{required:true,maxLength:100});field(grid,'Feldart',f.type,v=>{changedArray('customFields',f.id,'type',v);render()},{options:[['text','Text'],['number','Zahl'],['date','Datum'],['select','Auswahl']]});
   let value;if(f.type==='select'){const opts=field(grid,'Auswahlmöglichkeiten (eine pro Zeile)',(f.options||[]).join('\n'),v=>{const options=v.split('\n').map(x=>x.trim()).filter(Boolean);changedArray('customFields',f.id,'options',options);value.replaceChildren(new Option('Bitte wählen …',''),...options.map(o=>new Option(o,o)));value.value=e.draft.customFields.find(x=>x.id===f.id).value||''},{type:'textarea'});opts.parentElement.classList.add('am-wide');value=field(grid,'Wert',f.value,v=>changedArray('customFields',f.id,'value',v),{options:[['','Bitte wählen …'],...(f.options||[]).map(o=>[o,o])]})}
   else{value=field(grid,'Wert',f.value,v=>changedArray('customFields',f.id,'value',v),{type:f.type==='date'?'date':'text',maxLength:2000});if(f.type==='number')value.inputMode='decimal'}
   value.parentElement.classList.add('am-wide');card.append(grid,ownButton('Zusatzfeld entfernen',()=>{if(!confirm('Dieses Zusatzfeld entfernen?'))return;changed('customFields',e.draft.customFields.filter(x=>x.id!==f.id));render()},'danger'));list.append(card)}}
  body.append(ownButton('+ Zusatzfeld',()=>{if((e.draft.customFields||[]).length>=100)throw Error('Höchstens 100 Zusatzfelder sind möglich.');changed('customFields',[...(e.draft.customFields||[]),{id:crypto.randomUUID(),label:'',type:'text',value:'',options:[]}]);render();list.lastElementChild.querySelector('input').focus()},'primary'));render();
 }
 function imageEditor(body,e){
  const preview=E('div','am-editor-image-preview'),controls=E('div','am-editor-image-controls');body.append(preview,controls);const kind=field(controls,'Bildart',e.draft.imageKind||(e.draft.institution?'logo':'photo'),v=>changed('imageKind',v),{id:'amEdit_imageKind',options:[['photo','Kontaktfoto'],['logo','Institutionslogo']]});const input=field(controls,'Bild auswählen','',()=>{},{type:'file'});input.accept='image/png,image/jpeg,image/webp';let revision=0;
  const refresh=()=>{const img=X.photo(e.draft,'am-image-preview');preview.replaceChildren(...(img?[img]:[E('span','am-sub','Kein Bild hinterlegt')]));remove.hidden=!img};
  const remove=ownButton('Bild entfernen',()=>{revision++;input.value='';changed('imageData','');changed('imageKind','');refresh()},'quiet');controls.append(remove);
  input.oninput=null;input.onchange=()=>{const file=input.files?.[0];if(!file)return;const token=++revision;const job=(async()=>{try{const data=await X.thumbnail(file);if(M.editor!==e||token!==revision||!input.isConnected)return;changed('imageData',data);changed('imageKind',kind.value);refresh()}catch(err){if(M.editor===e){e.error=true;message(err.message,true)}}})();e.processing=job;job.finally(()=>{if(e.processing===job)e.processing=null})};refresh();
 }
 function render(form,e,focus){
  form.replaceChildren();e.refreshCollections={};e.commitLabels=[];e.unfinishedLabels={};
  const groups=[['basic','Grunddaten',GROUPS[0][1]],['image','Kontaktbild / Institutionslogo',[]],['addresses','Anschriften',addressKeys],['ways','Kontaktwege',GROUPS[2][1]],['availability','Erreichbarkeit',['preferredChannel','phoneHours','absentFrom','absentUntil','absenceNote','substituteContactId']],['references','Referenzen & Bank',GROUPS[3][1]],['organisation','Schlagwörter & Gruppen',[]],['custom','Zusatzangaben',[]],['notes','Notizen',['note']]];
  for(const [key,title,keys] of groups){
   const filled=keys.some(k=>e.draft[k])||({image:e.draft.imageData,addresses:e.draft.addresses?.length,ways:e.draft.contactWays?.length,organisation:e.draft.tags?.length||e.draft.groups?.length,custom:e.draft.customFields?.length})[key];
   const body=fold(form,key,title,['basic','addresses','ways','notes'].includes(key)||filled||focus===key),grid=E('div','am-form-grid');if(keys.length)body.append(grid);
   for(const k of keys){if(k==='customerNumber'&&e.ref.scope==='office')continue;let options;
    if(k==='_category'){const cats=window.__abModernCategories?.()||[{id:'soziales',label:'Soziales'}];options=[['','Bitte wählen …'],...cats.map(c=>[c.id,c.label])];if(e.draft[k]&&!options.some(([v])=>v===e.draft[k]))options.push([e.draft[k],'Bisherige Kategorie: '+e.draft[k]])}
    if(k==='preferredChannel')options=[['','Keine Vorgabe'],...Object.entries(CHANNELS)];
    if(k==='substituteContactId'){const contacts=window.__baModernContacts?.()||[];options=[['','Keine Vertretung'],...contacts.filter(c=>(c.__buero||!c.__caseId)&&c.id!==e.ref.id&&c.id!==e.bundle.centralId).map(c=>[c.id,name(c)])];if(e.draft[k]&&!options.some(([v])=>v===e.draft[k]))options.push([e.draft[k],'Bisherige Vertretung']);}
    const input=field(grid,LABELS[k],e.draft[k],v=>changed(k,v),{id:'amEdit_'+k,options,type:k==='note'?'textarea':k==='email'?'email':['absentFrom','absentUntil'].includes(k)?'date':'text'});
    if(k==='note'){input.className='am-note-input';input.parentElement.className='am-note-field';input.parentElement.firstChild.remove();input.setAttribute('aria-label','Notizen');input.title='Wächst beim Schreiben. Am unteren rechten Rand mit der Maus vergrößerbar.'}
    if(['status','role','salutation','title','houseLetter','phoneArea','mobileArea','faxArea'].includes(k)){input.setAttribute('data-combo','ab_'+k);input.autocomplete='off'}if(['postal','city','institution','house'].includes(k))input.setAttribute('data-combo',({postal:'ab_plz',city:'ab_ort',institution:'sd_institution',house:'sd_hausnummer'})[k]);
   }
   if(key==='image'){body.classList.add('am-editor-image');imageEditor(body,e)}
   if(key==='addresses')addresses(body,e);
   if(key==='ways'){body.append(E('p','am-sub','Weitere Wege benennen und bei Bedarf je Art bevorzugen.'));e.refreshCollections.contactWays=ways(body,()=>e.draft.contactWays||[],v=>changed('contactWays',v))}
   if(key==='organisation'){labels(body,e,'tags','Schlagwörter');labels(body,e,'groups','Gruppen')}
   if(key==='custom')extras(body,e);
  }
  if(e.bundle.centralId)form.querySelector('[data-section=basic] .am-editor-section-body').prepend(E('p','am-sub','Gemeinsame Kontaktdaten gelten in allen zugeordneten Fällen. Rolle und Referenzen bleiben fallbezogen.'));
  autoSizeNote(form.querySelector('#amEdit_note'));if(focus)go(form,focus);
  e.render=()=>render(form,e,focus);e.form=form;
 }
 function validate(e,commitLabels=true){
  if(e.new&&!String(e.draft.institution||'').trim()&&!String(e.draft.lastName||'').trim())throw Error('Bitte Institution oder Nachname angeben.');
  if(commitLabels)for(const commit of e.commitLabels||[])commit();
  const invalid=e.form?.querySelector(':invalid');if(invalid){for(let p=invalid.parentElement;p&&p!==e.form;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;throw Error('Bitte die markierten Felder vollständig und gültig ausfüllen.')}
  window.__abValidateImport(structuredClone(e.draft));
 }
 function overview(body,c,d){
  const p=person(),profile=p||d,editLink=(section,label)=>B(label,()=>edit(c,{},section),'quiet');
  const additional=(d.addresses||[]).filter(a=>a.id!==d.preferredAddressId);if(d.preferredAddressId)additional.unshift({...d,label:'Hauptanschrift'});
  if(additional.length){const box=E('details','am-overview-fold');box.append(E('summary','',additional.length+' weitere Anschrift'+(additional.length>1?'en':'')));for(const a of additional)info(box,a.label,api().address(a)+(a.country?', '+a.country:''),'address');box.append(editLink('addresses','Anschriften bearbeiten'));body.append(box)}
  const extra=(profile.contactWays||[]).filter(w=>w.value!==profile[w.type]||!['email','phone','mobile','fax'].includes(w.type));
  if(extra.length){const box=section('Weitere Kontaktwege');for(const w of extra){info(box,w.label+(w.preferred?' · Bevorzugt':''),w.value,w.type==='email'?'email':w.type==='fax'?'fax':T.PHONE_TYPES.includes(w.type)?'phone':undefined);if(['website','portal'].includes(w.type)&&T.safeUrl(w.value)){const a=E('a','am-btn','Öffnen');a.href=T.safeUrl(w.value);a.target='_blank';a.rel='noopener noreferrer';box.lastElementChild.querySelector('.am-info-value')?.append(a)}}box.append(p?B('Kontaktwege bearbeiten',()=>editPerson(c,p),'quiet'):editLink('ways','Kontaktwege bearbeiten'));body.append(box)}
  const reachKeys=['preferredChannel','phoneHours','absentFrom','absentUntil','absenceNote','substituteContactId','substitutePersonId'];if(reachKeys.some(k=>d[k]||p?.[k]))drawAvailability(body,c,d);
  if(d.tags?.length||d.groups?.length){const box=section('Organisation');for(const [k,label] of [['tags','Schlagwörter'],['groups','Gruppen']])if(d[k]?.length){box.append(E('span','am-sub',label));const chips=E('div','am-chips');for(const v of d[k])chips.append(E('span','am-chip',v));box.append(chips)}box.append(editLink('organisation','Organisation bearbeiten'));body.append(box)}
  const fields=(d.customFields||[]).filter(f=>String(f.value??'').trim());if(fields.length){const box=section('Zusatzangaben');for(const f of fields)info(box,f.label,f.type==='date'?dateLabel(f.value):f.value);box.append(editLink('custom','Zusatzangaben bearbeiten'));body.append(box)}
 }
 // Änderungen innerhalb wiederholbarer Felder nach ID zusammenführen. Unberührte
 // Unterfelder und parallel hinzugefügte Einträge bleiben bei Konflikten erhalten.
 function merge(base,own,remote){
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  if(same(own,base))return structuredClone(remote);if(same(remote,base)||same(own,remote))return structuredClone(own);
  if(Array.isArray(own)&&Array.isArray(remote)&&[...own,...remote,...(base||[])].every(v=>v&&typeof v==='object'&&v.id)){
   const old=new Map((base||[]).map(v=>[v.id,v])),local=new Map(own.map(v=>[v.id,v])),fresh=new Map(remote.map(v=>[v.id,v]));const out=[];
   for(const r of remote){if(!local.has(r.id)){if(!old.has(r.id))out.push(r);continue}out.push(merge(old.get(r.id),local.get(r.id),r))}
   for(const l of own)if(!fresh.has(l.id)&&(!old.has(l.id)||!same(l,old.get(l.id))))out.push(l);return out;
  }
  if(own&&remote&&typeof own==='object'&&typeof remote==='object'&&!Array.isArray(own)&&!Array.isArray(remote))return Object.fromEntries([...new Set([...Object.keys(remote),...Object.keys(own)])].map(k=>[k,merge(base?.[k],own[k],remote[k])]));
  return structuredClone(own);
 }
 return {render,validate,overview,ways,merge};
})();
