'use strict';
// Real phone UA matters: the shared mobile adapter otherwise never runs.
const assert=require('node:assert/strict');
module.exports=async({page,check,shot,errors})=>{
 const modules=[['todoWorkspace','at','window.openTodoFullView()','data-tw'],['fristenWorkspace','fd','window.openFristenModal()','data-action'],['wiedervorlagenWorkspace','wv','window.__caseOverview.openFollowups()','data-action']];
 for(const [width,height] of [[320,568],[390,844],[574,900],[768,900],[1024,900],[1440,1000]]){
  await page.setViewportSize({width,height});
  for(const theme of ['light','dark']){
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   for(const [id,prefix,open,action] of modules){
    await page.evaluate(()=>window.closeModal());await page.evaluate(open);
    const root=page.locator('#'+id);await root.waitFor();await page.waitForTimeout(160);
    const header=root.locator('.'+prefix+'-header'),actions=header.locator('.'+prefix+'-header-actions'),close=actions.locator('['+action+'=exit]'),create=actions.locator('['+action+'=new]');
    const label=id+' '+width+' '+theme;
    await check(label+' – responsive controls',async()=>{
     const mobile=await page.evaluate(()=>document.documentElement.classList.contains('mobile-online-active'));
     assert.equal(mobile,process.env.FOLLOWUP_QA_DESKTOP!=='1'&&width<=1024,'Phone mode is active when expected');
     assert.equal(await root.locator('.mobile-wrap-actions').count(),0,'Generic mobile adapter must not stretch workspace controls');
     const x=await close.boundingBox(),bar=await actions.boundingBox();assert.ok(x&&bar);
     assert.ok(Math.abs(x.x+x.width-bar.x-bar.width)<2,'Close stays at the right edge');
     const text=await create.locator('span:visible').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return {lines:range.getClientRects().length,text:el.textContent}});
     assert.equal(text.lines,1,'Creation label stays on one line');assert.match(text.text,/Neue/);
     assert.ok((await create.boundingBox()).height<=48,'Creation button does not grow vertically');
     const overflow=await root.evaluate(r=>[r,...r.querySelectorAll('header,main,footer,[class$="-searchbar"],[class$="-toolbar"],button')].filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+2).map(e=>e.className));
     assert.deepEqual(overflow,[],'No horizontal clipping');
    });
    if(prefix==='at')await check(label+' – status and tools remain accessible',async()=>{
     assert.ok(await root.locator('.at-status').isVisible());assert.ok(await root.locator('#todoWorkSort').isVisible());
     assert.equal(await actions.locator('[data-tw=tools]').getAttribute('aria-label'),'Werkzeuge');
    });
    if(prefix==='wv'){
     await check(label+' – full-width list and unified fields',async()=>{
      const rootWidth=await root.evaluate(e=>e.clientWidth);
      assert.equal(await root.locator('.wv-sidebar').isVisible(),rootWidth>880);
      assert.equal(await root.locator('#wv-search').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
      assert.equal(await root.locator('#wv-sort').evaluate(e=>getComputedStyle(e).backgroundImage),'none');
      const [sort,refresh]=await Promise.all([root.locator('#wv-sort').boundingBox(),root.locator('.wv-refresh').boundingBox()]);
      assert.ok(Math.abs(sort.height-refresh.height)<=2,'Sort and refresh have equal heights');
     });
    }
    if([320,574,1440].includes(width))await shot(id+'-'+width+'-'+theme);
    if([390,574,1440].includes(width)){
     await root.locator('['+action+'=filter]').first().click();
     const panel=root.locator('.'+prefix+'-panel');await panel.waitFor({state:'visible'});
     await check(label+' – filter usable',async()=>{
      assert.ok(await panel.locator('select').count());
      const bad=await panel.locator('select').evaluateAll(es=>es.filter(e=>getComputedStyle(e).backgroundImage!=='none').length);assert.equal(bad,0,'Custom selects have a single chevron');
      await panel.locator('['+action+'=apply-filter]').click();
     });
     if(prefix==='wv'){
      await root.locator('.wv-row-title').first().click();await panel.waitFor({state:'visible'});
      await panel.locator('.wv-panel-heading [data-action=close]').click();
      await create.click();await root.locator('[data-draft=note]').waitFor({state:'visible'});
      await check(label+' – editor opens and closes',async()=>{
       assert.ok(await root.locator('[data-action=save]').isVisible());
       await panel.locator('.wv-panel-heading [data-action=close]').click();assert.equal(await root.getAttribute('data-page'),'list');
      });
     }
    }
    await close.click();await check(label+' – close works',async()=>assert.ok(await page.locator('#modal').evaluate(e=>e.classList.contains('hidden'))));
   }
  }
 }
 await check('No runtime errors',async()=>assert.deepEqual(errors,[]));console.log('PLANNING MOBILE LAYOUT DONE');
};
