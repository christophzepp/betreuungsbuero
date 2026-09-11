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
 await menu.scrollIntoViewIfNeeded();await shot('wiedervorlagen-schnellaktionen');
 await check('Keine Laufzeitfehler bei den Schnellaktionen',async()=>assert.deepEqual(errors,[]));console.log('NAV DONE');
};
