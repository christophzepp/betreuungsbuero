'use strict';
// User regressions, 08.09.2026: real app, synthetic cases/mail, no external writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixture=fs.readFileSync(path.join(__dirname,'qa-mobile-completion.cjs'),'utf8');
const setup=new Function('require','__dirname',fixture.split('(async()=>{const{browser,page}=await setup()')[0]+';return setup;')(require,__dirname);
const output=process.env.MOBILE_QA_OUTPUT||'/tmp/mobile-workflow-fixes';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const {browser,page}=await setup(),checks=[],errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};
 const shot=async name=>{await page.waitForTimeout(180);await page.screenshot({path:path.join(output,name+'.png'),...(name.includes('tastatur')?{clip:{x:0,y:0,width:390,height:520}}:{})})};
 try{
  await page.evaluate(()=>openCaseOverview());await page.getByRole('button',{name:'Wiedervorlagen',exact:true}).waitFor();
  for(const route of ['header','navigation']){
   await page.getByRole('button',{name:'Wiedervorlagen',exact:true}).click();await page.locator('.follow-mobile-view').waitFor();await shot('wiedervorlagen');
   await page.locator(route==='header'?'.follow-mobile-view button[aria-label="Zurück"]':'#mobileOnlineShell [data-mobile-action="case-overview"]').click();await page.getByRole('button',{name:'Verlauf',exact:true}).waitFor();
   check('Wiedervorlagen → Übersicht über '+route,await page.getByRole('button',{name:'Verlauf',exact:true}).waitFor({state:'visible'}).then(()=>true));
  }
  const mail=fs.readFileSync(path.join(__dirname,'qa-mobile-mail.cjs'),'utf8');const start=mail.indexOf(' await page.evaluate(()=>{\n  window.__qaDrafts=[]'),end=mail.indexOf(" await check('Mobile Postfachliste");assert.ok(start>0&&end>start);
  await new Function('page','return (async()=>{'+mail.slice(start,end)+'})();')(page);
  await page.evaluate(()=>{__qaMailMessages[0].text='Lange Nachricht\n'+('Alle Unterlagen bitte prüfen.\n'.repeat(90));window.__aiVoiceSupported=()=>true});
  await page.locator('.mx-msg[data-uid="1"]').click();await page.getByRole('button',{name:'KI-Assistent',exact:true}).waitFor();
  const body=page.locator('.mx-mobile-view>.mobile-ui-body');
  check('KI-Zugang ohne Scrollen über der Navigation',await page.getByRole('button',{name:'KI-Assistent',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>0&&r.bottom<=innerHeight&&r.bottom<=document.getElementById('mobileOnlineShell').getBoundingClientRect().top+1}));
  await shot('mail-fester-ki-zugang');
  await body.evaluate(e=>e.scrollTop=180);await page.waitForTimeout(90);await body.evaluate(e=>e.scrollTop=350);await page.waitForTimeout(250);
  const scroll=await body.evaluate(e=>e.scrollTop);check('Lange Mail hat eine echte Scrollposition',scroll>=350);
  check('Mail-Aktionen folgen ausgeblendeter Navigation zum Bildschirmrand',await page.locator('.mx-mobile-view>.mobile-ui-actions').evaluate(e=>Math.abs(e.getBoundingClientRect().bottom-innerHeight)<2));
  await page.getByRole('button',{name:'KI-Assistent',exact:true}).click();await page.locator('[data-rai-input]').fill('Ungesendete Frage');await shot('mail-ki');
  check('Ein Senden-Knopf und getrennte Werkzeugzeile',await page.locator('[data-rai-send]').count()===1&&await page.locator('[data-rai-send]').evaluate(e=>e.getBoundingClientRect().left>e.parentElement.getBoundingClientRect().width/2));
  for(const name of ['Fall- und Bürodaten neu laden','Gespräch in die Falldokumentation übernehmen','Diktat (Spracheingabe)','Unterlagen für das Gespräch anhängen','Senden','Hell/Dunkel umschalten','KI-Einstellungen und Modell'])check('Werkzeug erreichbar: '+name,await page.locator('#mxReadAiHost [title="'+name+'"]').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.bottom<=innerHeight}));
  await page.getByRole('button',{name:'Zurück',exact:true}).click();check('Mail kehrt an ihre Leseposition zurück',Math.abs(await body.evaluate(e=>e.scrollTop)-scroll)<2);
  check('Nachricht und Anlagen bleiben erhalten',await page.locator('.mx-read-body').innerText().then(t=>t.includes('Lange Nachricht'))&&await page.locator('.mx-read .mx-atts').count()===1);
  await page.getByRole('button',{name:'KI-Assistent',exact:true}).click();check('Ungesendete KI-Frage überlebt den Ansichtswechsel',await page.locator('[data-rai-input]').inputValue()==='Ungesendete Frage');
  await page.evaluate(()=>{const c=ensureAIConfig();c.provider='openai';c.apiKey='fixture-no-network';aiProviderKeyConfigured=()=>true});await page.locator('[data-mobile-chats]').click();await page.locator('[data-mobile-case-chat]').click();await page.locator('[data-mobile-chat-layer]').waitFor();await page.evaluate(()=>__mobileUI.returnFromCaseChat());await page.locator('.mx-mobile-ai-view').waitFor();
  check('Chats-Rückkehr bewahrt KI-Eingabe ohne doppelte Assistenten',await page.locator('[data-rai-input]').inputValue()==='Ungesendete Frage'&&await page.locator('#mxReadAiHost').count()===1);
  await page.locator('.mx-mobile-ai-prompts summary').click();check('Schnellaktionen haben verständliche Beschriftungen',await page.getByRole('button',{name:'Fasse die E-Mail kompakt zusammen:',exact:false}).innerText()==='Zusammenfassen');await shot('mail-ki-schnellaktionen');
  await page.getByRole('button',{name:'Schnellprompts verwalten (alle anzeigen, neu, sortieren)',exact:true}).click();check('Alle Schnellprompts und Verwaltung bleiben erreichbar',await page.locator('#aiPromptMgr_mailRead').isVisible()&&await page.locator('#aiPromptMgr_mailRead').innerText().then(t=>t.includes('Hinzufügen')));await shot('mail-ki-promptverwaltung');await page.locator('#mobileOnlineSheet [data-mobile-sheet-close]').click();
  for(const width of [320,390,570])for(const dark of [false,true]){
   await page.setViewportSize({width,height:844});await page.evaluate(d=>document.documentElement.dataset.theme=d?'dark':'light',dark);await page.waitForTimeout(150);
   check('KI-Ansicht ohne Überlauf bei '+width+' / '+dark,await page.locator('.mx-mobile-ai-view').evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.querySelector('[data-rai-send]').getBoundingClientRect().bottom<=innerHeight));
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.locator('.mx-mobile-ai-prompts summary').click();await page.locator('[data-rai-input]').focus();
  await page.evaluate(()=>{window.__qaViewportOriginal=visualViewport;const v=new EventTarget();Object.assign(v,{height:520,width:390,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:v});__qaViewportOriginal.dispatchEvent(new Event('resize'))});await page.waitForTimeout(200);
  check('KI-Eingabe und Senden bei Tastatur vollständig sichtbar',!await page.locator('#mobileOnlineShell').isVisible()&&await page.locator('[data-rai-send]').evaluate(e=>e.getBoundingClientRect().bottom<=520));await shot('mail-ki-tastatur');
  await page.evaluate(()=>{Object.defineProperty(window,'visualViewport',{configurable:true,value:__qaViewportOriginal});__qaViewportOriginal.dispatchEvent(new Event('resize'));providerCall=async(prompt)=>{window.__qaAiPrompt=prompt;await new Promise(r=>window.__qaAiRelease=r);return {reply:'Die Unterlagen werden benötigt.'}};window.__aiEnsureOfficeContext=async()=>{}});
  await page.locator('[data-rai-input]').fill('Bitte zusammenfassen');await page.locator('[data-rai-send]').click();await page.waitForFunction(()=>typeof __qaAiRelease==='function');await page.locator('[data-rai-input]').fill('Nächste Frage');await page.locator('[data-rai-input]').press('Enter');
  check('Weitere Eingabe bleibt während laufender KI-Anfrage erhalten',await page.locator('[data-rai-input]').inputValue()==='Nächste Frage');
  await page.evaluate(()=>__qaAiRelease());await page.getByRole('button',{name:'Als Antwort-Entwurf übernehmen',exact:true}).waitFor();check('Antwort-Neuzeichnen bewahrt die nächste Frage',await page.locator('[data-rai-input]').inputValue()==='Nächste Frage');
  check('KI-Anfrage enthält die richtige E-Mail und Frage',await page.evaluate(()=>__qaAiPrompt.includes('Lange Nachricht')&&__qaAiPrompt.includes('Bitte zusammenfassen')));
  await page.evaluate(()=>providerCall=async(prompt)=>{__qaAiPrompt=prompt;return {reply:'Die Unterlagen werden benötigt.'}});await page.locator('.mx-mobile-ai-prompts summary').click();await page.getByRole('button',{name:'Schnellprompts verwalten (alle anzeigen, neu, sortieren)',exact:true}).click();await page.locator('#mobileOnlineSheet .aipm-txt').filter({hasText:'Analysiere den Ton'}).click();await page.waitForFunction(()=>__qaAiPrompt.includes('Analysiere den Ton'));
  check('Auch Schnellaktionen außerhalb der ersten fünf starten im Mail-Assistenten',!await page.locator('#mobileOnlineSheet').isVisible());
  await page.getByRole('button',{name:'Als Antwort-Entwurf übernehmen',exact:true}).last().click();await page.locator('#mxBody').waitFor();check('KI-Antwort bleibt als E-Mail-Entwurf übernehmbar',await page.locator('#mxBody').innerText().then(t=>t.includes('Die Unterlagen werden benötigt.')));
  check('Keine Laufzeitfehler',errors.length===0);
 }finally{fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
