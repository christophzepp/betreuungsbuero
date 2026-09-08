'use strict';
// Runs the real shipped app with synthetic tasks and an intercepted backend; no external writes.
const chromium=require(process.env.PLAYWRIGHT_MODULE||'playwright')[process.env.MOBILE_QA_BROWSER||'chromium'];
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=process.env.MOBILE_QA_OUTPUT||'/tmp/mobile-tasks-qa';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Berlin',locale:'de-DE',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});
 await page.route('https://**/*',r=>r.abort());await page.route('http://**/*',r=>r.abort());
 await page.addInitScript(()=>{window.__onlineInitialCaseNativeFetch=async(url)=>new Response(JSON.stringify(String(url)==='/api/cases'?{cases:[{id:'case-a',label:'Mara Hoffmann'},{id:'case-b',label:'Jonas Weber'}]}:{}),{headers:{'Content-Type':'application/json'}})});
 await page.route('http://mobile-qa.invalid/api/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
 await page.route('http://mobile-qa.invalid/',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'))}));
 await page.goto('http://mobile-qa.invalid/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.evaluate(()=>{
   const day=new Date(),today=[day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');
   window.__qaRequests=[];window.__qaTodos=[
    {id:'a',title:'Arztbrief nachfordern',description:'Den aktuellen Arztbrief bei der Praxis anfordern und anschließend in der Fallakte unter Gesundheit ablegen.',caseId:'case-a',caseLabel:'Mara Hoffmann',priority:'high',dueAt:today+'T00:00:00',calendarRef:'office',connectionId:'conn',done:false,itemType:'task'},
    {id:'b',title:'Belege für Jahresbericht ordnen',description:'Unterlagen für den Jahresbericht zusammenstellen.',caseId:'case-a',caseLabel:'Mara Hoffmann',priority:'normal',dueAt:'2026-09-10T00:00:00',done:false,itemType:'task'},
    {id:'c',title:'Adresse der Wohnberatung prüfen',caseId:'case-b',caseLabel:'Jonas Weber',priority:'low',done:false,itemType:'task'},
    {id:'d',title:'Rückruf erledigt',caseId:'case-b',caseLabel:'Jonas Weber',priority:'normal',done:true,itemType:'task'},
    {id:'r',title:'Monatlicher Rückruf',caseId:'case-a',caseLabel:'Mara Hoffmann',dueAt:today+'T00:00:00',priority:'normal',recurrenceRule:JSON.stringify({freq:'monthly',interval:1,until:''}),done:false,itemType:'task'},
    {id:'f',title:'Antwort abwarten',caseId:'case-a',caseLabel:'Mara Hoffmann',itemType:'followup',sourceType:'document',sourceId:'doc-1',sourceModule:'documents',sourceRef:'doc-1',priority:'normal',done:false}
   ];window.__qaAtt={a:[{id:'att-a',filename:'Arztbrief.pdf',mimeType:'application/pdf',size:1200}]};
   window.fetch=async(url,options={})=>{
    const u=String(url),method=options.method||'GET',body=options.body?JSON.parse(options.body):{};window.__qaRequests.push({url:u,method,body});let result={},status=200;
    if(u==='/api/cases')result={cases:[{id:'case-a',label:'Mara Hoffmann'},{id:'case-b',label:'Jonas Weber'}]};
    else if(u==='/api/calendar/connections')result={connections:[{id:'conn',provider:'vikunja',displayName:'Büro',calendars:[{kind:'task',remoteId:'office',name:'Büroaufgaben'},{kind:'task',remoteId:'personal',name:'Persönlich'}]}]};
    else if(u==='/api/todos/attachments-map')result={map:window.__qaAtt};
    else if(u==='/api/todos/sync')result={todos:window.__qaTodos};
    else if(u==='/api/todos'&&method==='GET'){if(window.__qaFailLoad){status=503;result={error:'Test offline'}}else result={todos:window.__qaTodos}}
    else if(u==='/api/todos'&&method==='POST'){const t={...body,id:'created-'+Date.now(),done:false};window.__qaTodos.push(t);result={todo:t}}
    else if(/^\/api\/todos\/[^/]+\/attachments/.test(u)){
      const id=u.split('/')[3],aid=u.split('/')[5];
      if(u.endsWith('send-remote'))result={ok:true};
      else if(method==='POST'){if(window.__qaFailUpload){status=503;result={error:'Upload unterbrochen'}}else{const att={...body,id:'att-'+Date.now(),size:100};(window.__qaAtt[id]||=[]).push(att);result={attachment:att}}}
      else if(method==='DELETE'){if(window.__qaFailDelete){status=403;result={error:'Keine Berechtigung'}}else window.__qaAtt[id]=(window.__qaAtt[id]||[]).filter(a=>a.id!==aid)}
      else result={attachments:window.__qaAtt[id]||[]};
    }else if(/^\/api\/todos\/[^/]+$/.test(u)){
      const id=u.split('/')[3],i=window.__qaTodos.findIndex(t=>t.id===id);
      if(method==='PUT'){if(window.__qaFailSave){status=503;result={error:'Speichern fehlgeschlagen'}}else{Object.assign(window.__qaTodos[i],body);result={todo:window.__qaTodos[i]}}}
      else if(method==='DELETE'){if(window.__qaFailDelete){status=403;result={error:'Keine Berechtigung'}}else window.__qaTodos.splice(i,1)}
    }
    return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json'}});
   };
   window.__appMode='online';window.__currentUser={id:1,displayName:'Testnutzer'};
   document.getElementById('loginGateOverlay')?.classList.add('hidden');const start=document.getElementById('startPage');start.hidden=false;start.classList.remove('hidden');window.dispatchEvent(new Event('resize'));
 });
 await page.waitForSelector('#mobileOnlineShell');await page.locator('#modeIntroNext').click();
 const check=async(name,fn)=>{await fn();console.log('PASS '+name)};
 await page.evaluate(()=>window.openTodoFullView());await page.waitForSelector('.todo-mobile-pilot');await page.waitForTimeout(300);
 await page.screenshot({path:path.join(output,'aufgaben-liste.png')});
 await check('Liste zeigt offene Aufgaben und Wiedervorlagen',async()=>assert.equal(await page.locator('.todo-mobile-row').count(),5));
 await page.getByRole('button',{name:'Details: Arztbrief nachfordern',exact:true}).click();
 await page.locator('[data-mobile-screen=detail]').waitFor();await page.waitForTimeout(200);await page.screenshot({path:path.join(output,'aufgabe-details.png')});
 await check('Details mit Anlage und festen Aktionen',async()=>{assert.equal(await page.getByRole('link',{name:'Arztbrief.pdf'}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'Erledigen',exact:true}).isVisible(),true)});
 await page.getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('#todoNewTitle').waitFor();
 await page.screenshot({path:path.join(output,'aufgabe-formular.png')});
 await check('Originalfelder und Datei-Explorer bleiben vollständig erhalten',async()=>{
  for(const id of ['todoNewTitle','todoNewCaseLabel','todoNewPriority','todoNewStart','todoNewDue','todoNewRecurFreq','todoNewRecurInterval','todoNewRecurUntil','todoNewConnection','todoNewCalendar','todoNewDescription'])assert.equal(await page.locator('#'+id).count(),1,id);
  assert.equal(await page.getByRole('button',{name:'Aus Datei-Explorer',exact:true}).count(),1);
 });
 await page.locator('#todoNewTitle').fill('Arztbrief – Entwurf');await page.locator('#todoNewDescription').fill('Noch nicht gespeicherte Notiz');
 await check('Realtime-Aktualisierung erhält Original-DOM und Entwurf',async()=>{
  await page.evaluate(()=>{window.__qaOriginal=document.getElementById('todoNewTitle')});await page.evaluate(()=>window.openTodoFullView());assert.equal(await page.evaluate(()=>window.__qaOriginal===document.getElementById('todoNewTitle')),true);
 });
 await check('Anlage hinzufügen erhält ungespeicherte Eingaben',async()=>{
  await page.locator('#todoMobileAttachments input[type=file]').setInputFiles({name:'Anlage.txt',mimeType:'text/plain',buffer:Buffer.from('Prüfanlage')});await page.getByRole('link',{name:'Anlage.txt',exact:true}).waitFor();
  assert.equal(await page.locator('#todoNewTitle').inputValue(),'Arztbrief – Entwurf');assert.equal(await page.locator('#todoNewDescription').inputValue(),'Noch nicht gespeicherte Notiz');
 });
 await check('Anlagenübertragung verwendet die bestehende Verknüpfung',async()=>{
  await page.locator('.attach-row').filter({hasText:'Anlage.txt'}).getByTitle('Diese Anlage zur verknüpften Vikunja-/OpenProject-Aufgabe übertragen').click();
  await page.waitForFunction(()=>__qaRequests.some(r=>r.url.endsWith('send-remote')&&r.method==='POST'));
  assert.equal(await page.evaluate(()=>__qaRequests.some(r=>r.url.endsWith('send-remote')&&r.method==='POST')),true);
 });
 await check('Fehlgeschlagenes Entfernen behält Anlage und Formular',async()=>{
  await page.evaluate(()=>window.__qaFailDelete=true);page.once('dialog',d=>d.accept());await page.locator('.attach-row').filter({hasText:'Anlage.txt'}).getByTitle('Entfernen',{exact:true}).click();
  assert.equal(await page.getByRole('link',{name:'Anlage.txt',exact:true}).count(),1);await page.evaluate(()=>window.__qaFailDelete=false);
  page.once('dialog',d=>d.accept());await page.locator('.attach-row').filter({hasText:'Anlage.txt'}).getByTitle('Entfernen',{exact:true}).click();await page.getByRole('link',{name:'Anlage.txt',exact:true}).waitFor({state:'detached'});
  assert.equal(await page.locator('#todoNewTitle').inputValue(),'Arztbrief – Entwurf');
 });
 await check('Escape und Bereichswechsel fragen bei geändertem Entwurf nach',async()=>{
  await page.evaluate(()=>window.closeModal());await page.getByRole('button',{name:'Weiter bearbeiten',exact:true}).click();
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Weiter bearbeiten',exact:true}).click();
  await page.locator('#mobileOnlineShell [data-mobile-action=documentation]').click();await page.getByRole('button',{name:'Weiter bearbeiten',exact:true}).click();assert.equal(await page.locator('#todoNewTitle').inputValue(),'Arztbrief – Entwurf');
 });
 await check('Chats und KI-Rückweg bewahren den Formular-DOM',async()=>{
  await page.evaluate(()=>{const c=ensureAIConfig();c.provider='openai';c.apiKey='fixture-no-network';aiProviderKeyConfigured=()=>true});
  await page.locator('[data-mobile-chats]').click();await page.locator('[data-mobile-case-chat]').click();
  assert.equal(await page.locator('[data-mobile-chat-layer]').count(),1);await page.evaluate(()=>__mobileUI.returnFromCaseChat());
  assert.equal(await page.evaluate(()=>window.__qaOriginal===document.getElementById('todoNewTitle')),true);
 });
 await page.locator('#todoNewRecurFreq').selectOption('weekly');await page.locator('#todoNewRecurInterval').fill('0');await page.locator('#todoNewRecurFreq').selectOption('');
 await check('Fehlgeschlagenes Speichern behält Eingaben und zeigt Fehler',async()=>{
  await page.evaluate(()=>window.__qaFailSave=true);await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('#todoMobileFormError:not([hidden])').waitFor();assert.equal(await page.locator('#todoNewTitle').inputValue(),'Arztbrief – Entwurf');await page.evaluate(()=>window.__qaFailSave=false);
 });
 await check('Ausgeschaltete Wiederholung blockiert das Speichern nicht',async()=>assert.equal(await page.evaluate(()=>__qaRequests.some(r=>r.method==='PUT'&&r.body.title==='Arztbrief – Entwurf'&&r.body.recurrenceRule==='')),true));
 await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('[data-mobile-screen=detail]').waitFor();
 await check('Bearbeiten speichert bestehende Felder ohne Verlust',async()=>{assert.equal(await page.evaluate(()=>__qaTodos.find(t=>t.id==='a').description),'Noch nicht gespeicherte Notiz');assert.equal(await page.evaluate(()=>__qaTodos.find(t=>t.id==='a').caseId),'case-a')});
 await page.getByRole('button',{name:'Zurück',exact:true}).click();
 await page.getByRole('button',{name:'Neue Aufgabe',exact:true}).click();await page.locator('#todoNewTitle').fill('Neue Aufgabe mit Anlage');await page.locator('#todoNewDescription').fill('Vollständiger neuer Arbeitsablauf');await page.locator('#todoNewCaseLabel').selectOption({label:'Jonas Weber'});await page.locator('#todoNewPriority').selectOption('low');await page.locator('#todoNewStart').fill('2026-09-10');await page.locator('#todoNewDue').fill('2026-09-09');
 await check('Datumsprüfung verhindert Fälligkeit vor Bearbeitungsstart',async()=>{await page.getByRole('button',{name:'Speichern',exact:true}).click();assert.match(await page.locator('#todoMobileFormError').innerText(),/Fälligkeit/)});
 await page.locator('#todoNewDue').fill('2026-09-11');await page.locator('#todoNewConnection').selectOption('conn');await page.locator('#todoNewCalendar').selectOption('personal');await page.locator('#todoNewRecurFreq').selectOption('weekly');await page.locator('#todoNewRecurInterval').fill('2');await page.locator('#todoNewRecurUntil').fill('2027-01-01');
 await page.locator('#todoPendingAttachments input[type=file]').setInputFiles({name:'Fehlerprobe.txt',mimeType:'text/plain',buffer:Buffer.from('Datei bleibt erhalten')});
 await page.evaluate(()=>window.__qaFailUpload=true);await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('#todoMobileFormError:not([hidden])').waitFor();
 await check('Teilweise gespeicherte Aufgabe behält fehlgeschlagene Dateien zur Wiederholung',async()=>{assert.match(await page.locator('#todoMobileFormError').innerText(),/fehlen noch/);assert.match(await page.locator('#todoPendingAttachments').innerText(),/Fehlerprobe.txt/);assert.equal(await page.evaluate(()=>__qaTodos.filter(t=>t.title==='Neue Aufgabe mit Anlage').length),1)});
 await page.evaluate(()=>window.__qaFailUpload=false);await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('[data-mobile-screen=detail]').waitFor();await page.getByRole('link',{name:'Fehlerprobe.txt'}).waitFor();
 await check('Wiederholung erzeugt keine doppelte Aufgabe und speichert alle Zuordnungen',async()=>{
  const todos=await page.evaluate(()=>__qaTodos.filter(t=>t.title==='Neue Aufgabe mit Anlage'));assert.equal(todos.length,1);assert.equal(todos[0].caseId,'case-b');assert.equal(todos[0].priority,'low');assert.equal(todos[0].calendarRef,'personal');assert.equal(JSON.parse(todos[0].recurrenceRule).interval,2);
 });
 await page.getByRole('button',{name:'Zurück',exact:true}).click();await page.getByRole('button',{name:'Details: Monatlicher Rückruf',exact:true}).click();await page.getByRole('button',{name:'Erledigen',exact:true}).click();
 await page.waitForFunction(()=>__qaTodos.find(t=>t.id==='r').dueAt.slice(0,7)!==new Date().toISOString().slice(0,7));
 await check('Serienaufgabe rückt auf nächste Fälligkeit und bleibt offen',async()=>assert.equal(await page.evaluate(()=>__qaTodos.find(t=>t.id==='r').done),false));
 await page.getByRole('button',{name:'Zurück',exact:true}).click();await page.getByRole('button',{name:'Details: Adresse der Wohnberatung prüfen',exact:true}).click();await page.getByRole('button',{name:'Erledigen',exact:true}).click();await page.getByRole('button',{name:'Wieder öffnen',exact:true}).waitFor();
 await check('Statuswechsel erledigt und wieder offen',async()=>{assert.equal(await page.evaluate(()=>__qaTodos.find(t=>t.id==='c').done),true);await page.getByRole('button',{name:'Wieder öffnen',exact:true}).click();await page.getByRole('button',{name:'Erledigen',exact:true}).waitFor();assert.equal(await page.evaluate(()=>__qaTodos.find(t=>t.id==='c').done),false)});
 await page.getByRole('button',{name:'Zurück',exact:true}).click();await page.getByRole('button',{name:'Aufgaben durchsuchen',exact:true}).click();await page.locator('#todoMobileSearch').fill('Wohnberatung');
 await check('Suche reduziert Ergebnisse, Löschen stellt sie wieder her',async()=>{assert.equal(await page.locator('.todo-mobile-row').count(),1);await page.getByRole('button',{name:'Suche löschen',exact:true}).click();assert.equal(await page.locator('.todo-mobile-row').count(),6)});
 await page.getByRole('button',{name:'Aufgaben durchsuchen',exact:true}).click();await page.getByRole('button',{name:'Filter',exact:true}).click();await page.getByRole('button',{name:'Ohne Termin',exact:true}).click();await page.getByLabel('Priorität',{exact:true}).selectOption('low');
 await page.screenshot({path:path.join(output,'aufgaben-filter.png')});await page.getByRole('button',{name:/Anwenden ·/}).click();
 await check('Fälligkeit und Priorität lassen sich kombinieren',async()=>{assert.equal(await page.locator('.todo-mobile-row').count(),1);assert.match(await page.locator('.todo-mobile-row').innerText(),/Wohnberatung/)});
 await page.getByRole('button',{name:/^Filter ·/}).click();await page.getByRole('button',{name:'zurücksetzen',exact:true}).click();await page.getByRole('button',{name:/Anwenden ·/}).click();
 await page.getByRole('button',{name:'Weitere Aufgabenaktionen',exact:true}).click();await page.getByRole('button',{name:'Listen & Farben',exact:true}).click();await page.getByLabel('Büroaufgaben · Büro',{exact:true}).uncheck();await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
 await check('Listen-Sichtbarkeit speichert bestehende Präferenz',async()=>{assert.equal(await page.getByRole('button',{name:'Details: Arztbrief – Entwurf',exact:true}).count(),0);assert.match(await page.evaluate(()=>localStorage.getItem('betreuung.calendarHidden.v1')),/task::office/)});
 await page.getByRole('button',{name:'Weitere Aufgabenaktionen',exact:true}).click();await page.getByRole('button',{name:'Listen & Farben',exact:true}).click();await page.getByRole('button',{name:'Alle anzeigen',exact:true}).click();await page.getByLabel('Farbe: Büroaufgaben · Büro',{exact:true}).fill('#cc5522');await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
 await check('Listenfarbe erscheint im Aufgabenpunkt',async()=>assert.equal(await page.locator('[data-todo-id=a] .todo-mobile-dot').evaluate(e=>e.style.background),'rgb(204, 85, 34)'));
 await page.getByLabel('Aufgaben sortieren').selectOption('manual');const before=await page.locator('.todo-mobile-row').evaluateAll(rows=>rows.map(r=>r.dataset.todoId));await page.getByRole('button',{name:/nach unten$/}).first().click();await page.waitForFunction(id=>document.querySelector('.todo-mobile-row').dataset.todoId!==id,before[0]);
 await check('Manuelles Verschieben per Touch ändert Reihenfolge',async()=>assert.equal(await page.locator('.todo-mobile-row').first().getAttribute('data-todo-id'),before[1]));
 await page.getByLabel('Aufgaben sortieren').selectOption('due');
 await page.getByRole('button',{name:'Weitere Aufgabenaktionen',exact:true}).click();
 await check('ICS-Gesamtexport erreicht Browserdownload',async()=>{const download=page.waitForEvent('download');await page.getByRole('button',{name:'Alle Aufgaben des Fallfilters als ICS exportieren',exact:true}).click();assert.match((await download).suggestedFilename(),/\.ics$/)});
 await page.getByRole('button',{name:'Weitere Aufgabenaktionen',exact:true}).click();await page.getByLabel('ICS-Datei importieren',{exact:true}).setInputFiles({name:'Import.ics',mimeType:'text/calendar',buffer:Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nSUMMARY:Importierte Aufgabe\r\nEND:VTODO\r\nEND:VCALENDAR')});await page.getByRole('button',{name:'Details: Importierte Aufgabe',exact:true}).waitFor();
 await check('ICS-Import verwendet vorhandenen Parser und Speicherung',async()=>assert.equal(await page.evaluate(()=>__qaTodos.some(t=>t.title==='Importierte Aufgabe')),true));
 await page.getByRole('button',{name:'Weitere Aufgabenaktionen',exact:true}).click();await page.getByRole('button',{name:'Aufgaben synchronisieren',exact:true}).click();await page.waitForFunction(()=>__qaRequests.some(r=>r.url==='/api/todos/sync'&&r.method==='POST'));
 await check('Synchronisierung bleibt erreichbar',async()=>assert.equal(await page.locator('.todo-mobile-pilot').isVisible(),true));
 await page.getByRole('button',{name:'Details: Importierte Aufgabe',exact:true}).click();await page.getByRole('button',{name:'Mehr',exact:true}).click();
 await check('Einzelexport bleibt erreichbar',async()=>{const download=page.waitForEvent('download');await page.getByRole('button',{name:'Als ICS exportieren',exact:true}).click();assert.match((await download).suggestedFilename(),/\.ics$/)});
 await page.getByRole('button',{name:'Mehr',exact:true}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Löschen',exact:true}).click();await page.locator('.todo-mobile-pilot[data-mobile-screen=list]').waitFor();
 await check('Löschen entfernt ausschließlich ausgewählte Aufgabe',async()=>{assert.equal(await page.evaluate(()=>__qaTodos.some(t=>t.title==='Importierte Aufgabe')),false);assert.equal(await page.evaluate(()=>__qaTodos.some(t=>t.id==='f')),true)});
 for(const width of [320,360,390,430])for(const dark of [false,true]){
  await page.setViewportSize({width,height:844});await page.evaluate(dark=>document.documentElement.dataset.theme=dark?'dark':'light',dark);await page.waitForTimeout(100);
  await check('Layout '+width+'px '+(dark?'dunkel':'hell'),async()=>{
   const bounds=await page.evaluate(()=>{const root=document.querySelector('.todo-mobile-pilot'),nav=document.getElementById('mobileOnlineShell'),fab=document.querySelector('.todo-mobile-fab');return {overflow:root.scrollWidth>root.clientWidth,bottom:fab.getBoundingClientRect().bottom,nav:nav.getBoundingClientRect().top}});assert.equal(bounds.overflow,false);assert.ok(bounds.bottom<=bounds.nav);
  });
  await page.locator('.todo-mobile-pilot>.mobile-ui-body').evaluate(el=>el.scrollTop=0);
  if(width===360&&dark)await page.screenshot({path:path.join(output,'aufgaben-dunkel-360.png')});
 }

 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='light');
 await check('Ladefehler zeigen vorhandene Aufgaben mit erneutem Ladezugang',async()=>{
  await page.evaluate(()=>{window.__qaFailLoad=true;return window.openTodoFullView()});assert.equal(await page.getByRole('button',{name:'Erneut laden',exact:true}).isVisible(),true);assert.ok(await page.locator('.todo-mobile-row').count()>0);
  await page.evaluate(()=>window.__qaFailLoad=false);await page.getByRole('button',{name:'Erneut laden',exact:true}).click();await page.getByRole('button',{name:'Erneut laden',exact:true}).waitFor({state:'detached'});
 });
 await page.getByRole('button',{name:'Neue Aufgabe',exact:true}).click();await page.locator('#todoNewTitle').fill('Entwurf verwerfen');
 await check('Verwerfen schließt den Entwurf ohne neue Aufgabe',async()=>{
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.getByRole('button',{name:'Änderungen verwerfen',exact:true}).click();await page.locator('.todo-mobile-pilot[data-mobile-screen=list]').waitFor();assert.equal(await page.evaluate(()=>__qaTodos.some(t=>t.title==='Entwurf verwerfen')),false);
 });
 for(const width of [320,430]){
  await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'Neue Aufgabe',exact:true}).click();await page.locator('#todoNewTitle').waitFor();
  await page.locator('#todoNewRecurFreq').selectOption('weekly');
  await check('Formular '+width+'px erhält Felder, Datum und feste Aktionen',async()=>{
    const result=await page.evaluate(()=>{const content=document.querySelector('.todo-mobile-pilot>.mobile-ui-body');return {overflow:content.scrollWidth>content.clientWidth,footer:document.querySelector('.todo-mobile-pilot>.mobile-ui-actions').getBoundingClientRect().bottom,nav:document.getElementById('mobileOnlineShell').getBoundingClientRect().top}});assert.equal(result.overflow,false);assert.ok(result.footer<=result.nav);
  });
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.getByRole('button',{name:'Änderungen verwerfen',exact:true}).click();
 }
 await page.setViewportSize({width:390,height:480});await page.getByRole('button',{name:'Neue Aufgabe',exact:true}).click();await page.locator('#todoNewTitle').waitFor();
 await check('Formularaktionen bleiben bei geringer Höhe erreichbar',async()=>{const b=await page.getByRole('button',{name:'Speichern',exact:true}).boundingBox(),n=await page.locator('#mobileOnlineShell').boundingBox();assert.ok(b.y+b.height<=n.y)});
 await page.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.setViewportSize({width:1366,height:900});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.waitForTimeout(100);await page.evaluate(()=>window.openTodoFullView());
 await check('Desktop verwendet weiterhin die ursprüngliche Aufgabenansicht',async()=>{assert.equal(await page.locator('.todo-mobile-pilot').count(),0);assert.equal(await page.locator('.todo-full-toolbar').isVisible(),true)});
 assert.deepEqual(errors,[]);console.log('PASS Keine JavaScript-Laufzeitfehler');

 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
