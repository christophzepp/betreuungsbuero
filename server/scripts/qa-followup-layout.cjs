'use strict';
const assert=require('node:assert/strict');
module.exports=async({page,root,act,panel,check,shot,errors})=>{
 await page.evaluate(()=>{
  for(let n=0;n<35;n++)__qaTodos.push({id:'scroll-'+n,itemType:'followup',title:'Wiedervorlage: Weitere Unterlagen gemeinsam auswerten '+n,description:'Gespräch mit ausführlicher Dokumentation vorbereiten.',caseId:'a',sourceType:'note',sourceId:'source-'+n,dueAt:__qaDay(3),priority:'normal',done:false});
  for(let n=0;n<30;n++)__qaDocs.push({id:'pick-'+n,name:'Dokument '+n+' mit ergänzenden Angaben.pdf',caseId:'a',createdAt:__qaDay(-n)});
 });
 const diag=process.env.FOLLOWUP_LAYOUT_DIAG==='1',results=[];
 const verify=async(name,fn)=>{try{await check(name,fn)}catch(e){if(!diag)throw e;console.log('FAIL '+name+': '+e.message);results.push(name)}};
 const metrics=async selector=>root.locator(selector).last().evaluate(el=>({h:el.clientHeight,sh:el.scrollHeight,top:el.scrollTop,rect:el.getBoundingClientRect().toJSON()}));
 // Unlike Playwright's click auto-scroll, scrolling the intended content pane must reach the final row/action itself.
 const reachable=async(scroll,selector)=>{
  await scroll.evaluate(el=>el.scrollTo({top:el.scrollHeight,behavior:'instant'}));await page.waitForTimeout(120);
  return root.locator(selector).last().evaluate(el=>{const r=el.getBoundingClientRect(),layout=el.closest('.wv-layout').getBoundingClientRect(),hit=document.elementFromPoint(Math.min(r.right-2,r.x+r.width/2),r.y+r.height/2);return r.top>=layout.top&&r.bottom<=layout.bottom+1&&!!hit&&(el===hit||el.contains(hit))});
 };
 for(const [width,height] of [[320,568],[390,420],[390,844],[600,700],[844,390],[1024,600],[1440,900]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>__followupWorkspace.open());await act('close').first().count().then(async n=>{if(n)await act('close').first().click()});
  await verify(`Liste per Scrollen bis zum letzten Eintrag ${width}×${height}`,async()=>assert.ok(await reachable(root.locator('.wv-list'),'.wv-row:last-child [data-open]:last-child')));
  if(diag)console.log('SCROLL '+width+' '+JSON.stringify(await metrics('.wv-list')));
  await page.evaluate(()=>__followupWorkspace.open('todo:f1'));
  await verify(`Detailaktionen per Scrollen erreichbar ${width}×${height}`,async()=>assert.ok(await reachable(panel,'[data-action=more]')));
  if(!diag){await act('edit').click();}else await act('edit').evaluate(el=>el.click());
  await verify(`Formular beginnt bei Fall und Original ${width}×${height}`,async()=>assert.equal(Math.round((await metrics('.wv-panel')).top),0));
  await verify(`Speichern bei gescrollten Formularfeldern erreichbar ${width}×${height}`,async()=>assert.ok(await reachable(panel.locator('.wv-panel-content'),'[data-action=save]')));
  await verify(`Notizfeld bleibt vollständig im erreichbaren Formularbereich ${width}×${height}`,async()=>{
   const field=await panel.locator('textarea[data-draft=note]').boundingBox(),content=await panel.locator('.wv-panel-content').boundingBox();
   assert.ok(field.height>=88&&field.y+field.height<=content.y+content.height+1);
   if(width<800)assert.ok(field.height<=180);
  });
  await shot('form-bottom-'+width+'-'+height);
  if(diag)await act('close').first().evaluate(el=>el.click());else await act('close').first().click();
  await act('filter').click();
  await verify(`Filter anwenden per Scrollen erreichbar ${width}×${height}`,async()=>assert.ok(await reachable(panel,'[data-action=apply-filter]')));
  await act('apply-filter').evaluate(el=>el.click());
 }
 await page.setViewportSize({width:1024,height:700});await act('new').click();
 await panel.locator('.wv-source-option').last().click();
 await verify('Ausgewähltes Original bleibt sichtbar und fokussiert',async()=>assert.equal(await panel.locator('.wv-source-option[aria-pressed=true]').evaluate(el=>document.activeElement===el),true));
 await verify('Große Originalauswahl scrollt innerhalb des Formularbereichs',async()=>assert.ok(await panel.locator('.wv-source-choices').evaluate(el=>{const r=el.getBoundingClientRect(),content=el.closest('.wv-panel-content').getBoundingClientRect();return el.scrollHeight>el.clientHeight&&r.top>=content.top&&r.bottom<=content.bottom})));
 await panel.locator('.wv-source-option').first().focus();await page.keyboard.press('Enter');
 await verify('Originalauswahl bleibt mit der Tastatur bedienbar',async()=>assert.equal(await panel.locator('.wv-source-option').first().evaluate(el=>document.activeElement===el&&el.getAttribute('aria-pressed')==='true'),true));
 await shot('source-selected');
 await act('close').first().evaluate(el=>el.click());await act('discard').evaluate(el=>el.click());
 await page.evaluate(()=>{const label='SehrLangerFallnameOhneTrennzeichen'.repeat(5),seed=async()=>{__onlineCaseCache.set('b',{label,data:{stammdaten:{person:{firstName:'Jonas',lastName:'Weber'},fristen:[]}}})};window.__onlineCaseSync={preloadCache:seed};window.__onlinePreloadCases=seed;seed();__qaTodos.find(x=>x.id==='f2').caseLabel=label;__qaDocs.find(x=>x.id==='doc2').pfad='Dateiverzeichnis/'.repeat(30)});
 for(const width of [320,768,1024]){
  await page.setViewportSize({width,height:700});await page.evaluate(()=>{document.documentElement.dataset.theme='dark';return __followupWorkspace.open()});if(await act('close').count())await act('close').first().click();await act('filter').click();await panel.getByLabel('Fall',{exact:true}).selectOption('b');await act('apply-filter').click();
  await verify(`Lange Fallnamen ohne Überlauf ${width}`,async()=>{const excess=await root.evaluate(el=>[...el.querySelectorAll('.wv-footer,.wv-chip,.wv-row,.wv-layout')].filter(n=>n.getClientRects().length&&n.scrollWidth>n.clientWidth+1).map(n=>({cls:n.className,w:n.clientWidth,sw:n.scrollWidth})));assert.deepEqual(excess,[])});
  await shot('long-case-'+width);
  await page.evaluate(()=>__followupWorkspace.open('todo:f2'));
  await verify(`Langtext-Test zeigt den echten Dateipfad ${width}`,async()=>assert.match(await panel.locator('.wv-original small').textContent(),/Dateiverzeichnis/));
  await verify(`Lange Dateipfade bleiben in den Details ${width}`,async()=>{assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1))});await shot('long-detail-'+width);
  await act('close').first().click();
 }
 await verify('Keine Laufzeitfehler im Layoutaudit',async()=>assert.deepEqual(errors,[]));console.log('LAYOUT DONE '+JSON.stringify(results));
};
