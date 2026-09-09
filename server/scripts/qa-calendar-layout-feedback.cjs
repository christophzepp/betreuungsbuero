'use strict';
// Focused layout regressions on the actual app, using the synthetic fixtures of both calendar runners.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async(page,check,output,mobile)=>{
  const settle=()=>page.waitForTimeout(260),mode=async label=>{await page.getByRole('button',{name:label,exact:true}).click();await settle()};
  const root=()=>page.locator(mobile?'.cal-mobile-view':'.cal-workspace');
  const fits=async()=>root().evaluate(el=>{const r=el.getBoundingClientRect();return {overflow:el.scrollWidth>el.clientWidth+1,right:r.right,width:innerWidth}});
  await page.evaluate(async()=>{await window.__calViewPrefSet('weekends',true);await window.__calViewPrefSet('agendaPast',true);return openCalendarFullView(__qaToday)});await settle();
  if(!mobile){
    await page.evaluate(()=>window.__calendarShowEditForm('todo:todo-a'));await page.locator('.cal-detail-actions').waitFor();
    await check('Detailaktionen stehen paarweise in gleich breiten Reihen',async()=>{const boxes=await page.locator('.cal-detail-actions>button').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,right:r.right,bottom:r.bottom}}));assert.equal(boxes.length,5);assert.equal(boxes[0].y,boxes[1].y);assert.equal(boxes[2].y,boxes[3].y);assert.ok(Math.abs(boxes[0].w-boxes[1].w)<1);assert.ok(boxes[4].y>=boxes[3].bottom);assert.ok(boxes[4].w>boxes[0].w)});
    await page.screenshot({path:path.join(output,'aktionen-desktop.png')});await page.getByRole('button',{name:'Zum Kalender',exact:true}).click();await settle();
    await mode('Woche');await check('Symbole sind im Desktop-Zeitraster und an Ganztagseinträgen vorhanden',async()=>{assert.ok(await page.locator('.caltime-event .cal-entry-icon[data-cal-kind=events]').count());for(const kind of ['tasks','fristen','followups'])assert.ok(await page.locator('.caltime-allday-chip .cal-entry-icon[data-cal-kind='+kind+']').count(),kind)});
    await mode('Monat');await check('Auch das Monatsraster trägt die Eintrags-Symbole',async()=>assert.ok(await page.locator('.calgrid-wrap .cal-entry-icon').count()));
  }
  for(const width of (mobile?[320,390,430]:[320,390,600,820])){
    await page.setViewportSize({width,height:900});await page.evaluate(()=>openCalendarFullView(__qaToday));await settle();
    await mode('Tag');
    await check('Ansichtsbuttons '+width+'px bilden vier gleich breite Felder',async()=>{const boxes=await page.locator(mobile?'.cal-mobile-controls .mobile-module-segments>button':'.cal-view-switch>button').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,w:r.width}}));assert.equal(boxes.length,4);assert.ok(boxes.every(b=>Math.abs(b.y-boxes[0].y)<1&&Math.abs(b.w-boxes[0].w)<1&&b.x>=0&&b.right<=width+1))});
    await check('Tag '+width+'px zeigt nur eine Tagesgruppe und alle vier Symbole',async()=>{assert.equal(await page.locator(mobile?'.cal-mobile-rows>.mobile-module-group':'.cal-day-agenda>.cal-agenda-date').count(),width>650&&!mobile?0:1);const entries=page.locator(mobile?'.cal-mobile-event':width>650?'.caltime-wrap':'.cal-day-agenda');for(const kind of ['events','tasks','fristen','followups'])assert.ok(await entries.locator('[data-cal-kind='+kind+']').count(),kind);assert.equal((await fits()).overflow,false)});
    if(width===600||width===390)await page.screenshot({path:path.join(output,(mobile?'mobil':'schmal')+'-tag-'+width+'.png')});
    await mode('Woche');
    await check('Woche '+width+'px besitzt echte getrennte Tagesspalten',async()=>{const overview=width<=650||mobile;assert.equal(await page.locator(overview?'.cal-week-day':'.caltime-daycol').count(),7);if(overview){assert.equal(await page.locator('.cal-week-jump button').count(),7);assert.ok(await page.locator('.cal-week-empty').count());assert.equal(await page.locator('.cal-day-agenda').count(),0);const first=await page.locator('.cal-week-day').nth(0).boundingBox(),second=await page.locator('.cal-week-day').nth(1).boundingBox();assert.ok(second.x>=first.x+first.width-1)}assert.equal((await fits()).overflow,false)});
    if(width<=650||mobile){
      await page.locator('[data-week-jump]').last().click();await settle();
      await check('Wochentag-Sprung '+width+'px erhält Woche und erreicht Sonntag',async()=>{assert.equal(await page.getByRole('button',{name:'Woche',exact:true}).getAttribute('aria-pressed'),'true');const scroll=await page.locator('.cal-week-scroll').boundingBox(),last=await page.locator('.cal-week-day').last().boundingBox();assert.ok(last.x>=scroll.x-1&&last.x+last.width<=scroll.x+scroll.width+1)});
      await page.evaluate(()=>openCalendarFullView(__qaToday));await settle();
      if(width===600||width===390)await page.screenshot({path:path.join(output,(mobile?'mobil':'schmal')+'-woche-'+width+'.png')});
      await page.getByRole('button',{name:'Details: Hausbesuch',exact:true}).click();await page.getByRole('button',{name:'Bearbeiten',exact:true}).waitFor();
      await check('Wochenkarte '+width+'px öffnet den ursprünglichen Termin',async()=>assert.ok(await page.getByRole('link',{name:'Besuchsplan.pdf',exact:true}).count()));
      await page.getByRole('button',{name:mobile?'Zurück':'Schließen',exact:true}).click();await settle();
    }
    await mode('Liste');
    const select=mobile?page.getByLabel('Zeitraum',{exact:true}):page.locator('#calAgendaScope');
    await select.selectOption('custom');await settle();
    await page.getByLabel('Von',{exact:true}).fill(await page.evaluate(()=>__qaToday));await settle();await page.getByLabel('Bis',{exact:true}).fill(await page.evaluate(()=>__qaToday));await settle();
    await check('Liste '+width+'px: Zeitraumfelder passen und gruppieren denselben Tag einmal',async()=>{assert.equal((await fits()).overflow,false);if(!mobile)assert.equal(await page.locator('.cal-range-pop').count(),0,'Datumseingabe darf den Mini-Kalender nicht automatisch öffnen');const inputBoxes=await page.getByLabel('Von',{exact:true}).boundingBox(),endBox=await page.getByLabel('Bis',{exact:true}).boundingBox();assert.ok(inputBoxes.x>=0&&endBox.x+endBox.width<=width+1);assert.equal(await page.locator(mobile?'.cal-mobile-rows>.mobile-module-group':'.calagenda-list-all>.cal-agenda-date').count(),1);assert.ok(await page.locator(mobile?'.cal-mobile-event':'.calagenda-list-all .calagenda-card').count()>=7)});
    if(!mobile&&width===390){await page.getByRole('button',{name:'Mini-Kalender',exact:true}).click();await settle();await check('Mini-Kalender öffnet sich gezielt und passt in das schmale Fenster',async()=>{const box=await page.locator('.cal-range-pop').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width)});await page.getByRole('button',{name:'Fertig',exact:true}).click();await settle()}
    if(width===600||width===390){await page.screenshot({path:path.join(output,(mobile?'mobil':'schmal')+'-liste-'+width+'.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await settle();await page.screenshot({path:path.join(output,(mobile?'mobil':'schmal')+'-liste-dunkel-'+width+'.png')});await page.evaluate(()=>document.documentElement.dataset.theme='light')}
    await select.selectOption('month');await settle();
  }
};
