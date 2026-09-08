'use strict';
// Real shipped app, synthetic profiles/cases and intercepted APIs. No external writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=process.env.MOBILE_QA_OUTPUT||'/tmp/mobile-menu-qa';fs.mkdirSync(output,{recursive:true});
let fixture=fs.readFileSync(path.join(__dirname,'qa-mobile-completion.cjs'),'utf8').split('(async()=>{const{browser,page}=await setup()')[0];
fixture=fixture.replace("await page.goto('http://completion.invalid/'",`await page.addInitScript(prefs=>{if(prefs.local)localStorage.setItem('betreuungsbuero.mobile-navigation.v1',JSON.stringify(prefs.local));window.__qaNavigationPrefs=prefs.server},navFixture);await page.goto('http://completion.invalid/'`);
fixture=fixture.replace("if(u==='/api/persons')", "if(u==='/api/user-prefs/mobile-navigation')r={prefs:window.__qaNavigationPrefs};else if(u==='/api/persons')");
const legacy={order:['start','case-chat','master-data','case-overview','documentation','calendar','tasks','mail'],pinned:['case-chat','case-overview','documentation','mail']};
const custom={order:['mail','calendar','start','case-chat','tasks'],pinned:['mail','start','case-chat','tasks','calendar']};
const checks=[],errors=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};
(async()=>{
const scenarios=[['neu',{},['case-overview','documentation','mail']],['lokales-altprofil',{local:custom},['mail','tasks','calendar']],['server-altprofil',{local:custom,server:legacy},['case-overview','documentation','mail']]];
for(const [name,navFixture,expected] of scenarios){
 const setup=new Function('require','__dirname','navFixture',fixture+';return setup;')(require,__dirname,navFixture);
 const {browser,page}=await setup();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 const nav=page.locator('#mobileOnlineShell'),sheet=page.locator('#mobileOnlineSheet');
 const favorites=()=>nav.locator('.mobile-nav-favorites [data-mobile-action]:not([data-mobile-action="start"])').evaluateAll(es=>es.map(e=>e.dataset.mobileAction));
 const openEditor=async()=>{await nav.locator('[data-mobile-more]').click();await sheet.locator('[data-mobile-edit-navigation]').click()};
 const shot=async name=>{await page.waitForTimeout(160);await page.screenshot({path:path.join(output,name+'.png')})};
 try{
  await page.waitForTimeout(120);
  check(name+': Start und Chats genau einmal in der sortierten Leiste',await nav.locator('[data-mobile-action="start"]').count()===1&&await nav.locator('[data-mobile-chats]').count()===1);
  if(navFixture.server?.navOrder)check('Gespeicherte Reihenfolge wird unverändert vom Server geladen',await nav.locator('.mobile-nav-favorites button').evaluateAll(es=>es.map(e=>e.dataset.mobileAction||'chats')).then(ids=>JSON.stringify(ids)===JSON.stringify(navFixture.server.navOrder)));
  check(name+': Persönliche Favoriten bleiben in Reihenfolge erhalten',JSON.stringify(await favorites())===JSON.stringify(expected));
  await nav.locator('[data-mobile-more]').click();
  check(name+': Kein veralteter KI-Chat im Mehr-Menü',await sheet.locator('[data-mobile-action="case-chat"]').count()===0&&await sheet.locator('.mobile-more-item').count()===31);
  await sheet.locator('[data-mobile-edit-navigation]').click();
  check(name+': Editor ohne alten Chat und mit angeheftetem Start',await sheet.locator('[data-editor-id="case-chat"]').count()===0&&await sheet.locator('[data-editor-id="start"] .mobile-pin-toggle').isDisabled());
  check(name+': Start und Chats sind reguläre sortierbare Vorschau-Buttons',await sheet.locator('[data-preview-id="start"]').isEnabled()&&await sheet.locator('[data-preview-id="chats"]').isEnabled()&&await sheet.locator('.mobile-nav-preview .is-static').allTextContents().then(text=>text.join(',')==='Mehr'));
  await sheet.locator('[data-mobile-editor-cancel]').click();await sheet.locator('[data-mobile-sheet-close]').click();
  check(name+': Abbrechen erhält die Favoriten',JSON.stringify(await favorites())===JSON.stringify(expected));
  if(name!=='server-altprofil')continue;
  await nav.locator('[data-mobile-action="start"]').click();
  await shot('start-mit-navigation');
  check('Start öffnet Tagesüberblick und markiert den richtigen Tab',await page.locator('#startPage').isVisible()&&await nav.locator('[data-mobile-action="start"]').getAttribute('aria-current')==='page');
  await nav.locator('[data-mobile-more]').click();await shot('schnellbereiche');await sheet.locator('[data-mobile-edit-navigation]').click();await shot('menue-anpassen');
  for(const id of expected)await sheet.locator('[data-editor-id="'+id+'"] .mobile-pin-toggle').click();
  await sheet.locator('[data-mobile-editor-save]').click();await sheet.locator('[data-mobile-sheet-close]').click();
  check('Auch ohne Favoriten bleiben drei feste Zugänge',await nav.locator('.mobile-nav-action').count()===3&&await favorites().then(f=>f.length===0));
  await openEditor();
  const eight=['calendar','tasks','documentation','mail','case-overview','contacts','deadlines','master-data'];
  for(const id of eight)await sheet.locator('[data-editor-id="'+id+'"] .mobile-pin-toggle').click();
  await sheet.locator('[data-editor-id="banking"] .mobile-pin-toggle').click();
  check('Start belegt keinen der acht Favoritenplätze',await sheet.locator('[data-preview-id]').count()===10&&await sheet.locator('[data-editor-id="banking"] .mobile-pin-toggle').getAttribute('aria-pressed')==='false');
  await sheet.locator('[data-mobile-editor-save]').click();await sheet.locator('[data-mobile-sheet-close]').click();
  check('Server-Payload enthält genau die acht Favoriten ohne Start oder alten Chat',await page.evaluate(ids=>{const r=__qaRequests.findLast(r=>r.u==='/api/user-prefs/mobile-navigation'&&r.method==='PUT');return JSON.stringify(JSON.parse(r.body).prefs.pinned)===JSON.stringify(ids)&&!JSON.parse(r.body).prefs.order.includes('case-chat')},eight));
  for(const width of [320,390,570])for(const dark of [false,true]){
   await page.setViewportSize({width,height:844});await page.evaluate(d=>document.documentElement.dataset.theme=d?'dark':'light',dark);await page.waitForTimeout(100);
   const rail=nav.locator('.mobile-nav-favorites');await rail.evaluate(e=>e.scrollLeft=e.scrollWidth);
   check('Mehr bleibt sichtbar, die sortierte Leiste ohne Seitenüberlauf bei '+width+' / '+(dark?'dunkel':'hell'),await nav.evaluate(e=>{const r=e.querySelector('[data-mobile-more]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.width>=44&&document.documentElement.scrollWidth<=innerWidth+1}));
   for(const button of await rail.locator('button').all()){await button.scrollIntoViewIfNeeded();check('Favorit '+await button.getAttribute('data-mobile-action')+' erreichbar bei '+width+' / '+dark,await button.evaluate(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1&&r.width>=44}))}
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await openEditor();for(const id of eight.filter(id=>!expected.includes(id)))await sheet.locator('[data-editor-id="'+id+'"] .mobile-pin-toggle').click();
  const previewIds=()=>sheet.locator('[data-preview-id]').evaluateAll(es=>es.map(e=>e.dataset.previewId));
  const startBefore=await previewIds();await sheet.locator('[data-preview-id="start"]').press(startBefore.indexOf('start')===0?'ArrowRight':'ArrowLeft');
  check('Start lässt sich mit Pfeiltasten verschieben',JSON.stringify(await previewIds())!==JSON.stringify(startBefore));
  for(const id of ['chats','start']){
   const before=await previewIds(),target=before.filter(v=>v!==id).at(-1);const source=sheet.locator('[data-preview-id="'+id+'"]'),dest=sheet.locator('[data-preview-id="'+target+'"]');await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await dest.boundingBox();
   await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width-4,b.y+b.height/2,{steps:18});await page.mouse.up();await page.waitForTimeout(300);
   const wanted=before.filter(v=>v!==id);wanted.splice(wanted.indexOf(target)+1,0,id);check(id+' lässt sich per Ziehen zwischen die anderen Buttons sortieren',JSON.stringify(await previewIds())===JSON.stringify(wanted));
  }
  await shot('menue-sortiert');await sheet.locator('[data-mobile-editor-save]').click();await sheet.locator('[data-mobile-sheet-close]').click();
  const saved=await page.evaluate(()=>JSON.parse(__qaRequests.findLast(r=>r.u==='/api/user-prefs/mobile-navigation'&&r.method==='PUT').body).prefs);check('Sortierung wird lokal und serverseitig gespeichert',await page.evaluate(p=>JSON.stringify(JSON.parse(localStorage.getItem('betreuungsbuero.mobile-navigation.v1')).navOrder)===JSON.stringify(p.navOrder),saved));
  scenarios.push(['sortierung-wieder-geladen',{server:saved},saved.pinned]);await shot('navigation-sortiert');
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';window.__userChat={getState:()=>({available:true,unread:3,unreadConversations:2,open:false}),close:()=>{},open:()=>window.__qaTeamOpened=true};dispatchEvent(new Event('userChatStateChanged'));const c=ensureAIConfig();c.provider='openai';c.apiKey='fixture-no-network';aiProviderKeyConfigured=()=>true});
  await nav.locator('[data-mobile-chats]').click();
  check('Chats bietet beide Gesprächsarten und den Mitarbeiter-Badge',await sheet.locator('[data-mobile-team-chat]').isEnabled()&&await sheet.locator('[data-mobile-case-chat]').isVisible()&&await nav.locator('[data-mobile-chat-badge]').innerText()==='3');
  await shot('chats');await sheet.locator('[data-mobile-team-chat]').click();check('Mitarbeiterchat bleibt über Chats erreichbar',await page.evaluate(()=>__qaTeamOpened===true));
  await nav.locator('[data-mobile-chats]').click();await sheet.locator('[data-mobile-case-chat]').click();await page.locator('[data-mobile-chat-layer]').waitFor();
  check('KI-Fallchat öffnet aus Chats mit bestehendem Rückweg',await page.locator('.cc2').isVisible());await page.evaluate(()=>__mobileUI.returnFromCaseChat());
  await page.evaluate(()=>openTodoFullView());await page.locator('.todo-mobile-pilot').waitFor();await page.evaluate(()=>__todoShowNewForm());await page.locator('#todoNewTitle').fill('Ungespeicherter Aufgabenentwurf');
  await nav.locator('[data-mobile-action="start"]').click();await sheet.getByRole('button',{name:'Weiter bearbeiten',exact:true}).click();
  check('Start-Zugang schützt ungespeicherte Formulare',await page.locator('#todoNewTitle').inputValue()==='Ungespeicherter Aufgabenentwurf');
  await page.locator('.todo-mobile-pilot').getByRole('button',{name:'Abbrechen',exact:true}).click();await sheet.getByRole('button',{name:'Änderungen verwerfen',exact:true}).click();await nav.locator('[data-mobile-action="start"]').click();
  await page.setViewportSize({width:1366,height:900});await page.waitForTimeout(120);check('Desktop blendet die mobile Navigation weiterhin aus',!await nav.isVisible());
 }finally{await browser.close()}
}
check('Keine JavaScript-Laufzeitfehler',errors.length===0);
fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
