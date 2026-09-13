'use strict';
// Echte Kontakt-/Kommunikationsdaten aus der Testdatenbank. Faxdienst und Mailabgleich
// werden lokal abgefangen: Der Test öffnet keinen Anbieter und versendet nichts.
const assert=require('node:assert/strict');
module.exports=async({page,mobile,db,errors})=>{
 const check=async(label,fn)=>{await fn();console.log('PASS '+(mobile?'Mobil':'Desktop')+' '+label)};
 const origin=new URL(page.url()).origin,faxUrl=origin+'/qa-fax';let syncCount=0;
 await page.context().route('**/qa-fax',r=>r.fulfill({contentType:'text/html',body:'<title>Test-Faxdienst</title><p>Neues Fax</p>'}));
 await page.route('**/api/addressbook/communications/sync',r=>{syncCount++;return r.fulfill({json:{done:true,checked:2,errors:[]}})});
 await page.evaluate(url=>{window.__qaFaxUrl=url;window.__qaCopied=[];window.__qaCopyFails=false;const settings=window.getExportGlobal;window.getExportGlobal=()=>({...settings(),simpleFaxComposeUrl:window.__qaFaxUrl});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.__qaCopyFails)throw Error('Test: Zwischenablage gesperrt');window.__qaCopied.push(text)}}})},faxUrl);
 const choose=async id=>{await page.evaluate(id=>window.__abOpenContact(id,'a'),id);await page.locator('.am-tab-body .am-info').first().waitFor()};
 const fax=number=>page.getByRole('link',{name:'Fax an '+number+' vorbereiten',exact:true});
 const openFax=async number=>{const opened=page.waitForEvent('popup');await fax(number).click();const popup=await opened;await popup.waitForURL(faxUrl);assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close()};
 await choose('court');
 await check('Fax öffnet den konfigurierten Dienst und kopiert exakt die angezeigte Nummer',async()=>{
  await openFax('0123/55');assert.equal(await page.evaluate(()=>window.__qaCopied.at(-1)),'0123/55');
  assert.equal(await page.getByRole('link',{name:'0123/44',exact:true}).getAttribute('href'),'tel:012344');
  await page.getByRole('button',{name:'Fax kopieren',exact:true}).click();assert.equal(await page.evaluate(()=>window.__qaCopied.at(-1)),'0123/55');
  await page.locator('.am-more summary').click();assert.equal(await page.getByRole('button',{name:'Faxnummer kopieren',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Daten kopieren',exact:true}).isVisible(),true);await page.locator('.am-more summary').click();
 });
 await check('Ansprechpartner und benannte Faxwege verwenden jeweils ihre eigene Nummer',async()=>{
  await page.locator('#amPerson').selectOption('sach');await openFax('0123/66');assert.equal(await page.evaluate(()=>window.__qaCopied.at(-1)),'0123/66');
  await page.getByRole('button',{name:'Kontaktwege',exact:true}).click();await openFax('0123/77');assert.equal(await page.evaluate(()=>window.__qaCopied.at(-1)),'0123/77');
  await page.locator('#amPerson').selectOption('');await openFax('0123/88');assert.equal(await page.evaluate(()=>window.__qaCopied.at(-1)),'0123/88');
 });
 await check('Gesperrte Zwischenablage verhindert das Öffnen nicht; ungültige Versandadresse wird abgefangen',async()=>{
  await page.evaluate(()=>window.__qaCopyFails=true);await openFax('0123/88');await page.waitForFunction(()=>document.querySelector('.am-save').textContent.includes('konnte nicht kopiert werden'));
  await page.evaluate(()=>{window.__qaCopyFails=false;window.__qaFaxUrl='javascript:window.__qaUnsafe=true'});await fax('0123/88').click();await page.waitForFunction(()=>document.querySelector('.am-save').textContent.includes('gültige Adresse'));assert.equal(await page.evaluate(()=>window.__qaUnsafe),undefined);assert.equal(page.context().pages().length,1);await page.evaluate(url=>window.__qaFaxUrl=url,faxUrl);
 });
 const screenshot=async name=>{await page.evaluate(()=>document.querySelectorAll('.toast-stack .toast,.toast-item,.toast').forEach(e=>e.remove()));await page.screenshot({path:'/tmp/addressbook-communication-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop')+'-'+name+'.png'})};
 const noOverflow=async()=>{const offenders=await page.locator('#addressbookModern,.am-detail,.am-communication,.am-communication-entry').evaluateAll(els=>els.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className));assert.deepEqual(offenders,[])};
 await choose('doctor');
 await check('Leerer Verlauf hat eigene Überschrift und erreichbare Aktionen, auch im Demomodus',async()=>{
  assert.equal(await page.getByRole('link',{name:/^Fax an /}).count(),0);await page.getByRole('button',{name:'Kommunikation',exact:true}).click();await page.getByRole('heading',{name:'Noch keine verknüpfte Kommunikation',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#amMailSync')?.textContent.includes('aktuell'));await noOverflow();await screenshot('empty-online');
  await page.evaluate(()=>{window.__appMode='local';document.querySelector('[data-tab=communication]').click()});assert.equal(await page.locator('#amMailSync').count(),0);await page.locator('.am-communication').scrollIntoViewIfNeeded();await screenshot('empty-local');await page.evaluate(()=>window.__appMode='online');
 });
 await choose('court');await page.getByRole('button',{name:'Kommunikation',exact:true}).click();
 await check('E-Mail, dokumentierte E-Mail und Schreiben bleiben korrekt verknüpft',async()=>{
  await page.getByRole('heading',{name:'Dokumentierte Antwort',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#amMailSync')?.textContent.includes('aktuell'));
  const card=title=>page.locator('.am-communication-entry').filter({has:page.getByRole('heading',{name:title,exact:true})});
  assert.equal(await card('Dokumentierte Antwort').count(),1);assert.equal(await card('Dokumentierte Antwort').getByRole('button',{name:'E-Mail öffnen',exact:true}).count(),1);
  await page.evaluate(()=>{window.__qaTargets=[];window.__mxOpenMsg=(...args)=>window.__qaTargets.push(['mail',...args]);window.phase4OpenHistoryEntry=id=>window.__qaTargets.push(['document',id]);window.openDokuEntryForm=(...args)=>window.__qaTargets.push(['doku',...args]);window.openFollowupsWorkspace=id=>window.__qaTargets.push(['followup',id])});
  await card('Dokumentierte Antwort').getByRole('button',{name:'E-Mail öffnen',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__qaTargets.at(-1)),['mail','qa-communication','INBOX','1']);
  await card('Dokumentierte Antwort').getByRole('button',{name:'In Falldokumentation öffnen',exact:true}).click();await page.waitForFunction(()=>window.__qaTargets.at(-1)?.[0]==='doku');assert.deepEqual(await page.evaluate(()=>window.__qaTargets.at(-1)),['doku','a',0]);
  await card('Versendetes Schreiben').getByRole('button',{name:'Versandeintrag öffnen',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__qaTargets.at(-1)),['document','qa-letter']);
  await card('Neue Nachricht').getByRole('button',{name:'E-Mail öffnen',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__qaTargets.at(-1)),['mail','qa-communication','INBOX','2']);
 });
 await check('Rückmeldung lässt sich anlegen und gezielt öffnen; Aktualisieren lädt den Verlauf neu',async()=>{
  await page.getByRole('button',{name:'Rückmeldung vereinbaren',exact:true}).click();await page.locator('.am-small-form [name=name]').fill('Rückruf '+(mobile?'Mobil':'Desktop'));await page.locator('.am-small-form [name=dueAt]').fill('2026-09-21');await page.locator('.am-small-form [name=description]').fill('Ergebnis gemeinsam besprechen.');await page.locator('.am-small-form button[type=submit]').click();await page.locator('.am-small-form').waitFor({state:'detached'});
  const card=page.locator('.am-communication-entry').filter({hasText:'Rückruf '+(mobile?'Mobil':'Desktop')});await card.getByRole('button',{name:'Wiedervorlage öffnen',exact:true}).click();assert.match(await page.evaluate(()=>window.__qaTargets.at(-1)[1]),/^todo:/);
  const before=syncCount;await page.getByRole('button',{name:'Nachrichten aktualisieren',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#amMailSync')?.textContent.includes('aktuell')&&document.querySelector('.am-communication-sync button')?.disabled===false);assert.ok(syncCount>before);
 });
 await check('Lange Texte bleiben in hellen und dunklen schmalen Ansichten ohne horizontalen Überlauf lesbar',async()=>{
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.locator('.am-communication-head').scrollIntoViewIfNeeded();await noOverflow();await screenshot('filled-'+theme)}
  if(mobile)await page.setViewportSize({width:320,height:640});else await page.locator('.am-resizer').focus().then(()=>page.keyboard.press('End'));
  await noOverflow();await page.getByRole('heading',{name:'Versendetes Schreiben',exact:true}).scrollIntoViewIfNeeded();await screenshot('narrow');
 });
 assert.deepEqual(errors,[]);
};
module.exports.setup=db=>{
 const contact=JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json);contact.people[0].fax='0123/66';contact.people[0].contactWays=[{id:'p-fax',type:'fax',label:'Abteilung',value:'0123/77'}];contact.contactWays=[{id:'c-fax',type:'fax',label:'Poststelle',value:'0123/88'}];db.prepare("UPDATE case_contacts SET data_json=? WHERE id='court'").run(JSON.stringify(contact));
 const link={scope:'case',caseId:'a',contactId:'court'};
 db.prepare('INSERT INTO case_doku_entries(id,case_id,data_json) VALUES(?,?,?)').run('qa-note','a',JSON.stringify({date:'2026-09-13',detail:'Dokumentierte Antwort',freeDetail:'Die Rückmeldung ist eingegangen und wurde dem Fall zugeordnet.',mailAccountId:'qa-communication',mailMessageId:'<qa-documented>',contactLink:link}));
 db.prepare("UPDATE cases SET stammdaten_json=? WHERE id='a'").run(JSON.stringify({exportHistory:[{id:'qa-letter',status:'sent',channel:'fax',documentTitle:'Versendetes Schreiben',note:'Langes Aktenzeichen: '+ 'AZ1234567890'.repeat(20),sentAt:'2026-09-12T09:00:00Z',contactLink:link}]}));
 db.prepare("INSERT INTO mail_accounts(id,label,kind,email,visibility,owner_user_id) VALUES('qa-communication','Testpostfach','imap','me@example.org','public',1)").run();
 require('../src/modules/contacts/addressbook-communications').indexMessages('qa-communication','INBOX',[{uid:1,messageId:'<qa-documented>',subject:'Dokumentierte Antwort',date:'2026-09-13',from:{address:'gericht@example.org'},to:[{address:'me@example.org'}]},{uid:2,messageId:'<qa-new>',subject:'Neue Nachricht',date:'2026-09-13',from:{address:'gericht@example.org'},to:[{address:'me@example.org'}]}]);
};
