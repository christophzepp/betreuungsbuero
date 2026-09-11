'use strict';
const assert=require('node:assert/strict');
module.exports=async({page,root,act,panel,check,shot,errors})=>{
 const hit=async locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect(),n=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&!!n&&(n===el||el.contains(n))});
 // Do not allow Playwright's automatic scrolling to hide an unreachable close/save action.
 const clickVisible=async locator=>{assert.ok(await hit(locator),'Schaltfläche muss ohne automatisches Scrollen erreichbar sein');const r=await locator.boundingBox();if(await page.evaluate(()=>navigator.maxTouchPoints>0))await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);else await page.mouse.click(r.x+r.width/2,r.y+r.height/2)};
 const hidden=()=>page.locator('#modal').evaluate(el=>el.classList.contains('hidden'));
 const pageIs=async expected=>assert.equal(await root.getAttribute('data-page'),expected);
 const formClose=()=>panel.locator('.wv-panel-heading [data-action=close]');
 await page.evaluate(()=>{for(let n=0;n<25;n++)__qaDocs.push({id:'editor-'+n,name:'Weitere Unterlagen mit ausführlichen Informationen '+n+'.pdf',caseId:'a',createdAt:__qaDay(-n)})});
 for(const [width,height,theme] of [[1440,900,'light'],[1024,700,'light'],[390,844,'dark'],[320,568,'light'],[844,390,'dark']]){
  await page.setViewportSize({width,height});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t},theme);
  await page.evaluate(()=>__followupWorkspace.create());await panel.waitFor();await shot(`editor-before-${width}-${height}`);
  await check(`Schließen, Abbrechen und Speichern sofort erreichbar ${width}×${height}`,async()=>{for(const el of [formClose(),act('exit'),act('save'),act('close').last()])assert.ok(await hit(el),JSON.stringify(await el.evaluate(n=>({html:n.outerHTML,rect:n.getBoundingClientRect().toJSON(),hit:document.elementFromPoint(n.getBoundingClientRect().x+n.clientWidth/2,n.getBoundingClientRect().y+n.clientHeight/2)?.outerHTML.slice(0,500)}))))});
  await check(`Formular ohne horizontalen Überlauf ${width}×${height}`,async()=>{const excess=await root.evaluate(el=>[el,...el.querySelectorAll('.wv-panel,.wv-panel-content,#wv-editor,.wv-form-grid,input,select,textarea')].filter(n=>n.getClientRects().length&&n.scrollWidth>n.clientWidth+2).map(n=>({tag:n.tagName,cls:n.className,w:n.clientWidth,sw:n.scrollWidth})));assert.deepEqual(excess,[])});
  if(width>=1000){
   await check(`Originalauswahl und Eingaben nebeneinander ${width}`,async()=>{const sections=await panel.locator('.wv-form-section').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));assert.ok(Math.abs(sections[0].top-sections[1].top)<2);assert.ok(sections[1].left>=sections[0].right)});
   await check(`Komplettes Standardformular ohne vertikales Scrollen ${width}`,async()=>assert.ok(await panel.locator('.wv-panel-content').evaluate(el=>el.scrollHeight<=el.clientHeight+1)));
  }
  await shot(`editor-new-${width}-${height}-${theme}`);
  await clickVisible(formClose());await check(`Inneres X schließt das neue Formular ${width}`,()=>pageIs('list'));
  await act('new').click();await clickVisible(act('exit'));await check(`Äußeres X schließt das Menü ${width}`,async()=>assert.equal(await hidden(),true));
  await page.evaluate(()=>__followupWorkspace.create());await panel.getByLabel('Titel',{exact:true}).fill('Entwurf behalten');
  await panel.locator('.wv-panel-content').evaluate(el=>el.scrollTop=el.scrollHeight);
  await panel.getByLabel('Notiz',{exact:true}).fill('Notiz bleibt nach Abbrechen erhalten.');
  const beforeScroll=await panel.locator('.wv-panel-content').evaluate(el=>el.scrollTop);
  await clickVisible(formClose());
  await check(`Verwerfen-Rückfrage sichtbar und bedienbar ${width}`,async()=>{assert.ok(await hit(act('cancel-confirm')));assert.ok(await hit(act('discard')));assert.equal(await root.locator('[role=alertdialog]').count(),1);assert.equal(await act('cancel-confirm').evaluate(el=>el===document.activeElement),true)});
  await check(`Hintergrund bleibt während der Rückfrage gesperrt ${width}`,async()=>assert.equal(await panel.evaluate(el=>!!el.closest('[inert]')),true));
  await page.keyboard.press('Shift+Tab');assert.equal(await act('discard').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await act('cancel-confirm').evaluate(el=>el===document.activeElement),true);
  if(width===390)await shot('editor-discard-dark-mobile');
  await page.keyboard.press('Escape');
  await check(`Escape schließt nur die Rückfrage und erhält den Entwurf ${width}`,async()=>{await pageIs('form');assert.equal(await root.locator('[role=alertdialog]').count(),0);assert.equal(await panel.getByLabel('Titel',{exact:true}).inputValue(),'Entwurf behalten');assert.equal(await panel.getByLabel('Notiz',{exact:true}).inputValue(),'Notiz bleibt nach Abbrechen erhalten.');assert.equal(await panel.locator('.wv-panel-content').evaluate(el=>el.scrollTop),beforeScroll);assert.equal(await panel.evaluate(el=>el.contains(document.activeElement)),true)});
  await clickVisible(formClose());await clickVisible(act('cancel-confirm'));
  await check(`Weiter bearbeiten erhält die Eingaben ${width}`,async()=>{await pageIs('form');assert.equal(await panel.getByLabel('Titel',{exact:true}).inputValue(),'Entwurf behalten')});
  await clickVisible(formClose());await clickVisible(act('discard'));
  await check(`Verwerfen nach innerem X kehrt zur Liste zurück ${width}`,()=>pageIs('list'));
  await act('new').click();await panel.getByLabel('Titel',{exact:true}).fill('Verwerfen');await clickVisible(act('exit'));await clickVisible(act('discard'));
  await check(`Verwerfen nach äußerem X schließt das Menü ${width}`,async()=>assert.equal(await hidden(),true));
 }
 await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.colorScheme='light';return __followupWorkspace.open('todo:f1')});await act('edit').click();
 await check('Bearbeiten zeigt das verknüpfte Original und vorhandene Eingaben',async()=>{assert.match(await panel.locator('.wv-original').innerText(),/Bescheid zur Kostenübernahme/);assert.equal(await panel.getByLabel('Titel',{exact:true}).inputValue(),'Kostenübernahme erneut prüfen');assert.equal(await panel.getByLabel('Priorität',{exact:true}).inputValue(),'high');assert.equal(await panel.getByLabel('Notiz',{exact:true}).inputValue(),'Bescheid und Berechnung gemeinsam durchsehen.')});
 await shot('editor-existing-desktop');
 await clickVisible(formClose());await check('Inneres X schließt auch ein unverändertes Bearbeitungsformular',()=>pageIs('list'));
 await act('new').click();await clickVisible(act('save'));
 await check('Validierungsfehler ist sichtbar, Aktionen bleiben erreichbar',async()=>{await panel.locator('#wv-form-error').filter({hasText:'Dokument'}).waitFor();assert.ok(await hit(panel.locator('#wv-form-error')));assert.ok(await hit(act('save')))});
 await panel.getByLabel('Fall',{exact:true}).selectOption('a');await panel.locator('.wv-source-option').filter({hasText:'Ausgabenübersicht.pdf'}).click();await panel.getByLabel('Titel',{exact:true}).fill('Ausgaben gemeinsam prüfen');await clickVisible(act('save'));await act('edit').waitFor();
 await check('Feste Speichern-Aktion legt Wiedervorlage mit Original an',async()=>{const todo=await page.evaluate(()=>__qaTodos.find(t=>t.title==='Wiedervorlage: Ausgaben gemeinsam prüfen'));assert.equal(todo.sourceId,'doc3');assert.equal(todo.caseId,'a');assert.equal(todo.itemType,'followup')});
 await act('postpone').click();await panel.locator('[data-days="7"]').click();await clickVisible(formClose());await clickVisible(act('cancel-confirm'));
 await check('Verschieben verwendet dieselbe sichtbare Rückfrage ohne Datenverlust',async()=>{await pageIs('postpone');assert.ok(await hit(act('save-postpone')))});await clickVisible(act('save-postpone'));await act('edit').waitFor();
 await check('Keine Laufzeitfehler im Editor',async()=>assert.deepEqual(errors,[]));console.log('EDITOR DONE');
};
