/* Shared presentation for module headings. Existing controls and their handlers stay intact. */
(function(){
 'use strict';
 const modules={
  calendar:{labels:['Kalender'],path:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'},
  tasks:{labels:['Aufgaben'],path:'<path d="m9 11 3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'},
  deadlines:{labels:['Fristen & Wiedervorlagen','Fristen'],path:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'},
  followups:{labels:['Wiedervorlagen'],path:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2"/>'},
  contacts:{labels:['Adressbuch','Adressbuch aus Excel'],path:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'},
  documents:{labels:['Datei-Explorer'],path:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'},
  documentation:{labels:['Falldokumentation'],path:'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'},
  planning:{labels:['Wünsche, Ziele & Entscheidungsplanung','Wünsche und Bedarfe','Wünsche & Ziele','Bedarfe & Wille'],path:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'},
  housing:{labels:['Wohnen'],path:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21v-8h6v8"/>'},
  finance:{labels:['Bürofinanzen','Finanzen']},
  cash:{labels:['Handkasse (Kassenbuch)','Handkasse']},
  health:{labels:['Gesundheitsübersicht','Gesundheit']},
  approvals:{labels:['Betreuungsgerichtliche Genehmigungen','Genehmigungen']},
  monitor:{labels:['Kontaktmonitor (§ 1863 BGB)','Kontaktmonitor']},
  banking:{labels:['Banken & Zahlungsverkehr','Banken']},
  archive:{labels:['Archivierte Formulare','Archiv']},
  abilities:{labels:['Fähigkeiten & Alltag']},
  intake:{labels:['Fallbeginn – geführter Intake','Fallbeginn (Intake)','Fallbeginn']},
  outtake:{labels:['Fallabschluss – geführter Outtake','Fallabschluss (Outtake)','Fallabschluss']},
  diagnostics:{labels:['Systemdiagnose und Qualitätssicherung','Systemdiagnose']},
  ai:{labels:['KI-Direktverbindung konfigurieren','KI-Direktverbindung']}
 };
 const svgMarkup=path=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+path+'</svg>';
 function navigationIcon(labels){
  for(const icon of document.querySelectorAll('.nav-icon-svg svg')){
   const control=icon.closest('button,summary,a');
   if(control&&([control,...control.querySelectorAll('span')].some(s=>labels.includes(s.textContent.trim()))||labels.includes([...control.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim())))return icon;
  }
  return null;
 }
 function decorate(title,key){
  if(!title)return;
  if(title.querySelector(':scope > .module-title-icon')&&title.dataset.moduleHeading===key)return;
  const label=title.textContent.trim(),spec=modules[key],source=navigationIcon(spec?.labels||[label]);
  if(!source&&!spec?.path)return;
  const text=document.createElement('span');text.className='module-title-text';text.textContent=label;
  const icon=document.createElement('span');icon.className='module-title-icon';icon.setAttribute('aria-hidden','true');
  if(source){const svg=source.cloneNode(true);svg.removeAttribute('class');svg.removeAttribute('style');svg.removeAttribute('id');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.querySelectorAll('title,desc').forEach(e=>e.remove());icon.append(svg)}
  else icon.innerHTML=svgMarkup(spec.path);
  title.replaceChildren(icon,text);title.classList.add('module-title');title.dataset.moduleHeading=key;
 }
 function closeButton(actions,label){
  if(!actions||actions.querySelector('[data-module-close]'))return;
  const b=document.createElement('button');b.type='button';b.className='module-close';b.dataset.moduleClose='';b.setAttribute('aria-label',label+' schließen');b.title=label+' schließen';b.innerHTML=svgMarkup('<path d="m6 6 12 12M6 18 18 6"/>');b.onclick=()=>window.closeModal();actions.append(b);
 }
 const specs=[
  ['calendar','.cal-work-head','h2','.cal-head-actions'],
  ['tasks','#todoWorkspace .at-header','h1','.at-header-actions'],
  ['deadlines','#fristenWorkspace .fd-header','h1','.fd-header-actions'],
  ['followups','#wiedervorlagenWorkspace .wv-titlebar','h1','.wv-header-actions'],
  ['contacts','#addressbookModern .am-head','.am-heading h2','.am-actions'],
  ['planning','.gdp-shell > .gdp-header','.gdp-brand h2','.gdp-actions'],
  ['housing','.housing-header-v255','.housing-brand-v255 h2','.housing-head-actions-v260']
 ];
 const otherRoots=[
  ['#functionalProfileHubOverlayV255','abilities','.v255-dialog-head h2'],
  ['#functionalProfileOverlayV255','abilities','.v255-dialog-head h2'],
  ['#ciOverlay','intake','.ci-head h1'],
  ['#coOverlay','outtake','.ci-head h1']
 ];
 function documentationHeader(modal){
  const header=modal.querySelector('.fd-shell > .fd-head');if(!header)return;
  header.classList.add('module-header');decorate(header.querySelector('h3'),'documentation');
  let actions=header.querySelector(':scope > .module-documentation-actions');
  if(!actions){
   actions=document.createElement('div');actions.className='module-header-actions module-documentation-actions';
   actions.append(...header.querySelectorAll(':scope > .sync,:scope > .menu,:scope > .fd-btn,:scope > .fd-ib'));
   header.append(actions);
  }
  // Keep the documentation close handler: it protects unfinished entry forms.
  const close=actions.querySelector('.fd-ib');
  if(close){close.classList.add('module-close');close.dataset.moduleClose='';close.setAttribute('aria-label','Falldokumentation schließen')}
  // The mobile heading also contains the interactive case picker. Decorate only its title.
  const mobileTitle=modal.querySelector('.fd-shell.fd-mobil-liste > .fd-m-top h4');
  if(mobileTitle&&!mobileTitle.querySelector('.module-title')){
   const title=document.createElement('span');
   for(const node of [...mobileTitle.childNodes])if(node.nodeType===3)title.append(node);
   mobileTitle.prepend(title);decorate(title,'documentation');
  }
 }
 function apply(){
  for(const [selector,key,titleSelector] of otherRoots){
   const root=document.querySelector(selector);if(!root)continue;
   root.classList.add('module-heading-root');decorate(root.querySelector(titleSelector),key);
  }
  const modal=document.getElementById('modal');if(!modal)return;
  documentationHeader(modal);
  for(const [key,selector,titleSelector,actionSelector] of specs){
   const header=modal.querySelector(selector);if(!header)continue;
   header.classList.add('module-header');decorate(header.querySelector(titleSelector),key);
   const actions=header.querySelector(actionSelector);actions?.classList.add('module-header-actions');
   if(key==='contacts'||key==='planning'||key==='housing')closeButton(actions,modules[key].labels[0]);
   if(key==='calendar'){
    const close=actions?.querySelector('[aria-label="Kalender schließen"]');
    if(close&&!close.hasAttribute('data-module-close')){close.innerHTML=svgMarkup('<path d="m6 6 12 12M6 18 18 6"/>');close.dataset.moduleClose=''}
   }
  }
  // The explorer and older main modules share the modal title. Exact navigation labels
  // deliberately exclude contact names, edit forms and other subordinate headings.
  const title=document.getElementById('modalTitle'),label=title?.textContent.trim();
  const known=Object.entries(modules).find(([,m])=>m.labels.includes(label));
  const main=known||navigationIcon([label]);
  if(main&&title){decorate(title,known?.[0]||label);title.classList.add('module-standalone-title')}
  else if(title){title.classList.remove('module-title','module-standalone-title');delete title.dataset.moduleHeading}
  if(!title?.getClientRects().length||!label){
   const heading=modal.querySelector('#modalBody h1,#modalBody h2'),text=heading?.textContent.trim();
   const spec=Object.entries(modules).find(([,m])=>m.labels.includes(text));
   if(spec||navigationIcon([text]))decorate(heading,spec?.[0]||text);
  }
  let close=modal.querySelector('.module-standalone-close');
  if(main&&title?.getClientRects().length){
   if(!close){closeButton(title.parentElement,label);close=title.parentElement.querySelector(':scope > [data-module-close]');close?.classList.add('module-standalone-close')}
   if(close){close.setAttribute('aria-label',label+' schließen');close.title=label+' schließen'}
  }else close?.remove();
  for(const title of modal.querySelectorAll('.mobile-ui-heading h2')){
   const label=title.textContent.trim(),known=Object.entries(modules).find(([,m])=>m.labels.includes(label));
   if(known||navigationIcon([label]))decorate(title,known?.[0]||label);
  }
 }
 function install(){
  const modal=document.getElementById('modal');if(!modal)return;
  let pending=false;
  const observer=new MutationObserver(records=>{
   // Watch content because existing modules replace their headers during navigation.
   if(pending||!records.some(r=>r.type==='characterData'||r.addedNodes.length||r.removedNodes.length))return;
   pending=true;queueMicrotask(()=>{
    pending=false;observer.disconnect();
    try{apply()}finally{observe()}
   });
  });
  const observe=()=>{
   observer.observe(modal,{childList:true,subtree:true,characterData:true});
   for(const [selector] of otherRoots){const root=document.querySelector(selector);if(root)observer.observe(root,{childList:true,subtree:true,characterData:true})}
  };
  // Some main workspaces are independent overlays, mounted directly on the body.
  new MutationObserver(records=>{
   if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&otherRoots.some(([s])=>n.matches(s))))){apply();observe()}
  }).observe(document.body,{childList:true});
  apply();observe();
 }
 window.__moduleHeaders=Object.freeze({apply});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
