'use strict';
const assert=require('node:assert/strict');
const history=(caseId,contactId)=>Array.from({length:14},(_,i)=>({id:'send-'+i,status:'sent',channel:'post',channels:['post'],documentTitle:'Mitteilung',subject:(caseId==='a'?'Mara':'Jonas')+' – Versand '+i,note:'Einzelvorgang '+caseId+'-'+i,recipient:'Amtsgericht Musterstadt',createdAt:'2026-09-'+String(i+1).padStart(2,'0')+'T09:00:00Z',sentAt:'2026-09-'+String(i+1).padStart(2,'0')+'T09:00:00Z',contactLink:{scope:'case',caseId,contactId}}));
module.exports=async({page,mobile,db,errors})=>{
 const check=async(label,fn)=>{await fn();console.log('PASS '+(mobile?'Mobil':'Desktop')+' '+label)};
 const menu=page.locator('.am-views'),select=page.locator('#amSavedViews'),query=page.locator('#phase5AddressSearchV154');
 const openMenu=async()=>{if(!await menu.getAttribute('open').then(x=>x!==null))await menu.locator('summary').click()};
 const closeMenu=async()=>{if(await menu.getAttribute('open').then(x=>x!==null))await menu.locator('summary').click()};
 const saved=()=>JSON.parse(db.prepare('SELECT filters_json FROM addressbook_views WHERE id=?').get(viewId).filters_json);
 const update=()=>menu.getByRole('button',{name:'Ansicht aktualisieren',exact:true});let viewId,otherId;
 await check('Ohne Auswahl ist Aktualisieren gesperrt; neue Ansichten bleiben getrennt',async()=>{
  await openMenu();assert.equal(await update().isDisabled(),true);await closeMenu();
  await query.fill('Sommer');await openMenu();page.once('dialog',d=>d.accept((mobile?'Mobil':'Desktop')+' Praxen'));await menu.getByRole('button',{name:'Aktuelle Filter speichern',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#amSavedViews').value);viewId=await select.inputValue();await closeMenu();
  await query.fill('Amtsgericht');await openMenu();page.once('dialog',d=>d.accept((mobile?'Mobil':'Desktop')+' Gerichte'));await menu.getByRole('button',{name:'Aktuelle Filter speichern',exact:true}).click();await page.waitForFunction(id=>document.querySelector('#amSavedViews').value!==id,viewId);otherId=await select.inputValue();await select.selectOption(viewId);assert.equal(await query.inputValue(),'Sommer');
 });
 let expected;
 await check('Aktualisieren behält ID und Namen und übernimmt Suche, Sortierung und Zusatzfilter',async()=>{
  await query.fill('Praxis');
  await page.evaluate(()=>{for(const id of ['phase5AddressDirectionV154','phase5AddressNameOrderV154']){const el=document.getElementById(id);el.selectedIndex=1;el.dispatchEvent(new Event('change',{bubbles:true}))}document.getElementById('amMissingEmail').checked=true;document.getElementById('amMissingEmail').dispatchEvent(new Event('change',{bubbles:true}))});
  const previous=db.prepare('SELECT * FROM addressbook_views WHERE id=?').get(viewId);await openMenu();await update().click();await page.waitForFunction(()=>document.querySelector('.am-save').textContent==='Ansicht aktualisiert');
  const next=db.prepare('SELECT * FROM addressbook_views WHERE id=?').get(viewId);assert.equal(next.label,previous.label);assert.equal(next.version,previous.version+1);expected=saved();assert.equal(expected.query,'Praxis');assert.equal(expected.missingEmail,'yes');assert.notEqual(expected.direction,JSON.parse(previous.filters_json).direction);assert.equal(JSON.parse(db.prepare('SELECT filters_json FROM addressbook_views WHERE id=?').get(otherId).filters_json).query,'Amtsgericht');assert.equal(await select.inputValue(),viewId);
  await page.screenshot({path:'/tmp/addressbook-views-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop')+'.png'});
  const bounds=await menu.locator('.am-menu-body').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=await page.evaluate(()=>innerWidth)+1);assert.ok(bounds.y+bounds.height<=await page.evaluate(()=>innerHeight)+1);
 });
 await check('Neu geöffnetes Adressbuch lädt die aktualisierten Filter vom Server',async()=>{
  await page.evaluate(()=>window.showImportedAddressbook());await openMenu();await select.selectOption(viewId);assert.equal(await query.inputValue(),expected.query);assert.equal(await page.locator('#amMissingEmail').isChecked(),true);
  for(const [key,id] of [['direction','phase5AddressDirectionV154'],['nameOrder','phase5AddressNameOrderV154']])assert.equal(await page.locator('#'+id).inputValue(),expected[key]);
 });
 await check('Parallele Änderungen werden geschützt; Neuladen behält die eigenen Filter',async()=>{
  await query.fill('Meine Filter');const V=require('../src/modules/contacts/addressbook-views'),v=V.list({userId:1}).views.find(v=>v.id===viewId);V.save({...v,filters:{...v.filters,query:'Anderes Fenster'}},{userId:1});
  await openMenu();await update().click();await menu.getByRole('button',{name:'Ansichten neu laden',exact:true}).waitFor();assert.equal(saved().query,'Anderes Fenster');assert.equal(await query.inputValue(),'Meine Filter');
  await menu.getByRole('button',{name:'Ansichten neu laden',exact:true}).click();assert.equal(await query.inputValue(),'Meine Filter');await update().click();await page.waitForFunction(()=>document.querySelector('.am-save').textContent==='Ansicht aktualisiert');assert.equal(saved().query,'Meine Filter');
 });
 await check('Umbenennen und Löschen funktionieren nach dem Aktualisieren weiterhin',async()=>{
  page.once('dialog',d=>d.accept((mobile?'Mobil':'Desktop')+' Neu'));await menu.getByRole('button',{name:'Ansicht umbenennen',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.am-save').textContent==='Ansicht gespeichert');assert.equal(saved().query,'Meine Filter');
  page.once('dialog',d=>d.accept());await menu.getByRole('button',{name:'Ansicht löschen',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#amSavedViews').value==='');assert.equal(db.prepare('SELECT id FROM addressbook_views WHERE id=?').get(viewId),undefined);assert.equal(await update().isDisabled(),true);
 });
 await check('Lokale Ansichten lassen sich ebenfalls unter derselben ID aktualisieren',async()=>{
  await page.evaluate(()=>{window.__appMode='local';state.ui.addressbookViews=[{id:'local-view',label:'Lokale Praxis',filters:{query:'Sommer',status:'active'},version:1}];window.showImportedAddressbook()});await openMenu();await select.selectOption('local-view');await query.fill('Lokale Änderung');await openMenu();await update().click();await page.waitForFunction(()=>state.ui.addressbookViews[0].version===2);const v=await page.evaluate(()=>state.ui.addressbookViews[0]);assert.equal(v.id,'local-view');assert.equal(v.label,'Lokale Praxis');assert.equal(v.filters.query,'Lokale Änderung');
 });
 const showBook=async()=>{
  await page.evaluate(async()=>{window.__appMode='online';window.__abScope='case';window.__abBueroWide=false;window.__activeServerCaseId='a';window.caseIdentityOf=()=>window.__activeServerCaseId;state.caseData.contacts=(await(await fetch('/api/cases/a/contacts')).json()).contacts.map(x=>({...x.data,id:x.id}));const data=await(await fetch('/api/cases/a/stammdaten')).json();state.ui.exportHistory=data.data.exportHistory;window.showImportedAddressbook()});
  await query.fill('');await page.evaluate(()=>{document.getElementById('amMissingEmail').checked=false;document.getElementById('phase5AddressStatusV154').value='all';window.phase5RenderAddressbookV154()});await page.locator('.am-row-open').filter({hasText:'Amtsgericht Musterstadt'}).click();await page.getByRole('button',{name:'Kommunikation',exact:true}).click();await page.locator('.am-section').filter({hasText:'Einzelvorgang a-13'}).waitFor();
 };
 const entry=(caseId,i)=>page.locator('.am-section').filter({has:page.getByText('Einzelvorgang '+caseId+'-'+i,{exact:true})});
 const assertTarget=async(caseId,i)=>{
  const card=page.locator('#phase4HistoryList [data-phase4-history-id="send-'+i+'"]');await card.waitFor({state:'visible'});await page.waitForTimeout(350);
  assert.equal(await card.locator('.phase4-history-details-v195').isVisible(),true);assert.equal(await card.locator('.phase4-history-head').getAttribute('aria-expanded'),'true');assert.match(await card.innerText(),new RegExp('Einzelvorgang '+caseId+'-'+i));assert.equal(await page.evaluate(()=>window.__activeServerCaseId),caseId);
  if(mobile){assert.equal(await page.locator('#phase4HistoryList .mc-native-selected').count(),1);assert.equal(await card.evaluate(el=>el.classList.contains('mc-native-selected')),true)}
  if(!mobile){const list=await page.locator('#phase4HistoryList').boundingBox(),rect=await card.boundingBox();if(rect.height<list.height)assert.ok(rect.y+rect.height<=list.y+list.height+1,'Der ganze Eintrag muss nach dem Modalwechsel sichtbar sein')}
  const rect=await card.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=await page.evaluate(()=>innerWidth)+1);const head=await card.locator('.phase4-history-head').boundingBox();assert.ok(head.y>=0&&head.y<await page.evaluate(()=>innerHeight));
 };
 await showBook();
 await check('Gleichnamige Schreiben öffnen per Quell-ID exakt den gewählten Versand',async()=>{
  await entry('a',13).getByRole('button',{name:'Versandeintrag öffnen',exact:true}).click();await assertTarget('a',13);
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:'/tmp/addressbook-history-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop')+'-'+theme+'.png'})}
 });
 if(!mobile)await check('Eigenes Scrollen beendet die automatische Nachführung des Sprungziels',async()=>{
  const list=page.locator('#phase4HistoryList'),start=await list.evaluate(el=>el.scrollTop);await list.hover();await page.mouse.wheel(0,-240);await page.waitForTimeout(200);const own=await list.evaluate(el=>el.scrollTop);assert.ok(own<start-100);
  await list.evaluate(el=>el.style.maxHeight=(el.clientHeight-30)+'px');await page.waitForTimeout(150);assert.ok(Math.abs(await list.evaluate(el=>el.scrollTop)-own)<5,'Eigener Scrollausschnitt muss bei späterem Größenwechsel erhalten bleiben');await list.evaluate(el=>el.style.maxHeight='');
 });
 await check('Ein bestehender Historienfilter versteckt das direkte Sprungziel nicht',async()=>{
  await page.evaluate(()=>{document.getElementById('phase4FilterSearch').value='Kein Treffer';window.phase4RefreshHistory();window.phase4OpenHistoryEntry('send-2')});await assertTarget('a',2);assert.equal(await page.locator('#phase4FilterSearch').inputValue(),'');
 });
 await showBook();
 await check('Gelöschtes Sprungziel meldet sich verständlich und öffnet keinen anderen Eintrag',async()=>{
  await page.evaluate(()=>state.ui.exportHistory=state.ui.exportHistory.filter(e=>e.id!=='send-13'));
  await entry('a',13).getByRole('button',{name:'Versandeintrag öffnen',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent.includes('nicht mehr vorhanden'));assert.equal(await page.locator('#phase4HistoryList').count(),0);
 });
 await check('Ein Schreiben aus einem zugeordneten anderen Fall öffnet dessen konkreten Eintrag',async()=>{
  // Der echte Falllader holt den fremden Fall samt Versandhistorie über HTTP.
  await page.evaluate(()=>window.__onlineCaseCache.delete('b'));
  await entry('b',13).getByRole('button',{name:'Versandeintrag öffnen',exact:true}).click();await assertTarget('b',13);
 });
 if(mobile)await check('Kleines Mobilfenster behält Eintrag und Aktionen im sichtbaren Bereich',async()=>{await page.setViewportSize({width:320,height:640});await page.waitForTimeout(200);await assertTarget('b',13);assert.equal(await page.locator('.mc-native-selected').evaluate(el=>el.scrollWidth>el.clientWidth+1),false)});
 assert.deepEqual(errors,[]);
};
module.exports.setup=db=>{
 const A=require('../src/modules/contacts/addressbook');const bundle=A.assign({scope:'case',caseId:'a',id:'court',targetCaseId:'b'}, {userId:1,isAdmin:true});const linked=bundle.associations.find(x=>x.caseId==='b').contactId;
 for(const [id,contactId] of [['a','court'],['b',linked]])db.prepare('UPDATE cases SET stammdaten_json=? WHERE id=?').run(JSON.stringify({person:{firstName:id==='a'?'Mara':'Jonas',lastName:id==='a'?'Muster':'Beispiel'},exportHistory:history(id,contactId)}),id);
};
