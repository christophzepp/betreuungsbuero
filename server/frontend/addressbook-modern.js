/* Produktives Adressbuch. Die bestehenden Import-/Export-/Merge-Wege bleiben über ihre Original-
   Bedienelemente angebunden. Kein Demodatensatz und kein paralleler Browser-Speicher im Online-Modus. */
(function(){
'use strict';
const PAGE_SIZE=200;
const M={page:0,viewKey:'',view:null,root:null,rows:[],selected:'',tab:'data',editor:null,small:null,bundle:null,load:0,editRequest:0,width:42,personIds:new Map()};
const $=s=>M.root?.querySelector(s),E=(t,cls,text)=>{const e=document.createElement(t);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
const B=(label,action,cls='',skipFlush=false)=>{const b=E('button','am-btn '+cls,label);b.type='button';b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{if(skipFlush||await flush())await action()}catch(e){message(e.message,true)}finally{b.disabled=false;if(b.closest('.am-selection'))selectionCount()}};return b};
const api=()=>window.__abModernLegacy;
const online=()=>window.__appMode==='online';
const activeCase=()=>String(window.__activeServerCaseId||window.caseIdentityOf?.(state)||'');
const ref=c=>({scope:c.__buero?'office':'case',caseId:c.__buero?'':String(c.__caseId||activeCase()),id:String(c.id||''),localKey:c.id?'':api().key(c)});
const identity=c=>JSON.stringify([ref(c).scope,ref(c).caseId,c.id||api().key(c)]);
const name=c=>[c.institution,[c.title,c.firstName,c.lastName].filter(Boolean).join(' ')].filter(Boolean).join(' – ')||c.role||'Unbenannter Kontakt';
const isEnded=c=>String(c.status||'').toLowerCase()==='beendet';
const selected=()=>M.rows.find(c=>identity(c)===M.selected);
async function request(path,body,method){const r=await fetch('/api/addressbook/'+path,{method:method||(body?'POST':'GET'),credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error||'Das Adressbuch ist momentan nicht erreichbar.');e.status=r.status;throw e}return j}
function message(text,error=false){const el=$('.am-save');if(el){el.textContent=text;el.classList.toggle('error',error)}M.errorToast?.remove?.();M.errorToast=error?window.toast?.(text):null}
function status(){message(online()?'Online · Änderungen werden automatisch gespeichert':window.__demoModus?'Vorführung · Änderungen nur in dieser Sitzung':'Lokal · Excel zusätzlich zur Sicherung exportieren')}
const dateLabel=value=>{if(!value)return '';const text=String(value);if(/^\d{4}-\d{2}-\d{2}/.test(text)){const date=new Date(text.length===10?text+'T12:00:00':text);if(Number.isFinite(+date))return date.toLocaleDateString('de-DE')+(text.length>10?' · '+date.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'')}return text};
function section(title){const e=E('section','am-section');e.append(E('h3','',title));return e}
function buttonSet(parent,buttons){for(const b of buttons)parent.append(b)}
function currentLink(c,person){const r=ref(c),p=person||null;return {...r,contactId:r.id,personId:p?.id||'',contactKey:c.key||window.phase5ContactKey?.(c)||api().key(c),snapshot:{label:p?[c.institution,p.name].filter(Boolean).join(' – '):name(c),institution:c.institution||'',person:p?.name||[c.title,c.firstName,c.lastName].filter(Boolean).join(' '),role:c.role||'',fileNumber:c.fileNumber||'',processNumber:c.processNumber||'',customerNumber:c.customerNumber||'',email:p?.email||c.email||'',phone:p?.phone||c.phone||''}}}
function person(){const id=$('#amPerson')?.value;return (M.bundle?.contact.people||selected()?.people||[]).find(p=>p.id===id)||null}
function positionMenus(){
 if(!M.root?.isConnected)return;const r=M.root.getBoundingClientRect(),vv=window.visualViewport,left=Math.max(r.left+4,vv?.offsetLeft||0),right=Math.min(r.right-4,(vv?.offsetLeft||0)+(vv?.width||innerWidth)),top=Math.max(r.top+4,vv?.offsetTop||0),bottom=Math.min(r.bottom-4,(vv?.offsetTop||0)+(vv?.height||innerHeight));
 for(const menu of M.root.querySelectorAll('.am-menu[open],.am-filters[open]')){const popup=menu.lastElementChild,a=menu.firstElementChild.getBoundingClientRect(),width=Math.max(0,Math.min(menu.classList.contains('am-filters')?680:300,right-left)),below=bottom-a.bottom-8,above=a.top-top-8,up=below<160&&above>below,height=Math.max(60,up?above:below);
  for(const [key,value] of Object.entries({position:'fixed',width:width+'px','max-width':width+'px',left:Math.max(left,Math.min(a.right-width,right-width))+'px',right:'auto','max-height':height+'px',top:(up?Math.max(top,a.top-8-Math.min(popup.scrollHeight,height)):a.bottom+8)+'px'}))popup.style.setProperty(key,value,'important');
 }
}
function closeMenus(except){for(const menu of M.root?.querySelectorAll('.am-menu[open],.am-filters[open]')||[])if(menu!==except)menu.open=false}
function personal(c,p){const a=(c.addresses||[]).find(a=>a.id===c.preferredAddressId);if(a)c={...c,...Object.fromEntries(['street','house','houseLetter','postal','city','postbox','country'].map(k=>[k,a[k]||'']))};return p?{...c,key:c.key||window.phase5ContactKey?.(c)||api().key(c),salutation:p.salutation||c.salutation,_personId:p.id,firstName:p.name,lastName:'',title:'',email:p.email||c.email,phone:p.phone||c.phone,fax:p.fax||c.fax,preferredChannel:p.preferredChannel||c.preferredChannel,phoneHours:p.phoneHours||c.phoneHours,absentFrom:p.absentFrom||'',absentUntil:p.absentUntil||'',absenceNote:p.absenceNote||''}:c}
function mount(){
 const host=document.getElementById('modalBody');if(!host||!api())return;
 M.page=0;M.viewKey='';
 const action=host.querySelector('.addressbook-action-row'),toolbar=host.querySelector('.addressbook-toolbar-v154'),scope=host.querySelector('.ab-case-switcher'),bulk=host.querySelector('.addressbook-select-row'),letters=host.querySelector('#abLetterBar'),list=host.querySelector('#phase5AddressListV154');
 if(!action||!toolbar||!list)return;
 M.root=E('div','am addressbook-view mobile-module-view');M.root.id='addressbookModern';M.root.dataset.mobileModule='contacts';M.root.setAttribute('aria-label','Adressbuch');M.editor=null;M.small=null;M.bundle=null;M.mailSync=null;M.load++;M.editRequest++;
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
 const top=E('div','am-tools');top.append(search);const filter=E('details','am-filters'),summary=E('summary','am-btn','Filter & Sortierung');filter.append(summary,toolbar);top.append(filter,viewMenu());const missing=E('label','am-missing'),check=E('input');check.type='checkbox';check.id='amMissingEmail';check.checked=state.ui?.addressbookViewV154?.missingEmail==='yes';check.onchange=()=>window.phase5RenderAddressbookV154();missing.append(check,document.createTextNode('Ohne E-Mail'));toolbar.append(missing);M.root.append(top);
 const board=E('div','am-board'),left=E('section','am-list-pane'),right=E('section','am-detail');right.setAttribute('aria-label','Kontaktdetails');
 const tabs=E('div','am-status-tabs');for(const [v,label] of [['active','Aktive'],['all','Alle'],['ended','Beendete']]){
  const b=B(label,()=>{document.getElementById('phase5AddressStatusV154').value=v;window.phase5RenderAddressbookV154()});b.dataset.status=v;tabs.append(b);
 }
 left.append(tabs);const listmeta=E('div','am-list-meta');const count=toolbar.querySelector('#phase5AddressCountV154');if(count)listmeta.append(count);left.append(listmeta);
 const selection=E('div','am-selection');selection.append(B('Alle auswählen',()=>window.__abCsvSelectAll(true)),B('Auswahl aufheben',()=>window.__abCsvSelectAll(false)),B('Als aktiv markieren',()=>bulkStatus('Aktiv')),B('Als beendet markieren',()=>bulkStatus('Beendet')));left.append(selection);if(letters)left.append(letters);left.append(list,E('nav','am-pages'));left.lastElementChild.setAttribute('aria-label','Kontaktseiten');
 const grip=E('div','am-resizer');grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');grip.setAttribute('aria-label','Breite der Kontaktliste');
 board.append(left,grip,right);M.root.append(board);host.classList.remove('mobile-top-view-body-v171');host.replaceChildren(M.root);
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
 M.root.addEventListener('click',async e=>{const b=e.target.closest('.am-menu-body button,.am-menu-body label');if(!b||(!M.editor&&!M.small)||b.__amReplay)return;e.preventDefault();e.stopImmediatePropagation();if(await flush()){M.editor=null;b.__amReplay=true;b.click();b.__amReplay=false}},true);
 for(const menu of M.root.querySelectorAll('.am-menu,.am-filters'))menu.addEventListener('toggle',()=>{if(menu.open){closeMenus(menu);positionMenus()}});
 M.root.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();M.root.classList.remove('am-show-detail');$('#phase5AddressSearchV154')?.focus()}if(e.key==='Escape'&&M.root.querySelector('.am-menu[open],.am-filters[open]')){e.stopPropagation();closeMenus()}},false);
 const scopeValue=scope?.querySelector('select')?.value;
 M.root.addEventListener('change',async e=>{const el=e.target;if((!M.editor&&!M.small)||!el.closest('.ab-case-switcher')||el.__amReplay)return;e.stopImmediatePropagation();if(await flush()){M.editor=null;el.__amReplay=true;el.dispatchEvent(new Event('change',{bubbles:true}));el.__amReplay=false}else el.value=scopeValue},true);
 status();
 const root=M.root;if(online())Promise.resolve(window.__baLoadServerBuero?.()).then(()=>{if(M.root===root&&root.isConnected&&!M.editor&&!M.small)window.phase5RenderAddressbookV154()}).catch(e=>{if(M.root===root&&root.isConnected)message(e.message,true)});
}
function render(rows,v){
 if(!M.root?.isConnected)return;const viewKey=JSON.stringify(v);if(M.viewKey!==viewKey){M.page=0;M.viewKey=viewKey}M.view=v;M.rows=rows;M.page=Math.max(0,Math.min(M.page,Math.ceil(rows.length/PAGE_SIZE)-1));
 const pages=$('.am-pages');pages.replaceChildren();pages.hidden=rows.length<=PAGE_SIZE;
 if(!pages.hidden){const prev=B('Zurück',()=>{M.page--;render(M.rows,M.view);$('#phase5AddressListV154').scrollTop=0}),next=B('Weiter',()=>{M.page++;render(M.rows,M.view);$('#phase5AddressListV154').scrollTop=0});prev.disabled=M.page===0;next.disabled=(M.page+1)*PAGE_SIZE>=rows.length;pages.append(prev,E('span','',`${M.page*PAGE_SIZE+1}–${Math.min((M.page+1)*PAGE_SIZE,rows.length)} von ${rows.length}`),next)}
 const list=$('#phase5AddressListV154'),scroll=list.scrollTop;list.replaceChildren();
 for(const b of M.root.querySelectorAll('[data-status]'))b.setAttribute('aria-pressed',String(b.dataset.status===v.status));selectionCount();
 if(!rows.length){list.append(E('p','am-empty','Keine Kontakte für diese Filter.'));M.selected='';if(!M.editor&&!M.small){M.bundle=null;M.load++;M.root.classList.remove('am-show-detail');$('.am-detail').classList.remove('am-editing');$('.am-detail').replaceChildren(E('p','am-empty','Filter anpassen oder einen neuen Kontakt anlegen.'))}return}
 if(!rows.some(c=>identity(c)===M.selected))M.selected=identity(rows[0]);
 const fragment=document.createDocumentFragment();for(const c of rows.slice(M.page*PAGE_SIZE,(M.page+1)*PAGE_SIZE)){const row=E('article','addressbook-card am-row');row.dataset.abLetter=api().letter(c,v);row.classList.toggle('selected',identity(c)===M.selected);
  const check=E('input');check.type='checkbox';check.checked=api().selected().has(api().key(c));check.setAttribute('aria-label',name(c)+' auswählen');check.onchange=()=>{window.__abCsvToggle(api().key(c),check.checked);selectionCount()};row.append(check);
  const open=B('',()=>choose(c));open.className='am-row-open';const icon=E('span','am-avatar',c.institution?'▤':([c.firstName?.[0],c.lastName?.[0]].filter(Boolean).join('')||'○'));
  const text=E('span','am-row-copy');text.append(E('strong','',api().title(c,v.nameOrder)),E('span','am-sub',[c.role,api().person(c,v.nameOrder),c.__cases||'',isEnded(c)?'Beendet':''].filter(Boolean).join(' · ')));open.append(icon,text);row.append(open);fragment.append(row);
 }
 list.append(fragment);list.scrollTop=scroll;for(const b of M.root.querySelectorAll('[data-status]'))b.setAttribute('aria-pressed',String(b.dataset.status===v.status));selectionCount();
 if(!M.editor&&!M.small)drawDetail(selected());
}
function jumpToLetter(letter){const index=M.rows.findIndex(c=>api().letter(c,M.view)===letter);if(index<0)return;M.page=Math.floor(index/PAGE_SIZE);render(M.rows,M.view);M.root.classList.remove('am-show-detail');const list=$('#phase5AddressListV154'),card=list.querySelector('[data-ab-letter="'+letter+'"]');if(!card)return;const scroller=getComputedStyle(list).overflowY==='visible'?list.closest('.am-list-pane'):list;scroller.scrollTo({top:scroller.scrollTop+card.getBoundingClientRect().top-scroller.getBoundingClientRect().top,behavior:'smooth'})}
function selectionCount(){const n=api().selected().size;let el=$('#amSelectionCount');if(!el){el=E('span');el.id='amSelectionCount';$('.am-list-meta')?.append(el)}el.textContent=n?n+' ausgewählt':'';$('.am-selection')?.classList.toggle('has-selection',!!n);for(const b of M.root.querySelectorAll('.am-selection button'))if(!b.textContent.startsWith('Alle'))b.disabled=!n}
async function bulkStatus(status){M.editor=null;const rows=api().contacts().filter(c=>api().selected().has(api().key(c)));let saved=0,errors=[];for(const c of rows){const key=api().key(c);try{await savePatch(c,{status});api().selected().delete(key);saved++}catch(e){errors.push(e.message)}}window.phase5RenderAddressbookV154();message(saved+' Kontakt(e) geändert.'+(errors.length?' '+errors.length+' nicht gespeichert: '+errors[0]:''),!!errors.length)}
async function choose(c){if(!await flush())return;M.editRequest++;M.editor=null;M.selected=identity(c);M.tab='data';M.root.classList.add('am-show-detail');window.phase5RenderAddressbookV154()}
async function loadDetails(c){
 const token=++M.load;const r=ref(c);if(!online()||!r.id){M.bundle={contact:c,history:c._addressHistory||[],associations:[],communications:localCommunications(c)};return M.bundle}
 const result=await request('contact?'+new URLSearchParams(r));if(token!==M.load||M.selected!==identity(c))return null;M.bundle=result;return result;
}
function localCommunications(c){const r=ref(c),caseId=r.scope==='case'?r.caseId:activeCase(),cd=caseId===activeCase()?state.caseData:window.__onlineCaseCache?.get(caseId)?.data||(window.caseRegistry||[]).find(e=>e.id===caseId)?.state?.caseData;return (cd?.documentationEntries||[]).filter(e=>{const l=e.contactLink;return l&&(l.scope||'case')===r.scope&&(r.scope==='office'||!l.caseId||l.caseId===caseId)&&(c.id?l.contactId===c.id:!!l.contactKey&&l.contactKey===(c.key||window.phase5ContactKey?.(c)||api().key(c)))}).map(e=>({id:e.id,caseId,title:e.detail||e.type,date:e.date,text:e.freeDetail||e.note,contactType:e.contactType}))}
function info(parent,label,value,kind){if(!value)return;const wrap=E('div','am-info'),copy=B('Kopieren',()=>navigator.clipboard.writeText(String(value)),'quiet');copy.setAttribute('aria-label',label+' kopieren');const content=E('div');content.append(E('span','am-sub',label));
 if(kind==='address'&&window.__mapAddressLinkHTML){const d=E('div');d.innerHTML=window.__mapAddressLinkHTML(String(value));content.append(d)}else if(kind==='phone'){const a=E('a','',value);a.href='tel:'+String(value).replace(/[^+\d]/g,'');content.append(a)}else content.append(E('div','',value));wrap.append(content,copy);parent.append(wrap)}
function drawDetail(c){
 if(!c)return;const pane=$('.am-detail');pane.classList.remove('am-editing');const scroll=pane.dataset.contact===identity(c)?pane.scrollTop:0;pane.dataset.contact=identity(c);pane.replaceChildren();const top=E('div','am-detail-top');top.append(B('← Kontakte',()=>M.root.classList.remove('am-show-detail'),'am-back quiet'),E('span','am-badge'+(isEnded(c)?' ended':''),c.status||'Aktiv'),B(c.__viewMergeId?'Fallkontakte öffnen':'Bearbeiten',()=>edit(c)));pane.append(top,E('h2','',name(c)),E('p','am-sub',c.role||'Ohne Rolle'));
 const people=E('div','am-person');if(c.people?.length){const label=E('label','','Ansprechpartner'),select=E('select');select.id='amPerson';select.append(new Option('Institution / allgemeiner Kontakt',''));for(const p of c.people)select.append(new Option([p.name,p.department].filter(Boolean).join(' · '),p.id));const chosen=M.personIds.get(identity(c));select.value=c.people.some(p=>p.id===chosen)?chosen:'';select.onchange=()=>{M.personIds.set(identity(c),select.value);drawTab(c)};label.append(select);people.append(label)}pane.append(people);
 const actions=E('div','am-detail-actions');
 const k=api().key(c),r=ref(c);
 if(!c.__viewMergeId&&r.scope==='case'&&r.caseId===activeCase())actions.append(B('Für aktuelles Dokument verwenden',()=>useDocument(c,person()),'primary'));
 if(!c.__viewMergeId)actions.append(B('Dokumentation anlegen',()=>documentContact(c,person())));actions.append(B('E-Mail intern',()=>mail(c,person(),true)),B('E-Mail extern',()=>mail(c,person(),false)));
 if(!c.email&&!c.people?.some(p=>p.email)){actions.querySelectorAll('button').forEach(b=>{if(b.textContent.startsWith('E-Mail'))b.disabled=true})}
 pane.append(actions);
 if(c.__viewMergeId){M.tab='data';pane.append(E('p','am-sub','Zusammengeführte Ansicht. Die ursprünglichen Fallkontakte bleiben erhalten.'),B('Zusammenführung verwalten',()=>window.openBueroAddressModal()))}
 const tabs=E('nav','am-tabs');tabs.setAttribute('aria-label','Kontaktdetails');for(const [key,label] of [['data','Kontaktdaten'],['cases','Fälle & Standard'],['people','Ansprechpartner'],['addresses','Anschriften'],['availability','Erreichbarkeit'],['history','Änderungen'],['communication','Kommunikation']]){if(c.__viewMergeId&&key!=='data')continue;const b=B(label,()=>{M.tab=key;drawTab(c);if(innerWidth<=680)requestAnimationFrame(()=>{const pane=$('.am-detail'),tabs=$('.am-tabs');if(pane&&tabs)pane.scrollTop+=tabs.getBoundingClientRect().top-pane.getBoundingClientRect().top})});b.dataset.tab=key;tabs.append(b)}pane.append(tabs,E('div','am-tab-body'));
 const more=E('details','am-more');more.append(E('summary','am-btn','Weitere Kontaktaktionen'));const other=E('div','am-detail-actions');
 other.append(B('Daten kopieren',()=>copyContact(c)),B('Faxnummer kopieren',()=>navigator.clipboard.writeText(person()?.fax||c.fax||'')));if(!c.__viewMergeId)other.append(B(isEnded(c)?'Aktivieren':'Beenden',()=>saveStatus(c,!isEnded(c))),B('Löschen',()=>removeContact(c),'danger'));
 if(r.scope==='case'&&r.caseId!==activeCase())other.append(B('Fall öffnen & bearbeiten',()=>window.__abSwitchCase(r.caseId)));
 more.append(other);pane.append(more);
 M.bundle=null;drawTab(c);pane.scrollTop=scroll;const root=M.root;loadDetails(c).then(x=>{if(x&&M.root===root&&root.isConnected&&!M.editor&&!M.small&&M.selected===identity(c))drawTab(c)}).catch(e=>{const body=$('.am-tab-body');if(body&&M.root===root&&!M.editor&&!M.small&&M.selected===identity(c)){body.append(E('p','am-error',e.message),B('Erneut laden',()=>drawDetail(c)))}});
}
function drawTab(c){
 const body=$('.am-tab-body');if(!body||M.editor||M.small)return;body.replaceChildren();for(const b of M.root.querySelectorAll('[data-tab]')){const active=b.dataset.tab===M.tab;b.setAttribute('aria-pressed',String(active));if(active){const a=b.getBoundingClientRect(),r=b.parentElement.getBoundingClientRect();if(a.left<r.left||a.right>r.right)b.parentElement.scrollLeft+=a.left<r.left?a.left-r.left:a.right-r.right}}
 const data=M.tab==='data'?personal(M.bundle?.contact||c,person()):M.bundle?.contact||c;
 if(M.tab==='data'){
  const s=section(person()?.name||'Kontaktinformationen');info(s,'Anschrift',api().address(data),'address');info(s,'E-Mail',data.email);info(s,'Telefon',data.phone,'phone');info(s,'Mobil',data.mobile,'phone');info(s,'Fax',data.fax);info(s,'Aktenzeichen',data.fileNumber);info(s,'Vorgangsnummer',data.processNumber);info(s,'Kundennummer',data.customerNumber);info(s,'Bevorzugter Kontaktweg',CHANNELS[data.preferredChannel]);info(s,'Telefonzeiten',data.phoneHours);if(data.absentFrom||data.absentUntil)info(s,'Abwesenheit',[dateLabel(data.absentFrom)||'offen',dateLabel(data.absentUntil)||'offen',data.absenceNote].join(' · '));info(s,'IBAN',data.iban);info(s,'BIC',data.bic);info(s,'Bank',data.bankName);if(data.note)s.append(E('p','am-note',data.note));body.append(s);return;
 }
 if(!M.bundle){body.append(E('p','am-empty','Kontaktinformationen werden geladen …'));return}
 if(M.tab==='addresses'){drawAddresses(body,c,data);return}else if(M.tab==='availability'){drawAvailability(body,c,data);return}else if(M.tab==='people'){
  body.append(E('p','am-sub','Bei Dokumenten, E-Mail und Dokumentation kann gezielt ein Ansprechpartner ausgewählt werden.'));
  for(const p of data.people||[]){const s=section(p.name);s.append(E('p','am-sub',[p.department,p.role,p.email,p.phone].filter(Boolean).join(' · ')),B('Bearbeiten',()=>editPerson(c,p)),B('Entfernen',()=>deletePerson(c,p),'danger'));body.append(s)}
  body.append(B('+ Ansprechpartner',()=>editPerson(c,null),'primary'));
 }else if(M.tab==='cases'){
  body.append(E('p','am-sub','Gemeinsame Stammdaten werden in allen zugeordneten Fällen aktualisiert. Aktenzeichen, Vorgangsnummer, Kundennummer und Rolle bleiben je Fall getrennt.'));
  for(const a of M.bundle.associations){const s=section(a.label);s.append(E('p','am-sub',[a.role,a.fileNumber||'Ohne Aktenzeichen',a.customerNumber?'Kunde '+a.customerNumber:'',a.processNumber,a.status].filter(Boolean).join(' · ')));
   for(const [purpose,label] of [['document','Dokumente'],['mail','E-Mail']]){const marked=Object.hasOwn(a.standards||{},purpose)&&a.standards[purpose]===(person()?.id||'');s.append(B((marked?'✓ Standard für ':'Als Standard für ')+label,()=>setStandard(c,a,purpose,marked)))}
   s.append(B('Fallangaben bearbeiten',()=>editAssociation(c,a)),B('Weitere Standardempfänger',()=>editStandards(c,a)));for(const [purpose,pid] of Object.entries(a.standards||{}))if(!['document','mail'].includes(purpose))s.append(E('p','am-sub',purposeLabel(purpose)+' · '+((data.people||[]).find(p=>p.id===pid)?.name||'Institution')));
   if(M.bundle.centralId&&online())s.append(B('Zentrale Zuordnung lösen',()=>detach(c,a),'quiet'));body.append(s)}
  if(online())body.append(B('+ Weiterem Fall zuordnen',()=>assign(c),'primary'));else body.append(E('p','am-sub','Zentrale Fallzuordnungen werden im Online-Modus verwaltet.'));
 }else if(M.tab==='history'){
  if(!M.bundle.history.length)body.append(E('p','am-empty','Noch keine protokollierten Änderungen. Neue Änderungen werden mit Datum, Bearbeiter und vorherigem Wert erfasst.'));
  for(const h of M.bundle.history){const s=section(new Date(h.at).toLocaleString('de-DE')+' · '+h.actor);for(const [k,v] of Object.entries(h.changes)){s.append(E('p','am-history-line',(LABELS[k]||k)+': '+displayValue(v.before)+' → '+displayValue(v.after)))}if(Object.keys(h.changes).some(k=>Object.hasOwn(LABELS,k)&&k!=='_standardRecipients'))s.append(B('Diese Änderung rückgängig machen',()=>restore(c,h)));else s.append(E('p','am-sub','Fallzuordnungen und Standardempfänger lassen sich unter „Fälle & Standard“ anpassen.'));body.append(s)}
  if(M.bundle.historyCursor)body.append(B('Weitere Änderungen laden',()=>loadMore(c,'history')));
 }else{
  body.append(B('+ Kommunikation dokumentieren',()=>documentContact(c,person()),'primary'),B('Rückmeldung vereinbaren',()=>followup(c)));if(online()){const sync=E('p','am-sub');sync.id='amMailSync';sync.textContent=(M.mailSync?.key===identity(c)?M.mailSync.text:'')||'Nachrichten werden abgeglichen …';body.append(sync,B('Nachrichten aktualisieren',()=>syncMail(c,true)));syncMail(c).catch(e=>message(e.message,true));}
  if(!M.bundle.communications.length)body.append(E('p','am-empty','Noch keine verknüpfte Kommunikation. Einträge werden gemeinsam mit der Falldokumentation geführt.'));
  for(const item of M.bundle.communications){const s=section(item.title);s.append(E('p','am-sub',[dateLabel(item.date),item.caseLabel,item.contactType,item.person].filter(Boolean).join(' · ')),E('p','am-note',item.text),B(({mail:'E-Mail öffnen',document:'Versandhistorie öffnen',followup:'Wiedervorlage öffnen'})[item.kind]||'In Falldokumentation öffnen',()=>openCommunication(item)));if(item.mail)s.append(B('E-Mail öffnen',()=>window.__mxOpenMsg(item.mail.accountId,item.mail.folder,item.mail.uid)));body.append(s)}
  if(M.bundle.communicationCursor)body.append(B('Weitere Kommunikation laden',()=>loadMore(c,'communications')));
 }
}
async function loadMore(c,kind){const bundle=M.bundle,key=kind==='history'?'historyCursor':'communicationCursor',cursor=bundle?.[key];if(!cursor)return;const result=await request(kind+'?'+new URLSearchParams({...ref(c),cursor}));if(M.bundle!==bundle||M.selected!==identity(c))return;const field=kind==='history'?'history':'communications',existing=new Set(bundle[field].map(x=>x.id));bundle[field].push(...result.items.filter(x=>!existing.has(x.id)));bundle[key]=result.nextCursor;drawTab(c)}
function displayValue(v){return v==null||v===''?'—':Array.isArray(v)?v.map(x=>[x.label||x.name,...Object.entries(x).filter(([k])=>!['id','label','name'].includes(k)).map(([k,v])=>v?(LABELS[k]||k)+': '+v:'')].filter(Boolean).join(' · ')).join('; '):typeof v==='object'?JSON.stringify(v):String(v)}
function localHistory(before,after){const changes={};for(const k of Object.keys(LABELS))if(JSON.stringify(before?.[k]??null)!==JSON.stringify(after[k]??null))changes[k]={before:before?.[k]??null,after:after[k]??null};return Object.keys(changes).length?[{id:crypto.randomUUID(),at:new Date().toISOString(),actor:'Lokal',changes},...(before?._addressHistory||[])]:before?._addressHistory||[]}
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
const GROUPS=[['Grunddaten',['_category','status','role','salutation','title','firstName','lastName','institution']],['Anschrift',['street','house','houseLetter','postal','city','postbox']],['Kontakt',['phoneArea','phoneNumber','mobileArea','mobileNumber','email','faxArea','faxNumber']],['Referenzen & Bank',['fileNumber','processNumber','customerNumber','iban','bic','bankName']],['Notizen',['note']]];
const LABELS={_category:'Kategorie',status:'Status',role:'Rolle',salutation:'Anrede',title:'Titel',firstName:'Vorname',lastName:'Nachname',institution:'Institution',street:'Straße',house:'Hausnummer',houseLetter:'Zusatz',postal:'PLZ',city:'Ort',postbox:'Postfach',phoneArea:'Vorwahl Telefon',phoneNumber:'Telefon',mobileArea:'Vorwahl Mobil',mobileNumber:'Mobil',email:'E-Mail',faxArea:'Vorwahl Fax',faxNumber:'Fax',fileNumber:'Aktenzeichen',processNumber:'Vorgangsnummer',customerNumber:'Kundennummer je Fall',addresses:'Benannte Anschriften',preferredAddressId:'Bevorzugte Anschrift',preferredChannel:'Bevorzugter Kontaktweg',phoneHours:'Telefonzeiten',absentFrom:'Abwesend ab',absentUntil:'Abwesend bis',absenceNote:'Hinweis zur Abwesenheit',substituteContactId:'Vertretung',iban:'IBAN',bic:'BIC',bankName:'Bankname',note:'Notizen',people:'Ansprechpartner',_standardRecipients:'Standardempfänger'};
async function edit(c){
 if(c?.__viewMergeId){window.__abSwitchCase(ref(c).caseId);return}
 if(!await flush())return;const root=M.root,token=++M.editRequest,r=c?ref(c):{scope:window.__abScope==='case'?'case':'office',caseId:window.__abScope==='case'?activeCase():'',id:''};if(!c)M.load++;
 let bundle=c?await loadDetails(c):{contact:{status:'Aktiv',_category:'soziales'},version:''};if(!bundle||M.root!==root||!root.isConnected||token!==M.editRequest)return;
 const draft=structuredClone(bundle.contact);for(const k of ['phone','mobile','fax'])if(!draft[k+'Number']&&draft[k]){const parts=String(draft[k]).split('/');draft[k+'Area']=parts.length>1?parts.shift():'';draft[k+'Number']=parts.join('/')}
 window.__abModernSetupCombos?.(draft._category);
 M.editor={ref:r,c,bundle,draft,pending:{},saving:null,timer:null,error:false,new:!c};M.root.classList.add('am-show-detail');
 const pane=$('.am-detail');pane.classList.add('am-editing');pane.scrollTop=0;pane.replaceChildren();pane.append(E('h2','',c?'Kontakt bearbeiten':'Neuer Kontakt'),E('p','am-sub',online()?'Änderungen werden automatisch gespeichert, sobald Institution oder Nachname angegeben ist.':'Lokaler Kontakt · Änderungen mit „Fertig“ übernehmen.'));
 const form=E('form','am-edit');form.onsubmit=e=>{e.preventDefault();finishEdit()};
 for(const [title,fields] of GROUPS){const group=section(title),grid=E('div','am-form-grid');for(const k of fields){if(k==='customerNumber'&&r.scope==='office')continue;const l=E('label','',LABELS[k]);let input;
  if(k==='_category'){input=E('select');const categories=window.__abModernCategories?.()||[{id:'soziales',label:'Soziales'}];input.append(new Option('Bitte wählen …',''));for(const cat of categories)input.append(new Option(cat.label,cat.id));if(draft[k]&&!categories.some(c=>c.id===draft[k]))input.append(new Option('Bisherige Kategorie: '+draft[k],draft[k]))}
  else input=E(k==='note'?'textarea':'input');input.name=k;input.id='amEdit_'+k;input.value=draft[k]||'';if(k==='email')input.type='email';
  if(['status','role','salutation','title','houseLetter','phoneArea','mobileArea','faxArea'].includes(k)){input.setAttribute('data-combo','ab_'+k);input.autocomplete='off'}
  if(['postal','city','institution','house'].includes(k))input.setAttribute('data-combo',({postal:'ab_plz',city:'ab_ort',institution:'sd_institution',house:'sd_hausnummer'})[k]);
  input.oninput=()=>changed(k,input.value);input.onchange=()=>changed(k,input.value);l.append(input);grid.append(l)}group.append(grid);form.append(group)}
 const footer=E('div','am-edit-footer');const conflict=B('Änderungskonflikt auflösen',resolveConflict,'am-conflict',true),retry=B('Speichern erneut versuchen',()=>savePending(),'am-retry',true);conflict.hidden=true;retry.hidden=true;footer.append(B('Fertig',finishEdit,'primary'),retry,conflict,B('Ungespeicherte Eingaben verwerfen',discard,'quiet',true));pane.append(form,footer);status();
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
  const wasNew=e.new;e.new=false;e.ref.id=bundle.contact.id;e.bundle=bundle;e.error=false;if($('.am-retry'))$('.am-retry').hidden=true;if($('.am-conflict'))$('.am-conflict').hidden=true;
  await cacheBundle(bundle,e.ref);M.bundle=bundle;
  if(wasNew){const row={...bundle.contact,__buero:e.ref.scope==='office',__caseId:e.ref.caseId};M.rows.push(row);M.selected=identity(row);e.c=row}
  if(!Object.keys(e.pending).length)message(online()?'Gespeichert · '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'Lokal übernommen · Excel zur zusätzlichen Sicherung exportieren');return true;
 }catch(err){e.pending={...sent,...e.pending};e.error=true;const conflict=$('.am-conflict');if(conflict)conflict.hidden=err.status!==409;const retry=$('.am-retry');if(retry)retry.hidden=err.status===409;message(err.message,true);return false}
 finally{e.saving=null}
 })();const ok=await e.saving;if(ok&&Object.keys(e.pending).length)return savePending();return ok;
}
function smallDirty(){return !!M.small&&JSON.stringify(Object.fromEntries(new FormData(M.small.form)))!==M.small.initial}
async function flush(){if(M.small){if(!await saveSmall())return false;clearTimeout(M.small.timer);M.small=null}return !M.editor||await savePending()}
async function resolveConflict(){const e=M.editor;if(!e||e.new)return;const fresh=await request('contact?'+new URLSearchParams(e.ref));const differences=Object.keys(e.pending).filter(k=>JSON.stringify(e.bundle.contact[k])!==JSON.stringify(fresh.contact[k])).map(k=>(LABELS[k]||k)+': gespeichert „'+displayValue(fresh.contact[k])+'“ / Ihre Eingabe „'+displayValue(e.pending[k])+'“');if(!confirm('Aktuellen Stand laden und Ihre noch offenen Eingaben darauf anwenden?'+(differences.length?'\n\nDiese Felder würden überschrieben:\n'+differences.join('\n'):' Andere zwischenzeitliche Änderungen bleiben erhalten.')))return;e.bundle=fresh;e.draft={...fresh.contact,...e.pending};for(const input of M.root.querySelectorAll('.am-edit [name]'))input.value=e.draft[input.name]||'';e.error=false;$('.am-conflict').hidden=true;await savePending()}
async function finishEdit(){if(!await flush())return;M.editor=null;window.showImportedAddressbook();if(M.rows.length)M.root?.classList.add('am-show-detail')}
async function discard(){const e=M.editor;if(!e)return;if(e.saving)await e.saving;if(Object.keys(e.pending).length&&!confirm('Noch nicht gespeicherte Eingaben verwerfen? Bereits automatisch gespeicherte Änderungen bleiben erhalten.'))return;clearTimeout(e.timer);M.editor=null;window.showImportedAddressbook()}
async function savePatch(c,patch){if(c.__viewMergeId)throw Error('Zusammengeführte Ansichten bitte in den zugehörigen Fallkontakten bearbeiten.');const r=ref(c);let bundle;if(online()){const fresh=await request('contact?'+new URLSearchParams(r));bundle=await request('contact',{...r,patch,version:fresh.version},'PATCH')}else{const next={...c,...patch,id:c.id||crypto.randomUUID(),_pendingWrite:true};next._addressHistory=localHistory(c,next);bundle={contact:next,associations:[],history:next._addressHistory,communications:localCommunications(c)};if(r.scope==='office')await window.__baModernSaveLocal?.(next)}await cacheBundle(bundle,r);M.bundle=bundle;window.phase5RenderAddressbookV154();return bundle}
async function saveStatus(c,end){await savePatch(c,{status:end?'Beendet':'Aktiv'})}
async function removeContact(c){if(!confirm('Kontakt „'+name(c)+'“ unwiderruflich löschen? Zum Ausblenden genügt „Beenden“.'))return;const r=ref(c);
 if(online()){const url=r.scope==='office'?'/api/office-contacts/'+encodeURIComponent(r.id):'/api/cases/'+encodeURIComponent(r.caseId)+'/contacts/'+encodeURIComponent(r.id);const response=await fetch(url,{method:'DELETE',credentials:'same-origin'});if(!response.ok){const j=await response.json().catch(()=>({}));throw Error(j.error||'Kontakt konnte nicht gelöscht werden.')}
 }
 if(r.scope==='office')await window.__baModernDelete?.(r.id);else{for(const cd of [r.caseId===activeCase()?state.caseData:null,window.__onlineCaseCache?.get(r.caseId)?.data].filter(Boolean))cd.contacts=(cd.contacts||[]).filter(x=>r.id?x.id!==r.id:api().key(x)!==api().key(c));if(!online())saveState()}
 M.selected='';window.showImportedAddressbook();
}
async function copyContact(c){c=personal(c,person());await navigator.clipboard.writeText([name(c),api().address(c),c.email,c.phone,c.mobile,c.fax,c.fileNumber,c.processNumber,c.customerNumber].filter(Boolean).join('\n'));message('Kontaktdaten kopiert')}
async function useDocument(c,p){const k=c.key||window.phase5ContactKey?.(c)||api().key(c);window.phase5ApplyContact(k);{const eo=window.getExportOptions?.(currentReport);if(eo){state.ui.exportOptions[currentReport]={...(state.ui.exportOptions[currentReport]||{}),recipientPersonId:p?.id||'',recipientEmail:p?.email||c.email||''};saveState();window.renderReport?.()}}}
async function mail(c,p,internal){const email=p?.email||c.email;if(!email)throw Error('Für diesen Kontakt ist keine E-Mail-Adresse hinterlegt.');const target={name:p?.name||name(c),email,subject:['Betreuungsangelegenheit',c.fileNumber].filter(Boolean).join(' '),contactLink:currentLink(c,p)};
 if(internal)await window.__mxComposeTo(target);else window.location.href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(target.subject);
}
async function documentContact(c,p){const r=ref(c),id=r.scope==='case'?r.caseId:activeCase();if(!id)throw Error('Bitte zuerst einen Fall öffnen.');M.editor=null;window.openDokuEntryForm(id,-1);window.__fdKontaktUebernehmen?.(personal(c,p),r.scope,id)}
async function openDoku(item){let cd=item.caseId===activeCase()?state.caseData:window.__onlineCaseCache?.get(item.caseId)?.data;if(online()){const r=await fetch('/api/cases/'+encodeURIComponent(item.caseId)+'/doku-entries',{credentials:'same-origin'});if(!r.ok)throw Error('Dokumentation nicht verfügbar.');const j=await r.json();if(cd)cd.documentationEntries=j.entries.map(x=>({...x.data,id:x.id}))}const index=(cd?.documentationEntries||[]).findIndex(x=>x.id===item.id);if(index<0)throw Error('Eintrag nicht gefunden.');window.openDokuEntryForm(item.caseId,index)}
function smallValues(s){return Object.fromEntries(new FormData(s.form))}
async function saveSmall(){
 const s=M.small;if(!s)return true;clearTimeout(s.timer);if(s.saving){await s.saving;return s.error?false:saveSmall()}
 if(s.conflict)return false;if(!smallDirty())return true;
 if(!s.form.checkValidity()){s.error=true;s.errorNode.textContent='Bitte die markierten Felder vollständig und gültig ausfüllen.';message('Noch nicht gespeichert · Angaben prüfen',true);return false}
 const sent=smallValues(s);s.error=false;s.errorNode.textContent='';message('Wird gespeichert …');
 s.saving=(async()=>{try{await s.submit(sent,s);s.initial=JSON.stringify(sent);s.everSaved=true;s.error=false;s.retry.hidden=true;message(online()?'Gespeichert':'Lokal übernommen');return true}catch(e){s.error=true;s.conflict=e.status===409;s.errorNode.textContent=e.message;s.retry.hidden=s.conflict;s.resolveButton.hidden=!s.conflict;message('Noch nicht gespeichert · '+e.message,true);return false}finally{s.saving=null}})();
 const ok=await s.saving;if(ok&&smallDirty())return saveSmall();return ok;
}
function smallForm(title,fields,submit,resolve){
 const pane=$('.am-tab-body');pane.replaceChildren();const form=E('form','am-small-form');form.append(E('h3','',title),E('p','am-sub',online()?'Gültige Änderungen werden automatisch gespeichert.':'Änderungen mit „Fertig“ übernehmen.'));
 for(const [k,label,value,options,optional] of fields){const l=E('label','',label),input=E(options?'select':'input');input.name=k;if(k==='email')input.type='email';if(['absentFrom','absentUntil','dueAt'].includes(k))input.type='date';if(k==='dueAt')input.required=true;if(k==='name'||k==='label')input.required=true;if(options){input.append(new Option('Bitte wählen …',''));for(const [val,text] of options)input.append(new Option(text,val));input.required=!optional}input.value=value||'';l.append(input);form.append(l)}
 const error=E('p','am-error');error.setAttribute('role','status');form.append(error);const footer=E('div','am-small-footer'),save=E('button','am-btn primary','Fertig');save.type='submit';
 const s=M.small={form,initial:JSON.stringify(Object.fromEntries(new FormData(form))),saving:null,timer:null,error:false,conflict:false,everSaved:false,submit,errorNode:error};
 s.retry=B('Speichern erneut versuchen',saveSmall,'',true);s.retry.hidden=true;s.resolveButton=B('Aktuellen Stand prüfen',async()=>{if(resolve&&await resolve(s)){s.conflict=false;s.resolveButton.hidden=true;await saveSmall()}},'',true);s.resolveButton.hidden=true;
 footer.append(save,s.retry,s.resolveButton,B('Ungespeicherte Eingaben verwerfen',async()=>{clearTimeout(s.timer);if(s.saving)await s.saving;if(smallDirty()&&!confirm('Ungespeicherte Eingaben verwerfen? Bereits automatisch gespeicherte Änderungen bleiben erhalten.'))return;M.small=null;drawDetail(selected())},'quiet',true));form.append(footer);
 form.oninput=()=>{clearTimeout(s.timer);message('Änderungen noch nicht gespeichert …');if(online())s.timer=setTimeout(saveSmall,650)};form.onchange=form.oninput;
 form.onsubmit=async e=>{e.preventDefault();if(await saveSmall()){clearTimeout(s.timer);M.small=null;drawDetail(selected())}};pane.append(form);return s;
}
const CHANNELS={email:'E-Mail',phone:'Telefon',mobile:'Mobiltelefon',post:'Post',fax:'Fax'};
// Erst den vollständigen Import prüfen; die bestehende Fallliste bleibt bis dahin erhalten.
window.__abValidateImport=function(c){
 const fail=m=>{throw Error(m)},object=x=>x&&typeof x==='object'&&!Array.isArray(x);
 const dates=x=>{if(x.preferredChannel&&!Object.hasOwn(CHANNELS,x.preferredChannel))fail('Ungültiger bevorzugter Kontaktweg.');for(const k of ['absentFrom','absentUntil'])if(x[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(x[k])||!Number.isFinite(Date.parse(x[k]))||new Date(x[k]).toISOString().slice(0,10)!==x[k]))fail('Ungültiges Abwesenheitsdatum.');if(x.absentFrom&&x.absentUntil&&x.absentFrom>x.absentUntil)fail('Abwesenheitsende liegt vor dem Beginn.')};
 for(const [key,max,fields,required] of [['addresses',30,['label','street','house','houseLetter','postal','city','postbox','country'],'label'],['people',100,['name','department','role','email','phone','fax','salutation','preferredChannel','phoneHours','absentFrom','absentUntil','absenceNote','substitutePersonId'],'name']]){
  if(c[key]==null)continue;if(!Array.isArray(c[key])||c[key].length>max)fail('Ungültige Zusatzdaten: '+key);const ids=new Set();for(const x of c[key]){if(!object(x)||typeof x.id!=='string'||!x.id||x.id.length>128||ids.has(x.id))fail('Fehlende oder doppelte ID in '+key);ids.add(x.id);if(fields.some(k=>x[k]!=null&&(typeof x[k]!=='string'||x[k].length>1000))||!x[required]?.trim())fail('Ungültige Angaben in '+key);if(key==='people')dates(x)}
 }
 if(c.preferredAddressId&&!(c.addresses||[]).some(a=>a.id===c.preferredAddressId))fail('Die bevorzugte Anschrift fehlt.');
 for(const p of c.people||[])if(p.substitutePersonId&&(p.substitutePersonId===p.id||!c.people.some(x=>x.id===p.substitutePersonId)))fail('Ungültige Vertretung beim Ansprechpartner.');
 if(c._standardRecipients!=null){if(!object(c._standardRecipients))fail('Ungültige Standardempfänger.');for(const [key,id] of Object.entries(c._standardRecipients))if(!/^(document|mail|role:(court|doctor|insurance)|report:[a-zA-Z0-9_.-]{1,150})$/.test(key)||typeof id!=='string'||(id&&!(c.people||[]).some(p=>p.id===id)))fail('Ungültiger Standardempfänger.')}
 dates(c);return c;
};
const VIEW_IDS={query:'phase5AddressSearchV154',status:'phase5AddressStatusV154',city:'phase5AddressCityV154',role:'phase5AddressRoleV154',institution:'phase5AddressInstitutionV154',kind:'phase5AddressKindV154',sortBy:'phase5AddressSortV154',direction:'phase5AddressDirectionV154',nameOrder:'phase5AddressNameOrderV154'};
function viewMenu(){
 const menu=E('details','am-menu am-views');menu.append(E('summary','am-btn','Ansichten'));const body=E('div','am-menu-body'),label=E('label','','Gespeicherte Ansicht'),select=E('select');select.id='amSavedViews';label.append(select);body.append(label);menu.append(body);
 const fill=views=>{M.views=views;const value=select.value;select.replaceChildren(new Option('Ansicht auswählen …',''));for(const v of views)select.append(new Option(v.label,v.id));select.value=value};
 const load=async()=>{fill(online()?(await request('views')).views:state.ui.addressbookViews||[])};
 select.onchange=async()=>{if(!await flush())return;const v=M.views.find(v=>v.id===select.value);if(!v)return;for(const [k,id] of Object.entries(VIEW_IDS)){const el=document.getElementById(id);if(!el)continue;const val=v.filters[k]||'';if(el.tagName==='SELECT'&&val&&![...el.options].some(o=>o.value===val))el.append(new Option(val,val));el.value=val}$('#amMissingEmail').checked=v.filters.missingEmail==='yes';window.phase5RenderAddressbookV154();menu.open=false};
 async function saveView(rename=false){const old=M.views.find(v=>v.id===select.value);if(rename&&!old)throw Error('Bitte zuerst eine Ansicht wählen.');const name=prompt(rename?'Ansicht umbenennen:':'Aktuelle Filter speichern als:',rename?old.label:'');if(name===null)return;if(!name.trim())throw Error('Bitte einen Namen angeben.');const row={id:rename?old.id:crypto.randomUUID(),label:name.trim(),filters:rename?old.filters:{...M.view},version:rename?old.version:0};if(online())fill((await request('views',row,'PUT')).views);else{state.ui.addressbookViews=[...(state.ui.addressbookViews||[]).filter(v=>v.id!==row.id),{...row,version:row.version+1}];saveState();fill(state.ui.addressbookViews)}select.value=row.id;message('Ansicht gespeichert')}
 body.append(B('Aktuelle Filter speichern',()=>saveView()),B('Ansicht umbenennen',()=>saveView(true)),B('Ansicht löschen',async()=>{const v=M.views.find(v=>v.id===select.value);if(!v)throw Error('Bitte zuerst eine Ansicht wählen.');if(!confirm('Ansicht „'+v.label+'“ löschen?'))return;if(online())fill((await request('views',{id:v.id,version:v.version},'DELETE')).views);else{state.ui.addressbookViews=M.views.filter(x=>x.id!==v.id);saveState();fill(state.ui.addressbookViews)}}));M.views=[];load().catch(e=>message(e.message,true));return menu;
}
// Bearbeitungsformulare halten ihre Ausgangsversion fest; Konflikte überschreiben keine fremden Daten.
async function rebaseSmall(s,remote,label){
 const before=JSON.parse(s.initial),own=smallValues(s),changed=Object.fromEntries(Object.keys(own).filter(k=>own[k]!==String(before[k]||'')).map(k=>[k,own[k]]));
 const difference=Object.keys(changed).map(k=>(LABELS[k]||({label:'Bezeichnung',country:'Land'})[k]||k)+': aktuell „'+(remote[k]||'—')+'“ / Ihre Eingabe „'+changed[k]+'“').join('\n');
 if(!confirm(label+' laden und Ihre offenen Änderungen darauf anwenden? Andere Angaben bleiben erhalten.\n\n'+difference))return false;
 for(const k of Object.keys(own))s.form.elements[k].value=changed[k]??remote[k]??'';return true;
}
function contactForm(c,title,fields,toPatch,valuesFor=d=>d){
 let base=M.bundle.contact,version=M.bundle.version;smallForm(title,fields,async values=>{const patch=toPatch(values,base);let bundle;if(online())bundle=await request('contact',{...ref(c),version,patch},'PATCH');else bundle=await savePatch(c,patch);base=bundle.contact;version=bundle.version;await cacheBundle(bundle,ref(c));M.bundle=bundle},async s=>{const fresh=await request('contact?'+new URLSearchParams(ref(c)));if(!await rebaseSmall(s,valuesFor(fresh.contact),'Aktuellen Kontakt'))return false;base=fresh.contact;version=fresh.version;return true});
}
function drawAddresses(body,c,d){
 const main=section('Hauptanschrift');info(main,'Anschrift',api().address(d),'address');main.append(B(!d.preferredAddressId?'✓ Bevorzugte Anschrift':'Als bevorzugte Anschrift',()=>savePatch(c,{preferredAddressId:''})));body.append(main);
 for(const a of d.addresses||[]){const s=section(a.label);info(s,'Anschrift',[api().address(a),a.country].filter(Boolean).join(', '),'address');s.append(B(d.preferredAddressId===a.id?'✓ Bevorzugte Anschrift':'Als bevorzugte Anschrift',()=>savePatch(c,{preferredAddressId:a.id})),B('Anschrift bearbeiten',()=>editAddress(c,a)),B('Anschrift entfernen',async()=>{if(!confirm('Anschrift „'+a.label+'“ entfernen?'))return;if(!online()){await savePatch(c,{addresses:d.addresses.filter(x=>x.id!==a.id),...(d.preferredAddressId===a.id?{preferredAddressId:''}:{})});return}const bundle=await request('contact',{...ref(c),version:M.bundle.version,patch:{addresses:d.addresses.filter(x=>x.id!==a.id),...(d.preferredAddressId===a.id?{preferredAddressId:''}:{})}},'PATCH');await cacheBundle(bundle,ref(c));M.bundle=bundle;window.phase5RenderAddressbookV154()},'danger'));body.append(s)}body.append(B('+ Anschrift',()=>editAddress(c),'primary'));
}
function editAddress(c,a){const id=a?.id||crypto.randomUUID();contactForm(c,a?'Anschrift bearbeiten':'Neue Anschrift',[['label','Bezeichnung',a?.label],...['street','house','houseLetter','postal','city','postbox','country'].map(k=>[k,k==='country'?'Land':LABELS[k],a?.[k]])],(v,base)=>{const all=[...(base.addresses||[])],i=all.findIndex(x=>x.id===id);if(i<0)all.push({...v,id});else all[i]={...v,id};return {addresses:all}},d=>(d.addresses||[]).find(x=>x.id===id)||{})}
function drawAvailability(body,c,d){
 const s=section('Erreichbarkeit');info(s,'Bevorzugter Kontaktweg',CHANNELS[d.preferredChannel]||'Keine Vorgabe');info(s,'Telefonzeiten',d.phoneHours);info(s,'Abwesend ab',dateLabel(d.absentFrom));info(s,'Abwesend bis',dateLabel(d.absentUntil));info(s,'Hinweis',d.absenceNote);const substitute=(window.__baModernContacts?.()||[]).find(x=>x.id===d.substituteContactId);if(d.substituteContactId)s.append(B('Vertretung: '+(substitute?name(substitute):'Zentralen Kontakt öffnen'),()=>openContact(d.substituteContactId)));s.append(B('Erreichbarkeit bearbeiten',()=>editAvailability(c,d)));body.append(s);
 const p=person();if(p){const s=section(p.name);info(s,'Telefonzeiten',p.phoneHours);info(s,'Abwesenheit',[dateLabel(p.absentFrom),dateLabel(p.absentUntil),p.absenceNote].filter(Boolean).join(' · '));const replacement=(d.people||[]).find(x=>x.id===p.substitutePersonId);if(replacement)s.append(B('Vertretung: '+replacement.name,()=>{$('#amPerson').value=replacement.id;M.personIds.set(identity(c),replacement.id);drawTab(c)}));s.append(B('Ansprechpartner bearbeiten',()=>editPerson(c,p)));body.append(s)}
}
async function editAvailability(c,d){
 if(online())await window.__baLoadServerBuero?.();const contacts=window.__baModernContacts?.()||api().contacts();const choices=contacts.filter(x=>x.__buero||(!x.__caseId&&x.id!==c.id)).filter(x=>x.id!==c.id&&x.id!==M.bundle.centralId).map(x=>[x.id,name(x)]);if(d.substituteContactId&&!choices.some(x=>x[0]===d.substituteContactId))choices.push([d.substituteContactId,'Bisherige Vertretung']);
 contactForm(c,'Erreichbarkeit bearbeiten',[['preferredChannel','Bevorzugter Kontaktweg',d.preferredChannel,Object.entries(CHANNELS),true],...['phoneHours','absentFrom','absentUntil','absenceNote'].map(k=>[k,LABELS[k],d[k]]),['substituteContactId','Vertretung (zentrales Adressbuch)',d.substituteContactId,choices,true]],v=>v);
}
async function openContact(id){await window.__abOpenContact(id,'')}
function editAssociation(c,a){let version=a.version;const target={scope:'case',caseId:a.caseId,id:a.contactId};smallForm('Fallangaben: '+a.label,['role','fileNumber','processNumber','customerNumber'].map(k=>[k,LABELS[k],a[k]]),async values=>{const bundle=await request('contact',{...target,version,patch:values},'PATCH');version=bundle.version;await cacheBundle(bundle,target);M.bundle=await request('contact?'+new URLSearchParams(ref(c)))},async s=>{const fresh=await request('contact?'+new URLSearchParams(target));if(!await rebaseSmall(s,fresh.contact,'Aktuelle Fallangaben'))return false;version=fresh.version;return true})}
function purposeLabel(p){return ({document:'Alle Dokumente',mail:'E-Mail','role:court':'Gericht','role:doctor':'Arzt','role:insurance':'Versicherung'})[p]||(p.startsWith('report:')?'Schreiben: '+((typeof REPORTS!=='undefined'?REPORTS:[]).find(r=>r.id===p.slice(7))?.title||p.slice(7)):p)}
function editStandards(c,a){
 const body=$('.am-tab-body');body.replaceChildren();const s=section('Standardempfänger · '+a.label),label=E('label','','Rolle oder Schreibentyp'),select=E('select');select.id='amStandardPurpose';for(const p of ['document','mail','role:court','role:doctor','role:insurance'])select.append(new Option(purposeLabel(p),p));for(const r of typeof REPORTS!=='undefined'?REPORTS:[])if(!String(r.id).startsWith('buero_'))select.append(new Option(r.title||r.label||r.id,'report:'+r.id));label.append(select);s.append(E('p','am-sub','Ein Standard je Fall und Zweck. Ein bestimmter Schreibentyp hat Vorrang vor Rolle und allgemeinem Dokumentstandard. Eine manuelle Empfängerauswahl bleibt erhalten.'),label,E('p','am-sub','Empfänger: '+(person()?.name||name(c))),B('Als Standard festlegen',()=>setStandard(c,a,select.value,false),'primary'),B('Diesen Standard entfernen',()=>setStandard(c,a,select.value,true)),B('Zurück',()=>drawTab(c)));if(typeof currentReport!=='undefined'&&a.caseId===activeCase()){const role=E('select');role.append(new Option('Keine Rollenvorgabe',''),new Option('Gericht','court'),new Option('Arzt','doctor'),new Option('Versicherung','insurance'));role.value=state.ui?.exportOptions?.[currentReport]?.recipientRole||'';const l=E('label','','Rolle für das aktuelle Schreiben');l.append(role);s.append(l,B('Rolle für aktuelles Schreiben speichern',()=>{state.ui.exportOptions=state.ui.exportOptions||{};state.ui.exportOptions[currentReport]={...(state.ui.exportOptions[currentReport]||{}),recipientRole:role.value};saveState();message('Empfängerrolle gespeichert')}));}body.append(s);
}
async function followup(c){
 const r=ref(c),caseId=r.scope==='case'?r.caseId:activeCase();if(!caseId)throw Error('Bitte einen Fall für die Rückmeldung öffnen.');const link=currentLink(c,person());let todoId='';const followupId=crypto.randomUUID();let baseVersion='';
 smallForm('Rückmeldung vereinbaren',[['name','Anlass',''],['dueAt','Wiedervorlage am',''],['description','Vereinbarung / Notiz','']],async v=>{if(online()){const result=await request('followup',{...r,targetCaseId:caseId,followupId,baseVersion,personId:link.personId,patch:v});baseVersion=result.version;M.bundle=await request('contact?'+new URLSearchParams(r));return}const payload={title:'Wiedervorlage: '+v.name,description:v.description,dueAt:v.dueAt+'T00:00:00',itemType:'followup',caseId,caseLabel:window.__onlineCaseCache?.get(caseId)?.label||'',sourceType:'contact',sourceId:r.id,sourceModule:'addressbook',sourceRef:JSON.stringify({contactLink:link}),connectionId:'local'};if(todoId)await window.__todoUpdateItem(todoId,payload);else{const result=await window.__todoCreateItem(payload);todoId=result?.id||result?.todo?.id;if(!todoId)throw Error('Die Wiedervorlage wurde gespeichert. Bitte die Ansicht neu öffnen.')}if(online())M.bundle=await request('contact?'+new URLSearchParams(r))});
}
async function openCommunication(item){if(item.kind==='mail'){await window.__mxOpenMsg(item.accountId,item.folder,item.uid);return}if(item.kind==='document'){if(item.caseId!==activeCase())await window.__abSwitchCase(item.caseId);if(item.caseId!==activeCase())throw Error('Der zugehörige Fall konnte nicht geöffnet werden.');window.showExportHistory();return}if(item.kind==='followup'){await window.openFollowupsWorkspace(item.workspaceId||(item.sourceId?'todo:'+item.sourceId:''));return}return openDoku(item)}
async function syncMail(c,force=false){
 if(!online()||M.tab!=='communication')return;const key=identity(c),root=M.root;if(M.mailSync?.key===key&&(M.mailSync.running||(!force&&Date.now()-M.mailSync.at<60000)))return;
 const run=M.mailSync={key,running:true,at:Date.now(),text:'Nachrichten werden abgeglichen …'},current=()=>M.mailSync===run&&M.root===root&&root.isConnected&&M.selected===key&&M.tab==='communication';let cursor;
 try{do{
  const result=await request('communications/sync',{...ref(c),...(cursor?{cursor}:{})});cursor=result.cursor;
  run.text=result.done?(result.errors.length?'Teilweise aktualisiert · '+result.errors.join(' '):'Nachrichten aktuell · '+result.checked+' geprüft'):'Nachrichtenabgleich läuft · '+result.checked+' geprüft';
  if(!current())break;const el=$('#amMailSync');if(el)el.textContent=run.text;
  if(result.done&&!M.small&&!M.editor){const bundle=M.bundle,load=M.load,result=await request('communications?'+new URLSearchParams(ref(c)));if(current()&&M.bundle===bundle&&M.load===load&&!M.small&&!M.editor){bundle.communications=result.items;bundle.communicationCursor=result.nextCursor;drawTab(c)}}
 }while(cursor&&current());if(cursor)run.text='Abgleich unterbrochen · erneut aktualisieren';
 }catch(e){run.text='Nachrichten konnten nicht vollständig aktualisiert werden.';if(current()){const el=$('#amMailSync');if(el)el.textContent=run.text;throw e}}finally{run.running=false}}
function editPerson(c,p){
 const id=p?.id||crypto.randomUUID();let base=p||{},baseVersion=M.bundle?.personVersions?.[id]||'';
 const fields=[['name','Name'],['department','Abteilung'],['role','Funktion'],['email','E-Mail'],['phone','Telefon'],['fax','Fax'],['salutation','Anrede'],['preferredChannel','Bevorzugter Kontaktweg'],['phoneHours','Telefonzeiten'],['absentFrom','Abwesend ab'],['absentUntil','Abwesend bis'],['absenceNote','Hinweis zur Abwesenheit'],['substitutePersonId','Vertretung innerhalb der Institution']];
 smallForm(p?'Ansprechpartner bearbeiten':'Neuer Ansprechpartner',fields.map(([k,label])=>[k,label,base[k],k==='preferredChannel'?Object.entries(CHANNELS):k==='substitutePersonId'?(c.people||[]).filter(x=>x.id!==id).map(p=>[p.id,p.name]):undefined,true]),async values=>{
  let bundle;if(online())bundle=await request('person',{...ref(c),personId:id,baseVersion,patch:values},'PATCH');else{const people=[...(api().contacts().find(x=>identity(x)===identity(c))?.people||c.people||[])],next={...values,id},i=people.findIndex(x=>x.id===id);if(i>=0)people[i]=next;else people.push(next);bundle=await savePatch(c,{people})}
  base=bundle.contact.people.find(x=>x.id===id)||{};baseVersion=bundle.personVersions?.[id]||'';await cacheBundle(bundle,ref(c));M.bundle=bundle;
 },async s=>{
  const fresh=await request('contact?'+new URLSearchParams(ref(c))),remote=fresh.contact.people?.find(x=>x.id===id)||{},own=smallValues(s),changed=Object.fromEntries(fields.filter(([k])=>String(own[k]||'')!==String(base[k]||'')).map(([k])=>[k,own[k]]));
  const difference=Object.keys(changed).map(k=>(fields.find(x=>x[0]===k)?.[1]||k)+': aktuell „'+(remote[k]||'—')+'“ / Ihre Eingabe „'+changed[k]+'“').join('\n');
  if(!confirm('Aktuellen Ansprechpartner laden und Ihre Änderungen darauf anwenden? Andere Felder bleiben erhalten.\n\n'+difference))return false;
  base=remote;baseVersion=fresh.personVersions?.[id]||'';for(const [k] of fields)s.form.elements[k].value=changed[k]??remote[k]??'';return true;
 });
}
async function deletePerson(c,p){if(!confirm('Ansprechpartner „'+p.name+'“ entfernen? Historische Dokumentation bleibt erhalten.'))return;if(!online()){await savePatch(c,{people:(api().contacts().find(x=>identity(x)===identity(c))?.people||c.people||[]).filter(x=>x.id!==p.id)});return}const bundle=await request('person',{...ref(c),personId:p.id,baseVersion:M.bundle?.personVersions?.[p.id]||'',remove:true},'PATCH');await cacheBundle(bundle,ref(c));M.bundle=bundle;window.phase5RenderAddressbookV154()}
function assign(c){
 const associated=new Set((M.bundle?.associations||[]).map(a=>a.caseId));const entries=[...(window.__onlineCaseCache?.entries()||[])].filter(([id])=>!associated.has(id)).map(([id,e])=>[id,e.label||id]);if(!entries.length)throw Error('Der Kontakt ist bereits allen verfügbaren Fällen zugeordnet.');
 const assignmentId=crypto.randomUUID();let targetVersion='',targetCaseId='';
 smallForm('Einem weiteren Fall zuordnen',[['targetCaseId','Fall','',entries],['role','Rolle in diesem Fall',c.role],['fileNumber','Aktenzeichen im Zielfall',''],['processNumber','Vorgangsnummer im Zielfall',''],['customerNumber','Kundennummer im Zielfall','']],async(values,s)=>{
  if(!targetCaseId)targetCaseId=values.targetCaseId;s.form.elements.targetCaseId.setAttribute('aria-readonly','true');
  const bundle=await request('assign',{...ref(c),...values,targetCaseId,assignmentId,targetVersion});targetVersion=bundle.assignment.version;await cacheBundle(bundle,ref(c));M.bundle=bundle;
 },async s=>{
  if(!targetCaseId)return false;const fresh=await request('contact?'+new URLSearchParams({scope:'case',caseId:targetCaseId,id:assignmentId}));
  if(!confirm('Die Fallzuordnung wurde geändert. Ihre offenen Angaben zu Rolle, Aktenzeichen und Vorgangsnummer auf den aktuellen Stand anwenden?'))return false;targetVersion=fresh.version;return true;
 });
 const input=M.small.form.elements.targetCaseId;input.addEventListener('change',()=>{if(targetCaseId){input.value=targetCaseId;message('Für einen weiteren Fall bitte eine neue Zuordnung öffnen.')}});
}

async function detach(c,a){if(!confirm('Die zentrale Verknüpfung für „'+a.label+'“ lösen? Der Kontakt bleibt als eigenständiger Fallkontakt erhalten.'))return;const bundle=await request('detach',{...ref(c),targetCaseId:a.caseId,contactId:a.contactId});await cacheBundle(bundle,ref(c));await refreshCase(a.caseId);if(M.selected===identity(c)){M.bundle=bundle;drawTab(c)}}
async function setStandard(c,a,purpose,remove){const p=person();const bundle=await request('standard',{caseId:a.caseId,id:a.contactId,purpose,personId:p?.id||'',remove});await cacheBundle(bundle,{scope:'case',caseId:a.caseId,id:a.contactId});await refreshCase(a.caseId);if(M.selected===identity(c)){const fresh=await loadDetails(c);if(fresh)drawTab(c)}}
async function restore(c,h){if(!confirm('Die angezeigte Änderung rückgängig machen? Dies wird als neue Änderung protokolliert.'))return;if(!online()){const patch={};for(const [k,v] of Object.entries(h.changes))if(Object.hasOwn(LABELS,k)&&k!=='_standardRecipients')patch[k]=v.before??(['people','addresses'].includes(k)?[]:'');if(patch.addresses&&(patch.preferredAddressId??c.preferredAddressId)&&!patch.addresses.some(a=>a.id===(patch.preferredAddressId??c.preferredAddressId)))patch.preferredAddressId='';if(!(patch.institution??c.institution)&&!(patch.lastName??c.lastName))throw Error('Die Anlage eines Kontakts lässt sich hier nicht rückgängig machen.');await savePatch(c,patch);return}const bundle=await request('restore',{...ref(c),historyId:h.id,version:M.bundle.version});await cacheBundle(bundle,ref(c));M.bundle=bundle;window.phase5RenderAddressbookV154()}
const mergeRequests=new Map();let mergeEpoch=0;
const mergeScore=c=>['institution','firstName','lastName','role','email','phone','mobile','street','city','postal','fileNumber','iban'].filter(k=>String(c[k]||'').trim()).length;
function applyMergeResult(caseId,result,removedId){
 const targets=[caseId===activeCase()?state.caseData:null,window.__onlineCaseCache?.get(caseId)?.data].filter(Boolean);
 for(const cd of new Set(targets)){cd.contacts=result.contacts;cd.contactMerges=[...(cd.contactMerges||[]).filter(x=>!x._serverMerge&&x.id!==removedId),...result.merges]}
 if(caseId===activeCase())saveState();
}
window.__abLoadModernMerges=async caseId=>{const epoch=mergeEpoch,result=await request('merges?'+new URLSearchParams({caseId}));if(epoch===mergeEpoch&&!window.__abMergeBusy)applyMergeResult(caseId,result);return result};
window.__abModernMerge=async(groups,caseId)=>{
 if(window.__abMergeBusy)throw Error('Bitte die laufende Zusammenführung abwarten.');window.__abMergeBusy=true;mergeEpoch++;
 try{const snapshot=await request('merges?'+new URLSearchParams({caseId}));const plans=groups.map(g=>({ids:g.map(c=>c.id),survivorId:g.slice().sort((a,b)=>(Number(!!b.centralContactId)-Number(!!a.centralContactId))||(Number(!!b.id)-Number(!!a.id))||(mergeScore(b)-mergeScore(a)))[0].id,versions:Object.fromEntries(g.map(c=>[c.id,snapshot.versions[c.id]]))}));
  const key=JSON.stringify([caseId,plans.map(p=>[p.ids,p.survivorId])]),operationId=mergeRequests.get(key)||crypto.randomUUID();mergeRequests.set(key,operationId);
  const result=await request('merge',{caseId,operationId,groups:plans});applyMergeResult(caseId,result);mergeRequests.delete(key);return result;
 }finally{window.__abMergeBusy=false}
};
window.__abModernUnmerge=async(record,caseId)=>{
 if(window.__abMergeBusy)throw Error('Bitte den laufenden Vorgang abwarten.');window.__abMergeBusy=true;mergeEpoch++;
 try{const snapshot=await request('merges?'+new URLSearchParams({caseId}));const result=await request('unmerge',{caseId,id:record.id,...(!record._serverMerge?{legacy:record,versions:snapshot.versions}:{})});applyMergeResult(caseId,result,record.id);return result}finally{window.__abMergeBusy=false}
};
window.__abMailDokuLink=function(caseId,to,preferred){
 const emails=String(to||'').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[];
 const cd=String(caseId)===activeCase()?state.caseData:window.__onlineCaseCache?.get(String(caseId))?.data;
 if(preferred?.contactId&&(preferred.scope==='office'||preferred.caseId===String(caseId))&&preferred.snapshot?.email&&emails.includes(preferred.snapshot.email.toLowerCase()))return preferred;
 const hits=[];for(const c of cd?.contacts||[]){if(c.email&&emails.includes(c.email.toLowerCase()))hits.push(currentLink({...c,__caseId:caseId},null));for(const p of c.people||[])if(p.email&&emails.includes(p.email.toLowerCase()))hits.push(currentLink({...c,__caseId:caseId},p));}
 return hits.length===1?hits[0]:null;
};
window.__abPersonView=(c,id)=>personal(c,(c.people||[]).find(p=>p.id===id));
window.__abModernLink=currentLink;
window.__abContactsForCase=id=>String(id)===activeCase()?state.caseData.contacts:window.__onlineCaseCache?.get(String(id))?.data?.contacts||[];
window.__abOpenContact=async(id,caseId)=>{await window.__abSwitchCase(caseId||'__buero');if(caseId&&String(caseId)!==activeCase())throw Error('Der verknüpfte Fall konnte nicht geöffnet werden.');if(!visible())window.showImportedAddressbook();const c=api().contacts().find(c=>c.id===id);if(c)await choose(c);else throw Error('Kontakt nicht mehr verfügbar.')};
const visible=()=>!!M.root?.isConnected&&!document.getElementById('modal')?.classList.contains('hidden');
window.__abModern={mount,render,jumpToLetter,active:visible,hold:()=>!!(visible()&&(M.editor||M.small)),selected,flush,edit,savePatch};
window.__abReportRole=(id,eo)=>{const saved=state.ui?.exportOptions?.[id]?.recipientRole;if(['court','doctor','insurance'].includes(saved))return saved;if(['initial','annual_assets','annual_noassets','closing','court_approval','accounting','remuneration'].includes(id))return 'court';return ['doctor','insurance'].includes(eo?.recipientType)?eo.recipientType:''};
window.__abDefaultRecipient=function(purpose='document',reportId,role){
 const keys=[];if(purpose==='document'&&reportId)keys.push('report:'+reportId);if(role)keys.push('role:'+role);keys.push(purpose);
 for(const key of keys){const c=(state.caseData.contacts||[]).find(x=>!isEnded(x)&&Object.hasOwn(x._standardRecipients||{},key));if(c){const p=(c.people||[]).find(x=>x.id===c._standardRecipients[key]);return {contact:c,person:p||null,...personal(c,p)}}}return null;
};
// Die Anwendung hat mehrere spätere Empfänger-Renderer. Ansprechpartner deshalb auch an
// deren öffentlichen Ausgabegrenzen auflösen; die dauerhafte Schlüsselreferenz bleibt die Institution.
function recipientPerson(eo){if(eo?.recipientType!=='contact'&&eo?._resolvedRecipientType!=='contact')return null;const c=window.phase5FindContact?.(eo.recipientContactKey);const p=c?.people?.find(p=>p.id===eo.recipientPersonId);return c?personal(c,p):null}
function recipientLines(c){return [c.institution,[c.title,c.firstName,c.lastName].filter(Boolean).join(' '),[c.street,[c.house,c.houseLetter].filter(Boolean).join('')].filter(Boolean).join(' ')||(c.postbox?'Postfach '+c.postbox:''),[c.postal,c.city].filter(Boolean).join(' '),c.country||''].filter(Boolean)}
for(const key of ['exportRecipientHTML','phase3RecipientLines','resolveExportRecipientLabel']){const previous=window[key];if(typeof previous!=='function')continue;window[key]=function(eo){const c=recipientPerson(eo);if(!c)return previous.apply(this,arguments);const lines=recipientLines(c);return key==='phase3RecipientLines'?lines:key==='resolveExportRecipientLabel'?lines.join(', '):lines.map(s=>{const d=E('div','',s);return d.innerHTML}).join('<br>')}}
const oldHistory=window.phase4CreateHistory;if(typeof oldHistory==='function')window.phase4CreateHistory=function(eo){const h=oldHistory.apply(this,arguments),c=window.phase5FindContact?.(eo?.recipientContactKey);if(h&&!h.__buero&&c){h.contactLink=currentLink(c,(c.people||[]).find(p=>p.id===eo.recipientPersonId));saveState()}return h};
const previousOptions=window.getExportOptions;window.getExportOptions=function(id){
 const eo=previousOptions.apply(this,arguments),saved=state.ui?.exportOptions?.[id]||{};
 // Standardvorschlag erst nach allen älteren Exportadaptern auflösen. Eine ausdrücklich
 // gewählte Adresse (einschließlich einer Auswahl nur für diesen Export) hat weiter Vorrang.
 if(!String(id||'').startsWith('buero_')&&!saved.recipientContactKey&&(!saved.recipientType||saved.recipientType==='export')&&!eo._persistentRecipientType){const def=window.__abDefaultRecipient('document',id,window.__abReportRole(id,eo));if(def){eo.recipientType='contact';eo._resolvedRecipientType='contact';eo.recipientContactKey=def.contact.key||window.phase5ContactKey(def.contact);eo.recipientPersonId=def.person?.id||''}}
 const c=recipientPerson(eo);if(c){eo._effectiveContact=c;eo.recipientEmail=c.email||'';eo.recipientFax=c.fax||''}return eo;
};
// Safari hält einzelne früh deklarierte Ausgabe-Funktionen zusätzlich als globale Bindung.
try{getExportOptions=window.getExportOptions;phase3RecipientLines=window.phase3RecipientLines;exportRecipientHTML=window.exportRecipientHTML;resolveExportRecipientLabel=window.resolveExportRecipientLabel;phase4CreateHistory=window.phase4CreateHistory}catch(_e){}
setInterval(()=>{if(visible()&&M.tab==='communication'&&!M.editor&&!M.small&&selected())syncMail(selected()).catch(()=>{})},60000);
window.addEventListener('beforeunload',e=>{if((M.editor&&(M.editor.saving||Object.keys(M.editor.pending).length))||smallDirty()||M.small?.saving){e.preventDefault();e.returnValue=''}});
window.addEventListener('mobileBeforeNavigate',e=>{if(window.__abMergeBusy){e.preventDefault();message('Bitte den laufenden Vorgang abwarten.');return}if(!visible()||(!M.editor&&!M.small))return;e.preventDefault();flush().then(ok=>{if(ok){M.editor=null;M.editRequest++;e.detail.proceed()}})});
document.addEventListener('pointerdown',e=>{if(visible()&&!e.target.closest('#addressbookModern .am-menu,#addressbookModern .am-filters'))closeMenus()});
window.addEventListener('resize',positionMenus);window.visualViewport?.addEventListener('resize',positionMenus);
const previousClose=window.closeModal;window.closeModal=function(){if(window.__abMergeBusy){window.toast?.('Bitte den laufenden Vorgang abwarten.');return}if(visible()&&(M.editor||M.small)){const self=this,args=arguments;return flush().then(ok=>{if(ok){M.editor=null;M.editRequest++;return previousClose.apply(self,args)}})}M.editRequest++;return previousClose.apply(this,arguments)};
const observer=new MutationObserver(()=>{if(!document.querySelector('#addressbookModern'))document.getElementById('modal')?.classList.remove('am-modal')});const modal=document.getElementById('modalBody');if(modal)observer.observe(modal,{childList:true});
})();
