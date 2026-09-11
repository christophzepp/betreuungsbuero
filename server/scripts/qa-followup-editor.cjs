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
   await check(`Formular nutzt Breite und Höhe bis zu den festen Aktionen ${width}`,async()=>{
    const content=await panel.locator('.wv-panel-content').boundingBox(),form=await panel.locator('#wv-editor').boundingBox(),choices=await panel.locator('.wv-source-choices').boundingBox(),note=await panel.getByLabel('Notiz',{exact:true}).boundingBox();
    assert.ok(form.x-content.x<=32&&content.x+content.width-form.x-form.width<=48);
    assert.ok(Math.abs(choices.y+choices.height-note.y-note.height)<=2);
    assert.ok(content.y+content.height-note.y-note.height<=28);
   });
   await check(`Originalnamen und Herkunft bleiben innerhalb ihrer Einträge ${width}`,async()=>{
    const clipped=await panel.locator('.wv-source-option').evaluateAll(es=>es.filter(el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll('strong,small')].some(n=>{const b=n.getBoundingClientRect();return b.top<r.top||b.bottom>r.bottom})}).map(el=>el.textContent));assert.deepEqual(clipped,[]);
   });
   await check(`Komplettes Standardformular ohne vertikales Scrollen ${width}`,async()=>{const sizes=await panel.locator('.wv-panel-content').evaluate(el=>[el,...el.querySelectorAll('#wv-editor,.wv-form-section,.wv-source-choices,.wv-note-field,textarea')].map(n=>({cls:n.className,h:n.clientHeight,sh:n.scrollHeight,rect:n.getBoundingClientRect().toJSON(),flex:getComputedStyle(n).flex,min:getComputedStyle(n).minHeight})));assert.ok(sizes[0].sh<=sizes[0].h+1,JSON.stringify(sizes))});
  }
  if(width===1440){
   await check('Größere Fenster zeigen mehr Originale und mehr Platz für Notizen',async()=>{
    const before=await panel.locator('.wv-source-choices').boundingBox(),noteBefore=await panel.getByLabel('Notiz',{exact:true}).boundingBox();
    await page.setViewportSize({width,height:1000});
    const after=await panel.locator('.wv-source-choices').boundingBox(),noteAfter=await panel.getByLabel('Notiz',{exact:true}).boundingBox();
    assert.ok(after.height-before.height>=70&&noteAfter.height-noteBefore.height>=70);
    await page.setViewportSize({width,height});
   });
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
 for(const [width,height,theme] of [[1440,900,'light'],[1024,700,'dark'],[390,844,'dark'],[320,568,'light']]){
  await page.setViewportSize({width,height});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t},theme);
  await check(`Bearbeitungsformular bleibt lesbar und bedienbar ${width}`,async()=>{assert.ok(await hit(formClose()));assert.ok(await hit(act('save')));assert.ok(await panel.locator('.wv-panel-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1))});
  if(width>=1000)await check(`Bearbeiten ordnet Kontext kompakt über den Eingaben an ${width}`,async()=>{
   const context=await panel.locator('.wv-source-section').boundingBox(),settings=await panel.locator('.wv-settings-section').boundingBox(),title=await panel.getByLabel('Titel',{exact:true}).boundingBox(),date=await panel.getByLabel('Wiedervorlage am',{exact:true}).boundingBox(),note=await panel.getByLabel('Notiz',{exact:true}).boundingBox(),content=await panel.locator('.wv-panel-content').boundingBox();
   assert.ok(context.y+context.height<=settings.y&&settings.y-context.y-context.height<=24);
   assert.ok(Math.abs(title.y-date.y)<2&&title.x+title.width<=date.x);
   assert.ok(note.width>=settings.width-2&&note.y+note.height<=content.y+content.height);
   assert.ok(await panel.locator('.wv-panel-content').evaluate(el=>el.scrollHeight<=el.clientHeight+1));
  });
  await shot(`editor-existing-${width}-${height}-${theme}`);
 }
 await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.colorScheme='light'});
 await clickVisible(formClose());await check('Inneres X schließt auch ein unverändertes Bearbeitungsformular',()=>pageIs('list'));
 await act('new').click();await clickVisible(act('save'));
 await check('Validierungsfehler ist sichtbar, Aktionen bleiben erreichbar',async()=>{await panel.locator('#wv-form-error').filter({hasText:'Dokument'}).waitFor();assert.ok(await hit(panel.locator('#wv-form-error')));assert.ok(await hit(act('save')))});
 await panel.getByLabel('Fall',{exact:true}).selectOption('a');await panel.locator('.wv-source-option').filter({hasText:'Ausgabenübersicht.pdf'}).click();await panel.getByLabel('Titel',{exact:true}).fill('Ausgaben gemeinsam prüfen');await clickVisible(act('save'));await act('edit').waitFor();
 await check('Feste Speichern-Aktion legt Wiedervorlage mit Original an',async()=>{const todo=await page.evaluate(()=>__qaTodos.find(t=>t.title==='Wiedervorlage: Ausgaben gemeinsam prüfen'));assert.equal(todo.sourceId,'doc3');assert.equal(todo.caseId,'a');assert.equal(todo.itemType,'followup')});
 await act('postpone').click();await panel.locator('[data-days="7"]').click();await clickVisible(formClose());await clickVisible(act('cancel-confirm'));
 await check('Verschieben verwendet dieselbe sichtbare Rückfrage ohne Datenverlust',async()=>{await pageIs('postpone');assert.ok(await hit(act('save-postpone')))});await clickVisible(act('save-postpone'));await act('edit').waitFor();
 await check('Keine Laufzeitfehler im Editor',async()=>assert.deepEqual(errors,[]));console.log('EDITOR DONE');
};
