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
 const root=()=>page.locator('#todoWorkspace'),act=k=>root().locator('[data-tw="'+k+'"]:visible'),panel=()=>root().locator('.at-panel'),open=async id=>{await root().locator('[data-tw=detail][data-id="'+id+'"]').first().click();await panel().locator('.at-detail-attachments .attach-empty,.at-detail-attachments .attach-box').waitFor()},back=async()=>{await panel().locator('[data-tw=back]').first().click()},save=async()=>{await act('save').click()},list=async()=>{for(let n=0;n<4&&await panel().isVisible();n++)await back()},shot=async name=>{await page.screenshot({path:path.join(output,name+'.png')})};
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.openTodoFullView());await root().waitFor();
 await check('Echte Aufgaben und Wiedervorlagen, eindeutige Icons und Suche sichtbar',async()=>{assert.equal(await root().locator('.at-row').count(),5);assert.equal(await root().locator('[data-cal-kind=followups]').count(),2);assert.equal(await page.getByRole('searchbox',{name:'Aufgaben durchsuchen'}).isVisible(),true)});await shot('desktop-liste');
 await open('a');await shot('desktop-details');await act('new').click();
 await check('Neue Aufgabe aus Details öffnet leeres Formular',async()=>assert.equal(await page.locator('#todoNewTitle').inputValue(),''));await back();
 await check('Abbrechen kehrt zum zuvor ausgewählten Eintrag zurück',async()=>assert.match(await panel().innerText(),/Arztbrief nachfordern/));
 await act('edit').click();await shot('desktop-formular');
 await check('Alle Originalfelder, Wiederholung und Explorer vorhanden',async()=>{for(const suffix of ['Title','CaseLabel','Priority','Start','Due','RecurFreq','RecurInterval','RecurUntil','Connection','Calendar','Description'])assert.equal(await page.locator('#todoNew'+suffix).count(),1,suffix);assert.equal(await panel().getByRole('button',{name:'Aus Datei-Explorer',exact:true}).count(),1)});
 await page.locator('#todoNewTitle').fill('Arztbrief – Entwurf');await page.locator('#todoNewDescription').fill('Ungespeicherte Notiz');
 await check('Realtime erhält Formular-DOM und Eingaben',async()=>{await page.evaluate(()=>window.__qaForm=document.getElementById('todoNewTitle'));await page.evaluate(()=>window.openTodoFullView());assert.equal(await page.evaluate(()=>window.__qaForm===document.getElementById('todoNewTitle')),true)});
 await check('Abgebrochener Statuswechsel hinterlässt kein falsches Häkchen',async()=>{await root().locator('[data-tw-complete=b]').click();await act('keep').click();assert.equal(await root().locator('[data-tw-complete=b]').isChecked(),false);assert.equal(await page.locator('#todoNewDescription').inputValue(),'Ungespeicherte Notiz')});
 await check('Fenster schließen und Escape schützen den Entwurf',async()=>{await act('exit').click();await act('keep').click();await page.keyboard.press('Escape');await act('keep').click();assert.equal(await page.locator('#todoNewTitle').inputValue(),'Arztbrief – Entwurf')});
 await check('Datei hochladen bewahrt Eingaben und verwendet echte Anlagenroute',async()=>{await page.locator('#todoMobileAttachments input[type=file]').setInputFiles({name:'Anlage.txt',mimeType:'text/plain',buffer:Buffer.from('Prüfanlage')});await panel().getByRole('link',{name:'Anlage.txt'}).waitFor();assert.equal(await page.locator('#todoNewTitle').inputValue(),'Arztbrief – Entwurf')});
 await check('Anlage an externe Aufgabe übertragen',async()=>{await panel().locator('.attach-row').filter({hasText:'Anlage.txt'}).getByTitle('Diese Anlage zur verknüpften Vikunja-/OpenProject-Aufgabe übertragen').click();await page.waitForFunction(()=>__qaRequests.some(r=>r.url.endsWith('send-remote')))});
 await check('Fehlgeschlagenes Entfernen erhält Anlage und Entwurf',async()=>{await page.evaluate(()=>window.__qaFailDelete=true);page.once('dialog',d=>d.accept());await panel().locator('.attach-row').filter({hasText:'Anlage.txt'}).getByTitle('Entfernen',{exact:true}).click();await page.locator('#todoMobileFormError:not([hidden])').waitFor();assert.equal(await panel().getByRole('link',{name:'Anlage.txt'}).count(),1);await page.evaluate(()=>window.__qaFailDelete=false);page.once('dialog',d=>d.accept());await panel().locator('.attach-row').filter({hasText:'Anlage.txt'}).getByTitle('Entfernen',{exact:true}).click();await panel().getByRole('link',{name:'Anlage.txt'}).waitFor({state:'detached'});assert.equal(await page.locator('#todoNewDescription').inputValue(),'Ungespeicherte Notiz')});
 await check('Fehler beim Speichern erhält Eingaben',async()=>{await page.evaluate(()=>window.__qaFailSave=true);await save();await page.locator('#todoMobileFormError:not([hidden])').waitFor();assert.equal(await page.locator('#todoNewTitle').inputValue(),'Arztbrief – Entwurf');await page.evaluate(()=>window.__qaFailSave=false)});
 await check('Deaktivierte Wiederholung blockiert nicht',async()=>{await page.locator('#todoNewRecurFreq').selectOption('weekly');await page.locator('#todoNewRecurInterval').fill('0');await page.locator('#todoNewRecurFreq').selectOption('');await save();await act('edit').waitFor();assert.equal(await page.evaluate(()=>__qaTodos.find(t=>t.id==='a').recurrenceRule),'')});await list();
 await act('new').click();await page.locator('#todoNewTitle').fill('Neue Aufgabe mit Anlage');await page.locator('#todoNewCaseLabel').selectOption({label:'Jonas Weber'});await page.locator('#todoNewPriority').selectOption('low');await page.locator('#todoNewStart').fill('2026-09-10');await page.locator('#todoNewDue').fill('2026-09-09');
 await check('Fälligkeit vor Beginn wird abgewiesen',async()=>{await save();assert.match(await page.locator('#todoMobileFormError').innerText(),/Fälligkeit/)});await page.locator('#todoNewDue').fill('2026-09-11');await page.locator('#todoNewRecurFreq').selectOption('weekly');await page.locator('#todoNewRecurInterval').fill('2');await page.locator('#todoNewRecurUntil').fill('2026-09-10');
 await check('Serienende vor erster Fälligkeit wird abgewiesen',async()=>{await save();assert.match(await page.locator('#todoMobileFormError').innerText(),/Wiederholung/)});await page.locator('#todoNewRecurUntil').fill('2027-01-01');await page.locator('#todoNewConnection').selectOption('conn');await page.locator('#todoNewCalendar').selectOption('personal');
 await page.locator('#todoPendingAttachments input[type=file]').setInputFiles({name:'Fehlerprobe.txt',mimeType:'text/plain',buffer:Buffer.from('Datei bleibt erhalten')});await page.evaluate(()=>window.__qaFailUpload=true);await save();
 await check('Teilerfolg behält fehlgeschlagene Datei am bereits gespeicherten Eintrag',async()=>{await page.locator('#todoMobileFormError:not([hidden])').waitFor();assert.match(await page.locator('#todoMobileFormError').innerText(),/fehlen noch/);assert.equal(await page.evaluate(()=>__qaTodos.filter(t=>t.title==='Neue Aufgabe mit Anlage').length),1);assert.equal(await panel().locator('input[type=file]').count(),1)});
 await page.evaluate(()=>window.__qaFailUpload=false);await save();await act('edit').waitFor();
 await check('Erneutes Speichern erzeugt keine Dublette und erhält Fall, Liste und Serie',async()=>{const rows=await page.evaluate(()=>__qaTodos.filter(t=>t.title==='Neue Aufgabe mit Anlage'));assert.equal(rows.length,1);assert.equal(rows[0].caseId,'case-b');assert.equal(rows[0].calendarRef,'personal');assert.equal(JSON.parse(rows[0].recurrenceRule).interval,2);await panel().getByRole('link',{name:'Fehlerprobe.txt'}).waitFor()});await list();
 await open('r');await act('complete').click();await page.waitForFunction(()=>__qaTodos.find(t=>t.id==='r').dueAt.slice(0,7)!==new Date().toISOString().slice(0,7));
 await check('Erledigen einer Serie schreibt nächste Fälligkeit fort',async()=>assert.equal(await page.evaluate(()=>__qaTodos.find(t=>t.id==='r').done),false));await list();
 await open('c');await act('complete').click();await panel().getByRole('button',{name:'Wieder öffnen',exact:true}).waitFor();await act('complete').click();await panel().getByRole('button',{name:'Erledigen',exact:true}).waitFor();
 await check('Status lässt sich erledigen und wieder öffnen',async()=>assert.equal(await page.evaluate(()=>__qaTodos.find(t=>t.id==='c').done),false));await list();
 await page.locator('#todoWorkSearch').fill('Wohnberatung');await check('Suche filtert nach Titel',async()=>assert.equal(await root().locator('.at-row').count(),1));await act('clear-search').click();
 await act('filter').click();await panel().locator('[data-tw=draft-due][data-value=none]').click();await panel().getByLabel('Priorität',{exact:true}).selectOption('low');
 await check('Kombinierter Filter zählt einzelnen Treffer korrekt',async()=>assert.equal(await act('apply-filter').innerText(),'Anwenden · 1 Eintrag'));
 await panel().locator('[data-tw=lists]').click();await act('apply-lists').click();await check('Listeneinstellungen erhalten den vorherigen Filterentwurf',async()=>assert.equal(await panel().getByLabel('Priorität',{exact:true}).inputValue(),'low'));await act('apply-filter').click();assert.equal(await root().locator('.at-row').count(),1);
 await act('filter').click();await act('reset-filter').click();await act('apply-filter').click();
 await root().locator('.at-sidebar [data-tw=lists]').click();await panel().getByLabel('Büroaufgaben · Büro',{exact:true}).uncheck();await act('apply-lists').click();
 await check('Sichtbarkeit wird in vorhandener Präferenz gespeichert',async()=>{assert.equal(await root().locator('[data-tw=detail][data-id=a]').count(),0);assert.match(await page.evaluate(()=>localStorage.getItem('betreuung.calendarHidden.v1')),/task::office/)});
 await root().locator('.at-sidebar [data-tw=lists]').click();await act('all-lists').click();await panel().getByLabel('Farbe: Büroaufgaben · Büro',{exact:true}).fill('#cc5522');await act('apply-lists').click();
 await check('Individuelle Listenfarbe erscheint am Eintrag',async()=>assert.equal(await root().locator('[data-todo-id=a] .at-dot').evaluate(n=>n.style.background),'rgb(204, 85, 34)'));
 await page.locator('#todoWorkSort').selectOption('manual');let ids=await root().locator('.at-row').evaluateAll(ns=>ns.map(n=>n.dataset.todoId));await root().locator('[data-tw=move-down]').first().click();
 await check('Manuelle Reihenfolge per Pfeil',async()=>assert.equal(await root().locator('.at-row').first().getAttribute('data-todo-id'),ids[1]));
 ids=await root().locator('.at-row').evaluateAll(ns=>ns.map(n=>n.dataset.todoId));await root().locator('[data-todo-id="'+ids[0]+'"]').dragTo(root().locator('[data-todo-id="'+ids[2]+'"]'),{targetPosition:{x:100,y:10}});
 await check('Drag-and-drop folgt der sichtbaren Einfügemarkierung',async()=>{const after=await root().locator('.at-row').evaluateAll(ns=>ns.map(n=>n.dataset.todoId));assert.equal(after.indexOf(ids[0])+1,after.indexOf(ids[2]))});await page.locator('#todoWorkSort').selectOption('due');
 await act('tools').click();await check('ICS-Gesamtexport erzeugt Download',async()=>{const d=page.waitForEvent('download');await act('export').click();assert.match((await d).suggestedFilename(),/\.ics$/)});
 await check('ICS-Import speichert über vorhandene Datenroute',async()=>{await page.getByLabel('ICS-Datei importieren').setInputFiles({name:'Import.ics',mimeType:'text/calendar',buffer:Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nSUMMARY:Importierte Aufgabe\r\nEND:VTODO\r\nEND:VCALENDAR')});await page.waitForFunction(()=>__qaTodos.some(t=>t.title==='Importierte Aufgabe'));});await list();
 await act('tools').click();await act('sync').click();await check('Synchronisierung erreicht echte Route',async()=>await page.waitForFunction(()=>__qaRequests.some(r=>r.url==='/api/todos/sync'&&r.method==='POST')));await list();
 const imported=await page.evaluate(()=>__qaTodos.find(t=>t.title==='Importierte Aufgabe').id);await open(imported);await check('Einzelexport erzeugt Download',async()=>{const d=page.waitForEvent('download');await act('export-single').click();assert.match((await d).suggestedFilename(),/\.ics$/)});page.once('dialog',d=>d.accept());await act('delete').click();await panel().waitFor({state:'hidden'});
 await check('Löschen entfernt ausschließlich den ausgewählten Eintrag',async()=>{assert.equal(await page.evaluate(()=>__qaTodos.some(t=>t.title==='Importierte Aufgabe')),false);assert.equal(await page.evaluate(()=>__qaTodos.some(t=>t.id==='f')),true)});
 await open('f');await act('edit').click();await page.locator('#todoNewDescription').fill('Quelle bleibt erhalten');await save();await act('edit').waitFor();
 await check('Bearbeitete Wiedervorlage erhält Ursprung und Eintragsart',async()=>{const t=await page.evaluate(()=>__qaTodos.find(t=>t.id==='f'));assert.equal(t.itemType,'followup');assert.equal(t.sourceId,'doc-1');assert.equal(t.sourceModule,'documents')});await list();
 await check('Schließen und erneutes Öffnen funktioniert',async()=>{await act('exit').click();await page.locator('#modal.hidden').waitFor({state:'attached'});await page.evaluate(()=>window.openTodoFullView());await root().waitFor({state:'visible'})});
 await check('Ladefehler erhalten zuletzt geladene Daten und Wiederholen',async()=>{await page.evaluate(()=>{window.__qaFailLoad=true;return window.openTodoFullView()});assert.ok(await root().locator('.at-row').count()>0);await act('reload').waitFor();await page.evaluate(()=>window.__qaFailLoad=false);await act('reload').click();await act('reload').waitFor({state:'detached'})});
 for(const width of [1440,1024,880,768,390,320])for(const dark of [false,true]){
  await list();await page.setViewportSize({width,height:900});await page.evaluate(d=>document.documentElement.dataset.theme=d?'dark':'light',dark);
  for(const view of ['list','detail','edit','filter','lists','tools']){
   if(view==='detail')await open('a');if(view==='edit')await act('edit').click();if(view==='filter'){await list();await act('filter').click()}if(view==='lists')await panel().locator('[data-tw=lists]').click();if(view==='tools'){await list();await act('tools').click()}
   await check('Layout '+width+' '+(dark?'dunkel':'hell')+' '+view,async()=>{const faults=await root().evaluate(r=>{const base=r.getBoundingClientRect(),bad=[];for(const el of r.querySelectorAll('button,input,select,textarea')){const b=el.getBoundingClientRect();if(!b.width||!b.height||el.closest('[hidden]'))continue;if(b.left<base.left-1||b.right>base.right+1)bad.push(el.id||el.getAttribute('aria-label')||el.textContent)}return bad});assert.deepEqual(faults,[]);assert.equal(await root().evaluate(r=>r.scrollWidth>r.clientWidth),false)});
   if(width===390&&!dark&&view==='list')await shot('mobil-liste');if(width===390&&!dark&&view==='filter')await shot('mobil-filter');if(width===320&&dark&&view==='edit')await shot('mobil-formular-dunkel');if(width===1440&&dark&&view==='detail')await shot('desktop-details-dunkel');
  }
 }
 await list();await page.setViewportSize({width:390,height:480});await act('new').click();await check('Formularaktionen bleiben bei geringer Höhe vor Navigation erreichbar',async()=>{const b=await act('save').boundingBox(),n=await page.locator('#mobileOnlineShell').boundingBox();assert.ok(b&&b.y+b.height<=(n?n.y:page.viewportSize().height))});
 await page.locator('#todoNewTitle').fill('Mobil ungespeichert');await page.setViewportSize({width:390,height:844});
 await check('Mobiler Bereichswechsel schützt ungespeicherte Eingaben',async()=>{await page.locator('#mobileOnlineShell [data-mobile-action=documentation]').click();await act('keep').click();assert.equal(await page.locator('#todoNewTitle').inputValue(),'Mobil ungespeichert')});
 await check('Chats und Rückkehr bewahren Formular-DOM',async()=>{await page.evaluate(()=>{window.__qaForm=document.getElementById('todoNewTitle');const c=ensureAIConfig();c.provider='openai';c.apiKey='fixture-no-network';aiProviderKeyConfigured=()=>true});await page.locator('[data-mobile-chats]').click();await page.locator('[data-mobile-case-chat]').click();await page.locator('[data-mobile-chat-layer]').waitFor();await page.evaluate(()=>__mobileUI.returnFromCaseChat());assert.equal(await page.evaluate(()=>window.__qaForm===document.getElementById('todoNewTitle')),true)});
 await back();await act('discard').click();await check('Verwerfen erzeugt keine Aufgabe',async()=>assert.equal(await page.evaluate(()=>__qaTodos.some(t=>t.title==='Mobil ungespeichert')),false));
 assert.deepEqual(errors,[]);console.log('PASS Keine JavaScript-Laufzeitfehler');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
