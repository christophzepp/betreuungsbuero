'use strict';
// Real delivered HTML with synthetic users/providers. Never sends an external request.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let fixture=fs.readFileSync(path.join(__dirname,'qa-mobile-completion.cjs'),'utf8').split('(async()=>{const{browser,page}=await setup()')[0];
fixture=fixture.replace("fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'))", "fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8').replace('function showBadge(user,mode){','window.__qaShowBadge=showBadge;function showBadge(user,mode){')");
const setup=new Function('require','__dirname',fixture+';return setup;')(require,__dirname);
(async()=>{const {browser,page}=await setup();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
const check=(name,value)=>{assert.ok(value,name);console.log('PASS '+name)};
try{
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>{__currentUser.permissions={online:{menuAdmin:false,menuAdminLogout:false,menuSettings:false,menuSettingsAi:false}};__currentUser.isAdmin=false;__qaShowBadge(__currentUser,'online')});
 const menu=page.locator('[data-user-menu]:visible').first();await menu.locator(':scope > summary').click({position:{x:40,y:15}});
 check('User menu opens even when administrative menu permissions are disabled',await menu.evaluate(e=>e.open));
 check('Logout remains reachable for restricted users',await menu.locator('[data-user-menu-logout]').isVisible());
 await page.evaluate(()=>{__currentUser.isAdmin=true;__currentUser.systemTime={timeZone:'Europe/Berlin'};});
 check('SQL UTC timestamp displays summer time',await page.evaluate(()=>__formatOfficeTime('2026-07-01 10:00:00').includes('12:00')));
 check('SQL UTC timestamp displays winter time',await page.evaluate(()=>__formatOfficeTime('2026-01-01 10:00:00').includes('11:00')));
 await page.evaluate(()=>{
   window.__testKey='';window.__savedKeyCalls=0;window.__qaProviderCalls=[];
   const previousFetch=window.fetch;
   window.fetch=async(url,options={})=>{
     if(String(url).startsWith('/api/admin/ai-config/')&&options.method==='PUT'){
       const data=JSON.parse(options.body);if(window.__failKeySave)return new Response(JSON.stringify({error:'Test: Speichern abgelehnt'}),{status:503});
       await new Promise(resolve=>setTimeout(resolve,60));if(data.apiKey)__testKey=data.apiKey;__savedKeyCalls++;return new Response('{}');
     }
     if(url==='/api/me')return new Response(JSON.stringify({aiConfig:{openai:{apiKey:__testKey,endpoint:'https://api.openai.com/v1/responses'}},aiBueroAnbieter:__testKey?['openai']:[]}));
     if(url==='/api/my-settings/ai-geprueft')return new Response('{}');
     return previousFetch(url,options);
   };
   window.__aiFetch=async(url,options)=>{__qaProviderCalls.push({url,authorization:options?.headers?.Authorization});return new Response(JSON.stringify({data:[{id:'gpt-5.2'},{id:'gpt-4.1'}]}))};
   openEinstellungenApp('ki');
 });
 await page.locator('#aiCfgKey').fill('synthetic-api-key');await page.evaluate(()=>saveAISettings());
 check('Saved key is acknowledged immediately without reopening settings',await page.locator('#aiCfgKey').getAttribute('placeholder').then(v=>/gesetzt|gespeichert/.test(v)));
 check('Office key stays out of editable fields and local case config',await page.evaluate(()=>!document.getElementById('aiCfgKey').value&&!ensureAIConfig().openai.apiKey));
 await page.evaluate(()=>testAIConnection());
 check('Connection test uses saved office key',await page.evaluate(()=>__qaProviderCalls.at(-1)?.authorization==='Bearer synthetic-api-key'));
 check('Connection test makes models available immediately',await page.evaluate(()=>ensureAIConfig().openai.models.includes('gpt-5.2')));
 await page.evaluate(()=>window.__failKeySave=true);await page.locator('#aiCfgKey').fill('rejected-key');await page.evaluate(()=>saveAISettings());
 check('Failed save displays error instead of success',await page.locator('#aiConfigProgress').innerText().then(v=>v.includes('Speichern abgelehnt')));
 await page.evaluate(()=>{closeModal();enterWorkspace();openReport('free_document');AppTheme.setPreference('dark',{persist:false})});
 const editor=page.locator('.free-rich-editor:visible').first();await page.waitForTimeout(100);
 check('Document editor follows global dark mode',await editor.getAttribute('data-editor-view')==='work');
 await page.locator('[data-free-editor-view=paper]:visible').first().click();check('White paper can be selected in dark mode',await editor.getAttribute('data-editor-view')==='paper');
 await page.evaluate(()=>AppTheme.setPreference('light',{persist:false}));await page.waitForTimeout(80);
 check('Global light mode returns editor to paper',await editor.getAttribute('data-editor-view')==='paper');
 await page.evaluate(()=>AppTheme.setPreference('dark',{persist:false}));await page.waitForTimeout(80);
 check('New global theme switch resets manual paper override',await editor.getAttribute('data-editor-view')==='work');
 const logo=await page.evaluate(async()=>{
   const previous=fetch;window.__logoBytes=0;
   window.fetch=async(url,opts)=>{if(url==='/api/office-profile/logo'){__logoBytes=atob(JSON.parse(opts.body).dataBase64).length;return new Response('{}')}return previous(url,opts)};
   const result=await __officeProfile.uploadLogo(new File([new Uint8Array(400000)],'large.png',{type:'image/png'}));return {result,bytes:__logoBytes};
 });check('Large logo reaches upload endpoint without call-stack overflow',logo.result.ok&&logo.bytes===400000);
 await page.evaluate(async()=>{await openMailApp();await __mx.compose()});const mail=page.locator('#mxBody');await mail.waitFor({state:'visible'});
 check('Mail text editor uses dark background in global dark mode',await mail.evaluate(e=>getComputedStyle(e).backgroundColor==='rgb(23, 38, 48)'));
 await page.evaluate(()=>AppTheme.setPreference('light',{persist:false}));
 check('Mail text color follows global light mode',await mail.evaluate(e=>getComputedStyle(e).color==='rgb(34, 50, 62)'));
 check('No runtime errors',errors.length===0);
 console.log('Browser checks completed.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
