'use strict';
// Shipped UI, synthetic accounts and intercepted APIs. No real provider requests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixture=fs.readFileSync(path.join(__dirname,'qa-mobile-completion.cjs'),'utf8').split('(async()=>{const{browser,page}=await setup()')[0];
const setup=new Function('require','__dirname',fixture+';return setup;')(require,__dirname);
const output=process.env.CALENDAR_SOURCE_QA_OUTPUT||'/tmp/calendar-source-qa';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const {browser,page}=await setup();const errors=[];let checks=0;page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(8000);
 const ok=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS '+name)};
 try{
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{
   const original=window.fetch,today=new Date(),date=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
   window.__qaSourcePrefs={version:1,localCalendar:true,localTasks:true,defaultCalendar:null,defaultTasks:null};
   window.__qaSourceConns=['a','b'].map(id=>({id,provider:'google',displayName:id==='a'?'Büro':'Persönlich',calendars:[{kind:'event',remoteId:'primary',name:'Termine'},{kind:'task',remoteId:'same',name:'Aufgaben'}]}));
   window.__qaSourceEvents=[{id:'local',title:'Lokaler Termin'},...['a','b'].map(id=>({id,title:'Termin '+id,connectionId:id,calendarRef:'primary'}))].map(e=>({...e,startAt:date+'T10:00:00',endAt:date+'T11:00:00'}));
   window.__qaSourceTodos=[{id:'local-task',title:'Lokale Aufgabe',itemType:'task'},{id:'local-followup',title:'Lokale Wiedervorlage',itemType:'followup',sourceType:'document',sourceId:'doc'},...['a','b'].map(id=>({id:'task-'+id,title:'Aufgabe '+id,itemType:'task',connectionId:id,calendarRef:'same'})),{id:'remote-followup',title:'Online-Wiedervorlage',itemType:'followup',sourceType:'document',sourceId:'doc',connectionId:'a',calendarRef:'same'}].map(t=>({...t,dueAt:date+'T12:00:00',priority:'normal',done:false}));
   window.fetch=async(url,options={})=>{
    const u=String(url),method=options.method||'GET';let result,status=200;
    if(u==='/api/calendar/connections')result={connections:__qaSourceConns,sourcePreferences:__qaSourcePrefs};
    else if(u==='/api/calendar/source-preferences'&&method==='PUT'){const prefs=JSON.parse(options.body).prefs;if(__qaSourceFail){status=503;result={error:'Test: Speichern fehlgeschlagen'}}else{__qaSourcePrefs=prefs;result={prefs}}}
    else if(u==='/api/calendar/events')result={events:__qaSourceEvents};
    else if(u==='/api/todos')result={todos:__qaSourceTodos};
    else return original(url,options);
    return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json'}});
   };
  });
  await page.evaluate(()=>openCalendarFullView());
  await page.locator('.cal-sidebar .cal-vis-panel>summary').first().click();
  const popup=page.locator('.cal-sidebar .cal-vis-panel[open] .cal-vis-drop');
  ok('Kalender zeigen Anbieter und beide Konten getrennt',await popup.getByRole('checkbox',{name:'Termine · Google Kalender · Büro',exact:true}).count()===1&&await popup.getByRole('checkbox',{name:'Termine · Google Kalender · Persönlich',exact:true}).count()===1);
  await popup.getByRole('checkbox',{name:'Termine · Google Kalender · Büro',exact:true}).uncheck();
  ok('Gleichnamiger Kalender des zweiten Kontos bleibt sichtbar',await popup.getByRole('checkbox',{name:'Termine · Google Kalender · Persönlich',exact:true}).isChecked());
  await popup.getByRole('checkbox',{name:'Termine · Google Kalender · Büro',exact:true}).check();
  await page.screenshot({path:path.join(output,'calendar-sources-light.png')});
  await page.evaluate(()=>openTodoFullView());await page.locator('[data-tw=tools]').click();await page.locator('[data-tw=lists]').filter({visible:true}).last().click();
  let panel=page.locator('.at-panel');
  ok('Aufgabenlisten zeigen Herkunft auf zwei Zeilen',await panel.locator('.cal-source-copy').allTextContents().then(rows=>rows.some(x=>x.includes('Google Kalender · Büro'))&&rows.some(x=>x.includes('Google Kalender · Persönlich'))));
  await panel.getByRole('checkbox',{name:'Lokale Wiedervorlagen · In dieser Software',exact:true}).uncheck();await panel.locator('[data-tw=apply-lists]').click();
  ok('Lokale Wiedervorlagen lassen Online-Wiedervorlagen eingeblendet',await page.locator('[data-todo-id=remote-followup]').count()===1&&await page.locator('[data-todo-id=local-followup]').count()===0);
  await page.locator('[data-tw=tools]').click();await page.locator('[data-tw=sources]').click();
  const settings=page.locator('.at-panel .cal-source-settings');
  await settings.locator('[data-cal-target=defaultCalendar]').selectOption('@a|primary');await settings.locator('[data-cal-target=defaultTasks]').selectOption('@b|same');await settings.locator('[data-cal-local=localCalendar]').uncheck();await settings.locator('[data-cal-local=localTasks]').uncheck();
  await page.evaluate(()=>__qaSourceFail=true);await settings.getByRole('button',{name:'Speicherziele speichern'}).click();
  ok('Speicherfehler wird sichtbar und ändert den aktiven Zustand nicht',await settings.getByRole('status').innerText().then(t=>t.includes('fehlgeschlagen'))&&await page.evaluate(()=>__calLocalSourceEnabled('event')));
  await page.evaluate(()=>__qaSourceFail=false);await settings.getByRole('button',{name:'Speicherziele speichern'}).click();
  ok('Lokale Speicherziele werden gespeichert und lokale Aufgaben verschwinden',await page.evaluate(()=>!__qaSourcePrefs.localCalendar&&!__qaSourcePrefs.localTasks)&&await page.locator('[data-todo-id=local-task]').count()===0&&await page.locator('[data-todo-id=task-a]').count()===1);
  await page.screenshot({path:path.join(output,'source-settings-light.png')});
  await page.locator('[data-tw=new]').click();await page.locator('#todoNewConnection').waitFor();
  ok('Neue Aufgabe hat ausschließlich Online-Ziele und gewählte Standardliste',await page.locator('#todoNewConnection option[value=local]').count()===0&&await page.locator('#todoNewConnection').inputValue()==='b'&&await page.locator('#todoNewCalendar').inputValue()==='same');
  await page.evaluate(()=>{closeModal();return openCalendarFullView()});
  await page.getByRole('button',{name:/Neuer Termin/}).first().click();await page.locator('#calNewConnection').waitFor();
  ok('Neuer Termin hat ausschließlich Online-Ziele und gewählten Standardkalender',await page.locator('#calNewConnection option[value=local]').count()===0&&await page.locator('#calNewConnection').inputValue()==='a'&&await page.locator('#calNewCalendar').inputValue()==='primary');
  await page.evaluate(()=>{closeModal();window.__caseOverview.workspaceData=async()=>({cases:[],sources:[],deadlineTodoIds:[],todos:__qaSourceTodos});return openFollowupsWorkspace()});
  ok('Wiedervorlagenansicht respektiert lokale Abschaltung und zeigt Kontoherkunft',await page.locator('#wiedervorlagenWorkspace .wv-row').count()===1&&await page.locator('#wiedervorlagenWorkspace .wv-row').innerText().then(t=>t.includes('Google Kalender · Büro')));
  await page.evaluate(()=>{closeModal();return openTodoFullView()});
  for(const width of [320,390,768,1440])for(const dark of [false,true]){
   await page.setViewportSize({width,height:1000});await page.evaluate(d=>document.documentElement.dataset.theme=d?'dark':'light',dark);await page.evaluate(()=>openTodoFullView());await page.locator('[data-tw=tools]').click();await page.locator('[data-tw=lists]').filter({visible:true}).last().click();
   ok('Quellen passen bei '+width+' '+(dark?'Dunkel':'Hell'),await page.locator('.at-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   ok('Farbauswahl bleibt bedienbar bei '+width+' '+(dark?'Dunkel':'Hell'),await page.locator('.at-color-row input[type=color]').first().evaluate(el=>el.getBoundingClientRect().width>=32));
   if(width===390||width===1440)await page.screenshot({path:path.join(output,'task-sources-'+width+(dark?'-dark':'-light')+'.png')});
  }
  for(const dark of [false,true]){
   await page.setViewportSize({width:390,height:1000});await page.waitForFunction(()=>document.documentElement.classList.contains('mobile-online-active'));await page.evaluate(d=>{document.documentElement.dataset.theme=d?'dark':'light';closeModal();return openCalendarFullView()},dark);
   await page.getByRole('button',{name:'Weitere Kalenderaktionen',exact:true}).click();await page.getByRole('button',{name:'Kalender und Listen anzeigen / ausblenden',exact:true}).click();
   ok('Mobiler Kalender zeigt beide Konten '+(dark?'Dunkel':'Hell'),await page.locator('.cal-mobile-settings-sheet').innerText().then(t=>t.includes('Google Kalender · Büro')&&t.includes('Google Kalender · Persönlich')));
   await page.screenshot({path:path.join(output,'calendar-mobile-'+(dark?'dark':'light')+'.png')});
   const mobileSettings=page.locator('.cal-mobile-settings .cal-source-settings');await mobileSettings.locator('summary').click();await mobileSettings.locator('[data-cal-local=localCalendar]').check();
   await mobileSettings.locator('[data-cal-target=defaultCalendar]').selectOption('@b|primary');
   ok('Mobile Einstellungen behalten ungespeicherte Auswahl '+(dark?'Dunkel':'Hell'),await mobileSettings.locator('[data-cal-local=localCalendar]').isChecked()&&await mobileSettings.locator('[data-cal-target=defaultCalendar]').inputValue()==='@b|primary');
   await mobileSettings.getByRole('button',{name:'Speicherziele speichern'}).click();await page.waitForFunction(()=>__qaSourcePrefs.localCalendar===true);
   await mobileSettings.locator('[data-cal-local=localCalendar]').uncheck();await mobileSettings.getByRole('button',{name:'Speicherziele speichern'}).click();await page.waitForFunction(()=>__qaSourcePrefs.localCalendar===false);
   ok('Mobile Einstellungen speichern und lassen sich wieder abschalten '+(dark?'Dunkel':'Hell'),await page.evaluate(()=>__qaSourcePrefs.defaultCalendar.connectionId==='b'));
   await page.evaluate(()=>{__mobileUI.closeSheet();__mobileUI.closeSheet()});
  }
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{closeModal();return openEinstellungenApp('kalender')});
  await page.locator('#einKalQuellen .cal-source-settings').waitFor();await page.locator('#einKalQuellen summary').click();
  await page.locator('#einKalQuellen [data-cal-local=localCalendar]').check();await page.locator('#einKalQuellen [data-cal-local=localTasks]').check();await page.locator('#einKalQuellen button').click();
  ok('Einstellungen speichern ohne aus der Einstellungsseite zu springen',await page.locator('#einKalQuellen').count()===1&&await page.evaluate(()=>__qaSourcePrefs.localTasks));
  await page.evaluate(()=>{closeModal();return openTodoFullView()});ok('Erneutes Einschalten stellt gespeicherte lokale Aufgaben wieder dar',await page.locator('[data-todo-id=local-task]').count()===1);
  ok('Keine JavaScript-Laufzeitfehler',errors.length===0);console.log(JSON.stringify({checks,errors,output}));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
