'use strict';
const assert=require('node:assert/strict');
module.exports=async({page,mobile,errors})=>{
 const check=async(label,run)=>{await run();console.log('PASS '+(mobile?'Mobil':'Desktop')+' '+label)};
 const tab=()=>page.locator('.am-tabs [data-tab=cases]'),cards=()=>page.locator('.am-tab-body>.am-section');
 const choose=async label=>{await page.locator('.am-row-open').filter({hasText:label}).click();await tab().click()};
 const requests=[];page.on('request',r=>{if(/\/api\/addressbook\//.test(r.url()))requests.push(r.method()+' '+r.url())});
 await page.evaluate(()=>{
  window.__appMode='local';window.__demoModus=true;window.__activeServerCaseId='alter-online-fall';window.__abScope='case';window.__abBueroWide=false;
  window.caseIdentityOf=s=>s.ui.localCaseId;state.ui.localCaseId='local-a';state.ui.caseLoaded=true;
  state.caseData.person={firstName:'Mara',lastName:'Muster'};state.caseData.care={fileNumber:'Fall A'};
  state.caseData.contacts=[{institution:'Demo-Gericht',role:'Betreuungsgericht',fileNumber:'A-100',customerNumber:'KD-A',status:'Aktiv'},{id:'linked-a',institution:'Zentraler Demo-Kontakt',centralContactId:'office-demo',role:'Versicherung',fileNumber:'A-200',status:'Aktiv'}];
  window.caseRegistry=[{id:'local-a',label:'Veralteter Fallname',state:{caseData:{contacts:[]}}},{id:'local-b',label:'Beispiel, Jonas (Fall B)',state:{caseData:{contacts:[{institution:'Demo-Gericht',fileNumber:'NICHT ZUGEORDNET'},{id:'linked-a',institution:'Zentraler Demo-Kontakt',fileNumber:'GLEICHE ID IST KEINE VERKNÜPFUNG'},{id:'linked-b',institution:'Zentraler Demo-Kontakt',centralContactId:'office-demo',role:'Gläubiger',fileNumber:'B-200',customerNumber:'KD-B',_standardRecipients:{mail:'person-b'},people:[{id:'person-b',name:'Person im zweiten Fall'}]}]}}}];
  window.showImportedAddressbook();
 });
 await check('Demo zeigt den Herkunftsfall auch für Kontakte ohne ID, mit aktuellen Fall- und Kontaktdaten',async()=>{
  await choose('Demo-Gericht');assert.equal(await cards().count(),1);assert.match(await cards().innerText(),/Muster, Mara \(Fall A\)/);assert.match(await cards().innerText(),/A-100/);assert.match(await cards().innerText(),/KD-A/);assert.doesNotMatch(await page.locator('.am-tab-body').innerText(),/Veralteter Fallname|NICHT ZUGEORDNET/);
  assert.equal(await page.getByRole('button',{name:'+ Weiterem Fall zuordnen',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Als Standard für E-Mail',exact:true}).count(),0);
  await page.screenshot({path:'/tmp/addressbook-demo-cases-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop')+'.png'});
  await page.locator('.am-contact-edit').click();await page.locator('#amEdit_fileNumber').fill('A-101');await page.getByRole('button',{name:'Fertig',exact:true}).click();await tab().click();assert.match(await cards().innerText(),/A-101/);
 });
 await check('Explizite zentrale Verknüpfungen zeigen getrennte Fallangaben; gleiche Namen und IDs reichen nicht',async()=>{
  if(mobile)await page.getByRole('button',{name:'← Kontakte',exact:true}).click();await choose('Zentraler Demo-Kontakt');assert.equal(await cards().count(),2);const text=await page.locator('.am-tab-body').innerText();assert.match(text,/A-200/);assert.match(text,/B-200/);assert.match(text,/KD-B/);assert.match(text,/Person im zweiten Fall/);assert.doesNotMatch(text,/GLEICHE ID IST KEINE VERKNÜPFUNG/);
 });
 await check('Lokaler Bürokontakt ohne Zuordnung bekommt keinen fremden oder geöffneten Fall',async()=>{
  await page.evaluate(async()=>{await window.__baModernSaveLocal({id:'unassigned-demo',institution:'Unzugeordneter Demo-Bürokontakt',status:'Aktiv'});window.__abScope='buero';window.__abBueroWide=true;window.showImportedAddressbook()});await choose('Unzugeordneter Demo-Bürokontakt');assert.equal(await cards().count(),0);await page.getByRole('heading',{name:'Keine Fallzuordnung in den geladenen Fällen',exact:true}).waitFor();assert.deepEqual(requests,[],'Lokale Fallanzeige darf keine Online-Zuordnungen lesen oder schreiben');
 });
 await check('Online-Fallzuordnungen behalten ihre Verwaltungs- und Standardaktionen',async()=>{
  await page.evaluate(async()=>{window.__appMode='online';window.__demoModus=false;window.__activeServerCaseId='a';window.__abScope='case';window.__abBueroWide=false;state.caseData.contacts=(await(await fetch('/api/cases/a/contacts')).json()).contacts.map(c=>({...c.data,id:c.id}));window.showImportedAddressbook()});await choose('Amtsgericht Musterstadt');await page.getByRole('button',{name:'Als Standard für E-Mail',exact:true}).waitFor();assert.match(await cards().innerText(),/Mara Muster/);assert.equal(await page.getByRole('button',{name:'+ Weiterem Fall zuordnen',exact:true}).count(),1);
 });
 assert.deepEqual(errors,[]);
};
