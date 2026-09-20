'use strict';
// Full server + browser smoke test, exclusively against an isolated temporary runtime.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bb-settings-smoke-')),serverRoot=path.resolve(__dirname,'..');
const port=20000+Math.floor(Math.random()*20000),url='http://127.0.0.1:'+port;
const env={...process.env,RUNTIME_ROOT:root,DB_PATH:path.join(root,'database/app.sqlite3'),DATA_DIR:path.join(root,'data'),DOCUMENTS_DATA_ROOT:path.join(root,'data'),RUNTIME_SECRETS_DIR:path.join(root,'secrets'),DOCUMENT_RECOVERY_KEY_FILE:path.join(root,'secrets/document-key'),TOTAL_BACKUP_DESTINATION:path.join(root,'backups'),RUNTIME_ARTIFACT_RESTORE_STATE_DIR:path.join(root,'restore'),EXTENSION_ARTIFACTS_DIR:path.join(root,'extensions'),SESSION_SECRET:crypto.randomBytes(32).toString('hex'),ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),COOKIE_SECURE:'0',PORT:String(port)};
let child,browser,logs='';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){child=spawn(process.execPath,['index.js'],{cwd:serverRoot,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<150;i++){try{if((await fetch(url+'/api/setup/state')).ok)return}catch(_){}if(child.exitCode!==null)throw new Error(logs);await delay(100)}throw new Error('Server start timed out: '+logs)}
async function stop(){if(!child||child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM')})}
(async()=>{try{
 execFileSync(process.execPath,['tools/admin/create-admin.js','--username','qa-admin','--password','Synthetic-only-Password-2846!','--admin','--online'],{cwd:serverRoot,env,stdio:'pipe'});
 await start();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'UTC'});
 await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
 const login=await page.request.post(url+'/api/login',{data:{username:'qa-admin',password:'Synthetic-only-Password-2846!',mode:'online'}});assert.equal(login.status(),200);assert.equal((await login.json()).user.id,1);console.log('PASS Initial administrator has ID 1');
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__currentUser?.id===1);
 await page.evaluate(()=>window.__appVisualReady);const intro=page.locator('#modeIntroNext');await intro.waitFor({state:'visible'});await intro.click();
 const menu=page.locator('[data-user-menu]:visible').first();await menu.locator(':scope > summary').click({position:{x:45,y:15}});assert.equal(await menu.evaluate(e=>e.open),true);console.log('PASS Real authenticated admin menu opens');
 await page.evaluate(()=>openEinstellungenApp('systemzeit'));await page.locator('#officeTimeZone').selectOption('America/New_York');await page.locator('[data-system-time-save]').click();await page.waitForFunction(()=>document.querySelector('[data-system-time-status]')?.textContent==='Zeitzone gespeichert.');console.log('PASS Admin saves time zone through settings UI');
 await page.evaluate(()=>openEinstellungenApp('versand'));
 await page.locator('#globalSimpleFaxUsername').fill('server-fax-user');
 await page.locator('#globalSimpleFaxPassword').fill('synthetic-server-fax-password');
 await page.locator('#globalSimpleFaxLoginUrl').fill('https://example.invalid/server-login');
 assert.equal(await page.evaluate(()=>saveGlobalServiceSettings()),true);
 assert.equal(await page.locator('#globalSimpleFaxPassword').inputValue(),'');
 const send=(await(await page.request.get(url+'/api/admin/send-credentials')).json()).services.find(s=>s.service==='simplefax');
 assert.equal(send.username,'server-fax-user');assert.equal(send.hasPassword,true);assert.equal(send.loginUrl,'https://example.invalid/server-login');
 assert.equal(await page.evaluate(()=>__officeCredentials.sendCredentials.simplefax.username),'server-fax-user');
 console.log('PASS One shipping form saves, masks and reloads actual office credentials');
 await page.evaluate(()=>openEinstellungenApp('briefkopf'));
 await page.locator('[data-sel="signatur"]').click();
 await page.getByLabel('Text unter der Unterschrift',{exact:true}).fill('Testbüro · Rechtliche Betreuung');
 await page.locator('[data-opt="landAnzeigen"]').check();
 await page.locator('.bk-tools [data-act="save"]').click();
 await page.waitForFunction(()=>__briefkopfBuero()?.signatur.text==='Testbüro · Rechtliche Betreuung');
 assert.equal((await(await page.request.get(url+'/api/office-json/briefkopf')).json()).data.landAnzeigen,true);
 console.log('PASS Briefkopf caption and country switch persist through the real settings UI');
 const bytes=Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),Buffer.alloc(300000)]);
 const upload=await page.request.post(url+'/api/office-profile/logo',{data:{filename:'Buerologo.png',mimeType:'image/png',dataBase64:bytes.toString('base64')}});assert.equal(upload.status(),200,await upload.text());
 await stop();await start();const logo=await page.request.get(url+'/api/office-profile/logo');assert.equal(logo.status(),200);assert.deepEqual(await logo.body(),bytes);
 const restoredBriefkopf=(await(await page.request.get(url+'/api/office-json/briefkopf')).json()).data;assert.equal(restoredBriefkopf.signatur.text,'Testbüro · Rechtliche Betreuung');assert.equal(restoredBriefkopf.landAnzeigen,true);
 const restoredSend=(await(await page.request.get(url+'/api/admin/send-credentials')).json()).services.find(s=>s.service==='simplefax');assert.equal(restoredSend.username,'server-fax-user');assert.equal(restoredSend.hasPassword,true);console.log('PASS Shipping credentials and Briefkopf options survive server restart');
 assert.equal((await (await page.request.get(url+'/api/me')).json()).user.systemTime.timeZone,'America/New_York');console.log('PASS Logo, session and office time zone survive server restart');
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__currentUser?.id===1);await page.evaluate(()=>window.__appVisualReady);if(await intro.isVisible())await intro.click();
 await page.locator('[data-user-menu]:visible').first().locator('[data-user-menu-logout-quick]').click();await page.waitForFunction(()=>!window.__currentUser);
 assert.equal((await page.request.get(url+'/api/me')).status(),401);console.log('PASS Logout from sidebar returns to unauthenticated session');
}finally{if(browser)await browser.close();await stop();fs.rmSync(root,{recursive:true,force:true})}})().catch(error=>{console.error(error);process.exitCode=1});
