'use strict';
const assert=require('node:assert/strict');
module.exports=async({page,mobile,db,errors})=>{
 const suffix=(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop');
 const menu=page.locator('.am-filters'),toggle=menu.locator('summary'),board=page.locator('.am-board');
 const check=async(name,fn)=>{await fn();console.log('PASS '+suffix+' '+name)};
 const expand=async()=>{if(!await menu.evaluate(e=>e.open))await toggle.click()};
 const collapse=async()=>{if(await menu.evaluate(e=>e.open))await page.getByRole('button',{name:'Filter schließen',exact:true}).click()};
 await check('Standardansicht bleibt kompakt; zusätzliche Filter sind vollständig eingeklappt',async()=>{
  for(const viewport of mobile?[{width:390,height:844},{width:320,height:640}]:[{width:1440,height:1000},{width:1024,height:768},{width:768,height:640}]){
   await page.setViewportSize(viewport);await page.evaluate(()=>{state.ui.addressbookViewV154={};window.showImportedAddressbook()});
   assert.equal(await menu.evaluate(e=>e.open),false);
   for(const id of ['amQuickFilter','amTagFilter','amGroupFilter','phase5AddressRoleV154','phase5AddressSortV154'])assert.equal(await page.locator('#'+id).isVisible(),false,id);
   const layout=await page.evaluate(()=>{const root=document.querySelector('#addressbookModern').getBoundingClientRect(),board=document.querySelector('.am-board').getBoundingClientRect(),caseBox=document.querySelector('.ab-case-switcher select').getBoundingClientRect(),search=document.querySelector('#phase5AddressSearchV154').getBoundingClientRect(),filter=document.querySelector('.am-filters>summary').getBoundingClientRect();return {header:board.top-root.top,detailHeight:board.height,caseBottom:caseBox.bottom,searchBottom:search.bottom,filterBottom:filter.bottom}});
   console.log('LAYOUT',viewport,layout);await page.screenshot({path:'/tmp/addressbook-compact-'+suffix+'-'+viewport.width+'.png'});
   assert.ok(layout.header<=(mobile?240:175),JSON.stringify(layout));assert.ok(layout.detailHeight>=(mobile?320:350),JSON.stringify(layout));
   if(!mobile)assert.ok(Math.abs(layout.caseBottom-layout.searchBottom)<2,'Fall und Suche stehen nebeneinander');
   assert.ok(Math.abs(layout.searchBottom-layout.filterBottom)<2,'Filterknopf steht neben der Suche');
   assert.equal(await page.locator('#addressbookModern').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
  }
 });
 await check('Filter öffnen als begrenztes Menü und verkleinern die Kontaktfläche nicht',async()=>{
  const before=await board.boundingBox();await expand();
  for(const id of ['amQuickFilter','amTagFilter','amGroupFilter','phase5AddressStatusV154','phase5AddressCityV154','phase5AddressRoleV154','phase5AddressInstitutionV154','phase5AddressKindV154','phase5AddressSortV154','phase5AddressDirectionV154','phase5AddressNameOrderV154','amMissingEmail']){await page.locator('#'+id).scrollIntoViewIfNeeded();assert.equal(await page.locator('#'+id).isVisible(),true,id)}
  const after=await board.boundingBox(),popup=await menu.locator('.addressbook-toolbar-v154').boundingBox();assert.ok(after.height>=before.height-1,'Öffnen reduziert die Kontaktfläche nicht');assert.equal(after.y,before.y);assert.ok(popup.x>=0&&popup.y>=0);assert.ok(popup.x+popup.width<=await page.evaluate(()=>innerWidth)+1);assert.ok(popup.y+popup.height<=await page.evaluate(()=>innerHeight)+1);
  const organizer=await menu.locator('.am-organizer').boundingBox();assert.ok(organizer.width>=popup.width-50,'Zusatzfilter nutzen die gesamte Menübreite');
  assert.equal(await menu.locator('.addressbook-toolbar-v154').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,'Filtermenü ohne seitlichen Überlauf');
  await menu.locator('.addressbook-toolbar-v154').evaluate(e=>e.scrollTop=0);await page.screenshot({path:'/tmp/addressbook-compact-'+suffix+'-filters.png'});await collapse();assert.equal(await toggle.evaluate(e=>e===document.activeElement),true);
 });
 await check('Aktive Filter bleiben nach dem Schließen erkennbar und werden zuverlässig zurückgesetzt',async()=>{
  await expand();await page.locator('#phase5AddressRoleV154').selectOption('Betreuungsgericht');await page.locator('#phase5AddressCityV154').selectOption('Musterstadt');await collapse();
  assert.equal(await toggle.locator('.am-filter-count').innerText(),'2');assert.match(await toggle.getAttribute('title'),/Rolle: Betreuungsgericht/);assert.equal(await page.locator('.am-row').count(),1);
  await page.locator('#phase5AddressSearchV154').fill('Nicht vorhanden');await page.waitForFunction(()=>document.querySelectorAll('.am-row').length===0);assert.equal(await toggle.locator('.am-filter-count').innerText(),'2');
  await expand();await menu.getByRole('button',{name:'Filter zurücksetzen',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.am-row').length===2);assert.equal(await toggle.locator('.am-filter-count').isVisible(),false);await collapse();
 });
 await check('Gespeicherte Ansichten stellen auch eingeklappte Filter wieder her',async()=>{
  await expand();await page.locator('#phase5AddressRoleV154').selectOption('Hausärztin');await collapse();
  await page.locator('.am-views summary').click();page.once('dialog',d=>d.accept('Kompakt '+suffix));await page.getByRole('button',{name:'Aktuelle Filter speichern',exact:true}).click();await page.waitForFunction(()=>!!document.querySelector('#amSavedViews').value);const id=await page.locator('#amSavedViews').inputValue();await page.locator('.am-views summary').click();
  await expand();await menu.getByRole('button',{name:'Filter zurücksetzen',exact:true}).click();await collapse();await page.locator('.am-views summary').click();await page.locator('#amSavedViews').selectOption(id);await page.waitForFunction(()=>document.querySelectorAll('.am-row').length===1);
  assert.equal(await menu.evaluate(e=>e.open),false);assert.equal(await toggle.locator('.am-filter-count').innerText(),'1');assert.match(await page.locator('.am-row').innerText(),/Sommer/);
  assert.equal(JSON.parse(db.prepare('SELECT filters_json FROM addressbook_views WHERE id=?').get(id).filters_json).role,'Hausärztin');
 });
 await check('Kontaktdetails und Speicherstatus bleiben auf allen Größen sichtbar',async()=>{
  await page.locator('.am-row-open').click();await page.locator('.am-tabs').waitFor();
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:'/tmp/addressbook-compact-'+suffix+'-detail-'+theme+'.png'});assert.equal(await page.locator('.am-detail').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.ok(await page.locator('.am-save').isVisible());assert.ok(await page.locator('.ab-case-switcher').isVisible())}
  if(mobile){await page.getByRole('button',{name:'← Kontakte',exact:true}).click();assert.ok(await page.locator('#phase5AddressSearchV154').isVisible())}
 });
 assert.deepEqual(errors,[]);
};
