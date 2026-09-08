'use strict';
// Runs the real shipped app with synthetic tasks and an intercepted backend; no external writes.
const chromium=require(process.env.PLAYWRIGHT_MODULE||'playwright')[process.env.MOBILE_QA_BROWSER||'chromium'];
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=process.env.MOBILE_QA_OUTPUT||'/tmp/mobile-navigation-qa';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Berlin',locale:'de-DE',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});
 await page.route('https://**/*',r=>r.abort());await page.route('http://**/*',r=>r.abort());
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
 const nav=page.locator('#mobileOnlineShell');
 const isHidden=()=>nav.evaluate(e=>e.inert&&e.getAttribute('aria-hidden')==='true'&&(getComputedStyle(e).opacity==='0'||getComputedStyle(e).display==='none'));
 const scroll=async(selector,y)=>{await page.locator(selector).evaluate((e,y)=>e.scrollTop=y,y);await page.waitForTimeout(55)};
 const hide=async selector=>{await scroll(selector,0);await scroll(selector,120);await scroll(selector,210);await page.waitForTimeout(300);assert.equal(await isHidden(),true)};
 const area='.todo-mobile-pilot>.mobile-ui-body';
 await page.evaluate(()=>{for(let i=0;i<60;i++)__qaTodos.push({id:'nav-'+i,title:'Weitere Aufgabe '+i,description:'Ein längerer Arbeitsablauf für die Prüfung der mobilen Navigation.',priority:'normal',itemType:'task',done:false})});
 await page.evaluate(()=>window.openTodoFullView());await page.locator(area).waitFor();await page.waitForTimeout(350);
 await check('Neue Aufgabenansicht startet mit sichtbarer Navigation',async()=>assert.equal(await isHidden(),false));
 const before=await page.locator(area).boundingBox();
 await hide(area);
 await check('Abwärtsscrollen blendet Navigation aus und entfernt unsichtbare Fokusziele',async()=>{assert.equal(await isHidden(),true);assert.ok((await page.locator(area).boundingBox()).height>=before.height+65)});
 await check('Ausgeblendete Navigation gibt keine dahinterliegende Startseite frei',async()=>{assert.match(await page.locator('#modal').evaluate(e=>getComputedStyle(e).backgroundColor),/^rgb\(/)});
 await page.screenshot({path:path.join(output,'navigation-ausgeblendet.png')});
 await scroll(area,205);await scroll(area,209);await scroll(area,204);await page.waitForTimeout(300);
 await check('Kleine Richtungswechsel lassen die Leiste ruhig',async()=>assert.equal(await isHidden(),true));
 await scroll(area,180);await page.waitForTimeout(300);
 await check('Aufwärtsscrollen blendet Navigation wieder ein',async()=>{assert.equal(await isHidden(),false);assert.deepEqual(await page.locator(area).boundingBox(),before)});
 await hide(area);await scroll(area,0);await page.waitForTimeout(220);
 await check('Am Seitenanfang erscheint die Leiste wieder',async()=>assert.equal(await isHidden(),false));
 await page.screenshot({path:path.join(output,'navigation-sichtbar.png')});
 await hide(area);await page.locator(area).evaluate(e=>e.scrollTop=e.scrollHeight);await page.waitForTimeout(600);
 await check('Am Listenende bleibt die Navigation trotz größerer Arbeitsfläche ruhig',async()=>{assert.equal(await isHidden(),true);const b=await page.locator(area).boundingBox();assert.ok(b.y+b.height>840)});
 await scroll(area,0);await page.waitForTimeout(200);
 await check('Mehr-Menü bleibt beim Scrollen seines Blatts sichtbar',async()=>{
  await page.locator('[data-mobile-more]').click();await page.locator('.mobile-sheet-content').evaluate(e=>e.scrollTop=300);await page.waitForTimeout(300);assert.equal(await isHidden(),false);await page.keyboard.press('Escape');
 });
 await hide(area);await page.evaluate(()=>window.__todoShowNewForm());await page.locator('#todoNewTitle').waitFor();await page.waitForTimeout(250);
 await check('Öffnen eines Formulars zeigt Navigation wieder',async()=>assert.equal(await isHidden(),false));
 const footer=await page.locator('.todo-mobile-pilot>.mobile-ui-actions').boundingBox();
 await hide(area);
 await check('Auch lange Formulare verwenden die Scrollregel, ihre Aktionen rücken an den unteren Bildschirmrand',async()=>{assert.ok((await page.locator('.todo-mobile-pilot>.mobile-ui-actions').boundingBox()).y>=footer.y+65);assert.equal(await page.getByRole('button',{name:'Speichern',exact:true}).isVisible(),true)});
 await page.locator('#todoNewTitle').focus();
 await page.evaluate(()=>{
   window.__qaViewportOriginal=window.visualViewport;
   const v=new EventTarget();Object.assign(v,{height:innerHeight,width:innerWidth,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:v});window.__qaViewport=v;
   // The app listeners belong to the real VisualViewport. Send its real event after
   // changing the measured geometry, equivalent to the OS keyboard resizing the viewport.
   window.__qaViewport.height=520;window.__qaViewportOriginal.dispatchEvent(new Event('resize'));
 });
 await page.waitForTimeout(120);
 await check('Bildschirmtastatur blendet Navigation vollständig aus',async()=>{assert.equal(await isHidden(),true);assert.equal(await nav.evaluate(e=>getComputedStyle(e).display),'none');assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('mobile-keyboard-open')),true)});
 await check('Speichern und Abbrechen liegen oberhalb der Tastatur',async()=>{const b=await page.locator('.todo-mobile-pilot>.mobile-ui-actions').boundingBox();assert.ok(b.y+b.height<=520);assert.equal(await page.locator('#todoNewTitle').count(),1)});
 await scroll(area,0);await page.evaluate(()=>document.getElementById('mobileOnlineShell').classList.remove('is-hidden'));await page.waitForTimeout(150);
 await check('Tastatur gewinnt gegen Seitenanfang und ältere Einblend-Aufrufe',async()=>assert.equal(await isHidden(),true));
 await page.evaluate(()=>{__qaViewport.height=844;__qaViewportOriginal.dispatchEvent(new Event('resize'))});await page.waitForTimeout(220);
 await check('Nach Tastaturschluss wird Navigation automatisch sichtbar',async()=>{assert.equal(await isHidden(),false);assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('mobile-keyboard-open')),false)});
 await page.evaluate(()=>{__qaViewport.scale=1.8;__qaViewport.height=450;__qaViewportOriginal.dispatchEvent(new Event('resize'))});
 await check('Pinch-Zoom wird nicht als Tastatur behandelt',async()=>assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('mobile-keyboard-open')),false));
 await page.evaluate(()=>{__qaViewport.scale=1;__qaViewport.height=520;window.__qaInnerHeightDescriptor=Object.getOwnPropertyDescriptor(window,'innerHeight');Object.defineProperty(window,'innerHeight',{configurable:true,value:520});__qaViewportOriginal.dispatchEvent(new Event('resize'))});
 await check('Auch Android mit verkleinertem Layout-Viewport wird erkannt',async()=>assert.equal(await isHidden(),true));
 await page.evaluate(()=>{Object.defineProperty(window,'innerHeight',{configurable:true,value:844});__qaViewport.height=844;__qaViewportOriginal.dispatchEvent(new Event('resize'));Object.defineProperty(window,'innerHeight',__qaInnerHeightDescriptor);Object.defineProperty(window,'visualViewport',{configurable:true,value:__qaViewportOriginal})});
 await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
 await page.evaluate(()=>{state.caseData.person.firstName='Mara';state.caseData.person.lastName='Hoffmann';state.caseData.documentationEntries=Array.from({length:60},(_,i)=>({id:'doku-nav-'+i,date:'2026-09-07',year:'2026',actor:'Wohnberatung',actorGroup:'Beratungsstelle',type:'Wohnen',detail:'Telefonat '+i,note:'Rückruf vereinbart.',contactType:'telefonisch',source:'manual'}));window.openDocumentationView()});await page.locator('.fd-shell').waitFor();await page.waitForTimeout(250);
 const doku=await page.locator('#modalBody').evaluate(root=>{const e=[...root.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+300&&['auto','scroll'].includes(getComputedStyle(e).overflowY));if(e)e.dataset.navQaScroller='doku';return !!e});assert.ok(doku);
 await hide('[data-nav-qa-scroller=doku]');
 await check('Dokumentationsliste verwendet denselben Standard',async()=>assert.equal(await isHidden(),true));
 await scroll('[data-nav-qa-scroller=doku]',0);await page.locator('.fd-fab').click();await page.locator('#dokuNote').waitFor();await page.waitForTimeout(250);assert.equal(await isHidden(),false);
 await hide('.fd-form-b');
 await check('Auch Dokumentationsformulare überschreiben die Scrollregel nicht mehr',async()=>{assert.equal(await isHidden(),true);assert.equal(await page.locator('.fd-form-f').isVisible(),true)});
 await page.locator('#dokuNote').focus();await page.evaluate(()=>{const v=new EventTarget();Object.assign(v,{height:520,width:390,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:v});__qaViewportOriginal.dispatchEvent(new Event('resize'))});await page.waitForTimeout(150);
 await check('Dokumentation behält ihre Formularaktionen über der Tastatur',async()=>{assert.equal(await isHidden(),true);const b=await page.locator('.fd-form-f').boundingBox();assert.ok(b.y+b.height<=521)});
 await page.evaluate(()=>{Object.defineProperty(window,'visualViewport',{configurable:true,value:__qaViewportOriginal});__qaViewportOriginal.dispatchEvent(new Event('resize'))});
 await page.evaluate(()=>{
   const previous=window.fetch,people=[{id:1,displayName:'Mara Muster',status:'online'},{id:2,displayName:'Anna Beispiel',status:'online'}];
   window.fetch=async(url,options={})=>{
     const u=String(url);if(!u.startsWith('/api/chat/'))return previous(url,options);
     let result={};
     if(u==='/api/chat/users')result={users:people};
     else if(u==='/api/chat/conversations')result={conversations:[{id:'nav-chat',type:'group',title:'Navigationstest',unread:1,participants:people,updatedAt:'2026-09-07T08:00:00Z',lastMessage:{body:'Letzte Testnachricht',senderUserId:2,createdAt:'2026-09-07T08:00:00Z'}}]};
     else if(u.includes('/messages'))result={messages:Array.from({length:60},(_,i)=>({id:'message-'+i,senderUserId:2,senderName:'Anna Beispiel',kind:'user',body:'Testnachricht '+i+' für einen längeren mobilen Gesprächsverlauf.',createdAt:'2026-09-07T08:00:00Z'}))};
     return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
   };
   const source=[...document.scripts].find(s=>s.textContent.includes('   NUTZERCHAT (Nutzerwunsch 2026-08-12)')).textContent;
   const marker=source.indexOf('   NUTZERCHAT (Nutzerwunsch 2026-08-12)');(0,eval)(source.slice(source.indexOf('(function(){',marker)));window.__userChat.open({list:true});
 });
 await page.locator('.uchat-conv-item').filter({hasText:'Navigationstest'}).click();await page.locator('#uchatLog .uchat-msg-row').first().waitFor();
 await hide('#uchatLog');
 await check('Mitarbeiterchat folgt derselben Scrollregel',async()=>assert.equal(await isHidden(),true));
 await page.locator('#uchatInput').focus();await page.evaluate(()=>{const v=new EventTarget();Object.assign(v,{height:520,width:390,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:v});__qaViewportOriginal.dispatchEvent(new Event('resize'))});await page.waitForTimeout(150);
 await check('Chat-Tastatur blendet Navigation aus und lässt den Nachrichtenversand erreichbar',async()=>{assert.equal(await isHidden(),true);const b=await page.locator('#uchatSendBtn').boundingBox();assert.ok(b.y+b.height<=520);assert.equal(await page.locator('#uchatInput').isVisible(),true)});
 await page.evaluate(()=>{Object.defineProperty(window,'visualViewport',{configurable:true,value:__qaViewportOriginal});__qaViewportOriginal.dispatchEvent(new Event('resize'));window.__userChat.close()});await page.waitForTimeout(180);
 await check('Chat-Rückkehr zeigt die Navigation wieder',async()=>assert.equal(await isHidden(),false));
 await page.setViewportSize({width:1366,height:900});await page.waitForTimeout(200);
 await check('Desktop erhält weder mobile Tastaturklasse noch mobile Navigation',async()=>{assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('mobile-keyboard-open')),false);assert.equal(await nav.isVisible(),false)});
 assert.deepEqual(errors,[]);console.log('PASS Keine JavaScript-Laufzeitfehler');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
