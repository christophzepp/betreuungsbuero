'use strict';
const assert=require('node:assert/strict');
module.exports=async({page,mobile,db,errors})=>{
 const fixture=JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json);fixture.note='';db.prepare("UPDATE case_contacts SET data_json=? WHERE id='court'").run(JSON.stringify(fixture));
 const check=async(label,fn)=>{await fn();console.log('PASS '+(mobile?'Mobil':'Desktop')+' '+label)};
 const note=page.locator('#amEdit_note'),height=()=>note.evaluate(e=>e.getBoundingClientRect().height),saved=()=>page.waitForFunction(()=>document.querySelector('.am-save')?.textContent.startsWith('Gespeichert'));
 const open=async()=>{await page.evaluate(()=>window.__abOpenContact('court','a'));await page.waitForFunction(()=>{const b=document.querySelector('.am-detail-top .am-star');return b&&!b.disabled})};
 const edit=async()=>{await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await note.scrollIntoViewIfNeeded()};
 await open();
 await check('Bearbeiten und Fallfavorit stehen nebeneinander; Kopfaktionen sind kompakt',async()=>{
  const edit=await page.locator('.am-contact-edit').boundingBox(),favorite=await page.locator('.am-detail-top .am-star').boundingBox();assert.ok(Math.abs(edit.y-favorite.y)<1);assert.ok(favorite.x>=edit.x+edit.width);assert.ok(edit.height<=(mobile?36:28)+1);assert.ok(favorite.height<=(mobile?36:28)+1);
  for(const box of await page.locator('.am-contact-actions .am-btn').evaluateAll(list=>list.map(e=>e.getBoundingClientRect().toJSON())))assert.ok(box.height<=(mobile?54:28)+1);
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:'/tmp/addressbook-compact-head-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop')+'-'+theme+'.png'})}
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
 });
 await edit();
 await check('Leere Notizen beginnen niedrig und nutzen die volle Formularbreite',async()=>{
  const size=await note.evaluate(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,grid:e.closest('.am-form-grid').getBoundingClientRect().width,resize:getComputedStyle(e).resize}));assert.ok(size.height>=50&&size.height<=80,JSON.stringify(size));assert.ok(Math.abs(size.width-size.grid)<2);assert.equal(size.resize,'vertical');
 });
 await check('Notizen wachsen und schrumpfen mit dem Text; Autosave erhält den vollständigen Inhalt',async()=>{
  const text=Array.from({length:18},(_,i)=>'Gesprächsnotiz '+(i+1)+': Inhalt bleibt vollständig erhalten.').join('\n');await note.fill(text);await page.waitForFunction(()=>document.querySelector('#amEdit_note').getBoundingClientRect().height>300);assert.ok(await note.evaluate(e=>e.scrollHeight<=e.clientHeight+1));await saved();assert.equal(JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json).note,text);
  await note.fill('Kurze Notiz');await page.waitForFunction(()=>document.querySelector('#amEdit_note').getBoundingClientRect().height<=80);await saved();
  await note.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/addressbook-compact-note-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop')+'.png'});
 });
 await check('Manuelles Vergrößern bleibt beim Weiterschreiben erhalten; Spaltenwechsel passt den Text an',async()=>{
  if(!mobile){
   const before=await height(),box=await note.boundingBox();await page.mouse.move(box.x+box.width-4,box.y+box.height-4);await page.mouse.down();await page.mouse.move(box.x+box.width-4,box.y+box.height+90,{steps:10});await page.mouse.up();assert.ok(await height()>before+50,'Nativer Ziehgriff muss das Feld vergrößern');
   const manual=await height();await note.fill('Notiz nach manueller Vergrößerung.');await saved();assert.ok(await height()>=manual-1,'Eingabe darf die manuell gewählte Höhe nicht zurücksetzen');
  }
  const text='Langer Text mit mehreren Wörtern zum Prüfen des automatischen Umbruchs. '.repeat(25);await note.fill(text);await saved();
  if(mobile)await page.setViewportSize({width:320,height:844});else{await page.locator('.am-resizer').focus();await page.keyboard.press('End')}
  await page.waitForFunction(()=>{const e=document.querySelector('#amEdit_note');return e.scrollHeight<=e.clientHeight+1});assert.ok(await note.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  if(mobile)await page.setViewportSize({width:390,height:844});else await page.locator('.am-resizer').dblclick();
  await page.getByRole('button',{name:'Fertig',exact:true}).click();await page.locator('.am-tabs').waitFor();
 });
 await check('Neuanlage beginnt kompakt; gespeicherte mehrzeilige Notizen sind beim erneuten Bearbeiten vollständig sichtbar',async()=>{
  await page.getByRole('button',{name:'+ Neuer Kontakt',exact:true}).click();await note.scrollIntoViewIfNeeded();assert.ok(await height()<=80);
  const institution='Neue Notizprüfung '+(mobile?'Mobil':'Desktop'),text=Array.from({length:12},(_,i)=>'Notiz zum neuen Kontakt, Zeile '+(i+1)).join('\n');await page.locator('#amEdit_institution').fill(institution);await note.fill(text);await page.waitForFunction(()=>document.querySelector('#amEdit_note').getBoundingClientRect().height>200);
  await page.getByRole('button',{name:'Kontakt anlegen',exact:true}).click();await page.locator('.am-tabs').waitFor();const record=db.prepare('SELECT data_json FROM case_contacts WHERE json_extract(data_json,\'$.institution\')=?').get(institution);assert.equal(JSON.parse(record.data_json).note,text);await edit();assert.ok(await note.evaluate(e=>e.scrollHeight<=e.clientHeight+1));assert.equal(await note.inputValue(),text);await page.getByRole('button',{name:'Fertig',exact:true}).click();
 });
 await check('Lokaler Demomodus übernimmt wachsende Notizen beim Bearbeiten und Neuanlegen',async()=>{
  await page.evaluate(()=>{window.__appMode='local';window.__demoModus=true;window.__abScope='case';window.__abBueroWide=false;state.ui.addressbookViewV154={};state.caseData.contacts=[{id:'demo-note',institution:'Lokaler Notizkontakt',status:'Aktiv'}];window.showImportedAddressbook()});await page.locator('.am-row-open').click();await edit();await note.fill('Lokale Notiz\n'.repeat(10));await page.waitForFunction(()=>document.querySelector('#amEdit_note').getBoundingClientRect().height>180);await page.getByRole('button',{name:'Fertig',exact:true}).click();await page.locator('.am-tabs').waitFor();assert.equal(await page.evaluate(()=>state.caseData.contacts.find(c=>c.id==='demo-note').note),'Lokale Notiz\n'.repeat(10));
  await page.getByRole('button',{name:'+ Neuer Kontakt',exact:true}).click();await note.scrollIntoViewIfNeeded();assert.ok(await height()<=80);await page.locator('#amEdit_institution').fill('Weitere lokale Notiz');await note.fill('Neue lokale Notiz\nZweite Zeile');await page.getByRole('button',{name:'Kontakt anlegen',exact:true}).click();await page.locator('.am-tabs').waitFor();assert.equal(await page.evaluate(()=>state.caseData.contacts.find(c=>c.institution==='Weitere lokale Notiz').note),'Neue lokale Notiz\nZweite Zeile');
 });
 assert.deepEqual(errors,[]);
};
