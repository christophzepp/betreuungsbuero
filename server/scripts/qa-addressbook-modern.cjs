'use strict';
// Echte App + echte Adressbuch-/Fall-Routen, ausschließlich gegen eine temporäre Testdatenbank.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qa-addressbook-'));
process.env.MAILBOX_WATCH='0';process.env.RUNTIME_ROOT=temp;process.env.DB_PATH=path.join(temp,'test.sqlite3');process.env.DOCUMENTS_DATA_ROOT=path.join(temp,'data');process.env.ENCRYPTION_KEY='54'.repeat(32);
const db=require('../src/database'),express=require('express'),playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=express();app.use(express.json({limit:'5mb'}));let failSave=false;const writes=[];
app.use((req,res,next)=>{req.session={userId:1,isAdmin:true,displayName:'QA Test'};if(req.method==='PATCH'&&req.path==='/api/addressbook/contact'){writes.push(req.body);if(failSave)return res.status(503).json({error:'Testverbindung unterbrochen – Eingaben bleiben erhalten.'})}next()});
app.use('/api/addressbook',require('../src/modules/contacts/addressbook-routes'));
app.use('/api/cases',require('../src/modules/cases/routes'));app.use('/api/office-contacts',require('../src/modules/office/contact-routes'));
if(process.env.QA_ORGANIZER)app.use('/ocr-assets',express.static(path.resolve(__dirname,'../assets/ocr')));
app.get('/test-address.xlsx',(req,res)=>res.sendFile(path.resolve(__dirname,'../assets/templates/Adressverzeichnis_blank.xlsx')));
app.get('/',(req,res)=>res.type('html').send(fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'))));
if(process.env.QA_MAILVCARD)app.use('/api/mailbox',require('../src/modules/mail/mailbox-routes'));
app.use('/api',(req,res)=>res.json({}));
db.prepare("INSERT INTO users(id,username,password_hash) VALUES(1,'qa','fixture')").run();
db.prepare("INSERT INTO cases(id,label,owner_user_id) VALUES('a','Mara Muster',1),('b','Jonas Beispiel',1)").run();
const seed=(id,c,d)=>db.prepare('INSERT INTO case_contacts(id,case_id,data_json) VALUES(?,?,?)').run(id,c,JSON.stringify(d));
seed('court','a',{institution:'Amtsgericht Musterstadt',firstName:'Sabine',lastName:'Müller',role:'Betreuungsgericht',status:'Aktiv',email:'gericht@example.org',fax:'0123/55',phone:'0123/44',street:'Gerichtsstraße',house:'1',postal:'12345',city:'Musterstadt',fileNumber:'A-100',_category:'justiz',people:[{id:'sach',name:'Lea Schneider',department:'Betreuung',email:'lea@example.org',phone:'0123/99'}]});
seed('doctor','a',{institution:'Praxis Dr. Sommer',role:'Hausärztin',status:'Aktiv',email:'praxis@example.org',phone:'0123/22',_category:'gesundheit',fileNumber:'A-200'});
seed('ended','a',{institution:'Frühere Praxis',role:'Hausarzt',status:'Beendet',_category:'gesundheit'});
seed('other','b',{institution:'Vermietung Nebenstadt',role:'Vermieter',status:'Aktiv',fileNumber:'B-900',_category:'wohnen'});
db.prepare('INSERT INTO office_contacts(id,data_json) VALUES(?,?)').run('office',JSON.stringify({institution:'Büro-Kontakt',role:'Notarin',email:'buero@example.org'}));
if(process.env.QA_ORGANIZER)require('./qa-addressbook-organizer.cjs').setup(db);
if(process.env.QA_CONTACT_TOOLS)require('./qa-addressbook-contact-tools.cjs').setup(db);
if(process.env.QA_MAILVCARD)require('./qa-addressbook-mail-vcard.cjs').setup(db);
if(process.env.QA_VIEWS_HISTORY)require('./qa-addressbook-views-history.cjs').setup(db);
let server,browser;
(async()=>{
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});const origin='http://127.0.0.1:'+server.address().port;
 browser=await playwright[process.env.QA_BROWSER||'chromium'].launch({headless:true});
 for(const mobile of (process.env.QA_MOBILE_ONLY?[true]:[false,true])){
 if(process.env.QA_REGRESSIONS){const ended=JSON.parse(db.prepare('SELECT data_json FROM case_contacts WHERE id=?').get('ended').data_json);ended.status='Beendet';db.prepare('UPDATE case_contacts SET data_json=? WHERE id=?').run(JSON.stringify(ended),'ended')}
 const page=await browser.newPage({viewport:mobile?{width:390,height:process.env.QA_REGRESSIONS?700:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,...(mobile?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
 page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});
 await page.route('**/*',r=>(r.request().url().startsWith(origin)||r.request().url().startsWith('blob:'+origin)||r.request().url().startsWith('data:image/'))?r.continue():r.abort());
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:90000});await page.locator('#modeIntroNext').click();await page.waitForTimeout(250);
 await page.evaluate(async()=>{
  window.__appMode='online';window.__activeServerCaseId='a';window.caseIdentityOf=()=> 'a';window.__abScope='case';window.__abBueroWide=false;
  const load=async id=>(await(await fetch('/api/cases/'+id+'/contacts')).json()).contacts.map(x=>({...x.data,id:x.id}));
  state.caseData.person.firstName='Mara';state.caseData.person.lastName='Muster';state.caseData.contacts=await load('a');state.caseData.documentationEntries=[];
  window.__onlineCaseCache=new Map([['a',{label:'Mara Muster',data:state.caseData}],['b',{label:'Jonas Beispiel',data:{contacts:await load('b'),documentationEntries:[]}}]]);
  if(window.__onlineCaseSync)window.__onlineCaseSync.preloadCache=async()=>{};
  document.getElementById('loginGateOverlay')?.remove();window.showImportedAddressbook();
 });
 await page.locator('#addressbookModern').waitFor();await page.waitForTimeout(300);
 if(process.env.QA_DISPLAY_BUGS){await require('./qa-addressbook-display-bugs.cjs')({page,mobile,db,errors});await page.close();continue;}
 if(process.env.QA_ORGANIZER){await require('./qa-addressbook-organizer.cjs')({page,mobile,db,errors});await page.close();continue;}
 if(process.env.QA_CONTACT_TOOLS){await require('./qa-addressbook-contact-tools.cjs')({page,mobile,db,errors});await page.close();continue;}
 if(process.env.QA_VIEWS_HISTORY){await require('./qa-addressbook-views-history.cjs')({page,mobile,db,errors});await page.close();continue;}
 if(process.env.QA_MAILVCARD){await require('./qa-addressbook-mail-vcard.cjs')({page,mobile,db,errors,temp});await page.close();continue;}
 if(process.env.QA_AUDIT){await require('./qa-addressbook-audit.cjs')({page,mobile,db,errors});await page.close();continue;}
 if(process.env.QA_EXPANSION){await require('./qa-addressbook-expansion.cjs')({page,mobile,db,errors});await page.close();continue;}
 if(process.env.QA_EXTENDED){await require('./qa-addressbook-extended.cjs')({page,mobile,db,errors});await page.close();continue;}
 if(process.env.QA_REGRESSIONS){await require('./qa-addressbook-regressions.cjs')({page,mobile,db,errors});await page.close();continue;}
 if(process.env.QA_LAYOUT_ONLY){
  const select=await page.locator('.ab-case-switcher select').boundingBox();assert.ok(select.height>=36,'Safari-Auswahlfeld muss volle Höhe haben');
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:'/tmp/addressbook-final-'+(mobile?'mobile':'desktop')+'-'+theme+'.png'})}
  console.log('LAYOUT',mobile?'Mobil':'Desktop',await page.evaluate(()=>({innerHeight,visualHeight:visualViewport.height,modal:document.querySelector('#modal .modal-box').getBoundingClientRect().toJSON(),root:document.querySelector('#addressbookModern').getBoundingClientRect().toJSON(),mobile:document.documentElement.className})));
  if(mobile){await page.setViewportSize({width:320,height:640});assert.equal(await page.locator('#addressbookModern').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);await page.screenshot({path:'/tmp/addressbook-final-mobile-small.png'})}
  assert.deepEqual(errors,[]);await page.close();continue;
 }
 const check=async(label,fn)=>{await fn();console.log('PASS '+(mobile?'Mobil':'Desktop')+' '+label)};
 await check('Originalfilter, Auswahl, Import und Export bleiben vorhanden',async()=>{
  for(const id of ['phase5AddressSearchV154','phase5AddressStatusV154','phase5AddressCityV154','phase5AddressRoleV154','phase5AddressInstitutionV154','phase5AddressKindV154','phase5AddressSortV154','phase5AddressDirectionV154','phase5AddressNameOrderV154','abLetterBar'])assert.equal(await page.locator('#'+id).count(),1,id);
  await page.locator('.am-menu:not(.am-views) summary').click();for(const t of ['Adressbuch als Excel herunterladen','vCard exportieren','vCard importieren','Duplikate & Kontakte zusammenführen'])assert.ok((await page.locator('.am-menu:not(.am-views) .am-menu-body').innerText()).includes(t),t);await page.locator('.am-menu:not(.am-views) summary').click();
 });
 const choose=async text=>{await page.getByRole('button',{name:new RegExp(text)}).filter({has:page.locator('.am-row-copy')}).click();await page.locator('.am-tab-body .am-section').first().waitFor()};
 await choose('Amtsgericht Musterstadt');
 await check('Vollständige Kontaktaktionen und Ansprechpartner sind erreichbar',async()=>{
  await page.locator('#amPerson').selectOption('sach');assert.match(await page.locator('.am-tab-body').innerText(),/lea@example.org/);
  for(const t of ['Für aktuelles Dokument verwenden','Dokumentation anlegen','E-Mail intern','E-Mail extern'])assert.equal(await page.getByRole('button',{name:t,exact:true}).isVisible(),true,t);
  await page.locator('.am-more summary').click();for(const t of ['Daten kopieren','Faxnummer kopieren','Beenden','Löschen'])assert.equal(await page.getByRole('button',{name:t,exact:true}).isVisible(),true,t);await page.locator('.am-more summary').click();
 });
 if(!mobile){
  const before=await page.locator('.am-list-pane').boundingBox(),grip=await page.locator('.am-resizer').boundingBox();await page.mouse.move(grip.x+4,grip.y+100);await page.mouse.down();await page.mouse.move(grip.x+90,grip.y+100);await page.mouse.up();const after=await page.locator('.am-list-pane').boundingBox();assert.ok(after.width>before.width+50);
  await page.locator('.am-resizer').focus();await page.keyboard.press('Home');assert.equal(await page.locator('.am-resizer').getAttribute('aria-valuenow'),'28');await page.keyboard.press('End');assert.equal(await page.locator('.am-resizer').getAttribute('aria-valuenow'),'65');await page.locator('.am-resizer').dblclick();
 }
 await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('#amEdit_institution').waitFor();
 await check('Alle ursprünglichen Adress-, Kontakt-, Referenz- und Bankfelder sind im Formular',async()=>{
  for(const id of ['institution','firstName','lastName','status','role','salutation','title','street','house','houseLetter','postal','city','postbox','phoneArea','phoneNumber','mobileArea','mobileNumber','email','faxArea','faxNumber','fileNumber','processNumber','iban','bic','bankName'])assert.equal(await page.locator('#amEdit_'+id).count(),1,id);
 });
 const email=(mobile?'mobil':'desktop')+'@example.org';await page.locator('#amEdit_email').fill(email);await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent.startsWith('Gespeichert'));
 assert.equal(JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json).email,email);
 failSave=true;await page.locator('#amEdit_note').fill('Entwurf bei Verbindungsfehler behalten.');await page.waitForFunction(()=>document.querySelector('.am-save')?.classList.contains('error'));
 assert.equal(await page.locator('#amEdit_note').inputValue(),'Entwurf bei Verbindungsfehler behalten.');await page.evaluate(()=>window.closeModal());assert.equal(await page.locator('#amEdit_note').isVisible(),true,'Fehlgeschlagene Eingaben müssen beim Schließen erhalten bleiben');failSave=false;await page.getByRole('button',{name:'Speichern erneut versuchen'}).click();await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent.startsWith('Gespeichert'));
 await page.getByRole('button',{name:'Fertig',exact:true}).click();await page.locator('.am-tabs').waitFor();
 await page.getByRole('button',{name:'Änderungen',exact:true}).click();await page.getByRole('heading',{name:/QA Test/}).first().waitFor();assert.match(await page.locator('.am-tab-body').innerText(),/E-Mail|Notizen/);
 if(!mobile){
  await page.getByRole('button',{name:'Fälle & Standard',exact:true}).click();await page.getByRole('button',{name:'+ Weiterem Fall zuordnen'}).click();await page.locator('[name=targetCaseId]').selectOption('b');await page.locator('[name=fileNumber]').fill('B-200');await page.locator('.am-small-form button[type=submit]').click();await page.getByRole('heading',{name:'Jonas Beispiel',exact:true}).waitFor();
  await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('#amEdit_institution').waitFor();await page.locator('#amEdit_city').fill('Neuer Ort');await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent.startsWith('Gespeichert'));await page.getByRole('button',{name:'Fertig',exact:true}).click();
  const projection=JSON.parse(db.prepare("SELECT c.data_json FROM case_contacts c JOIN addressbook_links l ON l.case_contact_id=c.id WHERE c.case_id='b'").get().data_json);assert.equal(projection.city,'Neuer Ort');assert.equal(projection.fileNumber,'B-200');
 }
 await page.getByRole('button',{name:'Fälle & Standard',exact:true}).click();await page.getByRole('heading',{name:'Mara Muster',exact:true}).waitFor();await page.locator('#amPerson').selectOption('sach');
 const caseSection=page.locator('.am-section').filter({has:page.getByRole('heading',{name:'Mara Muster',exact:true})});
 const mark=caseSection.getByRole('button',{name:'Als Standard für Dokumente',exact:true});if(await mark.count())await mark.click();
 await page.waitForFunction(()=>window.__abDefaultRecipient('document')?.person?.id==='sach');const def=await page.evaluate(()=>window.__abDefaultRecipient('document'));assert.equal(def.person.id,'sach');const recipient=await page.evaluate(()=>{delete state.ui.exportOptions.free_document;const eo=window.getExportOptions('free_document');return {eo,html:window.exportRecipientHTML(eo),lines:window.phase3RecipientLines(eo)}});assert.equal(recipient.eo.recipientPersonId,'sach');assert.match(recipient.html,/Lea Schneider/,JSON.stringify(recipient));assert.match(recipient.lines.join(' '),/Lea Schneider/);assert.equal(recipient.eo.recipientEmail,'lea@example.org');
 await page.getByRole('button',{name:'Dokumentation anlegen',exact:true}).click();await page.locator('#dokuLinkedContact').waitFor();assert.match(await page.locator('#dokuLinkedContact').inputValue(),/Lea Schneider/);
 await page.locator('#dokuFreeDetail').fill('Gespräch mit Ansprechpartner dokumentiert.');await page.locator('#dokuContactType').fill('telefonisch');await page.locator('#fdFormSaveBtn').click();await page.locator('#dokuLinkedContact').waitFor({state:'detached'});
 await page.evaluate(()=>window.showImportedAddressbook());await page.waitForTimeout(150);await choose('Amtsgericht Musterstadt');await page.getByRole('button',{name:'Kommunikation',exact:true}).click();await page.getByText('Gespräch mit Ansprechpartner dokumentiert.',{exact:true}).first().waitFor();
 await check('Gemeinsamer Kommunikationsverlauf enthält echte verknüpfte Dokumentation',async()=>{assert.ok(await page.getByRole('button',{name:'In Falldokumentation öffnen'}).count()>=1)});
 if(!mobile){
 await check('Standardwechsel aktualisiert auch den vorherigen Empfänger im Browser',async()=>{
  await choose('Praxis Dr. Sommer');await page.getByRole('button',{name:'Fälle & Standard',exact:true}).click();await page.getByRole('button',{name:'Als Standard für Dokumente',exact:true}).click();await page.waitForFunction(()=>window.__abDefaultRecipient('document')?.contact?.id==='doctor');
  await choose('Amtsgericht Musterstadt');await page.getByRole('button',{name:'Fälle & Standard',exact:true}).click();await page.locator('#amPerson').selectOption('sach');await page.locator('.am-section').filter({has:page.getByRole('heading',{name:'Mara Muster',exact:true})}).getByRole('button',{name:'Als Standard für Dokumente',exact:true}).click();await page.waitForFunction(()=>window.__abDefaultRecipient('document')?.person?.id==='sach');
 });
 await check('Ansprechpartner anlegen und wieder entfernen',async()=>{
  await page.getByRole('button',{name:'Ansprechpartner',exact:true}).click();await page.getByRole('button',{name:'+ Ansprechpartner',exact:true}).click();await page.locator('.am-small-form [name=name]').fill('Max Beispiel');await page.locator('.am-small-form [name=email]').fill('max@example.org');await page.locator('.am-small-form button[type=submit]').click();await page.getByRole('heading',{name:'Max Beispiel',exact:true}).waitFor();page.once('dialog',d=>d.accept());await page.locator('.am-section').filter({has:page.getByRole('heading',{name:'Max Beispiel',exact:true})}).getByRole('button',{name:'Entfernen',exact:true}).click();await page.getByRole('heading',{name:'Max Beispiel',exact:true}).waitFor({state:'detached'});
 });
 await check('Konflikte behalten den Entwurf und lassen sich ausdrücklich auflösen',async()=>{
  await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('#amEdit_city').waitFor();const stored=JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='court'").get().data_json);stored.city='Parallel geändert';db.prepare("UPDATE case_contacts SET data_json=? WHERE id='court'").run(JSON.stringify(stored));await page.locator('#amEdit_city').fill('Meine geprüfte Änderung');await page.locator('.am-conflict:not([hidden])').waitFor();assert.equal(await page.locator('#amEdit_city').inputValue(),'Meine geprüfte Änderung');page.once('dialog',d=>d.accept());await page.locator('.am-conflict').click();await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent.startsWith('Gespeichert'));await page.getByRole('button',{name:'Fertig',exact:true}).click();
  await page.getByRole('button',{name:'Änderungen',exact:true}).click();await page.getByRole('button',{name:'Diese Änderung rückgängig machen',exact:true}).first().waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Diese Änderung rückgängig machen',exact:true}).first().click();await page.waitForFunction(()=>state.caseData.contacts.find(c=>c.id==='court').city==='Parallel geändert');
 });
 await check('Neuanlage wird genau einmal gespeichert; Sammelstatus wartet auf Erfolg',async()=>{
  const before=db.prepare("SELECT count(*) n FROM case_contacts WHERE case_id='a'").get().n;
  await page.getByRole('button',{name:'+ Neuer Kontakt',exact:true}).click();await page.locator('#amEdit_institution').fill('QA Neue Institution');await page.locator('#amEdit_email').fill('neu@example.org');await page.getByRole('button',{name:'Kontakt anlegen',exact:true}).click();await page.locator('.am-tabs').waitFor();await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('#amEdit_note').waitFor();await page.locator('#amEdit_note').fill('Zweite automatische Speicherung');await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent.startsWith('Gespeichert'));assert.equal(db.prepare("SELECT count(*) n FROM case_contacts WHERE case_id='a'").get().n,before+1);await page.getByRole('button',{name:'Fertig',exact:true}).click();
  await page.locator('#phase5AddressSearchV154').fill('QA Neue');await page.getByRole('button',{name:'Alle auswählen',exact:true}).click();failSave=true;await page.getByRole('button',{name:'Als beendet markieren',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent.includes('nicht gespeichert'));assert.equal(await page.locator('.am-row input').isChecked(),true);failSave=false;await page.getByRole('button',{name:'Als beendet markieren',exact:true}).click();await page.locator('.am-row').waitFor({state:'detached'});await page.locator('#phase5AddressSearchV154').fill('');
 });
 await check('vCard-Import wird dauerhaft gespeichert und Duplikate werden übersprungen',async()=>{
  await page.locator('.am-menu:not(.am-views) summary').click();const input=page.locator('.am-menu:not(.am-views) .am-menu-body input[type=file]'),file={name:'kontakt.vcf',mimeType:'text/vcard',buffer:Buffer.from('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Vera Import\r\nN:Import;Vera;;;\r\nEMAIL:import@example.org\r\nEND:VCARD\r\n')};await input.setInputFiles(file);await page.waitForFunction(()=>state.caseData.contacts.some(c=>c.email==='import@example.org'&&c.id));const imported=db.prepare("SELECT id FROM case_contacts WHERE json_extract(data_json,'$.email')='import@example.org'").all();assert.equal(imported.length,1);await page.locator('.am-menu:not(.am-views) summary').click();await page.locator('.am-menu:not(.am-views) .am-menu-body input[type=file]').setInputFiles(file);await page.waitForTimeout(400);assert.equal(db.prepare("SELECT count(*) n FROM case_contacts WHERE json_extract(data_json,'$.email')='import@example.org'").get().n,1);
 });
 await check('Excel-Sicherung enthält aktuelle Kontaktdaten und Fallreferenzen',async()=>{
  await page.evaluate(async()=>{const response=await fetch('/test-address.xlsx');parsedAddressArchive=await XLSX.workbook(new File([await response.arrayBuffer()],'Adressverzeichnis.xlsx'))});
  await page.locator('.am-menu:not(.am-views) summary').click();const ready=page.waitForEvent('download');await page.getByRole('button',{name:'Adressbuch als Excel herunterladen',exact:true}).click();const download=await ready;const file=path.join(temp,'adressbuch.xlsx');await download.saveAs(file);const values=await page.evaluate(async bytes=>{const book=await XLSX.workbook(new File([new Uint8Array(bytes)],'Export.xlsx'));return await XLSX.sheet(book,book.sheets.find(s=>/adress/i.test(s.name)))},[...fs.readFileSync(file)]);const text=JSON.stringify(values);for(const expected of ['Amtsgericht Musterstadt','A-100','desktop@example.org','Vera','import@example.org','Mara'])assert.ok(text.includes(expected),expected);await page.locator('.am-menu:not(.am-views) summary').click();
 });
 await check('Büro- und Gesamtansicht behalten die richtige Kontaktquelle',async()=>{
  await page.evaluate(()=>window.__abSwitchCase('__buero'));await page.waitForTimeout(300);await choose('Büro-Kontakt');await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('#amEdit_note').fill('Büroweit gespeichert');await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent.startsWith('Gespeichert'));await page.getByRole('button',{name:'Fertig',exact:true}).click();assert.equal(JSON.parse(db.prepare("SELECT data_json FROM office_contacts WHERE id='office'").get().data_json).note,'Büroweit gespeichert');await page.locator('.am-menu:not(.am-views) summary').click();assert.match(await page.locator('.am-menu:not(.am-views) .am-menu-body').innerText(),/Online-Kontakte importieren/);assert.match(await page.locator('.am-menu:not(.am-views) .am-menu-body').innerText(),/In Online-Konto exportieren/);
  await page.evaluate(()=>window.__abSwitchCase('__all'));await page.waitForTimeout(250);await choose('Vermietung Nebenstadt');await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('#amEdit_note').fill('Richtiger fremder Fall');await page.waitForFunction(()=>document.querySelector('.am-save')?.textContent.startsWith('Gespeichert'));await page.getByRole('button',{name:'Fertig',exact:true}).click();assert.equal(JSON.parse(db.prepare("SELECT data_json FROM case_contacts WHERE id='other'").get().data_json).note,'Richtiger fremder Fall');await page.evaluate(()=>{window.__abScope='case';window.__abBueroWide=false;window.showImportedAddressbook()});
 });
 }
 if(mobile)await page.getByRole('button',{name:'← Kontakte',exact:true}).click();
 await page.locator('#phase5AddressSearchV154').fill('Sommer');await page.waitForTimeout(150);assert.equal(await page.locator('.am-row').count(),1);await page.locator('#phase5AddressSearchV154').fill('');
 await page.locator('.am-menu:not(.am-views) summary').click();const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:/^vCard exportieren/}).click();const download=await downloaded;const downloadPath=path.join(temp,(mobile?'mobil':'desktop')+'.vcf');await download.saveAs(downloadPath);assert.match(fs.readFileSync(downloadPath,'utf8'),/BEGIN:VCARD/);
 await page.locator('.am-menu:not(.am-views) summary').click();
 await page.evaluate(()=>{document.querySelectorAll('.toast-stack .toast,.toast-item').forEach(el=>el.remove());document.documentElement.dataset.theme='dark'});
 await page.screenshot({path:'/tmp/addressbook-modern-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop')+'-dark.png'});
 assert.equal(await page.locator('#addressbookModern').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
 await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:'/tmp/addressbook-modern-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop')+'.png'});
  if(mobile){const box=await page.locator('#phase5AddressListV154').boundingBox();assert.ok(box.height>150,'Kontaktliste muss auf dem Handy sichtbar bleiben');}
 await choose('Amtsgericht Musterstadt');await page.getByRole('button',{name:'Kontaktdaten',exact:true}).click();await page.screenshot({path:'/tmp/addressbook-modern-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop')+'-detail.png'});await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.screenshot({path:'/tmp/addressbook-modern-'+(process.env.QA_BROWSER||'chromium')+'-'+(mobile?'mobile':'desktop')+'-edit.png'});await page.getByRole('button',{name:'Fertig',exact:true}).click();
 if(!mobile){
 await check('Zusammenführen ist umkehrbar und stellt Original-IDs dauerhaft wieder her',async()=>{
  await page.evaluate(async()=>{for(const d of [{id:'merge-a',institution:'QA Dublette',email:'dup@example.org'},{id:'merge-b',institution:'QA Dublette',email:'dup@example.org',phone:'0123/77'}]){await fetch('/api/cases/a/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:d.id,data:d})})}const r=await(await fetch('/api/cases/a/contacts')).json();state.caseData.contacts=r.contacts.map(x=>({...x.data,id:x.id}));window.showImportedAddressbook()});
  await page.locator('.am-menu:not(.am-views) summary').click();await page.getByRole('button',{name:'Duplikate & Kontakte zusammenführen',exact:true}).click();await page.getByRole('heading',{name:/Duplikate/}).first().waitFor();
  page.once('dialog',d=>d.accept());await page.evaluate(()=>{window.__abCsvSelectAll(false);for(const c of state.caseData.contacts.filter(c=>c.id.startsWith('merge-')))window.__abCsvToggle(window.__abModernLegacy.key(c),true);return window.__abMergeSelected()});
  await page.waitForFunction(async()=>{const r=await(await fetch('/api/cases/a/contacts')).json();return r.contacts.filter(x=>x.id.startsWith('merge-')).length===1});const record=await page.evaluate(()=>state.caseData.contactMerges.find(m=>m.survivorId.startsWith('merge-')).id);await page.evaluate(async id=>window.__abUnmergeContacts(id),record);assert.equal(db.prepare("SELECT count(*) n FROM case_contacts WHERE id IN ('merge-a','merge-b')").get().n,2);
  await page.evaluate(()=>{window.__baBack=null;window.showImportedAddressbook()});
 });
 await check('Lokale Kontakte ohne ID lassen sich bearbeiten und einzeln löschen',async()=>{
  await page.evaluate(()=>{window.__appMode='local';window.__abScope='case';window.__abBueroWide=false;state.caseData.contacts=[{institution:'Lokal Eins',status:'Aktiv'},{institution:'Lokal Zwei',status:'Aktiv'}];window.showImportedAddressbook()});await choose('Lokal Eins');await page.locator('.am-detail-top').getByRole('button',{name:'Bearbeiten',exact:true}).click();await page.locator('#amEdit_city').fill('Lokaler Ort');await page.getByRole('button',{name:'Fertig',exact:true}).click();assert.equal(await page.evaluate(()=>state.caseData.contacts.length),2);assert.equal(await page.evaluate(()=>state.caseData.contacts.find(c=>c.institution==='Lokal Eins').city),'Lokaler Ort');await choose('Lokal Zwei');await page.locator('.am-more summary').click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Löschen',exact:true}).click();await page.waitForFunction(()=>state.caseData.contacts.length===1);assert.equal(await page.evaluate(()=>state.caseData.contacts[0].institution),'Lokal Eins');
 });
 }
 assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS vollständiger Adressbuch-Prüflauf; Daten ausschließlich in temporärer Datenbank');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));db.close();fs.rmSync(temp,{recursive:true,force:true})});
