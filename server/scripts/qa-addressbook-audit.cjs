'use strict';
const assert=require('node:assert/strict');
module.exports=async({page,mobile,db,errors})=>{
 const check=async(label,fn)=>{await fn();console.log('PASS '+(mobile?'Mobil':'Desktop')+' '+label)};
 const choose=async text=>{if(mobile&&await page.getByRole('button',{name:'← Kontakte',exact:true}).isVisible())await page.getByRole('button',{name:'← Kontakte',exact:true}).click();await page.locator('.am-row-open').filter({hasText:text}).click();await page.locator('.am-tab-body .am-section').first().waitFor()};
 await check('Ungültiger Excel-Import verändert weder Kontakte noch Kategoriezuordnung',async()=>{
  const r=await page.evaluate(()=>{
   const original=state.caseData.contacts,snapshot=JSON.stringify(original),blocks=window.__addressbookBlocks;const header=['Status','Rolle','Institution','PLZ','Ort','Benannte Anschriften','Ansprechpartner'];
   const result=[];for(const extra of [['{bad',''],['[null]',''],['{"id":"wrong"}',''],['','[null]']]){let rejected=false;try{extractAddresses([header,['Aktiv','Gericht','Gültige erste Zeile','12345','Ort'],['Aktiv','Arzt','Fehlerhafte zweite Zeile','12345','Ort',...extra]])}catch(e){rejected=true}result.push({rejected,unchanged:state.caseData.contacts===original&&JSON.stringify(state.caseData.contacts)===snapshot&&window.__addressbookBlocks===blocks});state.caseData.contacts=original;window.__addressbookBlocks=blocks}return result;
  });assert.deepEqual(r,Array.from({length:4},()=>({rejected:true,unchanged:true})));
 });
 await choose('Amtsgericht');
 await check('Späte Mailantworten verändern den inzwischen ausgewählten Kontakt nicht',async()=>{
  let pending;await page.route('**/api/addressbook/communications/sync',r=>r.fulfill({json:{done:true,checked:1,errors:[],cursor:null}}));
  await page.route('**/api/addressbook/communications?*',r=>{if(new URL(r.request().url()).searchParams.get('id')==='court')pending=r;else r.continue()});
  await page.getByRole('button',{name:'Kommunikation',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#amMailSync')?.textContent.includes('aktuell'));assert.ok(pending);
  await choose('Praxis Dr. Sommer');await page.getByRole('button',{name:'Kommunikation',exact:true}).click();
  await pending.fulfill({json:{items:[{id:'late',kind:'doku',title:'Falscher alter Kontakt',date:'2026-09-12'}],nextCursor:null}});await page.waitForTimeout(300);
  assert.match(await page.locator('.am-detail h2').innerText(),/Praxis/);assert.ok(!(await page.locator('.am-tab-body').innerText()).includes('Falscher alter Kontakt'));
  await page.unroute('**/api/addressbook/communications?*');await page.unroute('**/api/addressbook/communications/sync');
 });
 await check('Anschriftenkonflikt erhält fremde Änderungen und weitere Anschriften',async()=>{
  const row=JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json);row.addresses=[{id:'post',label:'Postanschrift',street:'Alter Weg',city:'Altstadt'}];db.prepare("UPDATE case_contacts SET data_json=? WHERE id='court'").run(JSON.stringify(row));
  await choose('Amtsgericht');await page.getByRole('button',{name:'Anschriften',exact:true}).click();await page.getByRole('button',{name:'Anschrift bearbeiten',exact:true}).click();
  row.addresses[0].city='Parallelstadt';row.addresses.push({id:'visit',label:'Besuchsanschrift',street:'Besuchsweg'});db.prepare("UPDATE case_contacts SET data_json=? WHERE id='court'").run(JSON.stringify(row));
  await page.locator('[name=street]').fill('Mein Weg');await page.getByRole('button',{name:'Aktuellen Stand prüfen',exact:true}).waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Aktuellen Stand prüfen',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent==='Gespeichert');
  const saved=JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json);assert.equal(saved.addresses[0].street,'Mein Weg');assert.equal(saved.addresses[0].city,'Parallelstadt');assert.equal(saved.addresses.length,2);
  await page.locator('.am-small-form button[type=submit]').click();await page.locator('.am-small-form').waitFor({state:'detached'});
 });
 await check('Fallangaben lassen sich nach einer parallelen Änderung ohne Datenverlust speichern',async()=>{
  await page.getByRole('button',{name:'Fälle & Standard',exact:true}).click();await page.getByRole('button',{name:'Fallangaben bearbeiten',exact:true}).click();
  const row=JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json);row.fileNumber=mobile?'Parallel-M':'Parallel-D';db.prepare("UPDATE case_contacts SET data_json=? WHERE id='court'").run(JSON.stringify(row));
  await page.locator('[name=customerNumber]').fill(mobile?'Kunde-M':'Kunde-D');await page.getByRole('button',{name:'Aktuellen Stand prüfen',exact:true}).waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Aktuellen Stand prüfen',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent==='Gespeichert');
  const saved=JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json);assert.equal(saved.fileNumber,row.fileNumber);assert.equal(saved.customerNumber,mobile?'Kunde-M':'Kunde-D');
  await page.locator('.am-small-form button[type=submit]').click();await page.locator('.am-small-form').waitFor({state:'detached'});
 });
 await check('Zentrale Vertretung bleibt bei gleichlautender Fallkontakt-ID eindeutig',async()=>{
  const row=JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json);row.substituteContactId='office';db.prepare("UPDATE case_contacts SET data_json=? WHERE id='court'").run(JSON.stringify(row));
  await page.evaluate(()=>{state.caseData.contacts.push({id:'office',institution:'Anderer Fallkontakt',status:'Aktiv'});window.phase5RenderAddressbookV154()});await choose('Amtsgericht');await page.getByRole('button',{name:'Erreichbarkeit',exact:true}).click();await page.getByRole('button',{name:'Vertretung: Büro-Kontakt',exact:true}).click();await page.locator('.am-detail h2').filter({hasText:'Büro-Kontakt'}).waitFor();
 });
 await check('Verknüpfte Rückmeldung öffnet ihren Eintrag und den richtigen Bürokontakt',async()=>{
  const id=mobile?'audit-mobile':'audit-desktop';require('../src/modules/contacts/addressbook-followup').save({scope:'office',id:'office',targetCaseId:'a',followupId:id,patch:{name:'Rückruf Büro',dueAt:'2026-10-15',description:'Notiz'}},{userId:1,isAdmin:true});
  await page.evaluate(id=>{window.__caseOverview.workspaceData=async()=>({cases:[{id:'a',label:'Mara Muster'}],sources:[],deadlineTodoIds:[],todos:[{id,title:'Wiedervorlage: Rückruf Büro',itemType:'followup',caseId:'a',sourceId:'office',sourceModule:'addressbook',sourceType:'contact',sourceRef:JSON.stringify({contactLink:{scope:'office',contactId:'office'}}),dueAt:'2026-10-15T00:00:00'}]});return window.__abOpenContact('office','')},id);
  await page.getByRole('button',{name:'Kommunikation',exact:true}).click();await page.locator('.am-section').filter({has:page.getByRole('heading',{name:'Wiedervorlage: Rückruf Büro',exact:true})}).first().getByRole('button',{name:'Wiedervorlage öffnen',exact:true}).click();
  await page.locator('#wiedervorlagenWorkspace').waitFor();await page.getByRole('button',{name:'Kontakt öffnen',exact:true}).click();await page.locator('.am-detail h2').filter({hasText:'Büro-Kontakt'}).waitFor();
 });
 for(const theme of ['light','dark']){await choose('Büro-Kontakt');await page.getByRole('button',{name:'Erreichbarkeit',exact:true}).click();await page.getByRole('button',{name:'Erreichbarkeit bearbeiten',exact:true}).click();await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);if(mobile)await page.setViewportSize({width:320,height:640});assert.equal(await page.locator('#addressbookModern').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);await page.screenshot({path:'/tmp/addressbook-audit-'+(mobile?'mobile':'desktop')+'-'+theme+'.png'});await page.locator('.am-small-form button[type=submit]').click();await page.locator('.am-small-form').waitFor({state:'detached'})}
 assert.deepEqual(errors,[]);
};
