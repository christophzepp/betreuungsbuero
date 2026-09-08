'use strict';
// Runs the real shipped app with synthetic tasks and an intercepted backend; no external writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const output=process.env.MOBILE_QA_OUTPUT||'/tmp/mobile-modules-qa';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Berlin',locale:'de-DE',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});
 await page.route('https://**/*',r=>r.abort());await page.route('http://**/*',r=>r.abort());
 await page.addInitScript(()=>{window.__onlineInitialCaseNativeFetch=async(url)=>new Response(JSON.stringify(String(url)==='/api/cases'?{cases:[{id:'case-a',label:'Mara Hoffmann'},{id:'case-b',label:'Jonas Weber'}]}:{}),{headers:{'Content-Type':'application/json'}})});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html')).href,{waitUntil:'domcontentloaded',timeout:90000});
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
 await page.addStyleTag({content:'.toast-stack{visibility:hidden!important}'});
 const check=async(name,fn)=>{await fn();console.log('PASS '+name)};

 await page.evaluate(()=>{
   const day=new Date(),today=[day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');
   window.__qaToday=today;window.__activeServerCaseId='case-a';window.__offenerFallId=()=> 'case-a';
   state.caseData.person={firstName:'Mara',lastName:'Hoffmann'};state.caseData.care={startDate:'2026-02-01'};
   state.caseData.fristen=[
    {id:'fr-a',title:'Widerspruch Pflegegrad',category:'widerspruch',institution:'Pflegekasse',dueDate:today,priority:'high',status:'offen',routing:'none',remindDays:7,note:'Begründung vollständig beifügen.'},
    {id:'fr-old',title:'Unterlagen nachreichen',category:'behoerde',dueDate:'2026-01-01',priority:'normal',status:'offen',routing:'none'},
    {id:'fr-done',title:'Bericht abgegeben',category:'jahresbericht',dueDate:today,status:'erledigt',routing:'none'},
    {id:'fr-debt',title:'Rate zahlen',category:'sonstige',dueDate:today,source:'schuldenregulierung',status:'offen',routing:'none'}
   ];
   const contact={id:'source-contact',role:'Hausärztin',firstName:'Lea',lastName:'Sommer',email:'praxis@example.org',phone:'02610001'};
   state.caseData.contacts=[contact];state.caseData.documentationEntries=[{date:today,actor:'Sozialamt',type:'Wohnen',detail:'Kostenübernahme beantragt',freeDetail:'Rückmeldung in zwei Wochen prüfen'}];
   window.__onlineCaseCache=new Map([['case-a',{label:'Mara Hoffmann',data:{stammdaten:structuredClone(state.caseData)}}],['case-b',{label:'Jonas Weber',data:{stammdaten:{person:{firstName:'Jonas',lastName:'Weber'},care:{},fristen:[{id:'fr-b',title:'Vergütungsabrechnung',category:'verguetung',dueDate:today,priority:'normal',status:'offen',routing:'none'}]}}}]]);
   if(window.__onlineCaseSync)window.__onlineCaseSync.preloadCache=async()=>{};
   const baseFetch=window.fetch;window.fetch=async(url,options={})=>{
     if(String(url).startsWith('/api/betreuungsuebersicht?'))return new Response(JSON.stringify({items:[{caseId:'case-a',firstName:'Mara',lastName:'Hoffmann',startDate:'2026-02-01',reviewDate:today}]}),{headers:{'Content-Type':'application/json'}});
     return baseFetch(url,options);
   };
   window.__qaTodos=[{id:'follow-a',title:'Wiedervorlage: Rückmeldung prüfen',description:'Auf Antwort warten.',caseId:'case-a',caseLabel:'Mara Hoffmann',dueAt:today+'T00:00:00',done:false,priority:'high',itemType:'followup',sourceType:'doku',sourceModule:'case-overview',sourceId:'doku-0',sourceRef:'case-a::doku-0'},
   {id:'follow-b',title:'Wiedervorlage: Spätere Prüfung',caseId:'case-b',caseLabel:'Jonas Weber',dueAt:'2027-12-01T00:00:00',done:false,priority:'normal',itemType:'followup',sourceType:'document',sourceId:'doc-1',sourceModule:'documents'},
   {id:'follow-done',title:'Wiedervorlage: Abgeschlossen',caseId:'case-a',caseLabel:'Mara Hoffmann',dueAt:today+'T00:00:00',done:true,priority:'normal',itemType:'followup'}];
 });
 await page.evaluate(()=>window.openFristenModal());
 await page.locator('.fr-mobile-view').waitFor();
 await check('Fristenliste nutzt eigenes mobiles Layout mit Fristen und abgeleiteten Terminen',async()=>{assert.ok(await page.locator('.fr-mobile-view .mobile-module-row').count()>=4);assert.match(await page.locator('.fr-mobile-view').innerText(),/GESETZLICH ABGELEITET/)});
 await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'fristen-liste.png')});
 await page.getByRole('button',{name:'Fristen filtern',exact:true}).click();await page.getByLabel('Priorität',{exact:true}).selectOption('high');await page.getByRole('button',{name:/Anwenden ·/}).click();
 await check('Fristenfilter kombiniert Kategorie, Fälligkeit und Priorität',async()=>assert.equal(await page.locator('.fr-mobile-view .mobile-module-row').count(),1));
 await page.getByRole('button',{name:'Details: Widerspruch Pflegegrad',exact:true}).click();await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'fristen-detail.png')});
 await page.getByRole('button',{name:'Bearbeiten',exact:true}).click();
 await check('Fristenformular enthält alle ursprünglichen Felder',async()=>{for(const key of ['title','category','formName','institution','baseDate','dueDate','interval','routing','remindDays','priority','note','status'])assert.equal(await page.locator('#frF_'+key).count(),1,key)});
 await page.locator('#frF_note').fill('Entwurf bleibt erhalten.');await page.evaluate(()=>{window.__qaOriginal=document.getElementById('frF_note');document.dispatchEvent(new CustomEvent('betreuung:remote-change',{detail:{paths:['fristen']}}))});await page.waitForTimeout(400);
 await check('Fristen-Entwurf übersteht Aktualisierung und Chats',async()=>{
   assert.equal(await page.evaluate(()=>__qaOriginal===document.getElementById('frF_note')),true);
   await page.evaluate(()=>{const c=ensureAIConfig();c.provider='openai';c.apiKey='fixture';aiProviderKeyConfigured=()=>true});
   await page.locator('[data-mobile-chats]').click();await page.locator('[data-mobile-case-chat]').click();await page.evaluate(()=>__mobileUI.returnFromCaseChat());assert.equal(await page.evaluate(()=>__qaOriginal===document.getElementById('frF_note')),true);
 });
 await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'fristen-formular.png')});
 await page.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.getByRole('button',{name:'Weiter bearbeiten',exact:true}).click();
 await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('.fr-mobile-view[data-mobile-screen=list]').waitFor();
 await check('Frist speichern erhält Kategorie, Routing und Erinnerung',async()=>{const f=await page.evaluate(()=>state.caseData.fristen.find(f=>f.id==='fr-a'));assert.equal(f.note,'Entwurf bleibt erhalten.');assert.equal(f.routing,'none');assert.equal(f.remindDays,7)});
 await page.getByRole('button',{name:'Fristen filtern',exact:true}).click();await page.getByRole('button',{name:'Zurücksetzen',exact:true}).click();await page.getByLabel('Herkunft',{exact:true}).selectOption('own');await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'fristen-filter.png')});await page.getByRole('button',{name:/Anwenden ·/}).click();
 await check('Alle Fälle zeigt auch fremde eigene Fristen',async()=>assert.equal(await page.getByRole('button',{name:'Details: Vergütungsabrechnung',exact:true}).count(),1));
 await page.getByRole('button',{name:'Neue Frist',exact:true}).click();await page.locator('#frF_title').fill('Neue wiederkehrende Frist');await page.locator('#frF_dueDate').fill(await page.evaluate(()=>__qaToday));await page.locator('#frF_interval').selectOption('monthly');await page.locator('#frF_routing').selectOption('none');await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('.fr-mobile-view[data-mobile-screen=list]').waitFor();
 await page.getByRole('button',{name:'Details: Neue wiederkehrende Frist',exact:true}).click();await page.getByRole('button',{name:'Erledigen',exact:true}).click();await page.getByRole('button',{name:'Wieder öffnen',exact:true}).waitFor();
 await check('Fristabschluss legt den nächsten Serientermin an',async()=>{const rows=await page.evaluate(()=>state.caseData.fristen.filter(f=>f.title==='Neue wiederkehrende Frist'));assert.equal(rows.length,2);assert.equal(rows.filter(f=>f.status==='offen').length,1)});
 await page.getByRole('button',{name:'Zurück',exact:true}).click();await page.getByRole('button',{name:'Details: Rate zahlen',exact:true}).click();
 await check('Schuldenfristen behalten ihre Herkunft und erlauben nur Routing',async()=>{assert.equal(await page.getByRole('button',{name:'Bearbeiten',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Kalender an',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Aufgabe an',exact:true}).count(),1)});
 await page.evaluate(()=>window.__caseOverview.openFollowups());await page.locator('.follow-mobile-view').waitFor();await page.getByRole('button',{name:'Details: Rückmeldung prüfen',exact:true}).waitFor();
 await check('Wiedervorlagen beginnen mit fälligen Vorgängen',async()=>{assert.equal(await page.locator('[data-followup-key]').count(),1)});
 await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'wiedervorlagen-liste.png')});
 await page.getByRole('button',{name:'Geplant',exact:true}).click();await check('Geplant zeigt spätere Wiedervorlagen anderer Fälle',async()=>assert.equal(await page.getByRole('button',{name:'Details: Spätere Prüfung',exact:true}).count(),1));
 await page.getByRole('button',{name:'Fällig',exact:true}).click();await page.getByRole('button',{name:'Details: Rückmeldung prüfen',exact:true}).click();await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'wiedervorlagen-detail.png')});
 await page.getByRole('button',{name:'Wiedervorlage bearbeiten',exact:true}).click();await page.locator('#covFollowupEditTitle').fill('Rückmeldung – Entwurf');await page.locator('#covFollowupEditNote').fill('Wichtige neue Notiz');
 await check('Wiedervorlagen-Formular schützt Eingaben beim Schließen',async()=>{await page.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.getByRole('button',{name:'Weiter bearbeiten',exact:true}).click();assert.equal(await page.locator('#covFollowupEditNote').inputValue(),'Wichtige neue Notiz')});
 await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'wiedervorlagen-formular.png')});
 await page.evaluate(()=>window.__qaFailSave=true);await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.waitForTimeout(300);
 await check('Fehlgeschlagene Wiedervorlage-Speicherung erhält den Entwurf',async()=>assert.equal(await page.locator('#covFollowupEditNote').inputValue(),'Wichtige neue Notiz'));
 await page.evaluate(()=>window.__qaFailSave=false);await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('#covActionOverlay').waitFor({state:'detached'});
 await check('Bearbeiten speichert mit unveränderter Ursprungsreferenz',async()=>{const t=await page.evaluate(()=>__qaTodos.find(t=>t.id==='follow-a'));assert.equal(t.description,'Wichtige neue Notiz');assert.equal(t.sourceRef,'case-a::doku-0')});
 await page.getByRole('button',{name:'+14 Tage',exact:true}).click();await page.waitForTimeout(300);await check('Verlängern setzt Fälligkeit 14 Tage nach dem späteren Datum',async()=>{const date=await page.evaluate(()=>__qaTodos.find(t=>t.id==='follow-a').dueAt.slice(0,10));assert.ok(date>await page.evaluate(()=>__qaToday))});
 await page.getByRole('button',{name:'Beenden',exact:true}).click();await page.getByRole('button',{name:'Wieder öffnen',exact:true}).waitFor();
 await check('Wiedervorlage lässt sich beenden und erneut öffnen',async()=>{assert.equal(await page.evaluate(()=>__qaTodos.find(t=>t.id==='follow-a').done),true);await page.getByRole('button',{name:'Wieder öffnen',exact:true}).click();await page.getByRole('button',{name:'Beenden',exact:true}).waitFor()});
 await page.getByRole('button',{name:'Zurück',exact:true}).click();await page.getByRole('button',{name:'Neue Wiedervorlage',exact:true}).click();await page.locator('#covActionFollowTitle').fill('Quelle prüfen');
 await check('Neue Wiedervorlage verlangt weiterhin einen konkreten Ursprung',async()=>{await page.getByRole('button',{name:'Wiedervorlage anlegen',exact:true}).click();assert.equal(await page.locator('#covActionOverlay').count(),1);assert.equal(await page.evaluate(()=>__qaTodos.filter(t=>t.title.includes('Quelle prüfen')).length),0)});
 await page.locator('.cov-followup-source-option').first().click();await page.getByRole('button',{name:'Wiedervorlage anlegen',exact:true}).click();await page.locator('#covActionOverlay').waitFor({state:'detached'});
 await check('Neue Wiedervorlage speichert Quelle und Fall',async()=>{const t=await page.evaluate(()=>__qaTodos.find(t=>t.title.includes('Quelle prüfen')));assert.equal(t.caseId,'case-a');assert.ok(t.sourceRef);assert.ok(t.sourceType)});

 await page.evaluate(()=>{window.__abScope='case';window.__abBueroWide=false;state.caseData.contacts=[{firstName:'Lea',lastName:'Sommer',role:'Hausärztin',city:'Koblenz',email:'praxis@example.org',phone:'02610001',phoneArea:'0261',phoneNumber:'0001',status:'Aktiv',iban:'DE02120300000000202051'},{institution:'Sozialamt',role:'Behörde',city:'Bonn',status:'Aktiv'},{firstName:'Nina',lastName:'Hoffmann',role:'Angehörige',city:'Bonn',status:'Beendet'}];parsedAddressArchive={archive:{},sheets:[]};window.showImportedAddressbook()});
 await page.locator('.ab-mobile-view').waitFor();await check('Adressbuch listet aktive Kontakte im neuen Stil',async()=>assert.equal(await page.locator('.ab-mobile-row-open').count(),2));
 await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'adressbuch-liste.png')});
 await page.getByRole('button',{name:'Kontakte filtern',exact:true}).click();await page.getByLabel('Status',{exact:true}).selectOption('all');await page.getByLabel('Ort',{exact:true}).selectOption('Bonn');await page.getByRole('button',{name:'Anwenden',exact:true}).click();
 await check('Adressbuchfilter übernimmt Status und Ort in die bestehende Ansicht',async()=>{assert.equal(await page.locator('.ab-mobile-row-open').count(),2);assert.equal(await page.evaluate(()=>state.ui.addressbookViewV154.city),'Bonn')});
 await page.getByRole('button',{name:'Kontakte filtern',exact:true}).click();await page.getByRole('button',{name:'Zurücksetzen',exact:true}).click();await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'adressbuch-filter.png')});await page.getByRole('button',{name:'Anwenden',exact:true}).click();
 await page.getByLabel('Auswählen: Lea Sommer',{exact:true}).check();await page.getByRole('button',{name:'Adressbuchaktionen',exact:true}).click();
 await check('Adressbuch behält Import, Excel, vCard, Duplikate und Sammelaktionen',async()=>{for(const text of ['Adressbuch als Excel herunterladen','vCard exportieren','Duplikate & Kontakte zusammenführen','Alle auswählen','Als „Aktiv“ markieren'])assert.ok(await page.getByRole('button',{name:text}).count()>0,text);assert.equal(await page.locator('#mobileOnlineSheet input[type=file]').count(),1)});
 await page.evaluate(()=>__mobileUI.closeSheet());await page.getByRole('button',{name:'Details: Lea Sommer',exact:true}).click();
 await check('Kontaktseite enthält Anruf, E-Mail, Bearbeiten und Referenzen',async()=>{assert.equal(await page.getByRole('link',{name:'Anrufen',exact:true}).count(),1);assert.equal(await page.locator('.ab-mobile-view').getByRole('button',{name:'E-Mail',exact:true}).count(),1);assert.match(await page.locator('.ab-mobile-view').innerText(),/DE02120300000000202051/)});
 await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'adressbuch-detail.png')});await page.getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('.mobile-contact-form').waitFor();
 await page.locator('#abLastName').fill('Sommer – Entwurf');await check('Kontakteditor bewahrt getrennte Telefonfelder und Bankreferenzen',async()=>{for(const id of ['abPhoneArea','abPhoneNumber','abMobileArea','abMobileNumber','abFaxArea','abFaxNumber','abIban','abBic','abBankName'])assert.equal(await page.locator('#'+id).count(),1,id)});
 await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'adressbuch-formular.png')});await page.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.getByRole('button',{name:'Weiter bearbeiten',exact:true}).click();await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('.ab-mobile-view').waitFor();
 await check('Kontakt speichern kehrt zur Liste zurück und bewahrt Referenzen',async()=>{const c=await page.evaluate(()=>state.caseData.contacts.find(c=>c.lastName==='Sommer – Entwurf'));assert.equal(c.iban,'DE02120300000000202051');assert.equal(c.phoneArea,'0261')});
 await page.getByRole('button',{name:'Neuer Kontakt',exact:true}).click();await page.locator('#abCategory').selectOption({index:1});await page.locator('#abLastName').waitFor();await page.locator('#abLastName').fill('Neuer Kontakt');await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('.ab-mobile-view').waitFor();
 await check('Neue Kontakte erhalten nach Kategorienwahl alle Originalfelder',async()=>assert.equal(await page.evaluate(()=>state.caseData.contacts.some(c=>c.lastName==='Neuer Kontakt')),true));
 await page.getByRole('button',{name:'Details: Neuer Kontakt',exact:true}).click();await page.getByRole('button',{name:'Weitere Kontaktaktionen',exact:true}).click();await page.getByRole('button',{name:'Beenden',exact:true}).click();
 await check('Kontaktstatus kehrt zu einer aktualisierten Liste zurück',async()=>{await page.locator('.ab-mobile-view[data-mobile-screen=list]').waitFor();assert.equal(await page.getByRole('button',{name:'Details: Neuer Kontakt',exact:true}).count(),0)});
 await page.getByRole('button',{name:'Adressbuchaktionen',exact:true}).click();await page.getByRole('button',{name:'Alle auswählen',exact:true}).click();await page.getByRole('button',{name:'Adressbuchaktionen',exact:true}).click();await page.getByRole('button',{name:'Auswahl aufheben',exact:true}).click();
 await check('Sammelauswahl lässt sich über wiederholt geöffnete Aktionen steuern',async()=>assert.equal(await page.locator('.ab-mobile-row-open').count(),2));
 await page.getByRole('button',{name:'Kontakte filtern',exact:true}).click();await page.locator('#abCaseSwitcherSel').selectOption('__buero');await page.getByRole('button',{name:'Neuer Büro-Kontakt',exact:true}).waitFor();
 await check('Wechsel zu Bürokontakten schließt das Filterblatt ohne doppelte Felder',async()=>{assert.equal(await page.locator('#mobileOnlineSheet').isVisible(),false);assert.equal(await page.locator('#phase5AddressStatusV154').count(),1)});
 await page.getByRole('button',{name:'Kontakte filtern',exact:true}).click();await page.locator('#abCaseSwitcherSel').selectOption('case-a');await page.getByRole('button',{name:'Neuer Kontakt',exact:true}).waitFor();
 await page.evaluate(()=>{window.closeModal();window.renderCaseReview();});await page.locator('#mobileOnlineShell [data-mobile-more]').click();await page.locator('#mobileOnlineSheet [data-mobile-action="master-data"]').click();
 await page.locator('.master-mobile-view').waitFor();
 await check('Stammdaten stellt sämtliche 13 vorhandenen Datenabschnitte bereit',async()=>assert.equal(await page.locator('[data-master-key]').count(),13));
 await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'stammdaten-bereiche.png')});await page.getByRole('button',{name:'Öffnen: Person und Identität',exact:true}).click();await page.locator('#caseReview [data-casepath="person.firstName"]').fill('Mara Test');
 await check('Stammdaten verwendet weiterhin die Originalfelder mit laufender Übernahme',async()=>assert.equal(await page.evaluate(()=>state.caseData.person.firstName),'Mara Test'));
 await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove()));await page.screenshot({path:path.join(output,'stammdaten-person.png')});await page.getByRole('button',{name:'Zurück zu Stammdaten',exact:true}).click();await page.getByRole('button',{name:'Öffnen: Kontakt und Anschrift',exact:true}).click();await page.locator('.master-mobile-view .person-contact-edit-top-v160').click();await page.locator('#pcCity').fill('Bonn');
 await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('.mobile-contact-form').waitFor({state:'hidden'});
 await check('Kontaktdateneditor schreibt getrennte Anschrift und kehrt zu Stammdaten zurück',async()=>{assert.equal(await page.evaluate(()=>state.caseData.person.city),'Bonn');assert.equal(await page.locator('.master-mobile-view').count(),1)});
 await page.evaluate(()=>window.__caseOverview.openFollowups());await page.locator('.follow-mobile-view').waitFor();
 for(const width of [320,360,390,430])for(const dark of [false,true]){
  await page.setViewportSize({width,height:844});await page.evaluate(dark=>document.documentElement.dataset.theme=dark?'dark':'light',dark);await page.waitForTimeout(100);
  await check('Wiedervorlagenlayout '+width+'px '+(dark?'dunkel':'hell'),async()=>{const bounds=await page.evaluate(()=>{const root=document.querySelector('.follow-mobile-view'),nav=document.getElementById('mobileOnlineShell');return{overflow:root.scrollWidth>root.clientWidth,bottom:root.getBoundingClientRect().bottom,nav:nav.getBoundingClientRect().top}});assert.equal(bounds.overflow,false);assert.ok(bounds.bottom<=bounds.nav+1)});
 }
 // Shared geometry is checked for every migrated list, not just the shortest fixture.
 const modules=[
  {id:'Fristen',root:'.fr-mobile-view',open:()=>window.openFristenModal(),form:()=>window.__frNew(),field:'#frF_title'},
  {id:'Adressbuch',root:'.ab-mobile-view',open:()=>window.showImportedAddressbook()},
  {id:'Stammdaten',root:'.master-mobile-view',open:async()=>{window.closeModal();window.renderCaseReview();document.querySelector('#mobileOnlineShell [data-mobile-more]').click();document.querySelector('#mobileOnlineSheet [data-mobile-action="master-data"]').click()}}
 ];
 for(const module of modules){
  await page.setViewportSize({width:390,height:844});await page.evaluate(module.open);await page.locator(module.root).waitFor();if(module.id==='Stammdaten'&&await page.locator('[data-master-back]').count())await page.locator('[data-master-back]').click();
  for(const width of [320,390,430])for(const dark of [false,true]){
   await page.setViewportSize({width,height:844});await page.evaluate(d=>document.documentElement.dataset.theme=d?'dark':'light',dark);await page.waitForTimeout(120);
   await check(module.id+' Layout '+width+'px '+(dark?'dunkel':'hell'),async()=>{
    const layout=await page.locator(module.root).evaluate(root=>({width:root.clientWidth,scroll:root.scrollWidth,bottom:root.getBoundingClientRect().bottom,nav:document.getElementById('mobileOnlineShell').getBoundingClientRect().top,actions:[...root.querySelectorAll(':scope>.mobile-ui-header button')].filter(b=>!b.hidden).map(b=>({label:b.ariaLabel,x:b.getBoundingClientRect().x,right:b.getBoundingClientRect().right,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,bottom:b.getBoundingClientRect().bottom,headerBottom:b.closest('header').getBoundingClientRect().bottom}))}));
    assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));assert.ok(layout.bottom<=layout.nav+1,JSON.stringify(layout));
    for(const action of layout.actions){assert.ok(action.x>=0&&action.right<=width+1,JSON.stringify(action));assert.ok(action.bottom<=action.headerBottom+1,JSON.stringify(action));assert.ok(action.width>=43&&action.height>=43,JSON.stringify(action))}
   });
  }
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.dataset.theme='light';window.openFristenModal()});await page.getByRole('button',{name:'Neue Frist',exact:true}).click();await page.locator('#frF_title').focus();
 await page.evaluate(()=>{window.__qaRealViewport=window.visualViewport;const v=new EventTarget();Object.assign(v,{height:520,width:390,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:v});__qaRealViewport.dispatchEvent(new Event('resize'))});await page.waitForTimeout(150);
 await check('Fristenaktionen bleiben bei geöffneter Tastatur erreichbar',async()=>{assert.equal(await page.locator('#mobileOnlineShell').isVisible(),false);const b=await page.locator('.fr-mobile-view>.mobile-ui-actions').boundingBox();assert.ok(b.y+b.height<=521)});
 await page.evaluate(()=>{Object.defineProperty(window,'visualViewport',{configurable:true,value:__qaRealViewport});__qaRealViewport.dispatchEvent(new Event('resize'))});await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
 // Office contacts use a different persistence path. A failed POST must retain the form and context.
 await page.evaluate(()=>{const previous=window.fetch;window.__qaOfficeFail=true;window.fetch=async(url,opts={})=>{if(String(url)==='/api/office-contacts'&&opts.method==='POST'){if(__qaOfficeFail)return new Response('{}',{status:503});return new Response(JSON.stringify({id:'office-created'}),{status:200})}return previous(url,opts)};window.__baEditBuero('office-new','addressbook')});
 await page.locator('.mobile-contact-form').waitFor();
 await page.locator('#baE_lastName').fill('Bürokontakt Test');await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.waitForTimeout(150);
 await check('Bürokontakt bleibt bei Speicherfehler als Entwurf erhalten',async()=>assert.equal(await page.locator('#baE_lastName').inputValue(),'Bürokontakt Test'));
 await page.evaluate(()=>window.__qaOfficeFail=false);await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('.mobile-contact-form').waitFor({state:'hidden'});
 await check('Bürokontakt lässt sich nach einem Fehler erneut speichern',async()=>assert.equal(await page.locator('.mobile-contact-form').isVisible(),false));
 await page.setViewportSize({width:1366,height:900});await page.waitForTimeout(100);await page.evaluate(()=>window.openFristenModal());await check('Desktop-Fristen behalten ihre ursprüngliche Ansicht',async()=>{assert.equal(await page.locator('.fr-toolbar-main').count(),1);assert.equal(await page.locator('.fr-mobile-view').count(),0)});
 assert.deepEqual(errors,[]);console.log('PASS Keine JavaScript-Laufzeitfehler');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
