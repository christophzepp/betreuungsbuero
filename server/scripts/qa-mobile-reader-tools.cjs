'use strict';
// Reuse the real PDF renderer and intercepted document API fixture; no production data or writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'qa-mobile-explorer.cjs'),'utf8');
const end=source.indexOf(" await check('Dateiliste zeigt ursprüngliche Dateien und Ordner'");
assert.ok(end>0,'Explorer fixture setup boundary exists');
const setup=new Function('require','__dirname',source.slice(0,end).replace('(async()=>{','async function setup(){')+'return {browser,page,errors};}catch(e){await browser.close();throw e;}};return setup;')(require,__dirname);
const output=process.env.MOBILE_QA_OUTPUT||'/tmp/mobile-reader-tools';fs.mkdirSync(output,{recursive:true});
(async()=>{const {browser,page,errors}=await setup();const checks=[];page.setDefaultTimeout(15000);
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};
 const shot=async name=>{await page.waitForTimeout(220);await page.screenshot({path:path.join(output,name+'.png')})};
 const sheet=page.locator('#mobileOnlineSheet');
 const open=async()=>{await page.getByRole('button',{name:'Werkzeuge',exact:true}).click();await sheet.locator('.dok-mobile-tools').waitFor()};
 const close=()=>sheet.getByRole('button',{name:'Zum Dokument',exact:true}).click();
 const width=()=>page.locator('#dokLauf2').evaluate(e=>parseFloat(e.style.getPropertyValue('--dokpw')));
 try{
  await page.locator('[data-dokid=pdf]').click();await page.getByRole('button',{name:'Lesen',exact:true}).click();await page.locator('#dokSeite_pdf_1 canvas').waitFor();await open();
  check('Alle sechs Werkzeuge bleiben im Blatt vorhanden',await sheet.locator('.dok-werkzeuggruppe button').count()===6);
  check('Doppelte Explorer-Navigation und Ordnerinformationen entfallen',!await sheet.innerText().then(t=>t.includes('Explorer')||t.includes('Dokumente ·')));
  check('Hand ist eindeutig ausgewählt',await sheet.getByRole('button',{name:'Hand',exact:true}).getAttribute('aria-pressed')==='true');
  for(const size of [320,390,570])for(const dark of [false,true]){
   await page.setViewportSize({width:size,height:844});await page.evaluate(d=>document.documentElement.dataset.theme=d?'dark':'light',dark);await page.waitForTimeout(120);
   const layout=await sheet.locator('.dok-mobile-tools').evaluate(e=>({overflow:e.scrollWidth>e.clientWidth+1,cards:[...e.querySelectorAll('.dok-werkzeuggruppe button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})}));
   check('Touchraster passt bei '+size+'px / '+(dark?'dunkel':'hell'),!layout.overflow&&layout.cards.every(c=>c.w>=80&&c.h>=70)&&layout.cards[0].y===layout.cards[2].y&&layout.cards[3].y>layout.cards[0].y);
   check('Abschluss bleibt über der Hauptnavigation erreichbar '+size+' / '+dark,await sheet.locator('footer').evaluate(e=>e.getBoundingClientRect().bottom<=document.getElementById('mobileOnlineShell').getBoundingClientRect().top+1));
   if(size===390||size===570&&!dark)await shot('werkzeuge-'+size+'-'+(dark?'dunkel':'hell'));
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await sheet.getByRole('button',{name:'Seitenbreite',exact:true}).click();const fit=await width();check('Seitenbreite setzt den Zoom auf die schmale Ansicht',fit===360);
  await sheet.getByRole('button',{name:'Verkleinern',exact:true}).click();check('Verkleinern verkleinert auch unterhalb von 460px',await width()<fit);
  await sheet.getByRole('button',{name:'Vergrößern',exact:true}).click();check('Vergrößern stellt die vorherige Breite wieder her',await width()===fit);
  await sheet.getByRole('button',{name:'Vollbild',exact:true}).click();check('Vollbild behält Beschriftung und Zustand',await sheet.getByRole('button',{name:'Vollbild beenden',exact:true}).getAttribute('aria-pressed')==='true');await sheet.getByRole('button',{name:'Vollbild beenden',exact:true}).click();
  await sheet.getByRole('button',{name:'Markieren',exact:true}).click();
  check('Farbflächen nutzen gleichmäßig die Breite',await sheet.locator('.dok-mobile-colors button').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().width>=70&&e.getBoundingClientRect().height>=44)));
  check('Markieren lässt die Farbauswahl geöffnet',await sheet.locator('.dok-mobile-colors button').count()===8&&await sheet.isVisible());
  await sheet.getByRole('button',{name:'Blau',exact:true}).click();check('Farbe ist zugänglich und eindeutig gewählt',await sheet.getByRole('button',{name:'Blau',exact:true}).getAttribute('aria-pressed')==='true');await shot('markieren-farben');await close();
  await open();check('Werkzeug und Farbe überstehen das Schließen',await sheet.getByRole('button',{name:'Markieren',exact:true}).getAttribute('aria-pressed')==='true'&&await sheet.getByRole('button',{name:'Blau',exact:true}).getAttribute('aria-pressed')==='true');
  await sheet.getByRole('button',{name:'Zeichnen',exact:true}).click();check('Freihandzeichnung behält die Farbauswahl',await sheet.locator('.dok-mobile-colors button').count()===8);
  await sheet.getByRole('button',{name:'Formen',exact:true}).click();check('Alle sieben Formen und gestrichelte Linien bleiben wählbar',await sheet.locator('.dok-mobile-shapes button').count()===8);
  await sheet.getByRole('button',{name:'Pfeil in beide Richtungen',exact:true}).click();await sheet.getByRole('button',{name:'Gestrichelt',exact:true}).click();await sheet.getByRole('button',{name:'Grün',exact:true}).click();
  check('Form, Linienart und Farbe lassen sich kombinieren',await sheet.getByRole('button',{name:'Pfeil in beide Richtungen',exact:true}).getAttribute('aria-pressed')==='true'&&await sheet.getByRole('button',{name:'Gestrichelt',exact:true}).getAttribute('aria-pressed')==='true'&&await sheet.getByRole('button',{name:'Grün',exact:true}).getAttribute('aria-pressed')==='true');
  await sheet.locator('.mobile-sheet-content').evaluate(e=>e.scrollTop=0);await shot('formen-hell');await sheet.locator('.dok-mobile-colors').scrollIntoViewIfNeeded();await shot('formen-farben');
  await page.setViewportSize({width:320,height:568});await page.waitForTimeout(180);
  check('Kleines Display scrollt nur den Blattinhalt und hält Abschluss erreichbar',await sheet.locator('.mobile-sheet-content').evaluate(e=>e.scrollHeight>e.clientHeight&&e.scrollWidth<=e.clientWidth+1)&&await sheet.locator('footer').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight-70));await shot('formen-kleines-display');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await shot('formen-dunkel');await page.evaluate(()=>document.documentElement.dataset.theme='light');await close();
  const pdf=page.locator('#dokSeite_pdf_1');await pdf.scrollIntoViewIfNeeded();const rect=await pdf.boundingBox();await page.mouse.move(rect.x+50,rect.y+100);await page.mouse.down();await page.mouse.move(rect.x+170,rect.y+200,{steps:8});await page.mouse.up();await page.waitForFunction(()=>__qaDocAnnotations.length>0);
  const annotation=await page.evaluate(()=>__qaDocAnnotations[0]);check('Form wird als echte Anmerkung am richtigen Dokument gespeichert',annotation.fileId==='pdf'&&annotation.page===1&&annotation.text==='Form: Doppelpfeil (gestrichelt)'&&JSON.stringify(annotation).includes('#16a34a'));await shot('gezeichnete-form');
  await open();await sheet.getByRole('button',{name:'Signatur',exact:true}).click();check('Signatur führt zum Platzieren zurück ins Dokument',await sheet.getAttribute('aria-hidden')==='true'&&await page.locator('#dokLauf2').getAttribute('data-werk')==='sig');
  await page.evaluate(()=>{const previous=window.fetch,c=document.createElement('canvas');c.width=160;c.height=50;const ctx=c.getContext('2d');ctx.font='20px serif';ctx.fillText('Testsignatur',5,32);const data=c.toDataURL('image/png');window.fetch=(url,opts)=>String(url)==='/api/signatures'?Promise.resolve(new Response(JSON.stringify({signatures:[{name:'Büro',data_url:data},{name:'Vertretung',data_url:data}]}),{headers:{'Content-Type':'application/json'}})):previous(url,opts)});
  await pdf.click({position:{x:70,y:240}});await page.locator('.dok-mobile-dialog').getByRole('button',{name:'Büro',exact:true}).click();await pdf.click({position:{x:70,y:240}});await page.waitForFunction(()=>__qaDocAnnotations.length===2);
  check('Signaturauswahl und Platzierung bleiben vollständig nutzbar',await page.evaluate(()=>__qaDocAnnotations[1].fileId==='pdf'&&__qaDocAnnotations[1].text==='Signatur: Büro'));await shot('signatur-platziert');
  await open();await sheet.getByRole('button',{name:'Kommentar',exact:true}).click();await pdf.click({position:{x:90,y:130}});await page.locator('#dokAnnText').fill('Kommentar über das neue Werkzeugblatt');await page.locator('#dokAnnOk').click();await page.waitForFunction(()=>__qaDocAnnotations.length===3);check('Kommentar bleibt über den vollständigen Speichervorgang nutzbar',await page.evaluate(()=>__qaDocAnnotations[2].text==='Kommentar über das neue Werkzeugblatt'));
  await page.locator('.dok-mobile-read-view>.mobile-ui-header').getByRole('button',{name:'Zurück',exact:true}).click();await page.evaluate(()=>__currentUser.canEditDocuments=false);await page.getByRole('button',{name:'Lesen',exact:true}).click();await page.locator('#dokSeite_pdf_1 canvas').waitFor();await open();
  check('Leserechte werden erklärt und bleiben unverändert',await sheet.locator('.dok-mobile-read-hint').innerText().then(t=>t.includes('Nur Lesen'))&&await sheet.locator('.dok-werkzeuggruppe button:disabled').count()===5&&!await sheet.getByRole('button',{name:'Hand',exact:true}).isDisabled());await shot('werkzeuge-nur-lesen');await close();
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(250);await page.evaluate(()=>openDokumenteModal());await page.evaluate(()=>__dok.leseOeffnen('pdf'));await page.locator('#dokSeite_pdf_1 canvas').waitFor();
  check('Desktop verwendet weiterhin die ursprüngliche Werkzeugleiste',await page.locator('.dok-mobile-tools').count()===0&&await page.locator('.dok-lkopf>.dok-werkzeuggruppe').isVisible());
  check('Keine JavaScript-Laufzeitfehler',errors.length===0);
 }catch(e){await shot('fehler');console.error('UI:',await sheet.innerText());throw e;}finally{fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
