/* Produktives Adressbuch. Die bestehenden Import-/Export-/Merge-Wege bleiben über ihre Original-
   Bedienelemente angebunden. Kein Demodatensatz und kein paralleler Browser-Speicher im Online-Modus. */
(function(){
'use strict';
const M={root:null,rows:[],selected:'',tab:'data',editor:null,bundle:null,load:0,width:42};
const $=s=>M.root?.querySelector(s),E=(t,cls,text)=>{const e=document.createElement(t);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
const B=(label,action,cls='',skipFlush=false)=>{const b=E('button','am-btn '+cls,label);b.type='button';b.onclick=async()=>{try{if(skipFlush||await flush())await action()}catch(e){message(e.message,true)}};return b};
const api=()=>window.__abModernLegacy;
const online=()=>window.__appMode==='online';
const activeCase=()=>String(window.__activeServerCaseId||window.caseIdentityOf?.(state)||'');
const ref=c=>({scope:c.__buero?'office':'case',caseId:c.__buero?'':String(c.__caseId||activeCase()),id:String(c.id||''),localKey:c.id?'':api().key(c)});
const identity=c=>JSON.stringify([ref(c).scope,ref(c).caseId,c.id||api().key(c)]);
const name=c=>[c.institution,[c.title,c.firstName,c.lastName].filter(Boolean).join(' ')].filter(Boolean).join(' – ')||c.role||'Unbenannter Kontakt';
const isEnded=c=>String(c.status||'').toLowerCase()==='beendet';
const selected=()=>M.rows.find(c=>identity(c)===M.selected);
async function request(path,body,method){const r=await fetch('/api/addressbook/'+path,{method:method||(body?'POST':'GET'),credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error||'Das Adressbuch ist momentan nicht erreichbar.');e.status=r.status;throw e}return j}
function message(text,error=false){const el=$('.am-save');if(el){el.textContent=text;el.classList.toggle('error',error)}if(error)window.toast?.(text)}
function status(){message(online()?'Online · Änderungen werden automatisch gespeichert':window.__demoModus?'Vorführung · Änderungen nur in dieser Sitzung':'Lokal · Excel zusätzlich zur Sicherung exportieren')}
function section(title){const e=E('section','am-section');e.append(E('h3','',title));return e}
function buttonSet(parent,buttons){for(const b of buttons)parent.append(b)}
function currentLink(c,person){const r=ref(c),p=person||null;return {...r,contactId:r.id,personId:p?.id||'',contactKey:c.key||window.phase5ContactKey?.(c)||api().key(c),snapshot:{label:p?[c.institution,p.name].filter(Boolean).join(' – '):name(c),institution:c.institution||'',person:p?.name||[c.title,c.firstName,c.lastName].filter(Boolean).join(' '),role:c.role||'',fileNumber:c.fileNumber||'',processNumber:c.processNumber||'',email:p?.email||c.email||'',phone:p?.phone||c.phone||''}}}
function person(){const id=$('#amPerson')?.value;return (selected()?.people||[]).find(p=>p.id===id)||null}
function personal(c,p){return p?{...c,key:c.key||window.phase5ContactKey?.(c)||api().key(c),salutation:p.salutation||c.salutation,_personId:p.id,firstName:p.name,lastName:'',title:'',email:p.email||c.email,phone:p.phone||c.phone,fax:p.fax||c.fax}:c}
function mount(){
 const host=document.getElementById('modalBody');if(!host||!api())return;
 const action=host.querySelector('.addressbook-action-row'),toolbar=host.querySelector('.addressbook-toolbar-v154'),scope=host.querySelector('.ab-case-switcher'),bulk=host.querySelector('.addressbook-select-row'),letters=host.querySelector('#abLetterBar'),list=host.querySelector('#phase5AddressListV154');
 if(!action||!toolbar||!list)return;
 M.root=E('div','am addressbook-view');M.root.id='addressbookModern';M.editor=null;M.bundle=null;
 const head=E('header','am-head'),title=E('div');title.append(E('h2','','Adressbuch'),E('p','am-sub','Kontakte, Ansprechpartner und Fallzuordnungen'));head.append(title);
 const tools=E('div','am-actions');
 tools.append(B('+ Neuer Kontakt',()=>edit(null),'primary'));
 const more=E('details','am-menu');more.append(E('summary','am-btn','Importieren & exportieren'));
 const menubody=E('div','am-menu-body');for(const node of [...action.children]){
  if(node.matches('button')&&/Neuer.*Kontakt/.test(node.textContent))continue;
  menubody.append(node);
 }
 // Excel bleibt auch in der Büroansicht über die bestehende Datenadministration erreichbar.
 if(!menubody.textContent.includes('Excel'))menubody.append(B('Excel-Sicherung des aktuellen Falls',()=>window.addressbookDownloadUpdated()));
 more.append(menubody);tools.append(more);head.append(tools);
 const context=E('div','am-context');if(scope)context.append(scope);else context.append(E('strong','',window.fullName?.()||'Aktueller Fall'));
 context.append(E('div','am-save'));M.root.append(head,context);
 const search=toolbar.querySelector('#phase5AddressSearchV154').parentElement;search.className='am-search';
 const top=E('div','am-tools');top.append(search);const filter=E('details','am-filters'),summary=E('summary','am-btn','Filter & Sortierung');filter.append(summary,toolbar);top.append(filter);M.root.append(top);
 const board=E('div','am-board'),left=E('section','am-list-pane'),right=E('section','am-detail');right.setAttribute('aria-label','Kontaktdetails');
 const tabs=E('div','am-status-tabs');for(const [v,label] of [['active','Aktive'],['all','Alle'],['ended','Beendete']]){
  const b=B(label,()=>{document.getElementById('phase5AddressStatusV154').value=v;window.phase5RenderAddressbookV154()});b.dataset.status=v;tabs.append(b);
 }
 left.append(tabs);const listmeta=E('div','am-list-meta');const count=toolbar.querySelector('#phase5AddressCountV154');if(count)listmeta.append(count);left.append(listmeta);
 const selection=E('div','am-selection');selection.append(B('Alle auswählen',()=>window.__abCsvSelectAll(true)),B('Auswahl aufheben',()=>window.__abCsvSelectAll(false)),B('Als aktiv markieren',()=>bulkStatus('Aktiv')),B('Als beendet markieren',()=>bulkStatus('Beendet')));left.append(selection);if(letters)left.append(letters);left.append(list);
 const grip=E('div','am-resizer');grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');grip.setAttribute('aria-label','Breite der Kontaktliste');
 board.append(left,grip,right);M.root.append(board);host.replaceChildren(M.root);
 document.getElementById('modal').classList.remove('addressbook-mobile-filters-collapsed');
 document.getElementById('modal').classList.add('am-modal');
 try{M.width=Math.max(28,Math.min(65,Number(localStorage.getItem('addressbook.split.v1'))||42))}catch(_e){}
 const resize=v=>{M.width=Math.max(28,Math.min(65,v));board.style.setProperty('--am-split',M.width+'%');grip.setAttribute('aria-valuenow',Math.round(M.width));grip.setAttribute('aria-valuemin','28');grip.setAttribute('aria-valuemax','65')};resize(M.width);
 const saveWidth=()=>{try{localStorage.setItem('addressbook.split.v1',String(M.width))}catch(_e){}};
 grip.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();grip.setPointerCapture(e.pointerId);grip.classList.add('dragging')};
 grip.onpointermove=e=>{if(grip.hasPointerCapture(e.pointerId)){const r=board.getBoundingClientRect();resize((e.clientX-r.left)/r.width*100)}};
 grip.onpointerup=e=>{if(grip.hasPointerCapture(e.pointerId))grip.releasePointerCapture(e.pointerId);grip.classList.remove('dragging');saveWidth()};
 grip.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();resize(e.key==='Home'?28:e.key==='End'?65:M.width+(e.key==='ArrowLeft'?-2:2));saveWidth()}};
 grip.ondblclick=()=>{resize(42);saveWidth()};
 // Original-Menüaktionen vor dem Verlassen des Autosave-Formulars abwarten.
 M.root.addEventListener('click',async e=>{const b=e.target.closest('.am-menu-body button,.am-menu-body label');if(!b||!M.editor||b.__amReplay)return;e.preventDefault();e.stopImmediatePropagation();if(await flush()){M.editor=null;b.__amReplay=true;b.click();b.__amReplay=false}},true);
 M.root.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#phase5AddressSearchV154')?.focus()}if(e.key==='Escape'&&filter.open){e.stopPropagation();filter.open=false}},false);
 const scopeValue=scope?.querySelector('select')?.value;
 M.root.addEventListener('change',async e=>{const el=e.target;if(!M.editor||!el.closest('.ab-case-switcher')||el.__amReplay)return;e.stopImmediatePropagation();if(await flush()){M.editor=null;el.__amReplay=true;el.dispatchEvent(new Event('change',{bubbles:true}));el.__amReplay=false}else el.value=scopeValue},true);
 status();
 const root=M.root;if(online())Promise.resolve(window.__baLoadServerBuero?.()).then(()=>{if(M.root===root&&root.isConnected&&!M.editor)window.phase5RenderAddressbookV154()});
}
function render(rows,v){
 if(!M.root?.isConnected)return;M.rows=rows;
 const list=$('#phase5AddressListV154'),scroll=list.scrollTop;list.replaceChildren();
 if(!rows.length){list.append(E('p','am-empty','Keine Kontakte für diese Filter.'));M.selected='';if(!M.editor)$('.am-detail').replaceChildren(E('p','am-empty','Filter anpassen oder einen neuen Kontakt anlegen.'));return}
 if(!rows.some(c=>identity(c)===M.selected))M.selected=identity(rows[0]);
 for(const c of rows){const row=E('article','addressbook-card am-row');row.dataset.abLetter=api().letter(c,v);row.classList.toggle('selected',identity(c)===M.selected);
  const check=E('input');check.type='checkbox';check.checked=api().selected().has(api().key(c));check.setAttribute('aria-label',name(c)+' auswählen');check.onchange=()=>{window.__abCsvToggle(api().key(c),check.checked);selectionCount()};row.append(check);
  const open=B('',()=>choose(c));open.className='am-row-open';const icon=E('span','am-avatar',c.institution?'▤':([c.firstName?.[0],c.lastName?.[0]].filter(Boolean).join('')||'○'));
  const text=E('span','am-row-copy');text.append(E('strong','',api().title(c,v.nameOrder)),E('span','am-sub',[c.role,api().person(c,v.nameOrder),c.__cases||'',isEnded(c)?'Beendet':''].filter(Boolean).join(' · ')));open.append(icon,text);row.append(open);list.append(row);
 }
 list.scrollTop=scroll;for(const b of M.root.querySelectorAll('[data-status]'))b.setAttribute('aria-pressed',String(b.dataset.status===v.status));selectionCount();
 if(!M.editor)drawDetail(selected());
}
function selectionCount(){const n=api().selected().size;let el=$('#amSelectionCount');if(!el){el=E('span');el.id='amSelectionCount';$('.am-list-meta')?.append(el)}el.textContent=n?n+' ausgewählt':'';$('.am-selection')?.classList.toggle('has-selection',!!n);for(const b of M.root.querySelectorAll('.am-selection button'))if(!b.textContent.startsWith('Alle'))b.disabled=!n}
async function bulkStatus(status){const rows=api().contacts().filter(c=>api().selected().has(api().key(c)));let saved=0,errors=[];for(const c of rows){const key=api().key(c);try{await savePatch(c,{status});api().selected().delete(key);saved++}catch(e){errors.push(e.message)}}window.phase5RenderAddressbookV154();message(saved+' Kontakt(e) geändert.'+(errors.length?' '+errors.length+' nicht gespeichert: '+errors[0]:''),!!errors.length)}
async function choose(c){if(!await flush())return;M.editor=null;M.selected=identity(c);M.tab='data';M.root.classList.add('am-show-detail');window.phase5RenderAddressbookV154()}
async function loadDetails(c){
 const token=++M.load;const r=ref(c);if(!online()||!r.id){M.bundle={contact:c,history:c._addressHistory||[],associations:[],communications:localCommunications(c)};return M.bundle}
 const result=await request('contact?'+new URLSearchParams(r));if(token!==M.load||M.selected!==identity(c))return null;M.bundle=result;return result;
}
function localCommunications(c){const r=ref(c),caseId=r.scope==='case'?r.caseId:activeCase(),cd=caseId===activeCase()?state.caseData:window.__onlineCaseCache?.get(caseId)?.data||(window.caseRegistry||[]).find(e=>e.id===caseId)?.state?.caseData;return (cd?.documentationEntries||[]).filter(e=>{const l=e.contactLink;return l&&(l.scope||'case')===r.scope&&(r.scope==='office'||!l.caseId||l.caseId===caseId)&&(c.id?l.contactId===c.id:!!l.contactKey&&l.contactKey===(c.key||window.phase5ContactKey?.(c)||api().key(c)))}).map(e=>({id:e.id,caseId,title:e.detail||e.type,date:e.date,text:e.freeDetail||e.note,contactType:e.contactType}))}
function info(parent,label,value,kind){if(!value)return;const wrap=E('div','am-info'),copy=B('Kopieren',()=>navigator.clipboard.writeText(String(value)),'quiet');copy.setAttribute('aria-label',label+' kopieren');const content=E('div');content.append(E('span','am-sub',label));
 if(kind==='address'&&window.__mapAddressLinkHTML){const d=E('div');d.innerHTML=window.__mapAddressLinkHTML(String(value));content.append(d)}else if(kind==='phone'){const a=E('a','',value);a.href='tel:'+String(value).replace(/[^+\d]/g,'');content.append(a)}else content.append(E('div','',value));wrap.append(content,copy);parent.append(wrap)}
function drawDetail(c){
 if(!c)return;const pane=$('.am-detail');pane.replaceChildren();const top=E('div','am-detail-top');top.append(B('← Kontakte',()=>M.root.classList.remove('am-show-detail'),'am-back quiet'),E('span','am-badge'+(isEnded(c)?' ended':''),isEnded(c)?'Beendet':'Aktiv'),B(c.__viewMergeId?'Fallkontakte öffnen':'Bearbeiten',()=>edit(c)));pane.append(top,E('h2','',name(c)),E('p','am-sub',c.role||'Ohne Rolle'));
 const people=E('div','am-person');if(c.people?.length){const label=E('label','','Ansprechpartner'),select=E('select');select.id='amPerson';select.append(new Option('Institution / allgemeiner Kontakt',''));for(const p of c.people)select.append(new Option([p.name,p.department].filter(Boolean).join(' · '),p.id));select.onchange=()=>drawTab(c);label.append(select);people.append(label)}pane.append(people);
 const actions=E('div','am-detail-actions');
 const k=api().key(c),r=ref(c);
 if(!c.__viewMergeId&&r.scope==='case'&&r.caseId===activeCase())actions.append(B('Für aktuelles Dokument verwenden',()=>useDocument(c,person()),'primary'));
 if(!c.__viewMergeId)actions.append(B('Dokumentation anlegen',()=>documentContact(c,person())));actions.append(B('E-Mail intern',()=>mail(c,person(),true)),B('E-Mail extern',()=>mail(c,person(),false)));
 if(!c.email&&!c.people?.some(p=>p.email)){actions.querySelectorAll('button').forEach(b=>{if(b.textContent.startsWith('E-Mail'))b.disabled=true})}
 pane.append(actions);
 if(c.__viewMergeId){M.tab='data';pane.append(E('p','am-sub','Zusammengeführte Ansicht. Die ursprünglichen Fallkontakte bleiben erhalten.'),B('Zusammenführung verwalten',()=>window.openBueroAddressModal()))}
 const tabs=E('nav','am-tabs');tabs.setAttribute('aria-label','Kontaktdetails');for(const [key,label] of [['data','Kontaktdaten'],['cases','Fälle & Standard'],['people','Ansprechpartner'],['history','Änderungen'],['communication','Kommunikation']]){if(c.__viewMergeId&&key!=='data')continue;const b=B(label,()=>{M.tab=key;drawTab(c)});b.dataset.tab=key;tabs.append(b)}pane.append(tabs,E('div','am-tab-body'));
 const more=E('details','am-more');more.append(E('summary','am-btn','Weitere Kontaktaktionen'));const other=E('div','am-detail-actions');
 other.append(B('Daten kopieren',()=>copyContact(c)),B('Faxnummer kopieren',()=>navigator.clipboard.writeText(person()?.fax||c.fax||'')));if(!c.__viewMergeId)other.append(B(isEnded(c)?'Aktivieren':'Beenden',()=>saveStatus(c,!isEnded(c))),B('Löschen',()=>removeContact(c),'danger'));
 if(r.scope==='case'&&r.caseId!==activeCase())other.append(B('Fall öffnen & bearbeiten',()=>window.__abSwitchCase(r.caseId)));
 more.append(other);pane.append(more);
 M.bundle=null;drawTab(c);loadDetails(c).then(x=>{if(x&&!M.editor&&M.selected===identity(c))drawTab(c)}).catch(e=>{if(M.selected===identity(c)){$('.am-tab-body').append(E('p','am-error',e.message));$('.am-tab-body').append(B('Erneut laden',()=>drawDetail(c)))}});
}
function drawTab(c){
 const body=$('.am-tab-body');if(!body||M.editor)return;body.replaceChildren();for(const b of M.root.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',String(b.dataset.tab===M.tab));
 const data=M.tab==='data'?personal(M.bundle?.contact||c,person()):M.bundle?.contact||c;
 if(M.tab==='data'){
  const s=section(person()?.name||'Kontaktinformationen');info(s,'Anschrift',api().address(data),'address');info(s,'E-Mail',data.email);info(s,'Telefon',data.phone,'phone');info(s,'Mobil',data.mobile,'phone');info(s,'Fax',data.fax);info(s,'Aktenzeichen',data.fileNumber);info(s,'Vorgangsnummer',data.processNumber);info(s,'IBAN',data.iban);info(s,'BIC',data.bic);info(s,'Bank',data.bankName);if(data.note)s.append(E('p','am-note',data.note));body.append(s);return;
 }
 if(!M.bundle){body.append(E('p','am-empty','Kontaktinformationen werden geladen …'));return}
 if(M.tab==='people'){
  body.append(E('p','am-sub','Bei Dokumenten, E-Mail und Dokumentation kann gezielt ein Ansprechpartner ausgewählt werden.'));
  for(const p of data.people||[]){const s=section(p.name);s.append(E('p','am-sub',[p.department,p.role,p.email,p.phone].filter(Boolean).join(' · ')),B('Bearbeiten',()=>editPerson(c,p)),B('Entfernen',()=>deletePerson(c,p),'danger'));body.append(s)}
  body.append(B('+ Ansprechpartner',()=>editPerson(c,null),'primary'));
 }else if(M.tab==='cases'){
  body.append(E('p','am-sub','Gemeinsame Stammdaten werden in allen zugeordneten Fällen aktualisiert. Aktenzeichen und Rolle bleiben fallspezifisch.'));
  for(const a of M.bundle.associations){const s=section(a.label);s.append(E('p','am-sub',[a.role,a.fileNumber||'Ohne Aktenzeichen',a.status].filter(Boolean).join(' · ')));
   for(const [purpose,label] of [['document','Dokumente'],['mail','E-Mail']]){const marked=Object.hasOwn(a.standards||{},purpose);s.append(B((marked?'✓ Standard für ':'Als Standard für ')+label,()=>setStandard(c,a,purpose,marked)))}
   if(M.bundle.centralId&&online())s.append(B('Zentrale Zuordnung lösen',()=>detach(c,a),'quiet'));body.append(s)}
  if(online())body.append(B('+ Weiterem Fall zuordnen',()=>assign(c),'primary'));else body.append(E('p','am-sub','Zentrale Fallzuordnungen werden im Online-Modus verwaltet.'));
 }else if(M.tab==='history'){
  if(!M.bundle.history.length)body.append(E('p','am-empty','Noch keine protokollierten Änderungen. Neue Änderungen werden mit Datum, Bearbeiter und vorherigem Wert erfasst.'));
  for(const h of M.bundle.history){const s=section(new Date(h.at).toLocaleString('de-DE')+' · '+h.actor);for(const [k,v] of Object.entries(h.changes)){s.append(E('p','am-history-line',(LABELS[k]||k)+': '+displayValue(v.before)+' → '+displayValue(v.after)))}if(Object.keys(h.changes).some(k=>Object.hasOwn(LABELS,k)&&k!=='_standardRecipients'))s.append(B('Diese Änderung rückgängig machen',()=>restore(c,h)));else s.append(E('p','am-sub','Fallzuordnungen und Standardempfänger lassen sich unter „Fälle & Standard“ anpassen.'));body.append(s)}
 }else{
  body.append(B('+ Kommunikation dokumentieren',()=>documentContact(c,person()),'primary'));
  if(!M.bundle.communications.length)body.append(E('p','am-empty','Noch keine verknüpfte Kommunikation. Einträge werden gemeinsam mit der Falldokumentation geführt.'));
  for(const item of M.bundle.communications){const s=section(item.title);s.append(E('p','am-sub',[item.date,item.caseLabel,item.contactType,item.person].filter(Boolean).join(' · ')),E('p','am-note',item.text),B('In Falldokumentation öffnen',()=>openDoku(item)));body.append(s)}
 }
}
function displayValue(v){return v==null||v===''?'—':Array.isArray(v)?v.map(x=>x.name||'').join(', '):typeof v==='object'?JSON.stringify(v):String(v)}
function localHistory(before,after){const changes={};for(const k of Object.keys(LABELS))if(JSON.stringify(before?.[k]??null)!==JSON.stringify(after[k]??null))changes[k]={before:before?.[k]??null,after:after[k]??null};return Object.keys(changes).length?[{id:crypto.randomUUID(),at:new Date().toISOString(),actor:'Lokal',changes},...(before?._addressHistory||[])].slice(0,100):before?._addressHistory||[]}
async function refreshCase(id){if(!online())return;const response=await fetch('/api/cases/'+encodeURIComponent(id)+'/contacts',{credentials:'same-origin'});if(!response.ok)throw Error('Fallkontakte konnten nicht aktualisiert werden. Bitte das Adressbuch erneut öffnen.');const j=await response.json(),list=(j.contacts||[]).map(x=>({...x.data,id:x.id}));const cached=window.__onlineCaseCache?.get(id);if(cached?.data)cached.data.contacts=list;if(id===activeCase())state.caseData.contacts=list}
async function cacheBundle(bundle,r){
 const row={...bundle.contact};if(row.institution||row.lastName)row.key=window.phase5ContactKey?.(row)||row.key;
 if(r.scope==='office')window.__baModernApply?.(row);
 else for(const cd of [r.caseId===activeCase()?state.caseData:null,window.__onlineCaseCache?.get(r.caseId)?.data,...(window.caseRegistry||[]).filter(e=>e.id===r.caseId).map(e=>e.state?.caseData)].filter(Boolean)){
  const list=cd.contacts=cd.contacts||[];const i=list.findIndex(x=>x.id===row.id||(r.localKey&&api().key(x)===r.localKey));if(i>=0)list[i]={...row};else list.push({...row});
 }
 const local=M.rows.findIndex(x=>String(x.id||'')===String(row.id)&&ref(x).scope===r.scope&&ref(x).caseId===r.caseId);if(local>=0)M.rows[local]={...M.rows[local],...row};
 if(!online()){saveState();return}
 // Nach einer zentralen Änderung auch alle sichtbaren Fallprojektionen nachladen (Excel und Empfänger).
 for(const a of bundle.associations||[]){if(a.caseId===r.caseId)continue;try{const response=await fetch('/api/cases/'+encodeURIComponent(a.caseId)+'/contacts',{credentials:'same-origin'});if(!response.ok)continue;const j=await response.json(),list=(j.contacts||[]).map(x=>({...x.data,id:x.id}));const cached=window.__onlineCaseCache?.get(a.caseId);if(cached?.data)cached.data.contacts=list;if(a.caseId===activeCase())state.caseData.contacts=list}catch(_e){}}
}
const GROUPS=[['Grunddaten',['_category','status','role','salutation','title','firstName','lastName','institution']],['Anschrift',['street','house','houseLetter','postal','city','postbox']],['Kontakt',['phoneArea','phoneNumber','mobileArea','mobileNumber','email','faxArea','faxNumber']],['Referenzen & Bank',['fileNumber','processNumber','iban','bic','bankName']],['Notizen',['note']]];
const LABELS={_category:'Kategorie',status:'Status',role:'Rolle',salutation:'Anrede',title:'Titel',firstName:'Vorname',lastName:'Nachname',institution:'Institution',street:'Straße',house:'Hausnummer',houseLetter:'Zusatz',postal:'PLZ',city:'Ort',postbox:'Postfach',phoneArea:'Vorwahl Telefon',phoneNumber:'Telefon',mobileArea:'Vorwahl Mobil',mobileNumber:'Mobil',email:'E-Mail',faxArea:'Vorwahl Fax',faxNumber:'Fax',fileNumber:'Aktenzeichen',processNumber:'Vorgangsnummer',iban:'IBAN',bic:'BIC',bankName:'Bankname',note:'Notizen',people:'Ansprechpartner',_standardRecipients:'Standardempfänger'};
async function edit(c){
 if(c?.__viewMergeId){window.__abSwitchCase(ref(c).caseId);return}
 if(!await flush())return;const r=c?ref(c):{scope:window.__abScope==='case'?'case':'office',caseId:window.__abScope==='case'?activeCase():'',id:''};
 let bundle=c?await loadDetails(c):{contact:{status:'Aktiv',_category:'soziales'},version:''};if(!bundle)return;
 const draft=structuredClone(bundle.contact);for(const k of ['phone','mobile','fax'])if(!draft[k+'Number']&&draft[k]){const parts=String(draft[k]).split('/');draft[k+'Area']=parts.length>1?parts.shift():'';draft[k+'Number']=parts.join('/')}
 window.__abModernSetupCombos?.(draft._category);
 M.editor={ref:r,c,bundle,draft,pending:{},saving:null,timer:null,error:false,new:!c};M.root.classList.add('am-show-detail');
 const pane=$('.am-detail');pane.replaceChildren();pane.append(E('h2','',c?'Kontakt bearbeiten':'Neuer Kontakt'),E('p','am-sub',online()?'Änderungen werden automatisch gespeichert, sobald Institution oder Nachname angegeben ist.':'Lokaler Kontakt · Änderungen mit „Fertig“ übernehmen.'));
 const form=E('form','am-edit');form.onsubmit=e=>{e.preventDefault();finishEdit()};
 for(const [title,fields] of GROUPS){const group=section(title),grid=E('div','am-form-grid');for(const k of fields){const l=E('label','',LABELS[k]);let input;
  if(k==='_category'){input=E('select');const categories=window.__abModernCategories?.()||[{id:'soziales',label:'Soziales'}];input.append(new Option('Bitte wählen …',''));for(const cat of categories)input.append(new Option(cat.label,cat.id));if(draft[k]&&!categories.some(c=>c.id===draft[k]))input.append(new Option('Bisherige Kategorie: '+draft[k],draft[k]))}
  else input=E(k==='note'?'textarea':'input');input.name=k;input.id='amEdit_'+k;input.value=draft[k]||'';if(k==='email')input.type='email';
  if(['status','role','salutation','title','houseLetter','phoneArea','mobileArea','faxArea'].includes(k)){input.setAttribute('data-combo','ab_'+k);input.autocomplete='off'}
  if(['postal','city','institution','house'].includes(k))input.setAttribute('data-combo',({postal:'ab_plz',city:'ab_ort',institution:'sd_institution',house:'sd_hausnummer'})[k]);
  input.oninput=()=>changed(k,input.value);input.onchange=()=>changed(k,input.value);l.append(input);grid.append(l)}group.append(grid);form.append(group)}
 const footer=E('div','am-edit-footer');const conflict=B('Änderungskonflikt auflösen',resolveConflict,'am-conflict',true);conflict.hidden=true;footer.append(B('Fertig',finishEdit,'primary'),B('Speichern erneut versuchen',()=>savePending(),'am-retry',true),conflict,B('Ungespeicherte Eingaben verwerfen',discard,'quiet',true));form.append(footer);pane.append(form);status();
}
function changed(k,v){const e=M.editor;if(!e)return;if(k==='_category')window.__abModernSetupCombos?.(v);e.draft[k]=v;e.pending[k]=v;e.error=false;
 for(const field of ['phone','mobile','fax'])if(k===field+'Area'||k===field+'Number'){e.pending[field]=[e.draft[field+'Area'],e.draft[field+'Number']].filter(Boolean).join('/');e.draft[field]=e.pending[field]}
 clearTimeout(e.timer);message(online()?'Änderungen noch nicht gespeichert …':'Lokale Änderungen noch nicht übernommen …');if(online())e.timer=setTimeout(()=>savePending(),650);
}
async function savePending(){
 const e=M.editor;if(!e)return true;clearTimeout(e.timer);if(e.saving){await e.saving;if(M.editor!==e)return true;return e.error?false:savePending()}
 if(!Object.keys(e.pending).length)return !e.error;
 if(!String(e.draft.institution||'').trim()&&!String(e.draft.lastName||'').trim()){message('Bitte Institution oder Nachname angeben.',true);return false}
 const email=e.draft.email||'';if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){message('Bitte eine gültige E-Mail-Adresse angeben.',true);return false}
 const sent=e.new?Object.fromEntries(Object.entries(e.draft).filter(([k])=>Object.hasOwn(LABELS,k)||['phone','mobile','fax'].includes(k))):{...e.pending};e.pending={};message('Wird gespeichert …');
 e.saving=(async()=>{
 try{
  let bundle;
  if(online())bundle=await request('contact',{...e.ref,patch:sent,version:e.bundle.version},e.new?'POST':'PATCH');
  else{const value={...e.draft,id:e.ref.id||crypto.randomUUID(),key:window.phase5ContactKey?.(e.draft),_pendingWrite:true};value._addressHistory=localHistory(e.bundle.contact,value);bundle={contact:value,version:'',associations:[],history:value._addressHistory,communications:[]};if(e.ref.scope==='office')await window.__baModernSaveLocal?.(value);}
  const wasNew=e.new;e.new=false;e.ref.id=bundle.contact.id;e.bundle=bundle;e.error=false;
  await cacheBundle(bundle,e.ref);M.bundle=bundle;
  if(wasNew){const row={...bundle.contact,__buero:e.ref.scope==='office',__caseId:e.ref.caseId};M.rows.push(row);M.selected=identity(row);e.c=row}
  if(!Object.keys(e.pending).length)message(online()?'Gespeichert · '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'Lokal übernommen · Excel zur zusätzlichen Sicherung exportieren');return true;
 }catch(err){e.pending={...sent,...e.pending};e.error=true;const conflict=$('.am-conflict');if(conflict)conflict.hidden=err.status!==409;message(err.message,true);return false}
 finally{e.saving=null}
 })();const ok=await e.saving;if(ok&&Object.keys(e.pending).length)return savePending();return ok;
}
async function flush(){return !M.editor||await savePending()}
async function resolveConflict(){const e=M.editor;if(!e||e.new)return;const fresh=await request('contact?'+new URLSearchParams(e.ref));const differences=Object.keys(e.pending).filter(k=>JSON.stringify(e.bundle.contact[k])!==JSON.stringify(fresh.contact[k])).map(k=>(LABELS[k]||k)+': gespeichert „'+displayValue(fresh.contact[k])+'“ / Ihre Eingabe „'+displayValue(e.pending[k])+'“');if(!confirm('Aktuellen Stand laden und Ihre noch offenen Eingaben darauf anwenden?'+(differences.length?'\n\nDiese Felder würden überschrieben:\n'+differences.join('\n'):' Andere zwischenzeitliche Änderungen bleiben erhalten.')))return;e.bundle=fresh;e.draft={...fresh.contact,...e.pending};for(const input of M.root.querySelectorAll('.am-edit [name]'))input.value=e.draft[input.name]||'';e.error=false;$('.am-conflict').hidden=true;await savePending()}
async function finishEdit(){if(!await flush())return;M.editor=null;window.showImportedAddressbook();M.root?.classList.add('am-show-detail')}
async function discard(){const e=M.editor;if(!e)return;if(e.saving)await e.saving;if(Object.keys(e.pending).length&&!confirm('Noch nicht gespeicherte Eingaben verwerfen? Bereits automatisch gespeicherte Änderungen bleiben erhalten.'))return;clearTimeout(e.timer);M.editor=null;window.showImportedAddressbook()}
async function savePatch(c,patch){if(c.__viewMergeId)throw Error('Zusammengeführte Ansichten bitte in den zugehörigen Fallkontakten bearbeiten.');const r=ref(c);let bundle;if(online()){const fresh=await request('contact?'+new URLSearchParams(r));bundle=await request('contact',{...r,patch,version:fresh.version},'PATCH')}else{const next={...c,...patch,id:c.id||crypto.randomUUID(),_pendingWrite:true};next._addressHistory=localHistory(c,next);bundle={contact:next,associations:[],history:next._addressHistory,communications:localCommunications(c)};if(r.scope==='office')await window.__baModernSaveLocal?.(next)}await cacheBundle(bundle,r);M.bundle=bundle;window.phase5RenderAddressbookV154();return bundle}
async function saveStatus(c,end){await savePatch(c,{status:end?'Beendet':'Aktiv'})}
async function removeContact(c){if(!confirm('Kontakt „'+name(c)+'“ unwiderruflich löschen? Zum Ausblenden genügt „Beenden“.'))return;const r=ref(c);
 if(online()){const url=r.scope==='office'?'/api/office-contacts/'+encodeURIComponent(r.id):'/api/cases/'+encodeURIComponent(r.caseId)+'/contacts/'+encodeURIComponent(r.id);const response=await fetch(url,{method:'DELETE',credentials:'same-origin'});if(!response.ok){const j=await response.json().catch(()=>({}));throw Error(j.error||'Kontakt konnte nicht gelöscht werden.')}
 }
 if(r.scope==='office')await window.__baModernDelete?.(r.id);else{for(const cd of [r.caseId===activeCase()?state.caseData:null,window.__onlineCaseCache?.get(r.caseId)?.data].filter(Boolean))cd.contacts=(cd.contacts||[]).filter(x=>r.id?x.id!==r.id:api().key(x)!==api().key(c));if(!online())saveState()}
 M.selected='';window.showImportedAddressbook();
}
async function copyContact(c){await navigator.clipboard.writeText([name(c),api().address(c),c.email,c.phone,c.mobile,c.fax,c.fileNumber,c.processNumber].filter(Boolean).join('\n'));message('Kontaktdaten kopiert')}
async function useDocument(c,p){const k=c.key||window.phase5ContactKey?.(c)||api().key(c);window.phase5ApplyContact(k);{const eo=window.getExportOptions?.(currentReport);if(eo){state.ui.exportOptions[currentReport]={...(state.ui.exportOptions[currentReport]||{}),recipientPersonId:p?.id||'',recipientEmail:p?.email||c.email||''};saveState();window.renderReport?.()}}}
async function mail(c,p,internal){const email=p?.email||c.email;if(!email)throw Error('Für diesen Kontakt ist keine E-Mail-Adresse hinterlegt.');const target={name:p?.name||name(c),email,subject:['Betreuungsangelegenheit',c.fileNumber].filter(Boolean).join(' '),contactLink:currentLink(c,p)};
 if(internal)await window.__mxComposeTo(target);else window.location.href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(target.subject);
}
async function documentContact(c,p){const r=ref(c),id=r.scope==='case'?r.caseId:activeCase();if(!id)throw Error('Bitte zuerst einen Fall öffnen.');M.editor=null;window.openDokuEntryForm(id,-1);window.__fdKontaktUebernehmen?.(personal(c,p),r.scope,id)}
async function openDoku(item){let cd=item.caseId===activeCase()?state.caseData:window.__onlineCaseCache?.get(item.caseId)?.data;if(online()){const r=await fetch('/api/cases/'+encodeURIComponent(item.caseId)+'/doku-entries',{credentials:'same-origin'});if(!r.ok)throw Error('Dokumentation nicht verfügbar.');const j=await r.json();if(cd)cd.documentationEntries=j.entries.map(x=>({...x.data,id:x.id}))}const index=(cd?.documentationEntries||[]).findIndex(x=>x.id===item.id);if(index<0)throw Error('Eintrag nicht gefunden.');window.openDokuEntryForm(item.caseId,index)}
function smallForm(title,fields,submit){const pane=$('.am-tab-body');pane.replaceChildren();const form=E('form','am-small-form');form.append(E('h3','',title));for(const [k,label,value,options] of fields){const l=E('label','',label),input=E(options?'select':'input');input.name=k;if(options)for(const [val,text] of options)input.append(new Option(text,val));input.value=value||'';l.append(input);form.append(l)}const error=E('p','am-error');form.append(error);const save=E('button','am-btn primary','Übernehmen');save.type='submit';form.append(save,B('Abbrechen',()=>drawTab(selected())));form.onsubmit=async ev=>{ev.preventDefault();save.disabled=true;try{await submit(Object.fromEntries(new FormData(form)));drawDetail(selected())}catch(e){error.textContent=e.message}finally{save.disabled=false}};pane.append(form)}
function editPerson(c,p){smallForm(p?'Ansprechpartner bearbeiten':'Neuer Ansprechpartner',[['name','Name',p?.name],['department','Abteilung',p?.department],['role','Funktion',p?.role],['email','E-Mail',p?.email],['phone','Telefon',p?.phone],['fax','Fax',p?.fax],['salutation','Anrede',p?.salutation]],async values=>{if(!values.name.trim())throw Error('Bitte einen Namen angeben.');const people=[...(M.bundle?.contact.people||c.people||[])],next={...values,id:p?.id||crypto.randomUUID()},i=people.findIndex(x=>x.id===next.id);if(i>=0)people[i]=next;else people.push(next);await savePatch(c,{people})})}
async function deletePerson(c,p){if(confirm('Ansprechpartner „'+p.name+'“ entfernen? Historische Dokumentation bleibt erhalten.'))await savePatch(c,{people:(M.bundle?.contact.people||c.people||[]).filter(x=>x.id!==p.id)})}
function assign(c){const entries=[...(window.__onlineCaseCache?.entries()||[])].map(([id,e])=>[id,e.label||id]);if(!entries.length)throw Error('Keine Fälle geladen.');smallForm('Einem weiteren Fall zuordnen',[['targetCaseId','Fall','',entries],['role','Rolle in diesem Fall',c.role],['fileNumber','Aktenzeichen im Zielfall',''],['processNumber','Vorgangsnummer im Zielfall','']],async values=>{const bundle=await request('assign',{...ref(c),...values});await cacheBundle(bundle,ref(c));M.bundle=bundle})}
async function detach(c,a){if(!confirm('Die zentrale Verknüpfung für „'+a.label+'“ lösen? Der Kontakt bleibt als eigenständiger Fallkontakt erhalten.'))return;const bundle=await request('detach',{...ref(c),targetCaseId:a.caseId,contactId:a.contactId});await cacheBundle(bundle,ref(c));await refreshCase(a.caseId);M.bundle=bundle;drawTab(c)}
async function setStandard(c,a,purpose,remove){const p=person();const bundle=await request('standard',{caseId:a.caseId,id:a.contactId,purpose,personId:p?.id||'',remove});await cacheBundle(bundle,{scope:'case',caseId:a.caseId,id:a.contactId});await refreshCase(a.caseId);M.bundle=await loadDetails(c);drawTab(c)}
async function restore(c,h){if(!confirm('Die angezeigte Änderung rückgängig machen? Dies wird als neue Änderung protokolliert.'))return;if(!online()){const patch={};for(const [k,v] of Object.entries(h.changes))if(Object.hasOwn(LABELS,k)&&k!=='_standardRecipients')patch[k]=v.before??(k==='people'?[]:'');if(!(patch.institution??c.institution)&&!(patch.lastName??c.lastName))throw Error('Die Anlage eines Kontakts lässt sich hier nicht rückgängig machen.');await savePatch(c,patch);return}const bundle=await request('restore',{...ref(c),historyId:h.id,version:M.bundle.version});await cacheBundle(bundle,ref(c));M.bundle=bundle;window.phase5RenderAddressbookV154()}
window.__abMailDokuLink=function(caseId,to,preferred){
 const emails=String(to||'').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[];
 const cd=String(caseId)===activeCase()?state.caseData:window.__onlineCaseCache?.get(String(caseId))?.data;
 if(preferred?.contactId&&(preferred.scope==='office'||preferred.caseId===String(caseId))&&preferred.snapshot?.email&&emails.includes(preferred.snapshot.email.toLowerCase()))return preferred;
 const hits=[];for(const c of cd?.contacts||[]){if(c.email&&emails.includes(c.email.toLowerCase()))hits.push(currentLink({...c,__caseId:caseId},null));for(const p of c.people||[])if(p.email&&emails.includes(p.email.toLowerCase()))hits.push(currentLink({...c,__caseId:caseId},p));}
 return hits.length===1?hits[0]:null;
};
window.__abPersonView=(c,id)=>personal(c,(c.people||[]).find(p=>p.id===id));
window.__abModernLink=currentLink;
window.__abModern={mount,render,active:()=>!!M.root?.isConnected,hold:()=>!!(M.root?.isConnected&&M.editor),selected,flush,edit,savePatch};
window.__abDefaultRecipient=function(purpose='document'){const c=(state.caseData.contacts||[]).find(x=>!isEnded(x)&&Object.hasOwn(x._standardRecipients||{},purpose));if(!c)return null;const p=(c.people||[]).find(x=>x.id===c._standardRecipients[purpose]);return {contact:c,person:p||null,...personal(c,p)}};
// Die Anwendung hat mehrere spätere Empfänger-Renderer. Ansprechpartner deshalb auch an
// deren öffentlichen Ausgabegrenzen auflösen; die dauerhafte Schlüsselreferenz bleibt die Institution.
function recipientPerson(eo){if((eo?.recipientType!=='contact'&&eo?._resolvedRecipientType!=='contact')||!eo.recipientPersonId)return null;const c=window.phase5FindContact?.(eo.recipientContactKey);const p=c?.people?.find(p=>p.id===eo.recipientPersonId);return p?personal(c,p):null}
function recipientLines(c){return [c.institution,[c.title,c.firstName,c.lastName].filter(Boolean).join(' '),[c.street,[c.house,c.houseLetter].filter(Boolean).join('')].filter(Boolean).join(' ')||(c.postbox?'Postfach '+c.postbox:''),[c.postal,c.city].filter(Boolean).join(' ')].filter(Boolean)}
for(const key of ['exportRecipientHTML','phase3RecipientLines','resolveExportRecipientLabel']){const previous=window[key];if(typeof previous!=='function')continue;window[key]=function(eo){const c=recipientPerson(eo);if(!c)return previous.apply(this,arguments);const lines=recipientLines(c);return key==='phase3RecipientLines'?lines:key==='resolveExportRecipientLabel'?lines.join(', '):lines.map(s=>{const d=E('div','',s);return d.innerHTML}).join('<br>')}}
const previousOptions=window.getExportOptions;window.getExportOptions=function(){const eo=previousOptions.apply(this,arguments),c=recipientPerson(eo);if(c){eo._effectiveContact=c;eo.recipientEmail=c.email||'';eo.recipientFax=c.fax||''}return eo};
window.addEventListener('beforeunload',e=>{if(M.editor&&(M.editor.saving||Object.keys(M.editor.pending).length)){e.preventDefault();e.returnValue=''}});
const previousClose=window.closeModal;window.closeModal=function(){if(M.root?.isConnected&&M.editor){const self=this,args=arguments;return flush().then(ok=>{if(ok){M.editor=null;return previousClose.apply(self,args)}})}return previousClose.apply(this,arguments)};
const observer=new MutationObserver(()=>{if(!document.querySelector('#addressbookModern'))document.getElementById('modal')?.classList.remove('am-modal')});const modal=document.getElementById('modalBody');if(modal)observer.observe(modal,{childList:true});
})();
