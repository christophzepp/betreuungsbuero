'use strict';
const assert=require('node:assert/strict');
module.exports=async function({page,mobile,db,errors}){
 const prefix='/tmp/addressbook-fixes-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop');
 const failures=[];
 const check=async(name,fn)=>{try{await fn();console.log('PASS',mobile?'Mobil':'Desktop',name)}catch(e){failures.push(name+': '+e.message);console.log('FAIL',mobile?'Mobil':'Desktop',name,e.message)}};
 const select=async text=>{if(mobile)await page.evaluate(()=>document.querySelector('#addressbookModern').classList.remove('am-show-detail'));await page.locator('.am-row-open').filter({hasText:text}).click();await page.waitForTimeout(180)};
 const visibleInside=async(selector)=>page.locator(selector).evaluate(e=>{const b=e.getBoundingClientRect(),r=document.querySelector('#addressbookModern').getBoundingClientRect();return {inside:b.left>=r.left-1&&b.right<=r.right+1&&b.top>=r.top-1&&b.bottom<=r.bottom+1,bottom:b.bottom,limit:r.bottom,left:b.left,right:b.right}});
 await page.setViewportSize(mobile?{width:390,height:700}:{width:1100,height:650});
 await page.locator('.am-filters summary').click();await page.screenshot({path:prefix+'-filters.png'});
 await check('Filtermenü liegt vollständig im sichtbaren Bereich',async()=>{const b=await visibleInside('.am-filters .addressbook-toolbar-v154');assert.ok(b.inside,JSON.stringify(b))});
 await page.locator('.am-filters summary').click();
 await select('Amtsgericht');await page.locator('#amPerson').selectOption('sach');
 await check('Ansprechpartner bleibt beim Aktualisieren und bei Mehrfachauswahl gewählt',async()=>{await page.evaluate(()=>window.phase5RenderAddressbookV154());assert.equal(await page.locator('#amPerson').inputValue(),'sach')});
 await check('Standard kann von der Institution auf einen Ansprechpartner wechseln',async()=>{
  await page.getByRole('button',{name:'Fälle & Standard',exact:true}).click();await page.getByRole('heading',{name:'Mara Muster',exact:true}).waitFor();
  await page.locator('#amPerson').selectOption('');const section=page.locator('.am-section').filter({has:page.getByRole('heading',{name:'Mara Muster',exact:true})});
  if(await section.getByRole('button',{name:'Als Standard für Dokumente',exact:true}).count())await section.getByRole('button',{name:'Als Standard für Dokumente',exact:true}).click();
  await page.waitForFunction(()=>window.__abDefaultRecipient('document')?.contact.id==='court'&&!window.__abDefaultRecipient('document')?.person);
  await page.locator('#amPerson').selectOption('sach');await section.getByRole('button',{name:'Als Standard für Dokumente',exact:true}).click();await page.waitForFunction(()=>window.__abDefaultRecipient('document')?.person?.id==='sach');
 });
 await check('Ungültige Ansprechpartner bleiben bei Listenaktualisierung und beim Wechsel erhalten',async()=>{
  await page.getByRole('button',{name:'Ansprechpartner',exact:true}).click();await page.getByRole('button',{name:'+ Ansprechpartner',exact:true}).click();await page.locator('.am-small-form [name=name]').fill('Entwurf erhalten');await page.locator('.am-small-form [name=email]').fill('ungueltig');
  await page.evaluate(()=>window.phase5RenderAddressbookV154());assert.equal(await page.locator('.am-small-form [name=name]').inputValue(),'Entwurf erhalten');
  await page.getByRole('button',{name:'Kontaktdaten',exact:true}).click();assert.equal(await page.locator('.am-small-form [name=name]').inputValue(),'Entwurf erhalten');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Ungespeicherte Eingaben verwerfen',exact:true}).click();await page.locator('.am-small-form').waitFor({state:'detached'});
 });
 await page.getByRole('button',{name:'Kontaktdaten',exact:true}).click();
 await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('#amEdit_institution').waitFor();await page.screenshot({path:prefix+'-edit.png'});
 await check('Fertig ist ohne Scrollen durch das gesamte Formular erreichbar',async()=>{const b=await visibleInside('.am-edit-footer');assert.ok(b.inside,JSON.stringify(b))});
 await page.getByRole('button',{name:'Fertig',exact:true}).click();
 await check('Eine verspätete Kontaktantwort überschreibt kein neues Formular',async()=>{
  await page.locator('.am-tabs').waitFor();
  await page.evaluate(()=>{window.__qaFetch=window.fetch;let once=true;window.fetch=(...args)=>{if(once&&String(args[0]).startsWith('/api/addressbook/contact?')){once=false;return new Promise((resolve,reject)=>{window.__qaRelease=()=>window.__qaFetch(...args).then(resolve,reject)})}return window.__qaFetch(...args)};window.__qaOpening=window.__abModern.edit(window.__abModern.selected())});
  try{await page.waitForFunction(()=>!!window.__qaRelease);await page.getByRole('button',{name:'+ Neuer Kontakt',exact:true}).click();await page.getByRole('heading',{name:'Neuer Kontakt',exact:true}).waitFor();await page.evaluate(()=>window.__qaRelease());await page.evaluate(()=>window.__qaOpening)}finally{await page.evaluate(()=>{window.fetch=window.__qaFetch;delete window.__qaFetch;delete window.__qaRelease})}
  assert.equal(await page.locator('#amEdit_institution').inputValue(),'');assert.ok(await page.getByRole('heading',{name:'Neuer Kontakt',exact:true}).isVisible());await page.getByRole('button',{name:'Fertig',exact:true}).click();
 });
 if(mobile)await page.getByRole('button',{name:'← Kontakte',exact:true}).click();
 await page.getByRole('button',{name:'Beendete',exact:true}).click();await select('Frühere Praxis');
 await page.locator('.am-more summary').click();await page.getByRole('button',{name:'Aktivieren',exact:true}).click();await page.locator('.am-row').waitFor({state:'detached'});
 await check('Leere Liste zeigt richtigen Status und bietet Filterzugang',async()=>{assert.equal(await page.locator('[data-status=ended]').getAttribute('aria-pressed'),'true');assert.ok(await page.locator('#phase5AddressSearchV154').isVisible());assert.equal(await page.locator('.am-selection button').last().isEnabled(),false)});
 await page.evaluate(()=>{document.querySelector('#addressbookModern').classList.remove('am-show-detail');document.getElementById('phase5AddressStatusV154').value='active';window.phase5RenderAddressbookV154()});
 await select('Amtsgericht');await page.locator('#amPerson').selectOption('sach');await page.getByRole('button',{name:'Dokumentation anlegen',exact:true}).click();await page.locator('#dokuLinkedContact').waitFor();
 await page.evaluate(()=>window.showImportedAddressbook());await page.waitForTimeout(250);await page.screenshot({path:prefix+'-return.png'});
 await check('Rückkehr aus der Dokumentation lässt die Adressbuchhöhe unverändert',async()=>{const b=await page.locator('#modal .modal-box').boundingBox();assert.ok(b.y+b.height<=page.viewportSize().height-(mobile?60:0)+1,JSON.stringify(b))});
 await check('A–Z springt auch bei einem niedrigen Fenster zum richtigen Kontakt',async()=>{
  await page.evaluate(()=>{window.__qaContacts=state.caseData.contacts;state.caseData.contacts=[...state.caseData.contacts,...Array.from({length:25},(_,i)=>({id:'qa-letter-'+i,lastName:'Testperson '+i,institution:'Testperson '+i,status:'Aktiv'})),{id:'qa-z',lastName:'Zebra',institution:'Zebra',status:'Aktiv'}];window.phase5RenderAddressbookV154()});
  await page.locator('#abLetterBar').getByRole('button',{name:'Z',exact:true}).click();await page.waitForFunction(()=>{const row=document.querySelector('[data-ab-letter=Z]')?.getBoundingClientRect(),pane=document.querySelector('.am-list-pane').getBoundingClientRect();return row&&row.top>=pane.top-1&&row.bottom<=pane.bottom+1},{},{timeout:3000});
  const box=await page.locator('.am-row').filter({hasText:'Zebra'}).boundingBox(),pane=await page.locator('.am-list-pane').boundingBox();const geometry=await page.locator('.am-list-pane').evaluate(e=>[...e.children].map(c=>({tag:c.id||c.className,rect:c.getBoundingClientRect().toJSON(),height:c.clientHeight,scrollHeight:c.scrollHeight,scrollTop:c.scrollTop,overflow:getComputedStyle(c).overflowY,flex:getComputedStyle(c).flex})));await page.screenshot({path:prefix+'-alphabet.png'});
  await page.evaluate(()=>{state.caseData.contacts=window.__qaContacts;delete window.__qaContacts;window.phase5RenderAddressbookV154()});
  assert.ok(box.y>=pane.y-1&&box.y+box.height<=pane.y+pane.height+1,JSON.stringify({box,pane,geometry}));
 });
 if(mobile)await check('Mobile Navigation bewahrt ungültige noch nicht gespeicherte Eingaben',async()=>{
  await select('Amtsgericht');await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('#amEdit_email').fill('ungueltig');
  await page.evaluate(()=>{window.__qaNavigated=false;window.dispatchEvent(new CustomEvent('mobileBeforeNavigate',{cancelable:true,detail:{proceed:()=>{window.__qaNavigated=true}}}))});
  assert.equal(await page.evaluate(()=>window.__qaNavigated),false);assert.equal(await page.locator('#amEdit_email').inputValue(),'ungueltig');
  await page.locator('#amEdit_email').fill('gericht@example.org');await page.getByRole('button',{name:'Fertig',exact:true}).click();await page.getByRole('button',{name:'← Kontakte',exact:true}).click();
 });
 await page.setViewportSize(mobile?{width:320,height:640}:{width:800,height:650});
 await page.locator('.am-filters summary').click();await check('Filter sind auch auf dem kleinsten Display vollständig erreichbar',async()=>assert.ok((await visibleInside('.am-filters .addressbook-toolbar-v154')).inside));await page.locator('.am-filters summary').click();
 await select('Amtsgericht');if(!mobile){await page.locator('.am-resizer').focus();await page.keyboard.press('End')}
 await check('Schmale Detailansicht bleibt innerhalb des Fensters',async()=>assert.equal(await page.locator('.am-detail').evaluate(e=>e.scrollWidth>e.clientWidth+1),false));
 for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:prefix+'-narrow-'+theme+'.png'})}
 await check('Keine Browserfehler',async()=>assert.deepEqual(errors,[]));
 if(failures.length)throw Error(failures.join('\n'));
};
