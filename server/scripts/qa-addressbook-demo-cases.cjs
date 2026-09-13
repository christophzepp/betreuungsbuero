'use strict';
const assert=require('node:assert/strict');
module.exports=async({page,mobile,db,errors})=>{
 const check=async(label,run)=>{await run();console.log('PASS '+(mobile?'Mobil':'Desktop')+' '+label)};
 const tab=()=>page.locator('.am-tabs [data-tab=cases]');
 const card=id=>page.locator('.am-tab-body>.am-section').filter({has:page.getByRole('heading',{name:new RegExp(id)})});
 const finish=async()=>{await page.locator('.am-small-form button[type=submit]').click();await page.locator('.am-small-form').waitFor({state:'detached'})};
 const requests=[];
 await page.evaluate(()=>{window.__qaNativeStorage=localStorage;window.__qaNativeBefore=JSON.stringify(Object.entries(localStorage));sessionStorage.setItem('betreuungsbuero.demoBoot.v1','1')});
 await page.addScriptTag({content:await page.locator('#aussendienst-2a-v1').textContent()});
 assert.equal(await page.evaluate(()=>__demoSpeicherAktiv&&localStorage===__adSpeicher),true);
 page.on('request',r=>{if(/\/api\/(addressbook|cases|office-contacts)\//.test(r.url()))requests.push(r.method()+' '+r.url())});
 await page.evaluate(()=>{
  window.__appMode='local';window.__demoModus=true;window.__activeServerCaseId='alter-online-fall';window.__abScope='case';window.__abBueroWide=false;window.caseIdentityOf=s=>s.ui.localCaseId;
  state.ui.localCaseId='demo-a';state.ui.caseLoaded=true;state.caseData.person={firstName:'Mara',lastName:'Muster'};state.caseData.care={fileNumber:'Fall A'};
  state.caseData.contacts=[{institution:'Demo-Gericht',role:'Betreuungsgericht',fileNumber:'A-100',customerNumber:'KD-A',status:'Aktiv',email:'gericht@example.org',people:[{id:'lea',name:'Lea Demo',email:'lea@example.org'}]}, {id:'previous',institution:'Bisheriger Standard',status:'Aktiv',_standardRecipients:{document:'',mail:''}}];
  const a=structuredClone(state),b=structuredClone(state);b.ui.localCaseId='demo-b';b.caseData.person={firstName:'Jonas',lastName:'Beispiel'};b.caseData.care.fileNumber='Fall B';b.caseData.contacts=[{id:'unrelated',institution:'Anderer Kontakt',role:'Arzt',fileNumber:'B-900',status:'Aktiv',_standardRecipients:{mail:''}}];
  window.caseRegistry=[{id:'demo-a',label:'Muster, Mara (Fall A)',state:a},{id:'demo-b',label:'Beispiel, Jonas (Fall B)',state:b}];window.__onlineCaseCache=new Map(window.caseRegistry.map(e=>[e.id,{label:e.label,data:structuredClone(e.state.caseData)}]));window.showImportedAddressbook();
 });
 await page.locator('.am-row-open').filter({hasText:'Demo-Gericht'}).click();await tab().click();
 await check('Fallangaben sind im echten Demo-Arbeitsspeicher bearbeitbar, auch ohne Kontakt-ID',async()=>{
  await card('Fall A').getByRole('button',{name:'Fallangaben bearbeiten',exact:true}).click();
  for(const [key,value] of Object.entries({role:'Gericht A',fileNumber:'A-101',processNumber:'V-A',customerNumber:'KD-A-NEU'}))await page.locator('.am-small-form [name='+key+']').fill(value);
  await finish();assert.match(await card('Fall A').innerText(),/A-101/);
  assert.deepEqual(await page.evaluate(()=>({count:state.caseData.contacts.length,id:!!state.caseData.contacts[0].id,file:state.caseData.contacts[0].fileNumber,registry:caseRegistry[0].state.caseData.contacts[0].fileNumber})),{count:2,id:true,file:'A-101',registry:'A-101'});
 });
 await check('Standardempfänger mit Ansprechpartner ersetzt ausschließlich den Standard im gewählten Fall',async()=>{
  await page.locator('#amPerson').selectOption('lea');await card('Fall A').getByRole('button',{name:'Als Standard für Dokumente',exact:true}).click();await card('Fall A').getByRole('button',{name:'✓ Standard für Dokumente',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>({person:__abDefaultRecipient('document')?.person?.id,old:state.caseData.contacts[1]._standardRecipients,b:caseRegistry[1].state.caseData.contacts[0]._standardRecipients})),{person:'lea',old:{mail:''},b:{mail:''}});
 });
 await check('Weitere Fallzuordnung übernimmt Stammdaten und lässt Referenzen und Standards getrennt',async()=>{
  await page.getByRole('button',{name:'+ Weiterem Fall zuordnen',exact:true}).click();await page.locator('[name=targetCaseId]').selectOption('demo-b');
  for(const [key,value] of Object.entries({role:'Gericht B',fileNumber:'B-202',processNumber:'V-B',customerNumber:'KD-B'}))await page.locator('.am-small-form [name='+key+']').fill(value);
  await finish();assert.match(await card('Fall B').innerText(),/B-202/);
  assert.deepEqual(await page.evaluate(()=>{const a=state.caseData.contacts[0],b=caseRegistry[1].state.caseData.contacts.find(c=>c.centralContactId===a.centralContactId);return {central:!!a.centralContactId,office:__baModernContacts().some(c=>c.id===a.centralContactId),role:b.role,fileA:a.fileNumber,fileB:b.fileNumber,person:b.people[0].id,standard:b._standardRecipients||{}}}),{central:true,office:true,role:'Gericht B',fileA:'A-101',fileB:'B-202',person:'lea',standard:{}});
  await page.getByRole('button',{name:'+ Weiterem Fall zuordnen',exact:true}).click();assert.match(await page.locator('.am-save').innerText(),/bereits allen verfügbaren Fällen/);assert.equal(await page.locator('.am-small-form').count(),0);
 });
 await check('Rollenstandards und ihre Entfernung funktionieren je Demo-Fall',async()=>{
  await card('Fall B').getByRole('button',{name:'Weitere Standardempfänger',exact:true}).click();await page.locator('#amStandardPurpose').selectOption('role:court');await page.getByRole('button',{name:'Als Standard festlegen',exact:true}).click();await card('Fall B').waitFor();
  assert.equal(await page.evaluate(()=>caseRegistry[1].state.caseData.contacts.find(c=>c.centralContactId)?._standardRecipients?.['role:court']),'lea');
  await card('Fall A').getByRole('button',{name:'✓ Standard für Dokumente',exact:true}).click();await card('Fall A').getByRole('button',{name:'Als Standard für Dokumente',exact:true}).waitFor();assert.equal(await page.evaluate(()=>Object.hasOwn(state.caseData.contacts[0]._standardRecipients,'document')),false);
 });
 await check('Fremde Fallangaben ändern weder den offenen Fall noch gemeinsame Stammdaten',async()=>{
  await card('Fall B').getByRole('button',{name:'Fallangaben bearbeiten',exact:true}).click();await page.locator('.am-small-form [name=customerNumber]').fill('KD-B-NEU');await finish();assert.match(await card('Fall B').innerText(),/KD-B-NEU/);assert.match(await card('Fall A').innerText(),/KD-A-NEU/);
  await page.locator('.am-contact-edit').click();await page.locator('#amEdit_email').fill('zentral-neu@example.org');await page.getByRole('button',{name:'Fertig',exact:true}).click();await tab().click();
  assert.deepEqual(await page.evaluate(()=>{const a=state.caseData.contacts[0],b=caseRegistry[1].state.caseData.contacts.find(c=>c.centralContactId===a.centralContactId),o=__baModernContacts().find(c=>c.id===a.centralContactId);return {emails:[a.email,b.email,o.email],files:[a.fileNumber,b.fileNumber],customers:[a.customerNumber,b.customerNumber],standards:b._standardRecipients}}),{emails:Array(3).fill('zentral-neu@example.org'),files:['A-101','B-202'],customers:['KD-A-NEU','KD-B-NEU'],standards:{'role:court':'lea'}});
 });
 await check('Geänderte Fallangaben bleiben beim erneuten Öffnen erhalten und Konflikte überschreiben nichts',async()=>{
  await card('Fall B').getByRole('button',{name:'Fallangaben bearbeiten',exact:true}).click();
  await page.evaluate(()=>{caseRegistry[1].state.caseData.contacts.find(c=>c.centralContactId).customerNumber='ZWISCHENZEITLICH'});
  await page.locator('.am-small-form [name=customerNumber]').fill('MEIN ENTWURF');await page.locator('.am-small-form button[type=submit]').click();await page.getByRole('button',{name:'Aktuellen Stand prüfen',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>caseRegistry[1].state.caseData.contacts.find(c=>c.centralContactId).customerNumber),'ZWISCHENZEITLICH');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Aktuellen Stand prüfen',exact:true}).click();await finish();assert.match(await card('Fall B').innerText(),/MEIN ENTWURF/);
  await page.evaluate(()=>window.showImportedAddressbook());await page.locator('.am-row-open').filter({hasText:'Demo-Gericht'}).click();await tab().click();assert.match(await card('Fall B').innerText(),/MEIN ENTWURF/);
 });
 await check('Ein echter Fallwechsel übernimmt die bearbeiteten Zuordnungen',async()=>{
  await page.evaluate(()=>{window.switchToCase('demo-b');window.showImportedAddressbook()});await page.locator('.am-row-open').filter({hasText:'Demo-Gericht'}).click();await tab().click();
  assert.equal(await page.evaluate(()=>state.caseData.contacts.find(c=>c.centralContactId)?.customerNumber),'MEIN ENTWURF');assert.match(await card('Fall A').innerText(),/KD-A-NEU/);
  await page.evaluate(()=>{window.switchToCase('demo-a');window.showImportedAddressbook()});await page.locator('.am-row-open').filter({hasText:'Demo-Gericht'}).click();await tab().click();
  assert.equal(await page.evaluate(()=>state.caseData.contacts.find(c=>c.centralContactId)?.customerNumber),'KD-A-NEU');assert.match(await card('Fall B').innerText(),/MEIN ENTWURF/);
 });
 await check('Zentrale Zuordnung lösen behält den Kontakt und seine Fallangaben',async()=>{
  page.once('dialog',d=>d.accept());await card('Fall B').getByRole('button',{name:'Zentrale Zuordnung lösen',exact:true}).click();await card('Fall B').waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>{const c=caseRegistry[1].state.caseData.contacts.find(c=>c.fileNumber==='B-202');return {present:!!c,linked:!!c.centralContactId,customer:c.customerNumber,email:c.email}}),{present:true,linked:false,customer:'MEIN ENTWURF',email:'zentral-neu@example.org'});
  await page.screenshot({path:'/tmp/addressbook-demo-case-actions-'+(mobile?'mobile':'desktop')+'.png'});
  assert.equal(await page.locator('#addressbookModern').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
 });
 await check('Direkte Zuordnung ohne ID erhält Favorit und Person; ungültige Ziele ändern nichts',async()=>{
  await page.evaluate(()=>{state.caseData.contacts.push({institution:'Neue Demo-Stelle',role:'Beratung',status:'Aktiv',people:[{id:'neu',name:'Neue Person'}]});window.showImportedAddressbook()});await page.locator('.am-row-open').filter({hasText:'Neue Demo-Stelle'}).click();await page.locator('#amPerson').selectOption('neu');await page.locator('.am-contact-controls .am-case-favorite').click();await tab().click();
  await page.getByRole('button',{name:'+ Weiterem Fall zuordnen',exact:true}).click();await page.locator('[name=targetCaseId]').evaluate(e=>e.append(new Option('Nicht geladener Fall','missing')));await page.locator('[name=targetCaseId]').selectOption('missing');await page.locator('.am-small-form button[type=submit]').click();await page.getByText('Bitte einen geladenen Demo-Fall auswählen.',{exact:true}).first().waitFor();
  assert.equal(await page.evaluate(()=>!!state.caseData.contacts.find(c=>c.institution==='Neue Demo-Stelle').centralContactId),false);
  await page.locator('[name=targetCaseId]').selectOption('demo-b');await page.locator('[name=fileNumber]').fill('B-NEU');await finish();assert.equal(await page.locator('#amPerson').inputValue(),'neu');
  assert.equal(await page.locator('.am-contact-controls .am-case-favorite').getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>state.caseData.contacts.filter(c=>c.institution==='Neue Demo-Stelle').length),1);assert.match(await card('Fall B').innerText(),/B-NEU/);
 });
 await check('Zentraler Bürokontakt verwaltet dieselben Demo-Zuordnungen',async()=>{
  await page.evaluate(()=>{window.__abScope='buero';window.__abBueroWide=true;window.showImportedAddressbook()});await page.locator('.am-row-open').filter({hasText:'Neue Demo-Stelle'}).click();await tab().click();assert.equal(await page.locator('.am-tab-body>.am-section').count(),2);
  await card('Fall B').getByRole('button',{name:'Fallangaben bearbeiten',exact:true}).click();await page.locator('[name=customerNumber]').fill('B-BUERO');await finish();assert.match(await card('Fall B').innerText(),/B-BUERO/);
  await page.locator('.am-contact-edit').click();await page.locator('#amEdit_email').fill('buero-demo@example.org');await page.getByRole('button',{name:'Fertig',exact:true}).click();await tab().click();
  assert.deepEqual(await page.evaluate(()=>caseRegistry.map(e=>e.state.caseData.contacts.find(c=>c.institution==='Neue Demo-Stelle')?.email)),['buero-demo@example.org','buero-demo@example.org']);
 });
 await check('Demo-Fallaktionen schreiben weder Serverdaten noch dauerhafte Browserdaten',async()=>{
  assert.deepEqual(requests,[]);assert.equal(await page.evaluate(()=>JSON.stringify(Object.entries(__qaNativeStorage))===__qaNativeBefore),true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM office_contacts').get().n,1);
  assert.equal(await page.evaluate(()=>Array.from({length:localStorage.length},(_,i)=>localStorage.getItem(localStorage.key(i))).some(v=>v.includes('zentral-neu@example.org'))),true);
 });
 assert.deepEqual(errors,[]);
};
