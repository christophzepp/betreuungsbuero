'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({page,root,act,panel,check,shot,errors,seed})=>{
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{document.getElementById('startPage').classList.remove('no-case');document.getElementById('startSidebar').hidden=false;__soloEnhanceNav()});
 const menu=page.locator('[data-wiedervorlagen-menu]:visible').first(),quick=menu.locator('summary [role=button]');
 await check('Drei Schnellaktionen in allen Wiedervorlagen-Menüs, in derselben Reihenfolge',async()=>{
  const menus=await page.locator('[data-wiedervorlagen-menu]').evaluateAll(ms=>ms.map(m=>[...m.querySelectorAll('summary [role=button]')].map(b=>b.title)));
  assert.ok(menus.length>=2);for(const titles of menus)assert.deepEqual(titles,['Im aktuellen Fenster öffnen','In neuem Fenster öffnen','Neue Wiedervorlage anlegen']);
 });
 await check('Gleiche Symbolgröße, Öffnen- und Plus-Icons wie bei Fristen',async()=>{
  const data=await menu.evaluate(m=>{const fr=m.previousElementSibling,buttons=m.querySelectorAll('summary [role=button]'),refs=fr.querySelectorAll('summary [role=button]');return {first:buttons[0].innerHTML,firstRef:refs[0].innerHTML,plus:buttons[2].innerHTML,plusRef:refs[2].innerHTML,sizes:[...buttons].map(b=>{const r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return [r.width,r.height,s.width,s.height]}),refSizes:[...refs].map(b=>{const r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return [r.width,r.height,s.width,s.height]})}});
  assert.equal(data.first,data.firstRef);assert.equal(data.plus,data.plusRef);assert.deepEqual(data.sizes,data.refSizes);
 });
 const isExpanded=await menu.evaluate(el=>el.open);
 await quick.nth(0).click();await root.waitFor();
 await check('Erste Aktion öffnet die Wiedervorlagen im aktuellen Fenster',async()=>{assert.equal(await root.getAttribute('data-page'),'list');assert.equal(await menu.evaluate(el=>el.open),isExpanded)});await act('exit').click();
 await quick.nth(2).click();await panel.waitFor();
 await check('Dritte Aktion öffnet direkt das Anlegen',async()=>{assert.equal(await root.getAttribute('data-page'),'form');assert.equal(await menu.evaluate(el=>el.open),isExpanded)});await act('exit').click();
 await quick.nth(0).focus();await page.keyboard.press('Enter');await root.waitFor();await check('Öffnen funktioniert über die Tastatur',async()=>assert.equal(await root.getAttribute('data-page'),'list'));await act('exit').click();
 await quick.nth(2).focus();await page.keyboard.press('Space');await panel.waitFor();await check('Plus funktioniert über die Leertaste ohne Aufklappen der Vorschau',async()=>{assert.equal(await root.getAttribute('data-page'),'form');assert.equal(await menu.evaluate(el=>el.open),isExpanded)});await act('exit').click();
 // The actual new-window action must load the module, rather than merely open a URL.
 const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'));
 await page.context().route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='wv-qa.invalid'&&u.pathname==='/'?route.fulfill({contentType:'text/html',body:html}):route.abort()});
 await page.context().addInitScript(()=>{window.__onlineInitialCaseNativeFetch=async()=>new Response('{}',{headers:{'Content-Type':'application/json'}})});
 const popupEvent=page.waitForEvent('popup');await quick.nth(1).click();const popup=await popupEvent;popup.on('pageerror',e=>errors.push('Eigenes Fenster: '+e.message));
 try{
  await popup.waitForLoadState('domcontentloaded');await popup.evaluate(seed);await popup.evaluate(()=>{window.__modeIntro.merken('online',true);window.dispatchEvent(new CustomEvent('appLoginReady',{detail:{mode:'online'}}))});
  await popup.locator('#wiedervorlagenWorkspace').waitFor({timeout:20000});await popup.waitForFunction(()=>document.querySelector('#wiedervorlagenWorkspace .wv-row'));
  if(await popup.locator('#modeIntroNext').isVisible())await popup.locator('#modeIntroNext').click();
  await check('Zweite Aktion öffnet das echte Wiedervorlagen-Menü im eigenen Fenster',async()=>{assert.equal(new URL(popup.url()).hash,'#solo=wiedervorlagen~a');assert.equal(await popup.locator('#wiedervorlagenWorkspace').getAttribute('data-page'),'list');assert.ok(await popup.locator('#wiedervorlagenWorkspace .wv-row').count());assert.equal(await root.isVisible(),false);assert.equal(await menu.evaluate(el=>el.open),isExpanded)});
  await check('Eigenes Fenster zeigt keine wirkungslose Menü-Schließen-Aktion',async()=>assert.equal(await popup.locator('#wiedervorlagenWorkspace [data-action=exit]').isVisible(),false));
  await popup.locator('#wiedervorlagenWorkspace [data-action=new]').click();await check('Neue Wiedervorlage ist auch im eigenen Fenster erreichbar',async()=>assert.equal(await popup.locator('#wiedervorlagenWorkspace').getAttribute('data-page'),'form'));
  await popup.locator('.wv-panel-heading [data-action=close]').click();await check('Inneres X kehrt im eigenen Fenster zur Liste zurück',async()=>assert.equal(await popup.locator('#wiedervorlagenWorkspace').getAttribute('data-page'),'list'));
 }finally{await popup.close()}
 await page.evaluate(()=>{__soloEnhanceNav();__soloEnhanceNav();__soloEnhanceNav()});
 await check('Erneutes Aktualisieren erzeugt keine doppelten Schnellaktionen',async()=>assert.equal(await quick.count(),3));
 await page.evaluate(()=>{
  __qaTodos.find(t=>t.id==='f1').title='Wiedervorlage: Eingangsbestätigung des Jobcenters zu den ergänzenden Unterlagen prüfen';
  __qaTodos.find(t=>t.id==='f2').caseLabel='Auerbach-Mustermann, Margarete mit einem ausführlichen Fallnamen';
  __qaTodos.push({id:'mini-extra',itemType:'followup',title:'Wiedervorlage: Rückmeldung der Pflegekasse',caseId:'a',caseLabel:'Hoffmann, Mara',sourceType:'note',sourceId:'mini-original',dueAt:__qaDay(7),priority:'normal',done:false});
  return __followupWorkspace.refresh();
 });
 await menu.evaluate(el=>el.open=true);await menu.locator('[data-wv-entry="todo:mini-extra"]').waitFor();
 await check('Vorschau zeigt fünf offene Einträge chronologisch, undatierte zuletzt',async()=>assert.deepEqual(await menu.locator('[data-wv-entry]').evaluateAll(es=>es.map(el=>el.dataset.wvEntry)),['todo:f1','todo:f2','mail:s1','todo:mini-extra','todo:nodate']));
 await check('Offene und überfällige Einträge sind wie bei Aufgaben zusammengefasst',async()=>assert.equal((await menu.locator('.todomini-summary').innerText()).replace(/\s+/g,' '),'1 überfällig 5 offen'));
 for(const [width,height,theme] of [[1440,1000,'light'],[1024,800,'dark'],[390,844,'light']]){
  await page.setViewportSize({width,height});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t},theme);
  if(width<700)await page.evaluate(()=>{document.body.classList.add('sb-open')});
  await menu.scrollIntoViewIfNeeded();
  await check(`Titel, Fall und Datum sind ruhig ausgerichtet ${width} ${theme}`,async()=>{
   const rows=await menu.locator('[data-wv-entry]').evaluateAll(es=>es.map(el=>{const box=n=>n.getBoundingClientRect().toJSON();return {row:box(el),title:box(el.querySelector('.todomini-title')),date:box(el.querySelector('.todomini-due')),case:box(el.querySelector('.case-ref-line')),overflow:el.scrollWidth>el.clientWidth+1}}));
   for(const r of rows){assert.equal(r.overflow,false);assert.ok(Math.abs(r.title.top-r.date.top)<2);assert.ok(r.title.right<=r.date.left);assert.ok(r.case.top>=r.title.bottom);assert.ok(Math.abs(r.case.left-r.title.left)<2);assert.ok(Math.abs(r.row.height-rows[0].row.height)<2)}
   assert.ok(await menu.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  });
  await shot(`wiedervorlagen-vorschau-${width}-${theme}`);
 }
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.colorScheme='light'});
 await check('Abgekürzte Texte bleiben im Tooltip und zugänglichen Namen vollständig',async()=>{const row=menu.locator('[data-wv-entry="todo:f2"]');assert.match(await row.getAttribute('title'),/Auerbach-Mustermann, Margarete mit einem ausführlichen Fallnamen/);assert.equal(await row.getAttribute('title'),await row.getAttribute('aria-label'))});
 const first=menu.locator('[data-wv-entry="todo:f1"]');await first.scrollIntoViewIfNeeded();const box=await first.boundingBox();await first.click({position:{x:box.width/2,y:box.height-3}});await act('edit').waitFor();
 await check('Auch der freie Bereich einer Vorschauzeile öffnet den richtigen Eintrag',async()=>assert.match(await panel.innerText(),/Eingangsbestätigung des Jobcenters/));await act('exit').click();
 await menu.locator('[data-wv-entry="todo:f2"]').focus();await page.keyboard.press('Enter');await act('edit').waitFor();
 await check('Vorschauzeilen öffnen sich mit der Tastatur',async()=>assert.match(await panel.innerText(),/Arztbrief besprechen/));await act('exit').click();
 await menu.locator('[data-wv-open]').click();await root.waitFor();await check('Vollständige Wiedervorlagen bleiben unterhalb der Vorschau erreichbar',async()=>assert.equal(await root.getAttribute('data-page'),'list'));await act('exit').click();
 await check('Keine Laufzeitfehler bei den Schnellaktionen',async()=>assert.deepEqual(errors,[]));console.log('NAV DONE');
};
