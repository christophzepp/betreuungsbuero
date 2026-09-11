'use strict';
const assert=require('node:assert/strict');
module.exports=async function({page,mobile,db,errors}){
 const prefix='/tmp/addressbook-extended-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop'),A=require('../src/modules/contacts/addressbook'),admin={userId:1,isAdmin:true,displayName:'Zweite Bearbeiterin'};
 const read=()=>JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json);
 const check=async(name,fn)=>{await fn();console.log('PASS',mobile?'Mobil':'Desktop',name)};
 const select=async text=>{if(mobile)await page.evaluate(()=>document.querySelector('#addressbookModern').classList.remove('am-show-detail'));await page.locator('.am-row-open').filter({hasText:text}).click();await page.locator('.am-tabs').waitFor()};
 const saved=()=>page.waitForFunction(()=>document.querySelector('.am-save')?.textContent==='Gespeichert');
 await check('Suche findet Namen und Abteilungen innerhalb einer Institution',async()=>{
  const p=read().people.find(p=>p.id==='sach');for(const search of [p.name,p.department,p.email,p.phone]){await page.locator('#phase5AddressSearchV154').fill(search);assert.equal(await page.locator('.am-row').count(),1);assert.match(await page.locator('.am-row').innerText(),/Amtsgericht/)}await page.locator('#phase5AddressSearchV154').fill('');
 });
 await select('Amtsgericht');await page.getByRole('button',{name:'Ansprechpartner',exact:true}).click();
 await check('Ansprechpartner speichert automatisch und genau einmal, auch bei weiterem Tippen während des Speicherns',async()=>{
  await page.getByRole('button',{name:'+ Ansprechpartner',exact:true}).click();let hold;await page.route('**/api/addressbook/person',async route=>{await new Promise(r=>{hold=r});await route.continue()},{times:1});
  await page.locator('.am-small-form [name=name]').fill('Automatisch '+(mobile?'Mobil':'Desktop'));await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent==='Wird gespeichert …');
  await page.locator('.am-small-form [name=department]').fill('Nachgereichte Abteilung');while(!hold)await new Promise(r=>setTimeout(r,20));hold();await saved();
  const own=read().people.filter(p=>p.name==='Automatisch '+(mobile?'Mobil':'Desktop'));assert.equal(own.length,1);assert.equal(own[0].department,'Nachgereichte Abteilung');
  await page.getByRole('button',{name:'Fertig',exact:true}).click();
 });
 await check('Speicherfehler bewahrt Personenentwurf und verhindert Schließen; erneuter Versuch speichert',async()=>{
  await page.locator('.am-section').filter({has:page.getByRole('heading',{name:'Lea Schneider',exact:true})}).getByRole('button',{name:'Bearbeiten',exact:true}).click();
  await page.route('**/api/addressbook/person',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test-Unterbrechung'})}));
  await page.locator('.am-small-form [name=phone]').fill('0123/Neu');await page.getByRole('button',{name:'Speichern erneut versuchen',exact:true}).waitFor();
  await page.evaluate(()=>window.closeModal());assert.ok(await page.locator('.am-small-form').isVisible());assert.equal(await page.locator('.am-small-form [name=phone]').inputValue(),'0123/Neu');
  await page.unroute('**/api/addressbook/person');await page.getByRole('button',{name:'Speichern erneut versuchen',exact:true}).click();await saved();assert.equal(read().people.find(p=>p.id==='sach').phone,'0123/Neu');
  await page.getByRole('button',{name:'Fertig',exact:true}).click();
 });
 await check('Personenkonflikt zeigt offene Eingaben und erhält andere Felder der parallelen Änderung',async()=>{
  await page.locator('.am-section').filter({has:page.getByRole('heading',{name:'Lea Schneider',exact:true})}).getByRole('button',{name:'Bearbeiten',exact:true}).click();
  const old=read().people.find(p=>p.id==='sach');A.savePerson({scope:'case',caseId:'a',id:'court',personId:'sach',baseVersion:A.personVersion(old),patch:{...old,department:'Parallel '+(mobile?'Mobil':'Desktop')}},admin);
  await page.locator('.am-small-form [name=phone]').fill('Eigene '+(mobile?'Mobil':'Desktop'));await page.getByRole('button',{name:'Aktuellen Stand prüfen',exact:true}).waitFor();
  assert.match(await page.locator('.am-small-form [name=phone]').inputValue(),/^Eigene/);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Aktuellen Stand prüfen',exact:true}).click();await saved();
  const result=read().people.find(p=>p.id==='sach');assert.equal(result.department,'Parallel '+(mobile?'Mobil':'Desktop'));assert.equal(result.phone,'Eigene '+(mobile?'Mobil':'Desktop'));
  await page.screenshot({path:prefix+'-person.png'});assert.equal(await page.locator('.am-detail').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);await page.getByRole('button',{name:'Fertig',exact:true}).click();
 });
 if(!mobile)await check('Fallzuordnung speichert ohne Übernehmen und aktualisiert dieselbe Zuordnung',async()=>{
  await page.getByRole('button',{name:'Fälle & Standard',exact:true}).click();await page.getByRole('button',{name:'+ Weiterem Fall zuordnen',exact:true}).click();await page.locator('[name=targetCaseId]').selectOption('b');await saved();
  const rows=db.prepare("SELECT c.* FROM case_contacts c JOIN addressbook_links l ON l.case_contact_id=c.id WHERE case_id='b'").all();assert.equal(rows.length,1);const id=rows[0].id;
  await page.locator('[name=fileNumber]').fill('B-Autosave');await page.locator('[name=processNumber]').fill('Vorgang-Autosave');await saved();
  const next=db.prepare('SELECT data_json FROM case_contacts WHERE id=?').get(id);assert.equal(JSON.parse(next.data_json).fileNumber,'B-Autosave');assert.equal(JSON.parse(next.data_json).processNumber,'Vorgang-Autosave');
  await page.getByRole('button',{name:'Kontaktdaten',exact:true}).click();assert.equal(await page.locator('.am-small-form').count(),0);
 });
 await check('Ältere Änderungen und Kommunikation sind über Nachladen erreichbar',async()=>{
  const tag=mobile?'m':'d';db.transaction(()=>{for(let i=0;i<205;i++)db.prepare('INSERT INTO addressbook_history VALUES(?,?,?,?,?,?,?)').run('qa-h-'+tag+i,'case','a','court','2025-09-12T00:00:00','Historie '+tag,JSON.stringify({note:{before:'',after:'Historie '+i}}));for(let i=0;i<405;i++)db.prepare('INSERT INTO case_doku_entries(id,case_id,data_json) VALUES(?,?,?)').run('qa-d-'+tag+i,'a',JSON.stringify({date:'2025-09-12',detail:'Kommunikation '+i,contactLink:{contactId:'court',caseId:'a',scope:'case'}}))})();
  await select('Amtsgericht');await page.getByRole('button',{name:'Änderungen',exact:true}).click();
  const more=page.getByRole('button',{name:'Weitere Änderungen laden',exact:true});await more.waitFor();let clicks=0;while(await more.count()){const before=await page.locator('.am-tab-body .am-section').count();await more.click();await page.waitForFunction(n=>document.querySelectorAll('.am-tab-body .am-section').length>n,before);assert.ok(++clicks<12)}
  assert.equal(await page.locator('.am-tab-body .am-section').count(),db.prepare("SELECT count(*) n FROM addressbook_history WHERE scope='case' AND case_id='a' AND contact_id='court'").get().n);
  await page.getByRole('button',{name:'Kommunikation',exact:true}).click();const moreD=page.getByRole('button',{name:'Weitere Kommunikation laden',exact:true});await moreD.waitFor();clicks=0;while(await moreD.count()){const before=await page.locator('.am-tab-body .am-section').count();await moreD.click();await page.waitForFunction(n=>document.querySelectorAll('.am-tab-body .am-section').length>n,before);assert.ok(++clicks<12)}
  assert.equal(await page.getByRole('button',{name:'In Falldokumentation öffnen',exact:true}).count(),mobile?810:405);
 });
 await check('Verlorene Merge- und Undo-Antworten können ohne doppelte Änderungen wiederholt werden',async()=>{
  const suffix=mobile?'mobile':'desktop',ids=['qa-merge-a-'+suffix,'qa-merge-b-'+suffix];
  for(const id of ids)db.prepare('INSERT INTO case_contacts(id,case_id,data_json) VALUES(?,?,?)').run(id,'a',JSON.stringify({institution:'QA Merge '+suffix,email:'merge@example.org'}));
  await page.evaluate(async ids=>{const j=await(await fetch('/api/cases/a/contacts')).json();state.caseData.contacts=j.contacts.map(c=>({...c.data,id:c.id}));window.__qaMergeGroup=state.caseData.contacts.filter(c=>ids.includes(c.id))},ids);
  const fail=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Simulierter Antwortverlust'})});
  await page.route('**/api/addressbook/merge',fail,{times:1});
  const attempt=()=>page.evaluate(async()=>{try{await window.__abModernMerge([window.__qaMergeGroup],'a');return ''}catch(e){return e.message}});
  assert.match(await attempt(),/Antwortverlust/);assert.equal(db.prepare('SELECT count(*) n FROM case_contacts WHERE id IN (?,?)').get(...ids).n,2);
  await page.route('**/api/addressbook/merge',async route=>{await route.fetch();await fail(route)},{times:1});assert.match(await attempt(),/Antwortverlust/);
  assert.equal(db.prepare('SELECT count(*) n FROM case_contacts WHERE id IN (?,?)').get(...ids).n,1);assert.equal(await page.evaluate(ids=>state.caseData.contacts.filter(c=>ids.includes(c.id)).length,ids),2);
  assert.equal(await attempt(),'');assert.equal(await page.evaluate(ids=>state.caseData.contacts.filter(c=>ids.includes(c.id)).length,ids),1);
  await page.evaluate(ids=>{window.__qaMergeRecord=state.caseData.contactMerges.find(m=>ids.includes(m.survivorId))},ids);
  await page.route('**/api/addressbook/unmerge',async route=>{await route.fetch();await fail(route)},{times:1});
  assert.match(await page.evaluate(async()=>{try{await window.__abModernUnmerge(window.__qaMergeRecord,'a');return ''}catch(e){return e.message}}),/Antwortverlust/);
  await page.evaluate(async()=>{await window.__abModernUnmerge(window.__qaMergeRecord,'a');delete window.__qaMergeRecord;delete window.__qaMergeGroup});
  assert.equal(db.prepare('SELECT count(*) n FROM case_contacts WHERE id IN (?,?)').get(...ids).n,2);
 });
 await check('5.000 Kontakte bleiben durchsuchbar und verursachen keinen horizontalen Überlauf',async()=>{
  const timing=await page.evaluate(()=>{window.__qaLargeOriginal=state.caseData.contacts;const t=performance.now();state.caseData.contacts=[...state.caseData.contacts,...Array.from({length:5000},(_,i)=>({id:'large-'+i,institution:'Institution '+String(i).padStart(4,'0'),status:'Aktiv',people:[{id:'person-'+i,name:'Ansprechpartner '+i,department:'Abteilung '+i}]})),{id:'large-z',institution:'Ziel am Ende',status:'Aktiv'}];document.querySelector('#addressbookModern').classList.remove('am-show-detail');window.phase5RenderAddressbookV154();return performance.now()-t});
  assert.equal(await page.locator('.am-row').count(),200);await page.locator('.am-pages').getByRole('button',{name:'Weiter',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.am-pages')?.textContent.includes('201–400'));await page.getByRole('button',{name:'Alle auswählen',exact:true}).click();assert.ok(await page.locator('#amSelectionCount').innerText().then(s=>Number.parseInt(s)>5000));await page.getByRole('button',{name:'Auswahl aufheben',exact:true}).click();
  await page.locator('#abLetterBar').getByRole('button',{name:'Z',exact:true}).click();await page.waitForFunction(()=>{const z=[...document.querySelectorAll('.am-row')].find(e=>e.textContent.includes('Ziel am Ende'))?.getBoundingClientRect(),p=document.querySelector('.am-list-pane').getBoundingClientRect();return z&&z.top>=p.top&&z.bottom<=p.bottom});assert.match(await page.locator('.am-pages').innerText(),/5001/);await page.screenshot({path:prefix+'-pages.png'});
  const start=Date.now();await page.locator('#phase5AddressSearchV154').fill('Ansprechpartner 4999');await page.locator('.am-row').filter({hasText:'Institution 4999'}).waitFor();assert.equal(await page.locator('.am-row').count(),1);assert.equal(await page.locator('#addressbookModern').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
  console.log('PERF',mobile?'Mobil':'Desktop','5000 Kontakte Render',Math.round(timing)+'ms','Suche',Date.now()-start+'ms');await page.screenshot({path:prefix+'-search.png'});
  await page.evaluate(()=>{state.caseData.contacts=window.__qaLargeOriginal;delete window.__qaLargeOriginal;window.phase5RenderAddressbookV154()});await page.locator('#phase5AddressSearchV154').fill('');
 });
 assert.deepEqual(errors,[]);
};
