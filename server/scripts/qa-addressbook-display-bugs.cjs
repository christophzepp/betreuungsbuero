'use strict';
const assert=require('node:assert/strict');
module.exports=async({page,mobile,db,errors})=>{
 const failures=[],suffix=mobile?'mobile':'desktop';
 const check=async(label,work)=>{if(process.env.QA_LOCAL_ONLY&&!label.startsWith('Lokale'))return;try{await work();console.log('PASS '+suffix+' '+label)}catch(e){failures.push(label+': '+e.message);console.log('FAIL '+suffix+' '+label+': '+e.message)}};
 const A=require('../src/modules/contacts/addressbook'),admin={userId:1,isAdmin:true};
 const patch=data=>A.replace('case','a','court',data,admin,A.version(A.get('case','a','court')));
 const get=()=>A.data(A.get('case','a','court'));
 const open=async()=>{await page.evaluate(()=>window.__abOpenContact('court','a'));await page.locator('.am-tabs').waitFor()};
 const more=async()=>{const m=page.locator('.am-menu:not(.am-views)');if(!await m.evaluate(e=>e.open))await m.locator('summary').click()};
 await check('Kontaktliste auf kurzen Bildschirmen sichtbar und alle Filter erreichbar',async()=>{
  for(const size of mobile?[{width:320,height:640},{width:390,height:844}]:[{width:768,height:640},{width:1440,height:1000}]){
   await page.setViewportSize(size);await page.evaluate(()=>window.showImportedAddressbook());
   const geometry=await page.evaluate(()=>{const list=document.querySelector('#phase5AddressListV154').getBoundingClientRect(),pane=document.querySelector('.am-list-pane').getBoundingClientRect();return {visible:Math.min(list.bottom,pane.bottom)-Math.max(list.top,pane.top),pane:pane.height}});
   await page.screenshot({path:'/tmp/addressbook-audit-'+size.width+'-list.png'});
   assert.ok(geometry.visible>=100,JSON.stringify({size,...geometry}));
   await page.locator('.am-filters summary').click();
   for(const id of ['phase5AddressRoleV154','amTagFilter','amGroupFilter']){await page.locator('#'+id).scrollIntoViewIfNeeded();assert.ok(await page.locator('#'+id).isVisible(),id)}
   await page.locator('.am-filters summary').click();
   assert.equal(await page.locator('#addressbookModern').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
  }
 });
 await check('Signatur ersetzt ausdrücklich gewählte Hauptwege und erhält bisherige Wege',async()=>{
  patch({email:'alt@example.org',phone:'01234/111111',contactWays:[{id:'post',type:'email',label:'Poststelle',value:'alt@example.org',preferred:true},{id:'tel',type:'phone',label:'Zentrale',value:'01234/111111',preferred:true}]});await open();
  await page.evaluate(()=>window.__abImportSignature('Mit freundlichen Grüßen\nAnna Beispiel\nneu@example.org\nTel.: 01234/222222\nhttps://example.org'));
  await page.getByRole('button',{name:'Vorschlag prüfen',exact:true}).click();await page.locator('.am-signature-row [name=email]').waitFor();
  for(const label of ['E-Mail übernehmen','Telefon übernehmen'])await page.getByRole('checkbox',{name:label,exact:true}).check();
  await page.getByRole('button',{name:'Ausgewählten Kontakt ergänzen',exact:true}).click();await page.locator('.am-tabs').waitFor({state:'attached'});
  const c=get();assert.equal(c.email,'neu@example.org');assert.equal(c.phone,'01234/222222');assert.ok(c.contactWays.some(w=>w.value==='alt@example.org'&&!w.preferred));assert.ok(c.contactWays.some(w=>w.value==='01234/111111'&&!w.preferred));
 });
 await check('Ansprechpartner zeigt seine eigene Mobilnummer',async()=>{
  patch({mobile:'0171/111111',people:[{id:'sach',name:'Lea Schneider',mobile:'0171/222222'}]});await open();await page.locator('#amPerson').selectOption('sach');
  const info=page.locator('.am-info').filter({has:page.locator('.am-sub',{hasText:/^Mobil$/})});assert.match(await info.innerText(),/0171\/222222/);
 });
 await check('Visitenkartenentwurf bleibt bei Hintergrundaktualisierung erhalten',async()=>{
  await more();await page.getByRole('button',{name:'Visitenkarte übernehmen',exact:true}).click();await page.getByLabel('Erkannter Visitenkartentext').fill('Noch nicht gespeicherte Visitenkarte');
  await page.getByRole('heading',{name:'Visitenkarte übernehmen',exact:true}).click();
  // The public refresh entry point used by office contact events must preserve utility drafts.
  await page.evaluate(()=>window.__abModern.refresh?window.__abModern.refresh():window.showImportedAddressbook());
  assert.equal(await page.getByLabel('Erkannter Visitenkartentext').inputValue(),'Noch nicht gespeicherte Visitenkarte');
  await page.getByRole('button',{name:'← Kontakte',exact:true}).click();await page.locator('.am-tabs').waitFor({state:'attached'});
 });
 await check('Verspätete Papierkorb- und Signaturantworten verändern die neue Ansicht nicht',async()=>{
  for(const kind of ['trash','signature']){
   await open();let release,started,finished;
   const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r),complete=new Promise(r=>finished=r);
   const pattern=kind==='trash'?'**/api/addressbook/trash':'**/api/addressbook/contact?*';
   const handler=async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response});finished()};
   await page.route(pattern,handler);
   try{
    if(kind==='trash'){await more();await page.getByRole('button',{name:'Papierkorb',exact:true}).click()}
    else{await page.evaluate(()=>window.__abImportSignature('anna@example.org'));await page.getByRole('button',{name:'Vorschlag prüfen',exact:true}).click()}
    await ready;await more();await page.getByRole('button',{name:'Visitenkarte übernehmen',exact:true}).click();
    release();await complete;await page.waitForTimeout(100);
    assert.equal(await page.locator('.am-signature-row').count(),0);
    assert.equal(await page.getByText('Der Papierkorb ist leer.',{exact:true}).count(),0);
    assert.ok(await page.getByLabel('Erkannter Visitenkartentext').isVisible());
   }finally{release();await page.unroute(pattern,handler)}
  }
 });
 await check('Alle Detailansichten bleiben hell und dunkel ohne seitlichen Überlauf',async()=>{
  await open();if(mobile)await page.setViewportSize({width:320,height:640});
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   for(const tab of ['data','cases','people','addresses','ways','extras','sync','availability','history','communication']){
    await page.locator('[data-tab='+tab+']').click();await page.waitForFunction(()=>!document.querySelector('.am-tab-body')?.textContent.includes('Kontaktinformationen werden geladen'));
    assert.equal(await page.locator('.am-detail').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,theme+' '+tab);
    if(mobile){const back=await page.getByRole('button',{name:'← Kontakte',exact:true}).boundingBox();assert.ok(back&&back.y>=0&&back.y+back.height<640,'Rückkehr zur Liste bleibt sichtbar')}
   }
   await page.screenshot({path:'/tmp/addressbook-audit-'+suffix+'-'+theme+'.png'});
  }
 });
 await check('Lokale Signaturübernahme hält Telefon- und Exportfelder konsistent',async()=>{
  await page.evaluate(()=>{window.__appMode='local';state.ui.addressbookViewV154={};state.caseData.contacts=[{id:'court',institution:'Lokaler Kontakt',status:'Aktiv',phone:'01234/111111',phoneArea:'01234',phoneNumber:'111111',contactWays:[{id:'old',type:'phone',label:'Zentrale',value:'01234/111111',preferred:true}]}];window.showImportedAddressbook()});
  await open();await page.evaluate(()=>window.__abImportSignature('Tel.: 01234/222222'));await page.getByRole('button',{name:'Vorschlag prüfen',exact:true}).click();await page.getByRole('checkbox',{name:'Telefon übernehmen',exact:true}).check();await page.getByRole('button',{name:'Ausgewählten Kontakt ergänzen',exact:true}).click();await page.locator('.am-tabs').waitFor({state:'attached'});
  const c=await page.evaluate(()=>state.caseData.contacts.find(c=>c.id==='court'));assert.equal(c.phone,'01234/222222');assert.equal(c.phoneArea,'');assert.equal(c.phoneNumber,c.phone);assert.ok(c.contactWays.some(w=>w.id==='old'&&!w.preferred));
 });
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
};
