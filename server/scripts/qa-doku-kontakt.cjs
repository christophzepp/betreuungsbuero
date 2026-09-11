'use strict';
// Echte ausgelieferte App mit synthetischen Fällen und abgefangenen HTTP-Antworten; keine externen Zugriffe.
// PLAYWRIGHT_MODULE=/path/to/playwright node server/scripts/qa-doku-kontakt.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const app=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const mobile of [false,true]){
   const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,...(mobile?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
   const errors=[],writes=[],entries=[];let failContacts=false,failSave=false,delayContacts=null;
   page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});
   page.setDefaultTimeout(15000);
   const contacts={a:[{id:'arzt-a',data:{institution:'Praxis Dr. Sommer',firstName:'Lea',lastName:'Sommer',role:'Hausärztin',fileNumber:'A-100',email:'praxis@example.org',status:'Aktiv'}},
    {id:'bank-a',data:{institution:'Sparkasse Musterstadt',role:'Bank',fileNumber:'A-200'}},{id:'ended-a',data:{institution:'Frühere Praxis',role:'Hausarzt',status:'Beendet'}},
    {id:'unsafe-a',data:{institution:'<img src=x onerror=alert(1)>',role:'Unbekannt'}}],b:[{id:'court-b',data:{institution:'Amtsgericht anderer Fall',role:'Betreuungsgericht',fileNumber:'B-300'}}]};
   await page.route('**/*',async r=>{
    const u=new URL(r.request().url()),method=r.request().method();
    if(u.origin!=='http://doku.invalid')return r.abort();
    if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:app});
    let result={};
    if(u.pathname==='/api/cases')result={cases:[{id:'a',label:'Mara Muster'},{id:'b',label:'Jonas Beispiel'}]};
    else if(u.pathname.endsWith('/contacts')){if(delayContacts)await delayContacts;if(failContacts)return r.fulfill({status:503,json:{error:'Testfehler'}});result={contacts:contacts[u.pathname.split('/')[3]]||[]}}
    else if(u.pathname==='/api/office-contacts')result={contacts:[{id:'office-1',data:{institution:'Büro-Kontakt',firstName:'Anna',lastName:'Test',role:'Notarin'}}]};
    else if(u.pathname.includes('/doku-entries')&&['POST','PUT'].includes(method)){
     const data=r.request().postDataJSON().data;writes.push({method,url:u.pathname,data});
     if(failSave)return r.fulfill({status:503,json:{error:'Speichern fehlgeschlagen (Test)'}});
     const id=method==='POST'?'entry-'+(entries.length+1):u.pathname.split('/').pop();
     const found=entries.find(e=>e.id===id);if(found)found.data=data;else entries.push({id,data});result={id,ok:true};
    }else if(u.pathname.endsWith('/doku-entries'))result={entries};
    await r.fulfill({json:result});
   });
   await page.goto('http://doku.invalid/',{waitUntil:'domcontentloaded',timeout:90000});
   await page.locator('#modeIntroNext').click();
   await page.waitForTimeout(250);
   await page.evaluate(({mobile,contacts})=>{
    window.__appMode='online';window.__activeServerCaseId='a';window.__qaEntries=[];
    window.caseIdentityOf=()=> 'a';window.findCaseEntry=()=>null;
    state.caseData.person.firstName='Mara';state.caseData.person.lastName='Muster';state.caseData.contacts=contacts.a.map(x=>({...x.data,id:x.id}));state.caseData.documentationEntries=[];
    window.__onlineCaseCache=new Map([['a',{label:'Mara Muster',data:state.caseData}],['b',{label:'Jonas Beispiel',data:{contacts:contacts.b.map(x=>({...x.data,id:x.id})),documentationEntries:[]}}]]);
    if(window.__onlineCaseSync)window.__onlineCaseSync.preloadCache=async()=>{};
    if(mobile)document.documentElement.classList.add('mobile-online-active');
    ['loginGateOverlay','modeIntroOverlay'].forEach(id=>document.getElementById(id)?.remove());
    window.openDocumentationView();
   },{mobile,contacts});
   await page.locator('.fd-shell').waitFor();
   await page.waitForTimeout(250);
   await page.evaluate(()=>window.openDokuEntryForm('a',-1));

   const check=async(name,fn)=>{await fn();console.log('PASS '+(mobile?'Mobil':'Desktop')+' '+name)};
   const open=async()=>{await page.locator('#fdKontaktButton').click();await page.getByRole('button',{name:/Praxis Dr. Sommer/}).waitFor()};
   await open();
   await check('Fall- und Bürokontakte, Ende-Filter, sichere Textdarstellung',async()=>{
    assert.equal(await page.locator('.fd-kontakt-option').count(),4);assert.equal(await page.locator('#fdKontaktTreffer img').count(),0);
    await page.locator('#fdKontaktBeendet').check();assert.equal(await page.locator('.fd-kontakt-option').count(),5);
    assert.equal(await page.getByRole('button',{name:/Amtsgericht anderer Fall/}).count(),0);
    await page.locator('#fdKontaktSuche').fill('A-100');assert.equal(await page.locator('.fd-kontakt-option').count(),1);
   });
   await page.getByRole('button',{name:/Praxis Dr. Sommer/}).click();
   await check('Vorauswahl nur Bereich/Gegenüber; Kontaktart und Ereignis bleiben leer',async()=>{
    assert.equal(await page.locator('#dokuActor').inputValue(),'Hausärzt:in');assert.match(await page.locator('#dokuLinkedContact').inputValue(),/Lea Sommer/);
    for(const id of ['dokuContactType','dokuType','dokuDetail','dokuNote','dokuFreeDetail'])assert.equal(await page.locator('#'+id).inputValue(),'');
   });
   await page.locator('#dokuFreeDetail').fill('Besprochenen Inhalt unverändert erhalten.');await page.locator('#dokuContactType').fill('telefonisch');
   await open();await page.getByRole('button',{name:/Sparkasse Musterstadt/}).click();assert.equal(await page.locator('#dokuActor').inputValue(),'Bank / Sparkasse');
   await page.locator('#dokuActor').fill('Eigene Einordnung');await open();await page.getByRole('button',{name:/Praxis Dr. Sommer/}).click();
   assert.equal(await page.locator('#dokuActor').inputValue(),'Eigene Einordnung');
   // Restore an unambiguous grouping manually, then save using the real form pipeline.
   await page.locator('#dokuActorGroup').fill('Gesundheit, Pflege & Rehabilitation');
   failSave=true;await page.locator('#fdFormSaveBtn').click();await page.waitForTimeout(350);
   await check('Fehler erhält Auswahl und Eingaben, erneutes Speichern ist möglich',async()=>{assert.match(await page.locator('#dokuLinkedContact').inputValue(),/Lea Sommer/);assert.equal(await page.locator('#fdFormSaveBtn').isEnabled(),true);assert.equal(entries.length,0)});
   failSave=false;await page.locator('#fdFormSaveBtn').click();await page.locator('#dokuLinkedContact').waitFor({state:'detached'});
   await check('Server erhält Kontakt-ID/Snapshot, genau einen neuen Eintrag und unveränderten Freitext',async()=>{
    assert.equal(entries.length,1);assert.equal(entries[0].data.contactLink.contactId,'arzt-a');assert.equal(entries[0].data.contactLink.snapshot.fileNumber,'A-100');assert.equal(entries[0].data.freeDetail,'Besprochenen Inhalt unverändert erhalten.');
    assert.equal(writes.filter(w=>w.method==='POST').length,2,'ein fehlgeschlagener und ein erfolgreicher Versuch');
   });
   await page.evaluate(data=>{state.caseData.documentationEntries=data.map(e=>({...e.data,id:e.id}));window.openDokuEntryForm('a',0)},entries);
   assert.match(await page.locator('#dokuLinkedContact').inputValue(),/Lea Sommer/);
   await page.locator('#fdKontaktEntfernen').click();await page.locator('#fdFormSaveBtn').click();await page.locator('#dokuLinkedContact').waitFor({state:'detached'});assert.equal(entries[0].data.contactLink,null);
   await page.evaluate(()=>window.openDokuEntryForm('a',-1));await open();await page.getByRole('button',{name:/Praxis Dr. Sommer/}).click();
   await page.locator('#dokuFormCaseSelect').selectOption('b');assert.equal(await page.locator('#dokuLinkedContact').inputValue(),'');assert.equal(await page.locator('#dokuActor').inputValue(),'');
   await page.locator('#fdKontaktButton').click();await page.getByRole('button',{name:/Amtsgericht anderer Fall/}).click();
   await page.locator('#dokuNote').fill('Nur anderer Fall');await page.locator('#dokuContactType').fill('telefonisch');await page.locator('#fdFormSaveBtn').click();await page.locator('#dokuLinkedContact').waitFor({state:'detached'});
   assert.equal(entries[1].data.contactLink.caseId,'b');assert.ok(writes.some(w=>w.url==='/api/cases/b/doku-entries'&&w.method==='POST'));
   await page.evaluate(()=>window.openDokuEntryForm('b',-1));
   await page.locator('#fdKontaktButton').click();await page.getByRole('button',{name:/Amtsgericht anderer Fall/}).click();
   await page.locator('#dokuNote').fill('Zweiter Eintrag im anderen Fall');await page.locator('#dokuContactType').fill('telefonisch');await page.locator('#fdFormSaveBtn').click();await page.locator('#dokuLinkedContact').waitFor({state:'detached'});
   await check('Weitere Einträge im Fremdfall duplizieren keinen vorherigen Datensatz',async()=>{assert.equal(entries.length,3);assert.equal(writes.filter(w=>w.method==='POST'&&w.url==='/api/cases/b/doku-entries').length,2)});
   await page.evaluate(()=>window.openDokuEntryForm('a',-1));
   failContacts=true;await page.locator('#fdKontaktButton').click();await page.getByRole('button',{name:'Erneut versuchen'}).waitFor();assert.equal(await page.getByRole('button',{name:/Büro-Kontakt/}).count(),1);
   failContacts=false;await page.getByRole('button',{name:'Erneut versuchen'}).click();await page.getByRole('button',{name:/Praxis Dr. Sommer/}).waitFor();
   await check('Kontaktliste bleibt bei schmalem Fenster im Formular',async()=>{
    const overflow=await page.locator('.fd-kontakt').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false);
    await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));
    await page.screenshot({path:'/tmp/doku-kontakt-'+(mobile?'mobil':'desktop')+'.png'});
   });
   // Closing a chooser must ignore a late server response and must not mark the form dirty.
   await page.getByRole('button',{name:'Auswahl schließen'}).click();let release;delayContacts=new Promise(r=>release=r);
   await page.locator('#fdKontaktButton').click();await page.locator('#fdKontaktSuche').fill('Suche');await page.keyboard.press('Escape');release();delayContacts=null;await page.waitForTimeout(100);
   assert.equal(await page.locator('#fdKontaktAuswahl').isVisible(),false);
   await page.evaluate(()=>window.fdFormAbbrechen());assert.equal(await page.locator('.fd-frage').count(),0);
   // Lokaler Modus nutzt ausschließlich bereits geladene Fall-/Bürokontakte.
   const countBefore=writes.length;
   await page.evaluate(()=>{window.__appMode='local';window.__baBueroContacts=async()=>[{id:'local-office',institution:'Lokales Büro'}];window.openDokuEntryForm('a',-1)});
   await open();await page.getByRole('button',{name:/Praxis Dr. Sommer/}).click();
   await check('Lokale Kontaktauswahl funktioniert ohne Server-Schreibzugriff',async()=>{assert.match(await page.locator('#dokuLinkedContact').inputValue(),/Lea Sommer/);assert.equal(writes.length,countBefore)});
   // Error reporting from our deliberate failed request is handled; page exceptions must remain absent.
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
