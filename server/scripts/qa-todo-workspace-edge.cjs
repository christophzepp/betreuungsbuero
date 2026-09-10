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
 const root=()=>page.locator('#todoWorkspace'),act=k=>root().locator('[data-tw="'+k+'"]:visible'),panel=()=>root().locator('.at-panel'),list=async()=>{for(let n=0;n<4&&await panel().isVisible();n++)await panel().locator('[data-tw=back]').first().click()};
 await page.setViewportSize({width:1366,height:900});await page.evaluate(()=>window.openTodoFullView());
 await check('Anlagenzahl ist bereits in der Liste sichtbar',async()=>assert.match(await root().locator('[data-todo-id=a] .at-meta').innerText(),/1/));
 await check('Verzögertes Bearbeiten öffnet geschlossenes Fenster nicht erneut',async()=>{
  await page.evaluate(()=>{window.__qaFetch=window.fetch;window.fetch=async(u,o)=>{if(String(u)==='/api/todos')await new Promise(resolve=>window.__qaResume=resolve);return __qaFetch(u,o)};window.__qaEditing=window.__todoShowEditForm('a')});await page.waitForFunction(()=>typeof __qaResume==='function');await act('exit').click();await page.evaluate(async()=>{window.fetch=__qaFetch;__qaResume();await __qaEditing});assert.equal(await page.locator('#modal').evaluate(n=>n.classList.contains('hidden')),true);
 });
 await page.evaluate(()=>window.openTodoFullView());await act('tools').click();
 await check('Verzögerte Synchronisierung bewahrt neuen Formular-DOM',async()=>{
  await page.evaluate(()=>{window.__qaFetch=window.fetch;window.fetch=async(u,o)=>{if(String(u)==='/api/todos/sync')await new Promise(resolve=>window.__qaResumeSync=resolve);return __qaFetch(u,o)}});await act('sync').click();await page.waitForFunction(()=>typeof __qaResumeSync==='function');await act('new').click();await page.locator('#todoNewTitle').fill('Warten auf Sync');await page.evaluate(()=>window.__qaForm=document.getElementById('todoNewTitle'));await page.evaluate(()=>{window.fetch=__qaFetch;__qaResumeSync()});await page.locator('.at-feedback').filter({hasText:'Aufgaben synchronisiert.'}).waitFor();assert.equal(await page.evaluate(()=>window.__qaForm===document.getElementById('todoNewTitle')),true);assert.equal(await page.locator('#todoNewTitle').inputValue(),'Warten auf Sync');
 });await panel().locator('[data-tw=back]').first().click();await act('discard').click();await list();
 await root().locator('[data-tw=detail][data-id=a]').first().click();await act('edit').click();await page.locator('#todoNewDescription').fill('Datei bei Fehler nicht verlieren');await page.evaluate(()=>window.__qaFailUpload=true);
 await check('Datei-Explorer übernimmt Datei in die Aufgabe und verwendet deren Fall',async()=>{await page.evaluate(()=>{window.__qaFailUpload=false;window.__qaPicker=window.__dokDateiPick;window.__dokDateiPick=async(title,context)=>{window.__qaPickerContext=context;return [new File(['Explorerinhalt'],'Aus-Fallakte.txt',{type:'text/plain'})]}});await panel().getByRole('button',{name:'Aus Datei-Explorer',exact:true}).click();await panel().getByRole('link',{name:'Aus-Fallakte.txt'}).waitFor();assert.equal(await page.evaluate(()=>__qaPickerContext.caseId),'case-a');assert.equal(await page.locator('#todoNewDescription').inputValue(),'Datei bei Fehler nicht verlieren');await page.evaluate(()=>{window.__dokDateiPick=window.__qaPicker;window.__qaFailUpload=true})});
 await check('Fehlgeschlagener Upload an vorhandene Aufgabe bleibt zum Wiederholen erhalten',async()=>{await page.locator('#todoMobileAttachments input[type=file]').setInputFiles({name:'Erneut.txt',mimeType:'text/plain',buffer:Buffer.from('Noch einmal')});await page.locator('#todoMobileFormError').filter({hasText:'Die Datei bleibt ausgewählt'}).waitFor();assert.match(await page.locator('#todoPendingAttachments').innerText(),/Erneut.txt/);assert.equal(await page.locator('#todoNewDescription').inputValue(),'Datei bei Fehler nicht verlieren');await page.evaluate(()=>window.__qaFailUpload=false);await act('save').click();await panel().getByRole('link',{name:'Erneut.txt'}).waitFor()});await list();
 await check('Leere Antwort zeigt einen bedienbaren Leerzustand',async()=>{await page.evaluate(()=>{window.__qaKeepTodos=__qaTodos;window.__qaTodos=[];return window.openTodoFullView()});assert.match(await root().locator('.at-empty').innerText(),/Keine passenden Aufgaben/);assert.equal(await act('new').isVisible(),true);await page.evaluate(()=>{window.__qaTodos=__qaKeepTodos;return window.openTodoFullView()})});
 // Local persistence exercises the real localStorage adapter; the task workspace has no mock database.
 await act('exit').click();await page.evaluate(()=>{window.__appMode='local';window.__wieOnline=()=>false;localStorage.setItem(window.TODO_STORAGE_KEY,'[]');window.caseRegistry=[{id:'local-a',label:'Lokaler Fall',state:{caseData:{}}}]});await page.evaluate(()=>window.openTodoFullView());await act('new').click();await page.locator('#todoNewTitle').fill('Lokal dauerhaft');await act('save').click();await act('edit').waitFor();
 await check('Lokal angelegte Aufgabe wird dauerhaft gespeichert',async()=>{const items=await page.evaluate(()=>window.__todoItemsAll());assert.equal(items.filter(t=>t.title==='Lokal dauerhaft').length,1);await act('exit').click();await page.evaluate(()=>window.openTodoFullView());assert.equal(await root().getByRole('button',{name:'Details: Lokal dauerhaft',exact:true}).count(),1)});
 await root().getByRole('button',{name:'Details: Lokal dauerhaft',exact:true}).click();await act('edit').click();await page.locator('#todoNewTitle').fill('Lokal aktualisiert');await page.locator('#todoNewTitle').press('Enter');await act('edit').waitFor();await check('Enter speichert lokale Änderungen',async()=>assert.equal((await page.evaluate(()=>window.__todoItemsAll())).some(t=>t.title==='Lokal aktualisiert'),true));
 await act('exit').click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{window.__appMode='online';window.__wieOnline=()=>true;window.dispatchEvent(new Event('resize'))});await page.evaluate(()=>window.openCalendarFullView());
 await check('Mobile Kalenderaufgabe öffnet neue Details und kehrt zum Kalender zurück',async()=>{
  await page.evaluate(()=>window.__calendarShowEditForm('todo:a'));await root().waitFor();assert.match(await panel().innerText(),/Aus dem Kalender/);await panel().locator('[data-tw=back]').first().click();assert.equal(await root().count(),0);assert.ok(await page.locator('.cal-mobile-view').count()>0);
 });
 assert.deepEqual(errors,[]);console.log('PASS Keine JavaScript-Laufzeitfehler');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
