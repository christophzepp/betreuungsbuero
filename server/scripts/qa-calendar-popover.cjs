'use strict';
// Uses the real calendar fixture, synthetic lists, real clicks and controlled scroll positions.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async(page,check,output)=>{
  const settle=()=>page.waitForTimeout(280);
  const panel=kind=>page.locator('.cal-vis-panel[data-kind="'+kind+'"]');
  const popup=kind=>panel(kind).locator('.cal-vis-drop');
  const close=async()=>{const footer=page.locator('.cal-status'),r=await footer.boundingBox();await footer.click({position:{x:r.width-4,y:r.height/2}});await settle()};
  const fits=async(kind)=>popup(kind).evaluate(el=>{const r=el.getBoundingClientRect(),root=el.closest('.cal-workspace').getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:innerWidth,height:innerHeight,rootTop:root.top,rootBottom:root.bottom,overflow:el.scrollWidth>el.clientWidth+1,scrollable:el.scrollHeight>el.clientHeight+1}});
  async function openNearBottom(kind){
    const summary=panel(kind).locator('summary');
    await summary.evaluate(el=>{const side=el.closest('.cal-sidebar');side.scrollTop+=el.getBoundingClientRect().bottom-(side.getBoundingClientRect().bottom-8)});
    await summary.click();await settle();
  }
  await page.evaluate(async()=>{
    const original=window.fetch;
    window.fetch=async(url,options)=>{
      if(String(url)!=='/api/calendar/connections')return original(url,options);
      const result=await (await original(url,options)).json();
      result.connections.push({id:'task-conn',displayName:'Büroaufgaben',calendars:[{kind:'task',remoteId:'tasks-office',name:'Aufgaben Büro'}]});
      return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
    };
    await __calendarSetView('month');document.querySelectorAll('.cal-vis-panel,.cal-tools').forEach(el=>el.open=false);
  });await settle();
  await openNearBottom('task');
  await page.screenshot({path:path.join(output,'aufgabenlisten-unten.png')});
  await check('Aufgabenlisten am unteren Fensterrand öffnen vollständig oberhalb des Buttons',async()=>{
    const r=await fits('task'),anchor=await panel('task').locator('summary').boundingBox();
    assert.ok(r.top>=8&&r.bottom<=r.height-8,JSON.stringify(r));assert.ok(r.bottom<=anchor.y-3);assert.equal(r.overflow,false);
  });
  const before=await popup('task').boundingBox();
  await page.locator('.cal-sidebar').evaluate(el=>el.scrollTop+=20);await settle();
  await check('Offenes Menü folgt dem Button beim Scrollen der Seitenleiste',async()=>{const after=await popup('task').boundingBox();assert.ok(after.y<before.y-10);assert.ok((await fits('task')).bottom<=page.viewportSize().height-8)});
  await close();
  await page.locator('.cal-sidebar').evaluate(el=>el.scrollTop=0);await panel('view').locator('summary').click();await settle();
  await check('Ansichtsmenü öffnet bei ausreichend Platz unterhalb des Buttons',async()=>{const r=await fits('view'),anchor=await panel('view').locator('summary').boundingBox();assert.ok(r.top>=anchor.y+anchor.height+3);assert.ok(r.bottom<=r.height-8)});await close();
  await openNearBottom('event');await page.screenshot({path:path.join(output,'kalender-farben-unten.png')});await check('Kalender-und-Farben-Menü bleibt ebenfalls vollständig sichtbar',async()=>{const r=await fits('event');assert.ok(r.top>=8&&r.bottom<=r.height-8);assert.equal(r.overflow,false)});await close();
  await page.evaluate(async()=>{
    const original=window.fetch;
    window.fetch=async(url,options)=>{
      if(String(url)!=='/api/calendar/connections')return original(url,options);
      const result=await (await original(url,options)).json();
      result.connections.find(c=>c.id==='task-conn').calendars.push(...Array.from({length:22},(_,i)=>({kind:'task',remoteId:'task-list-'+i,name:'Aufgabenliste '+(i+1)+' – Betreuung und Organisation'})));
      return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
    };
    await openCalendarFullView();
  });await settle();
  for(const [width,height] of [[1440,560],[1024,480],[390,700],[320,480]]){
    await page.setViewportSize({width,height});await settle();await page.evaluate(()=>openCalendarFullView());await settle();
    if(width<=900)await page.getByRole('button',{name:'Kalenderfilter anzeigen',exact:true}).click();
    await openNearBottom('task');
    await check('Lange Aufgabenlisten passen bei '+width+'×'+height+' und sind intern scrollbar',async()=>{const r=await fits('task');assert.ok(r.top>=8&&r.bottom<=height-8&&r.left>=8&&r.right<=width-8,JSON.stringify(r));assert.equal(r.overflow,false);assert.equal(r.scrollable,true)});
    await popup('task').evaluate(el=>el.scrollTop=el.scrollHeight);await settle();
    await check('Letzte Listenzeile bleibt bei '+width+'×'+height+' erreichbar',async()=>{const row=await popup('task').locator('.cal-vis-row').last().boundingBox(),r=await fits('task');assert.ok(row.y>=r.top&&row.y+row.height<=r.bottom+1)});
    if(width===320)await page.screenshot({path:path.join(output,'aufgabenlisten-320.png')});
    await close();
  }
  await page.setViewportSize({width:1440,height:900});await settle();await page.evaluate(()=>openCalendarFullView());await settle();
  await openNearBottom('task');
  await popup('task').getByRole('button',{name:'Keine',exact:true}).click();await settle();
  await check('Listenfilter bleibt beim Anwenden wirksam',async()=>assert.equal(await popup('task').locator('input[type=checkbox]:checked').count(),0));
  await popup('task').getByRole('button',{name:'Alle',exact:true}).click();await settle();
  await check('Alle Listen lassen sich wieder einblenden',async()=>assert.ok(await popup('task').locator('input[type=checkbox]:checked').count()>=25));
};
