'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixture=fs.readFileSync(path.join(__dirname,'qa-mobile-completion.cjs'),'utf8').split('(async()=>{const{browser,page}=await setup()')[0];
const setup=new Function('require','__dirname',fixture+';return setup;')(require,__dirname);
const output='/tmp/remuneration-prefill-qa';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const {browser,page}=await setup();const errors=[];let checks=0;
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
 const ok=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS '+name)};
 const values=()=>page.evaluate(()=>{const c=state.caseData.care;return[c.remStage,c.assetStatus,c.housingCategory]});
 try{
  await page.setViewportSize({width:1440,height:1000});
  await page.waitForFunction(()=>!document.documentElement.classList.contains('mobile-online-active'));
  await page.evaluate(()=>{
   const original=window.fetch;window.__qaPrefillStage='2';window.__qaPrefillGuardian='person-b';window.__qaPrefillDelay=0;window.__qaQualis={entries:{'person-a':{einstufung:'C',qualification:'Sozialpädagogin (B.A.)'}}};
   window.fetch=async(url,options={})=>{
    if(String(url).endsWith('/remuneration-prefill')){
     const guardian=__qaPrefillGuardian,value=__qaPrefillStage,delay=__qaPrefillDelay;
     if(delay)await new Promise(r=>setTimeout(r,delay));
     if(window.__qaPrefillFail)return new Response('{}',{status:503});
     return new Response(JSON.stringify({guardian,stage:{value,ready:true,kind:'source',detail:'Einstufung des zuständigen Betreuers im Qualifikationsmanager'}}),{headers:{'Content-Type':'application/json'}});
    }
    if(String(url)==='/api/office-json/qualifikationen'){if(options.method==='PUT')__qaQualis=JSON.parse(options.body).data;return new Response(JSON.stringify({data:__qaQualis}),{headers:{'Content-Type':'application/json'}})}
    return original(url,options);
   };
   state.caseData.rechtlicherBetreuer='person-b';state.caseData.accommodation={type:'Pflegeheim',currentResidence:{type:'eigene Häuslichkeit'}};
   state.caseData.assets={begin:[{id:'asset1',category:'Girokonto',amount:4000}],end:[],debtsBegin:[],debtsEnd:[]};
   for(const field of ['remStage','assetStatus','housingCategory'])state.caseData.care[field]='';delete state.caseData.care._remunerationPrefill;
   goStart();renderCaseReview();
  });
  await page.waitForFunction(()=>state.caseData.care.remStage==='2');
  ok('All three fields use assigned guardian, actual residence and assets',JSON.stringify(await values())===JSON.stringify(['2','M','A']));
  const select=field=>page.locator('select[data-casepath="care.'+field+'"]');
  const cluster=select('remStage').locator('xpath=ancestor::details[1]');await cluster.evaluate(el=>el.open=true);
  ok('Source explanations are visible',await cluster.locator('[data-remuneration-hint]').count()===3);
  await select('housingCategory').selectOption('S');
  await page.evaluate(()=>{state.caseData.accommodation.currentResidence.type='Mietwohnung';saveState();renderCaseReview()});
  ok('Manual housing survives source change and rerender',(await values())[2]==='S');
  await page.getByRole('button',{name:'Wohnform (Vergütung) automatisch vorbelegen',exact:true}).click();
  ok('Return to automatic uses current housing',(await values())[2]==='A');
  await page.evaluate(()=>__vaField('begin','asset1','amount','20000'));
  ok('Actual assets editor updates managed status',(await values())[1]==='NM');
  await select('assetStatus').selectOption('');
  await page.evaluate(()=>{__vaField('begin','asset1','amount','5000');renderCaseReview()});
  ok('Deliberately cleared manual status stays empty',(await values())[1]==='');
  await page.getByRole('button',{name:'Vermögensstatus automatisch vorbelegen',exact:true}).click();
  ok('Reset uses latest asset statement',(await values())[1]==='M');
  await page.evaluate(()=>{__qaPrefillStage='1';document.dispatchEvent(new Event('betreuung:qualifications-changed'))});
  await page.waitForFunction(()=>state.caseData.care.remStage==='1');ok('Qualification update refreshes stage',true);
  await select('remStage').selectOption('2');await page.evaluate(()=>__remunerationPrefill.refresh(true));
  ok('Manual stage overrides qualification',(await values())[0]==='2');
  await page.getByRole('button',{name:'Vergütungsstufe automatisch vorbelegen',exact:true}).click();await page.waitForFunction(()=>state.caseData.care.remStage==='1');
  await page.evaluate(()=>{__qaPrefillFail=true;return __remunerationPrefill.refresh(true)});
  ok('Source failure retains previous auto stage',(await values())[0]==='1');
  ok('Failure has visible retry',await page.getByRole('button',{name:'Erneut laden',exact:true}).count()===1);
  await page.evaluate(()=>{__qaPrefillFail=false;__qaPrefillDelay=300;__qaPrefillStage='2';window.__qaOldRequest=__remunerationPrefill.refresh(true)});
  await page.evaluate(()=>{state.caseData={...state.caseData,care:{},rechtlicherBetreuer:'person-a'};__qaPrefillGuardian='person-a';__qaPrefillStage='1';__qaPrefillDelay=0;renderCaseReview()});
  await page.waitForFunction(()=>state.caseData.care.remStage==='1');await page.evaluate(()=>__qaOldRequest);
  ok('Late response cannot change another active case',(await values())[0]==='1');
  await page.evaluate(()=>{state.caseData=JSON.parse(JSON.stringify(state.caseData));renderCaseReview()});
  ok('Auto metadata survives JSON roundtrip',(await values())[0]==='1'&&(await values())[1]==='M');
  await page.evaluate(()=>{__qaPrefillStage='2';__qaPrefillDelay=200;window.__qaReloadRequest=__remunerationPrefill.refresh(true)});
  await page.evaluate(()=>{state.caseData=JSON.parse(JSON.stringify(state.caseData));renderCaseReview()});
  await page.evaluate(()=>__qaReloadRequest);await page.waitForFunction(()=>state.caseData.care.remStage==='2');
  ok('Reloading the same case during lookup still applies the result',true);
  await page.evaluate(()=>{__qaPrefillDelay=0;__qaPrefillStage='1';return __remunerationPrefill.refresh(true)});
  for(const dark of [false,true]){
   await page.evaluate(d=>{document.documentElement.dataset.theme=d?'dark':'light';document.querySelector('select[data-casepath="care.remStage"]').closest('details').open=true},dark);
   await cluster.scrollIntoViewIfNeeded();await cluster.screenshot({path:path.join(output,'stammdaten-'+(dark?'dark':'light')+'.png')});
   ok('Source fields fit desktop '+(dark?'dark':'light'),await cluster.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  }
  await page.evaluate(()=>openQualifikationsManager());
  await page.locator('[data-qmkey="person-a"]').click();
  ok('Manager offers only current stages and maps legacy C to 2',await page.locator('#qmEinstufung').evaluate(e=>e.value==='2'&&[...e.options].map(x=>x.value).join(',')===',1,2'));
  await page.locator('#qmEinstufung').selectOption('1');await page.evaluate(()=>__qm.save());
  ok('Manager saves numeric stage',await page.evaluate(()=>__qaQualis.entries['person-a'].einstufung==='1'));
  ok('Office qualification export uses current stage',await page.evaluate(async()=>{const rows=await __qmBuildRows();return rows.find(r=>r[0]==='Ada Beispiel')?.[4]==='1'}));
  await page.evaluate(()=>closeModal());
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.classList.contains('mobile-online-active'));
  await page.evaluate(()=>{__qaQualis.entries['person-a'].einstufung='C';return openQualifikationsManager()});
  await page.getByRole('button',{name:'Details: Ada Beispiel',exact:true}).click();
  ok('Mobile qualification details use stage 2 for legacy C',await page.locator('#modalBody').innerText().then(t=>t.includes('Hochschulabschluss')&&!t.includes('Stufe C')));
  await page.getByRole('button',{name:'Bearbeiten',exact:true}).click();
  ok('Mobile editor uses current stage 2',await page.locator('#qmEinstufung').inputValue()==='2');
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.evaluate(()=>closeModal());
  await page.locator('[data-mobile-more]').click();await page.locator('[data-mobile-action="master-data"]').filter({visible:true}).click();
  await page.getByRole('button',{name:'Öffnen: Betreuungsverfahren',exact:true}).click();
  for(const width of [320,390])for(const dark of [false,true]){
   await page.setViewportSize({width,height:844});await page.evaluate(d=>document.documentElement.dataset.theme=d?'dark':'light',dark);
   await select('remStage').scrollIntoViewIfNeeded();
   ok('Source hints fit mobile '+width+' '+(dark?'dark':'light'),await page.locator('.master-mobile-view').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   if(width===390)await page.screenshot({path:path.join(output,'stammdaten-mobile-'+(dark?'dark':'light')+'.png')});
  }
  await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>!document.documentElement.classList.contains('mobile-online-active'));
  await page.evaluate(()=>{window.__appMode='local';window.bueroLocal={...window.bueroLocal,persons:[{id:'person-a',firstName:'Ada',lastName:'Beispiel'}],qualifikationen:{entries:{'person-a':{einstufung:'C'}}}};renderCaseReview()});
  ok('Offline uses local qualification',(await values())[0]==='2');
  await page.evaluate(()=>{window.__demoModus=true;window.__appMode='online';__qaPrefillStage='1';renderCaseReview()});
  ok('Demo uses its own sources',(await values())[0]==='2');
  ok('No runtime errors',errors.length===0);console.log(JSON.stringify({checks,errors,output}));
 }catch(error){await page.screenshot({path:path.join(output,'failure.png')});console.log(await page.evaluate(()=>({care:state.caseData.care,fields:[...document.querySelectorAll('[data-casepath^="care."]')].map(e=>({p:e.dataset.casepath,v:e.value,label:e.getAttribute('aria-label')}))})));throw error}
 finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
