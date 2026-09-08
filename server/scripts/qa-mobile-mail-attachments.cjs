'use strict';
// Actual app and synthetic mail. A loopback server verifies real attachment downloads; no production writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'qa-mobile-completion.cjs'),'utf8');

const output=process.env.MOBILE_QA_OUTPUT||'/tmp/mobile-mail-attachments';fs.mkdirSync(output,{recursive:true});
(async()=>{const requests=[];const server=require('node:http').createServer((req,res)=>{if(!req.url.startsWith('/api/mailbox/accounts/office/attachment?')){res.writeHead(404);return res.end()}requests.push(req.url);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="Bescheid.pdf"'});res.end('Synthetic attachment content')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const setup=new Function('require','__dirname',source.split('(async()=>{const{browser,page}=await setup()')[0].replaceAll('http://completion.invalid/',origin+'/')+';return setup;')(require,__dirname);const{browser,page}=await setup();const checks=[],errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};const shot=async name=>{await page.waitForTimeout(160);await page.screenshot({path:path.join(output,name+'.png')})};
try{
 const mail=fs.readFileSync(path.join(__dirname,'qa-mobile-mail.cjs'),'utf8'),start=mail.indexOf(' await page.evaluate(()=>{\n  window.__qaDrafts=[]'),end=mail.indexOf(" await check('Mobile Postfachliste");assert.ok(start>0&&end>start);await new Function('page','return (async()=>{'+mail.slice(start,end)+'})();')(page);
 await page.evaluate(()=>{__qaMailMessages[0].text='Guten Tag,\n\nbitte prüfen Sie die beigefügten Unterlagen.\n'+('Weitere Informationen zur Kostenübernahme.\n'.repeat(90));__qaMailMessages[0].attachments.push({index:3,filename:'Ergänzung "Kosten & Belege" – ausführliche Anlagenübersicht.pdf',size:86000,contentType:'application/pdf'})});
 await page.locator('.mx-msg[data-uid="1"]').click();const access=page.locator('.mx-mobile-attachment-access'),body=page.locator('.mx-mobile-view>.mobile-ui-body');await access.waitFor();
 check('Anzahl und Dateinamen sind vor dem ersten Scrollen sichtbar',await access.innerText().then(t=>t.includes('2 Anlagen')&&t.includes('Bescheid.pdf'))&&await access.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight/2}));await shot('mail-anlagen-sofort-sichtbar');
 const original=await page.locator('#mxRead .mx-atts a').evaluateAll(es=>es.map(e=>[e.getAttribute('href'),e.getAttribute('download')]));
 await body.evaluate(e=>e.scrollTop=180);await page.waitForTimeout(80);await body.evaluate(e=>e.scrollTop=360);await page.waitForTimeout(300);const scroll=await body.evaluate(e=>e.scrollTop);
 check('Anlagenzugang bleibt beim Lesen langer Nachrichten sichtbar',scroll>=350&&await access.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight/2}));
 await access.getByRole('button',{name:'2 Anlagen anzeigen',exact:true}).click();const sheet=page.locator('#mobileOnlineSheet');
 check('Anlagenblatt erhält sämtliche Original-Downloadziele und Dateinamen',JSON.stringify(await sheet.locator('.mx-att').evaluateAll(es=>es.map(e=>[e.getAttribute('href'),e.getAttribute('download')])))===JSON.stringify(original));await shot('mail-anlagenblatt');
 // Browser-native downloads may bypass Playwright routing, so serve this fixture on loopback.
 await page.route('**/api/mailbox/accounts/*/attachment?*',r=>r.continue());
 const promise=page.waitForEvent('download');await sheet.locator('.mx-att').first().click();const download=await promise;
 check('Datei wird vollständig heruntergeladen',await download.failure()===null&&fs.readFileSync(await download.path(),'utf8')==='Synthetic attachment content');
 check('Download verwendet richtigen Account, Ordner, UID und Anlagenindex',download.suggestedFilename()==='Bescheid.pdf'&&requests.some(u=>u.includes('/accounts/office/attachment?folder=INBOX&uid=1&idx=0')));
 for(const width of [320,390,570])for(const dark of [false,true]){await page.setViewportSize({width,height:844});await page.evaluate(d=>document.documentElement.dataset.theme=d?'dark':'light',dark);await page.waitForTimeout(100);check('Dateiliste mit langem Namen passt '+width+' / '+dark,await sheet.locator('.mx-mobile-attachments').evaluate(e=>e.scrollWidth<=e.clientWidth+1&&[...e.querySelectorAll('a')].every(a=>a.getBoundingClientRect().height>=44)))}
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='light');await sheet.locator('[data-mobile-sheet-close]').click();
 check('Schließen des Anlagenblatts erhält die Leseposition',Math.abs(await body.evaluate(e=>e.scrollTop)-scroll)<2);
 await page.getByRole('button',{name:'KI-Assistent',exact:true}).click();await page.locator('.mx-mobile-ai-view button[aria-label="Zurück"]').click();check('Anlagenzugang bleibt nach KI-Rückkehr erhalten',await access.getByRole('button',{name:'2 Anlagen anzeigen',exact:true}).isVisible());
 await page.locator('.mx-mobile-view .mobile-ui-header button[aria-label="Zurück"]').click();await page.locator('.mx-msg[data-uid="3"]').click();
 check('Nachricht ohne Anlagen zeigt keinen alten Hinweis',await access.count()===0);
 await page.locator('.mx-mobile-view .mobile-ui-header button[aria-label="Zurück"]').click();await page.locator('.mx-msg[data-uid="2"]').click();await access.waitFor();
 check('Auch HTML-Mail zeigt den Anlagenzugang sofort',await access.getByRole('button',{name:'1 Anlage anzeigen',exact:true}).isVisible());
 check('HTML-Mail behält ihre Sandbox',await page.locator('#mxReadBody iframe').getAttribute('sandbox')==='allow-popups allow-popups-to-escape-sandbox');await shot('html-mail-anlagen');
 await access.getByRole('button',{name:'1 Anlage anzeigen',exact:true}).click();check('Nachrichtenwechsel zeigt ausschließlich die aktuelle Anlage',await sheet.locator('.mx-att').count()===1&&await sheet.locator('.mx-att').getAttribute('download')==='Arztbrief.pdf');await sheet.locator('[data-mobile-sheet-close]').click();
 await page.setViewportSize({width:1366,height:900});await page.evaluate(()=>openMailApp());await page.waitForTimeout(200);check('Desktop erhält keine zusätzliche mobile Anlagenleiste',!await access.isVisible());
 check('Keine JavaScript-Laufzeitfehler',errors.length===0);
}finally{fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
