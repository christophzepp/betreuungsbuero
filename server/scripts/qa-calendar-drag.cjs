'use strict';
// Real mouse gestures against the shipped app, using exclusively synthetic records.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async(page,check,output)=>{
 const settle=()=>page.waitForTimeout(400);
 const event=id=>page.locator('.caltime-event[data-event-id="'+id+'"]');
 const saved=id=>page.evaluate(id=>__qaEvents.find(e=>String(e.id)===String(id)),id);
 const localSaved=id=>page.evaluate(id=>JSON.parse(localStorage.getItem(CAL_STORAGE_KEY)).find(e=>String(e.id)===String(id)),id);
 await page.evaluate(async()=>{await __calViewPrefSet('weekends',true);await __calViewPrefSet('hours','8-18');await __calViewPrefSet('hourHeight',66);await __calendarSetView('week');document.querySelectorAll('.cal-vis-panel,.cal-tools').forEach(el=>el.open=false)});await settle();
 const today=await page.evaluate(()=>__qaToday),other=await page.locator('.caltime-daycol').evaluateAll((cols,today)=>cols.find(c=>c.dataset.day!==today).dataset.day,today);
 let lastPreview='',lastPreviewHeight=0;
 async function drag(source,target,{minutes,grab=.5,cancel=false,screenshot,refresh=false}={}){
  await source.scrollIntoViewIfNeeded();
  const a=await source.boundingBox(),b=await target.boundingBox();assert.ok(a&&b,'Source and destination must exist');
  const timed=await source.evaluate(el=>el.classList.contains('caltime-event'));
  const css=await target.evaluate(el=>{const wrap=el.closest('.caltime-wrap');return wrap?{hour:parseFloat(getComputedStyle(wrap).getPropertyValue('--caltime-hour')),from:parseFloat(getComputedStyle(wrap).getPropertyValue('--caltime-from'))}:null});
  const offset=Math.min(a.height-3,Math.max(3,a.height*grab));
  const dest={x:b.x+b.width/2,y:minutes===undefined?b.y+Math.min(b.height/2,18):b.y+(minutes-css.from*60)/60*css.hour+(timed?offset:0)};
  assert.ok(dest.y>0&&dest.y<page.viewportSize().height,'Drop must be on screen: '+dest.y);
  await page.mouse.move(a.x+a.width/2,a.y+offset);await page.mouse.down();await page.mouse.move(a.x+a.width/2+8,a.y+offset,{steps:4});await page.mouse.move(dest.x,dest.y,{steps:18});await page.mouse.move(dest.x,dest.y,{steps:2});
  lastPreview=(await page.locator('.caltime-drop-ghost').allTextContents()).join('');
  lastPreviewHeight=await page.locator('.caltime-drop-ghost').evaluateAll(els=>els[0]?.getBoundingClientRect().height||0);
  if(refresh){await page.evaluate(async()=>{const root=document.querySelector('.cal-workspace');await window.openCalendarFullView();if(!root.isConnected)throw new Error('Background refresh replaced active drag target')})}
  if(screenshot)await page.screenshot({path:path.join(output,screenshot)});
  if(cancel){await page.mouse.move(2,2,{steps:4});await page.mouse.move(2,2)}
  await page.mouse.up();await settle();
 }
 const col=day=>page.locator('.caltime-daycol[data-day="'+day+'"]'),allDay=day=>page.locator('.caltime-allday-col[data-day="'+day+'"]');
 await drag(event('visit'),col(today),{minutes:735,screenshot:'uhrzeit-vorschau.png'});
 await check('Echtes Ziehen speichert 12:15 einschließlich Dauer, Erinnerung und Zielvorschau',async()=>{const e=await saved('visit');assert.equal(e.startAt,today+'T12:15:00');assert.equal(e.endAt,today+'T13:15:00');assert.equal(e.reminderAt,today+'T11:45:00');assert.match(lastPreview,/12:15/);assert.match(await page.locator('.cal-drag-message').innerText(),/verschoben.*12:15/)});
 await drag(event('visit'),col(other),{minutes:735,grab:.75,refresh:true});
 await check('Greifposition und Hintergrundaktualisierung erhalten den laufenden Ziehvorgang',async()=>{assert.equal((await saved('visit')).startAt,other+'T12:15:00');assert.equal(await event('visit').locator('..').getAttribute('data-day'),other)});
 await page.evaluate(()=>window.openCalendarFullView());await settle();
 await check('Erneutes Laden zeigt die gespeicherte Verschiebung',async()=>{assert.equal(await event('visit').locator('..').getAttribute('data-day'),other);assert.match(await event('visit').innerText(),/12:15/)});
 await page.evaluate(async()=>{await __calViewPrefSet('hours','0-24');await __calViewPrefSet('hourHeight',48);document.getElementById('calTimeScroll').scrollTop=9*48});await settle();
 const scroll=await page.locator('#calTimeScroll').evaluate(el=>el.scrollTop);
 await drag(event('visit'),col(today),{minutes:810});
 await check('Gescrolltes 24-Stunden-Raster speichert 13:30 und erhält die Scrollposition',async()=>{assert.equal((await saved('visit')).startAt,today+'T13:30:00');assert.equal(await page.locator('#calTimeScroll').evaluate(el=>el.scrollTop),scroll)});
 await page.evaluate(()=>__calendarSetView('day'));await settle();
 await drag(event('visit'),col(today),{minutes:855});
 await check('Tagesansicht erlaubt Verschieben auf eine andere Uhrzeit',async()=>assert.equal((await saved('visit')).startAt,today+'T14:15:00'));
 await page.evaluate(()=>__calendarSetView('week'));await settle();
 const before=await saved('visit');await page.evaluate(()=>__qaFailSave=true);
 await drag(event('visit'),col(other),{minutes:855});
 await check('Serverfehler erhält den ursprünglichen Termin und wird direkt im Kalender angezeigt',async()=>{assert.deepEqual(await saved('visit'),before);assert.equal(await page.locator('.cal-drag-message[role=alert]').count(),1);assert.equal(await page.locator('.cal-drag-source,.caltime-drop-ghost').count(),0)});
 await page.evaluate(()=>{__qaFailSave=false;__qaFailLoad=true});await drag(event('visit'),col(other),{minutes:855});
 await check('Ladefehler beim Ablegen bleibt sichtbar und schreibt keine Ersatzdaten',async()=>{assert.deepEqual(await saved('visit'),before);assert.match(await page.locator('.cal-drag-message').innerText(),/geladen/)});
 await page.evaluate(()=>__qaFailLoad=false);await drag(event('visit'),col(other),{minutes:855,cancel:true});
 await check('Ablegen außerhalb bricht ohne Speicherung und ohne Geisterrahmen ab',async()=>{assert.deepEqual(await saved('visit'),before);assert.equal(await page.locator('html.cal-dragging,.cal-drag-source,.caltime-drop-ghost').count(),0)});
 await drag(event('visit'),col(other),{minutes:855});
 await check('Nach Abbruch und Speicherfehler funktioniert der nächste Versuch',async()=>assert.equal((await saved('visit')).startAt,other+'T14:15:00'));
 await page.evaluate(async()=>{const t=__qaTodos.find(t=>t.id==='todo-a');t.dueAt=__qaToday+'T09:30:00';t.remindAt=__qaToday+'T09:00:00';t.sourceId='linked-document';await window.openCalendarFullView()});await settle();
 for(const [id,title,kind] of [['todo-a','Unterlagen prüfen','task'],['follow-a','Antwort abwarten','followup'],['deadline-a','Bericht abgeben','deadline']]){
  await drag(page.locator('.caltime-allday-chip').filter({hasText:title}),allDay(other));
  await check('Echtes Ziehen verschiebt '+kind+' in der Aufgabenablage',async()=>{const t=await page.evaluate(id=>__qaTodos.find(t=>t.id===id),id);assert.equal(t.dueAt.slice(0,10),other);assert.equal(t.itemType,kind);assert.equal(t.done,false);if(id==='todo-a'){assert.equal(t.dueAt,other+'T09:30:00');assert.equal(t.remindAt,other+'T09:00:00');assert.equal(t.sourceId,'linked-document')}});
 }
 await drag(page.locator('.caltime-allday-chip').filter({hasText:'Fortbildung'}),col(today),{minutes:660});
 await check('Ganztagstermin wird beim Ablegen auf 11 Uhr zu einem einstündigen Termin',async()=>{const e=await saved('allday');assert.equal(e.allDay,false);assert.equal(e.startAt,today+'T11:00:00');assert.equal(e.endAt,today+'T12:00:00');assert.equal(lastPreviewHeight,46)});
 await page.evaluate(async()=>{await __calViewPrefSet('lanes',0);await __calendarSetView('month');document.querySelectorAll('.cal-vis-panel,.cal-tools').forEach(el=>el.open=false)});await settle();
 await drag(page.locator('.calgrid-chip').filter({hasText:'Hausbesuch'}),page.locator('.calgrid-day[data-cal-day="'+today+'"]'));
 await check('Monatsraster verschiebt das Datum unter Erhalt von Uhrzeit und Dauer',async()=>{const e=await saved('visit');assert.equal(e.startAt,today+'T14:15:00');assert.equal(e.endAt,today+'T15:15:00')});
 await page.evaluate(()=>sessionStorage.setItem('betreuungsbuero.demoBoot.v1','1'));
 await page.addScriptTag({content:await page.locator('#aussendienst-2a-v1').textContent()});
 await check('Der lokale Test verwendet den echten Demo-Arbeitsspeicher der Anwendung',async()=>assert.equal(await page.evaluate(()=>__demoSpeicherAktiv&&localStorage===__adSpeicher),true));
 await page.evaluate(async()=>{
  window.__appMode='local';window.__demoModus=true;
  const items=__qaEvents.map(e=>({...e,startAt:new Date(e.startAt).toISOString(),endAt:new Date(e.endAt).toISOString()}));
  items.push({id:42,title:'Lokaler Termin',startAt:__qaToday+'T10:00:00',endAt:__qaToday+'T11:00:00',allDay:false});
  localStorage.setItem(CAL_STORAGE_KEY,JSON.stringify(items));localStorage.setItem(TODO_STORAGE_KEY,JSON.stringify(__qaTodos));
  await __calViewPrefSet('hours','8-18');await __calViewPrefSet('hourHeight',66);await __calendarSetView('week');
 });await settle();
 await drag(event('visit'),col(other),{minutes:780});
 await check('Lokale UTC-Termine werden auf den gewählten Tag und die lokale Stunde gespeichert',async()=>assert.equal((await localSaved('visit')).startAt,other+'T13:00:00'));
 await drag(event(42),col(other),{minutes:690});
 await check('Numerische lokale Kennungen werden statt eines stillen Abbruchs korrekt gespeichert',async()=>assert.equal((await localSaved(42)).startAt,other+'T11:30:00'));
 await page.evaluate(()=>window.openCalendarFullView());await settle();
 await check('Lokale Änderungen bleiben nach erneutem Öffnen des Kalenders erhalten',async()=>{assert.equal(await event(42).locator('..').getAttribute('data-day'),other);assert.match(await event(42).innerText(),/11:30/)});
 await page.evaluate(()=>{window.__qaSetItem=localStorage.setItem.bind(localStorage);Object.defineProperty(localStorage,'setItem',{configurable:true,value:(key,value)=>{if(key===CAL_STORAGE_KEY)throw new Error('Speicher voll');return __qaSetItem(key,value)}})});
 await drag(event(42),col(today),{minutes:720});
 await check('Lokaler Speicherfehler wird angezeigt und erhält die ursprüngliche Uhrzeit',async()=>{assert.equal((await localSaved(42)).startAt,other+'T11:30:00');assert.match(await page.locator('.cal-drag-message[role=alert]').innerText(),/lokalen Speicher/)});
 await page.evaluate(()=>localStorage.setItem=__qaSetItem);await page.screenshot({path:path.join(output,'speicherfehler.png')});
};
