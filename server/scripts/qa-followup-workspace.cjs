'use strict';
// Exercises the shipped application using synthetic data and intercepted APIs only.
const { [process.env.MOBILE_QA_BROWSER||'chromium']:engine }=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=process.env.MOBILE_QA_OUTPUT||'/tmp/followup-workspace-qa';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await engine.launch({headless:true});try{
 const desktop=process.env.FOLLOWUP_QA_DESKTOP==='1';
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:!desktop,hasTouch:!desktop,locale:'de-DE',timezoneId:'Europe/Berlin'});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR '+e.message)});
 await page.route('**/*',r=>r.abort());
 await page.addInitScript(()=>{window.__onlineInitialCaseNativeFetch=async()=>new Response('{}',{headers:{'Content-Type':'application/json'}})});
 await page.route('http://wv-qa.invalid/api/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
 await page.route('http://wv-qa.invalid/',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'))}));
 await page.goto('http://wv-qa.invalid/',{waitUntil:'domcontentloaded',timeout:90000});
 const seed=()=>{
  const iso=(n=0)=>{const d=new Date();d.setDate(d.getDate()+n);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};window.__qaDay=iso;
  window.__appMode='online';window.__demoModus=false;window.__currentUser={id:1,displayName:'Prüfung'};window.__activeServerCaseId='a';window.__offenerFallId=()=>window.__activeServerCaseId;
  const ca={person:{firstName:'Mara',lastName:'Hoffmann'},fristen:[{id:'fr1',todoId:'deadline-old',dueDate:iso(14),remindDays:14,title:'Frist'}]},cb={person:{firstName:'Jonas',lastName:'Weber'},fristen:[]};state.caseData=ca;
  window.__onlineCaseCache=new Map([['a',{label:'Hoffmann, Mara',data:{stammdaten:ca}}],['b',{label:'Weber, Jonas',data:{stammdaten:cb}}]]);window.__onlinePreloadCases=async()=>{};window.__onlineCaseSync={preloadCache:async()=>{}};window.createAutoDokuEntry=async()=>({});
  window.__qaDocs=[{id:'doc1',name:'Bescheid zur Kostenübernahme.pdf',caseId:'a',createdAt:iso(-10)},{id:'doc2',name:'Sehr langer Arztbrief mit Hinweisen zur Behandlung und weiteren Untersuchungen.pdf',caseId:'b',createdAt:iso(-1)},{id:'doc3',name:'Ausgabenübersicht.pdf',caseId:'a',createdAt:iso(-2)}];
  window.__qaTodos=[{id:'f1',itemType:'followup',title:'Wiedervorlage: Kostenübernahme erneut prüfen',description:'Bescheid und Berechnung gemeinsam durchsehen.',caseId:'a',caseLabel:'Hoffmann, Mara',sourceType:'document',sourceId:'doc1',sourceModule:'documents',sourceRef:'document:doc1',dueAt:iso(-2)+'T00:00:00',priority:'high',done:false},
   {id:'f2',itemType:'followup',title:'Wiedervorlage: Arztbrief besprechen',caseId:'b',caseLabel:'Weber, Jonas',sourceType:'document',sourceId:'doc2',dueAt:iso(0),priority:'normal',done:false},
   {id:'done',itemType:'followup',title:'Wiedervorlage: Gespräch ausgewertet',caseId:'a',sourceType:'note',sourceId:'missing',dueAt:iso(-4),priority:'normal',done:true},
   {id:'nodate',itemType:'followup',title:'Wiedervorlage: Vorgang ohne Datum',caseId:'a',sourceType:'note',sourceId:'note2',dueAt:'',priority:'low',done:false},
   {id:'deadline',itemType:'followup',title:'Wiedervorlage: Frist',sourceType:'frist',sourceModule:'deadlines',caseId:'a',dueAt:iso()},
   {id:'deadline-old',itemType:'followup',title:'Wiedervorlage: Alte Frist',caseId:'a',dueAt:iso()},
   {id:'task',itemType:'task',title:'Freie Aufgabe',caseId:'a',dueAt:iso()}];
  window.__qaMail=[{id:'s1',accountId:'acc1',subject:'Besuchstermin abstimmen',folder:'Wiedervorlage',messageId:'m1',wakeAt:iso(2)+'T12:00:00.000Z'}];window.__qaRequests=[];
  window.fetch=async(url,opts={})=>{const u=String(url),method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):{};__qaRequests.push({url:u,method,body});let data={},status=200;
   if(u==='/api/todos'&&method==='GET'){data={todos:__qaTodos};if(window.__qaFailLoad){status=503;data={error:'Laden unterbrochen'}}}
   else if(u==='/api/todos'&&method==='POST'){const todo={...body,id:'created-'+__qaTodos.length};__qaTodos.push(todo);data={todo}}
   else if(/^\/api\/todos\/[^/]+$/.test(u)){const id=decodeURIComponent(u.split('/')[3]),i=__qaTodos.findIndex(x=>x.id===id);if(i<0){status=404}else if(window.__qaFailSave){status=403;data={error:'Speichern nicht erlaubt'}}else if(method==='PUT'){Object.assign(__qaTodos[i],body);data={todo:__qaTodos[i]}}else if(method==='DELETE')__qaTodos.splice(i,1)}
   else if(u.startsWith('/api/documents/ordner-dateien')){const cid=new URL(u,'http://wv-qa.invalid').searchParams.get('caseId');data={files:__qaDocs.filter(x=>x.caseId===cid)}}
   else if(u.startsWith('/api/mailbox/case-messages'))data={messages:u.endsWith('caseId=a')?[{id:'em1',accountId:'acc1',folder:'INBOX',uid:'42',messageId:'new-mail',subject:'Nachfrage aus der Wohngruppe',caseId:'a'}]:[]};
   else if(u==='/api/mailbox/accounts/acc1/snooze'){const row={...body,id:'s2',accountId:'acc1'};__qaMail.push(row);data={id:'s2',wakeAt:body.wakeAt}}
   else if(u==='/api/mailbox/snoozes'){if(window.__qaMailFail){status=503;data={error:'Postfach nicht erreichbar'}}else data={snoozes:__qaMail}}
   else if(u==='/api/mailbox/snoozes/s1'&&method==='PATCH'){__qaMail[0].wakeAt=body.wakeAt;data={ok:true}}
   else if(u==='/api/mailbox/snoozes/s1/wake'){__qaMail=[];data={ok:true}}
   else if(u==='/api/mailbox/snoozes/s1/source')data={accountId:'acc1',folder:'Wiedervorlage',uid:'123'};
   else if(u==='/api/cases')data={cases:[{id:'a',label:'Hoffmann, Mara'},{id:'b',label:'Weber, Jonas'}]};
   else if(u.startsWith('/api/cases/'))data={stammdaten:{data:u.includes('/b/')?cb:ca},dokuEntries:{entries:[]}};
   return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})};
  document.getElementById('loginGateOverlay')?.classList.add('hidden');const start=document.getElementById('startPage');start.hidden=false;start.classList.remove('hidden');window.dispatchEvent(new Event('resize'));
 };await page.evaluate(seed);
 await page.waitForTimeout(400);if(await page.locator('#modeIntroNext').isVisible())await page.locator('#modeIntroNext').click();
 const root=page.locator('#wiedervorlagenWorkspace'),act=a=>root.locator(`[data-action="${a}"]:visible`),panel=root.locator('.wv-panel'),check=async(name,fn)=>{await fn();console.log('PASS '+name)},shot=async name=>page.screenshot({path:path.join(out,name+'.png')}),open=async id=>{await root.locator(`[data-open="${id}"]`).first().click();await panel.waitFor()};
 if(process.env.FOLLOWUP_LAYOUT_AUDIT){await require('./qa-followup-layout.cjs')({page,root,act,panel,check,shot,errors,out});return;}
 if(process.env.FOLLOWUP_NAV_AUDIT){await require('./qa-followup-nav.cjs')({page,root,act,panel,check,shot,errors,seed});return;}
 if(process.env.FOLLOWUP_EDITOR_AUDIT){await require('./qa-followup-editor.cjs')({page,root,act,panel,check,shot,errors,out});return;}
 if(process.env.FOLLOWUP_NOTE_AUDIT){await require('./qa-followup-note.cjs')({page,root,act,panel,check,shot,errors});return;}
 if(process.env.PLANNING_REGRESSION_AUDIT){await require('./qa-planning-regressions.cjs')({page,root,act,panel,check,shot,errors});return;}
 if(process.env.FOLLOWUP_REGRESSION_AUDIT){await require('./qa-followup-regressions.cjs')({page,root,act,panel,check,shot,errors});return;}
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.__caseOverview.openFollowups());await root.waitFor();
 await check('Alle echten Quellen, keine Fristerinnerung oder freie Aufgabe',async()=>{assert.equal(await root.locator('.wv-row').count(),4);assert.equal(await root.getByText('Später / ohne Datum').count(),1)});await shot('desktop-liste');
 await check('Navigation direkt nach Fristen mit Schnellaktionen und Tooltip',async()=>{assert.ok(await page.locator('[data-fristen-menu] + [data-wiedervorlagen-menu]').count());assert.ok(await page.locator('[data-wiedervorlagen-menu] [data-wv-new]').first().getAttribute('title'))});
 // Click actual row padding, rather than a title/icon that already opened the panel.
 const entry=id=>root.locator(`.wv-row[data-id="${id}"]`);
 const clickRowPadding=async id=>{const row=entry(id),box=await row.boundingBox();assert.ok(box);await row.click({position:{x:box.width/2,y:5}})};
 await clickRowPadding('todo:f1');
 await check('Weißraum öffnet die zugehörigen Details',async()=>{assert.equal(await root.getAttribute('data-page'),'detail');assert.equal(await panel.locator('.wv-panel-content>h2').innerText(),'Kostenübernahme erneut prüfen');assert.equal(await entry('todo:f1').locator('.wv-row-title').getAttribute('aria-expanded'),'true')});
 await clickRowPadding('todo:f2');
 await check('Weißraum eines anderen Eintrags wechselt die Details',async()=>{assert.equal(await panel.locator('.wv-panel-content>h2').innerText(),'Arztbrief besprechen');assert.equal(await root.locator('.wv-selected').getAttribute('data-id'),'todo:f2')});
 await clickRowPadding('todo:f2');
 await check('Erneuter Klick in dieselbe Zeile schließt die Details',async()=>{assert.equal(await root.getAttribute('data-page'),'list');assert.equal(await panel.isVisible(),false);assert.equal(await root.locator('.wv-selected').count(),0);assert.equal(await entry('todo:f2').locator('.wv-row-title').getAttribute('aria-expanded'),'false')});
 await root.locator('.wv-list').click({position:{x:3,y:3}});
 await check('Klick außerhalb der Einträge öffnet keine Details',async()=>assert.equal(await root.getAttribute('data-page'),'list'));
 await entry('todo:f1').locator('.wv-case').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new MouseEvent('click',{bubbles:true}))});
 await check('Markieren von Eintragstext öffnet keine Details',async()=>assert.equal(await root.getAttribute('data-page'),'list'));await page.evaluate(()=>window.getSelection().removeAllRanges());
 await entry('todo:f1').locator('.wv-row-title').focus();await page.keyboard.press('Enter');
 await check('Tastatur öffnet die Details genau einmal',async()=>assert.equal(await root.getAttribute('data-page'),'detail'));
 await entry('todo:f1').locator('.wv-row-title').focus();await page.keyboard.press('Space');
 await check('Leertaste schließt und erhält den Fokus am Eintrag',async()=>{assert.equal(await root.getAttribute('data-page'),'list');assert.equal(await entry('todo:f1').locator('.wv-row-title').evaluate(el=>el===document.activeElement),true)});
 await entry('todo:f1').locator('.wv-row-right [data-open]').click();
 await check('Pfeil öffnet die Details genau einmal',async()=>assert.equal(await root.getAttribute('data-page'),'detail'));
 await entry('todo:f1').locator('.wv-row-right [data-open]').click();
 await check('Schließsymbol am ausgewählten Eintrag schließt die Details',async()=>assert.equal(await root.getAttribute('data-page'),'list'));
 if(!desktop){await page.setViewportSize({width:390,height:844});const row=entry('todo:f1'),box=await row.boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+5);await check('Mobil öffnet auch Antippen des Weißraums die Details',async()=>assert.equal(await root.getAttribute('data-page'),'detail'));await act('back').click();await page.setViewportSize({width:1440,height:1000})}
 await open('todo:f1');await shot('desktop-details');await act('edit').click();await panel.getByRole('textbox',{name:'Titel',exact:true}).fill('Bescheid erneut sorgfältig prüfen');await panel.getByRole('textbox',{name:'Notiz',exact:true}).fill('Geänderte Prüfnotiz');
 await page.evaluate(()=>window.__qaFailSave=true);await act('save').click();await check('Schreibfehler erhält den Formularentwurf',async()=>{await root.locator('#wv-form-error').filter({hasText:'aktualisiert'}).waitFor();assert.equal(await panel.getByRole('textbox',{name:'Titel',exact:true}).inputValue(),'Bescheid erneut sorgfältig prüfen')});
 await page.evaluate(()=>window.__qaFailSave=false);await act('save').click();await act('edit').waitFor();await check('Speichern erhält Dokument und Fall',async()=>{const t=await page.evaluate(()=>__qaTodos.find(x=>x.id==='f1'));assert.equal(t.title,'Wiedervorlage: Bescheid erneut sorgfältig prüfen');assert.equal(t.sourceId,'doc1');assert.equal(t.caseId,'a')});
 await act('undo').click();await check('Rückgängig schreibt persistent zurück',async()=>{assert.equal(await page.evaluate(()=>__qaTodos.find(x=>x.id==='f1').title),'Wiedervorlage: Kostenübernahme erneut prüfen')});
 await act('postpone').click();await panel.locator('[data-days="7"]').click();await act('save-postpone').click();await act('edit').waitFor();await check('Überfällige ab heute um sieben Tage verschoben',async()=>assert.equal(await page.evaluate(()=>__qaTodos.find(x=>x.id==='f1').dueAt.slice(0,10)),await page.evaluate(()=>__qaDay(7))));
 await act('complete').click();await panel.getByRole('button',{name:'Wieder öffnen',exact:true}).waitFor();await act('complete').click();await panel.getByRole('button',{name:'Erledigen',exact:true}).waitFor();console.log('PASS Erledigen und Wiederöffnen');
 await act('new').click();await panel.getByLabel('Fall',{exact:true}).selectOption('a');await panel.locator('.wv-source-option').filter({hasText:'Ausgabenübersicht.pdf'}).click();await panel.getByLabel('Titel',{exact:true}).fill('Ausgaben besprechen');await act('save').click();await act('edit').waitFor();await check('Neuanlage mit bestehendem Original',async()=>{const t=await page.evaluate(()=>__qaTodos.find(x=>x.title==='Wiedervorlage: Ausgaben besprechen'));assert.equal(t.sourceId,'doc3');assert.equal(t.itemType,'followup')});
 await act('new').click();await panel.getByLabel('Fall',{exact:true}).selectOption('a');await panel.locator('.wv-source-option').filter({hasText:'Ausgabenübersicht.pdf'}).click();await act('save').click();await check('Doppelte offene Wiedervorlage wird abgefangen',async()=>await act('existing').waitFor());await act('existing').click();await act('delete').click();await act('confirm-delete').click();await check('Löschen entfernt nur die Wiedervorlage',async()=>{assert.equal(await page.evaluate(()=>__qaTodos.some(x=>x.title==='Wiedervorlage: Ausgaben besprechen')),false);assert.equal(await page.evaluate(()=>__qaDocs.length),3)});
 await open('mail:s1');await act('postpone').click();await panel.locator('[data-days="7"]').click();await act('save-postpone').click();await act('edit').waitFor();await act('complete').click();await check('E-Mail tatsächlich über Rückholroute zurückgeholt',async()=>{assert.equal(await page.evaluate(()=>__qaMail.length),0);assert.ok(await page.evaluate(()=>__qaRequests.some(x=>x.url.endsWith('/s1/wake')&&x.method==='POST')))});
 await act('new').click();await panel.getByLabel('Fall',{exact:true}).selectOption('a');await panel.locator('.wv-source-option').filter({hasText:'Nachfrage aus der Wohngruppe'}).click();await panel.getByLabel('Wiedervorlage am',{exact:true}).fill(await page.evaluate(()=>__qaDay(4)));await act('save').click();await act('complete').waitFor();await check('Neue E-Mail-Wiedervorlage stellt das Original im Postfach zurück',async()=>{assert.ok(await page.evaluate(()=>__qaRequests.some(x=>x.url.endsWith('/acc1/snooze')&&x.body.messageId==='new-mail')))});await act('close').first().click();
 await open('todo:f1');await page.evaluate(()=>{__qaTodos.find(x=>x.id==='f1').recurrenceRule=JSON.stringify({freq:'monthly',interval:1})});await page.evaluate(()=>__followupWorkspace.open());const before=await page.evaluate(()=>__qaTodos.find(x=>x.id==='f1').dueAt);await act('complete').click();await act('edit').waitFor();await check('Wiederkehrende Wiedervorlage rückt zur nächsten Fälligkeit weiter',async()=>{const t=await page.evaluate(()=>__qaTodos.find(x=>x.id==='f1'));assert.equal(t.done,false);assert.notEqual(t.dueAt,before)});await act('close').first().click();
 await act('new').click();await panel.getByLabel('Titel',{exact:true}).fill('Ungespeicherter Entwurf');await act('exit').click();await check('Schließen schützt ungespeicherte Änderungen',async()=>await act('cancel-confirm').waitFor());await act('cancel-confirm').click();await act('close').first().click();await act('discard').click();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});for(const theme of ['light','dark']){await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t},theme);await page.waitForTimeout(80);await check(`Menüknopf überdeckt keine Überschrift ${width} ${theme}`,async()=>assert.equal(await page.locator('#sbReopen').isVisible(),false));await check(`Liste ohne horizontalen Überlauf ${width} ${theme}`,async()=>assert.ok(await root.evaluate(el=>el.scrollWidth<=el.clientWidth+1)));await shot(width+'-'+theme);await act('filter').click();await check(`Filter sichtbar ${width} ${theme}`,async()=>assert.ok(await panel.isVisible()));await act('apply-filter').click();await open('todo:f1');await shot(width+'-'+theme+'-details');await act('edit').click();await panel.getByLabel('Titel',{exact:true}).fill('Ein sehr langer Titel mit ausführlichen Angaben zum Original und weiteren Informationen für den nächsten Termin');await shot(width+'-'+theme+'-formular');await act('close').first().click();await act('discard').click();}}
 await act('new').click();await panel.getByLabel('Fall',{exact:true}).selectOption('a');await panel.locator('.wv-source-option').filter({hasText:'Ausgabenübersicht.pdf'}).click();await page.evaluate(()=>{window.__appMode='local';localStorage.setItem('betreuungsbuero.todos.v1','[]')});await panel.getByLabel('Titel',{exact:true}).fill('Lokal gespeicherte Wiedervorlage');await act('save').click();await act('edit').waitFor();await check('Lokale Speicherung übersteht erneutes Öffnen',async()=>{await page.evaluate(()=>__followupWorkspace.open());await root.getByText('Lokal gespeicherte Wiedervorlage',{exact:true}).first().waitFor();});
 await check('Keine neuen Laufzeitfehler',async()=>assert.deepEqual(errors,[]));console.log('DONE');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
