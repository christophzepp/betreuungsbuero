'use strict';
const assert=require('node:assert/strict');
module.exports=async({page,root,act,panel,check,shot,errors})=>{
 const note=()=>panel.getByLabel('Notiz',{exact:true});
 const height=()=>note().evaluate(el=>el.getBoundingClientRect().height);
 const text=lines=>Array.from({length:lines},(_,n)=>`Zeile ${n+1}: Unterlagen erneut prüfen und Rückmeldung dokumentieren.`).join('\n');
 const visible=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&!!hit&&(hit===el||el.contains(hit))});
 const fits=()=>note().evaluate(el=>el.scrollHeight<=el.clientHeight+2&&el.scrollWidth<=el.clientWidth+2);
 const discard=async()=>{await panel.locator('.wv-panel-heading [data-action=close]').click();if(await act('discard').isVisible())await act('discard').click()};
 const resize=async delta=>{
  // Use the browser's real resize handle; setting style.height would miss flex-layout regressions.
  await panel.locator('.wv-panel-content').evaluate(el=>el.scrollTop=el.scrollHeight);
  const r=await note().boundingBox();
  await page.mouse.move(r.x+r.width-3,r.y+r.height-3);await page.mouse.down();
  await page.mouse.move(r.x+r.width-3,r.y+r.height-3+delta,{steps:12});await page.mouse.up();
 };
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>__followupWorkspace.open());
 await check('Aktualisieren zeigt Pfeilsymbol und Wort gemeinsam neben der Sortierung',async()=>{
  assert.equal((await act('reload').innerText()).trim(),'Aktualisieren');assert.equal(await act('reload').locator('svg').count(),1);
  assert.equal(await root.locator('.wv-list-actions [data-action=reload]').count(),1);assert.equal(await root.locator('.wv-countline button').count(),0);
 });
 await root.locator('#wv-search').fill('Kostenübernahme');
 await page.evaluate(()=>{__qaTodos.find(t=>t.id==='f1').title='Wiedervorlage: Kostenübernahme aktualisiert'});await act('reload').click();
 await check('Aktualisieren lädt Änderungen und erhält die Suche',async()=>{await root.getByText('Kostenübernahme aktualisiert',{exact:true}).waitFor();assert.equal(await root.locator('#wv-search').inputValue(),'Kostenübernahme')});
 await root.locator('#wv-search').fill('');await page.evaluate(()=>__followupWorkspace.create());
 const initial=await height();await note().fill(text(50));
 await check('Lange Eingaben wachsen ohne abgeschnittenen Text',async()=>{assert.ok(await height()>initial+250);assert.ok(await fits());assert.ok(await visible(act('save')))});
 await note().fill('Kurze Notiz');
 await check('Automatische Höhe wird bei kürzerem Text wieder kompakt',async()=>assert.ok(Math.abs(await height()-initial)<=2));
 await resize(-100);const smaller=await height();
 await check('Notiz lässt sich mit der Maus verkleinern',async()=>assert.ok(smaller<initial-70,`${initial} → ${smaller}`));
 await note().fill('Kurze Notiz mit Ergänzung');
 await check('Tippen erhält die selbst gewählte Höhe',async()=>assert.ok(Math.abs(await height()-smaller)<=2));
 await resize(65);const larger=await height();
 await check('Notiz lässt sich mit der Maus vergrößern',async()=>assert.ok(larger>smaller+40,`${smaller} → ${larger}`));
 await panel.locator('.wv-source-option').filter({hasText:'Ausgabenübersicht.pdf'}).click();
 await check('Originalauswahl erhält Notiz und manuell gewählte Höhe',async()=>{assert.equal(await note().inputValue(),'Kurze Notiz mit Ergänzung');assert.ok(Math.abs(await height()-larger)<=2)});
 await note().fill(text(60));
 await check('Text wächst auch über die manuell eingestellte Höhe hinaus',async()=>{assert.ok(await height()>larger+250);assert.ok(await fits())});
 await note().fill('Gespeicherte Notiz');
 await check('Nach Kürzen bleibt die manuelle Mindesthöhe erhalten',async()=>assert.ok(Math.abs(await height()-larger)<=2));
 await shot('notiz-manuell-desktop');
 await act('save').click();await act('edit').waitFor();
 await check('Notiz wird gespeichert, Größenwahl bleibt reine Anzeigeeinstellung',async()=>{
  const saved=await page.evaluate(()=>__qaTodos.find(t=>t.sourceId==='doc3'));assert.equal(saved.description,'Gespeicherte Notiz');assert.equal(saved.manual,undefined);assert.equal(saved.written,undefined);
 });
 for(const [width,height,theme] of [[1440,900,'light'],[1024,700,'dark'],[390,844,'dark'],[320,568,'light']]){
  await page.setViewportSize({width,height});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t},theme);
  await page.evaluate(()=>{__qaTodos.find(t=>t.id==='f1').description=Array.from({length:32},(_,i)=>`Prüfschritt ${i+1}: Unterlagen mit dem Original vergleichen.`).join('\n')});
  await page.evaluate(()=>__followupWorkspace.open('todo:f1'));await act('edit').click();
  await check(`Vorhandene lange Notiz vollständig lesbar ${width} ${theme}`,async()=>{assert.ok(await fits());assert.ok(await visible(act('save')));assert.ok(await panel.locator('.wv-panel-content').evaluate(el=>el.scrollWidth<=el.clientWidth+2))});
  await note().fill('Kompakte Notiz');await shot(`notiz-${width}-${theme}`);
  await note().fill(text(40));
  await panel.locator('.wv-panel-content').evaluate(el=>el.scrollTop=el.scrollHeight);
  await check(`Letzte Textzeile und Aktionen erreichbar ${width}`,async()=>{
   assert.ok(await fits());assert.ok(await visible(act('save')));
   const r=await note().boundingBox(),c=await panel.locator('.wv-panel-content').boundingBox();assert.ok(r.y+r.height<=c.y+c.height+2);
  });
  await discard();
 }
 await check('Keine Laufzeitfehler',async()=>assert.deepEqual(errors,[]));console.log('NOTE DONE');
};
