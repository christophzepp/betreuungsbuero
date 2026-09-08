'use strict';
// Screenshot regressions from 08.09.2026. Synthetic data, intercepted network only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixture=fs.readFileSync(path.join(__dirname,'qa-mobile-completion.cjs'),'utf8');
let prefix=fixture.split('(async()=>{const{browser,page}=await setup()')[0];
if(process.env.MOBILE_QA_HTML)prefix=prefix.replace("fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'))","fs.readFileSync(process.env.MOBILE_QA_HTML)");
const setup=new Function('require','__dirname',prefix+';return setup;')(require,__dirname);
const output=process.env.MOBILE_QA_OUTPUT||'/tmp/mobile-layout-qa';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const {browser,page}=await setup(),checks=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
 const check=(name,value)=>{checks.push({name,pass:!!value});console.log((value?'PASS ':'FAIL ')+name);if(!process.env.MOBILE_QA_BASELINE)assert.ok(value,name)};
 const shot=async name=>{await page.waitForTimeout(200);await page.screenshot({path:path.join(output,name+'.png')})};
 const nav=async id=>{await page.evaluate(()=>{__mobileUI.closeSheet();closeModal();scrollTo(0,0)});await page.locator('[data-mobile-more]').click();await page.locator('#mobileOnlineSheet [data-mobile-action="'+id+'"]').click();await page.waitForTimeout(250)};
 try{
  await nav('start');await page.evaluate(()=>__startTodayOverviewRefresh());
  for(const dark of [false,true]){await page.evaluate(d=>document.documentElement.dataset.theme=d?'dark':'light',dark);await shot('start-'+(dark?'dark':'light'));check('Start nutzt die Kartenbreite '+dark,await page.locator('#startTodayMetrics').evaluate(e=>e.getBoundingClientRect().width>=e.parentElement.getBoundingClientRect().width-4))}
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';state.caseData.contacts=Array.from({length:32},(_,i)=>({id:'layout-contact-'+i,key:'layout-contact-'+i,name:'Amtsgericht Musterstadt '+i,organization:'Amtsgericht Musterstadt '+i,role:'Betreuungsgericht',city:'Musterstadt',phone:'01234/50088',email:'poststelle@example.org',status:'Aktiv'}));showImportedAddressbook()});
  await page.locator('.mobile-module-fab').waitFor();await shot('adressbuch');
  check('Plus ist rund und mindestens 44 px groß',await page.locator('.mobile-module-fab').evaluate(e=>{const r=e.getBoundingClientRect();return Math.abs(r.width-r.height)<1&&r.width>=44}));
  await page.evaluate(()=>{state.caseData.documentationEntries=[{id:'layout-short',date:'2026-09-06',contactType:'persönlich (Hausbesuch)',note:'Rückruf zur Wohnberatung vereinbart.'},{id:'layout-long',date:'2026-08-06',contactType:'persönlich (Hausbesuch)',note:'Gemeinsam wurde der Stand der Unterlagen besprochen. '.repeat(8)}];window.__dashAllCases=async()=>[{caseId:'case-a',label:'Mara Hoffmann',caseData:state.caseData,documentationEntries:state.caseData.documentationEntries}]});
  await nav('contact-monitor');
  await page.getByRole('button',{name:'Kontaktmonitor durchsuchen',exact:true}).click();await page.getByRole('searchbox').fill('Wohnberatung');
  check('Kontaktnotizen bleiben durchsuchbar',await page.locator('.mc-row').count()===1);
  await page.locator('.mc-row').first().click();await shot('kontaktmonitor');
  if(!process.env.MOBILE_QA_BASELINE)check('Kurze und lange Kontaktnotizen nutzen dieselbe volle Breite',await page.locator('.km-mobile-history-entry').evaluateAll(es=>es.length===2&&es.every(e=>Math.abs(e.querySelector('small').getBoundingClientRect().left-e.querySelector('p').getBoundingClientRect().left)<1&&e.querySelector('p').getBoundingClientRect().width>300)));

  await page.getByRole('button',{name:'Kontaktprofil',exact:true}).click();await page.locator('#cpUnderstanding').waitFor();await shot('kontaktprofil');
  check('Kontaktprofil hat eine eigene mobile Formularansicht',await page.locator('.contact-profile-mobile[data-mobile-screen=form]').count()===1);
  if(!process.env.MOBILE_QA_BASELINE){
   check('Alle 25 Profilfelder bleiben vorhanden',await page.locator('.contact-profile-mobile input,.contact-profile-mobile select,.contact-profile-mobile textarea').count()===25);
   for(const width of [320,390,570]){
    await page.setViewportSize({width,height:844});await page.waitForTimeout(100);
    check('Kontaktprofil passt bei '+width,await page.locator('.contact-profile-mobile').evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.querySelector('.mobile-ui-actions').getBoundingClientRect().bottom<=innerHeight));
   }
   await page.setViewportSize({width:390,height:844});
   await page.locator('#cpEvidence').fill('Layoutprüfung');await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
   await page.getByRole('button',{name:'Weiter bearbeiten',exact:true}).click();check('Abbruchschutz erhält den Entwurf',await page.locator('#cpEvidence').inputValue()==='Layoutprüfung');
   await page.locator('.contact-profile-mobile>.mobile-ui-body').evaluate(e=>e.scrollTop=150);await page.waitForTimeout(80);await page.locator('.contact-profile-mobile>.mobile-ui-body').evaluate(e=>e.scrollTop=300);await page.waitForTimeout(350);await shot('kontaktprofil-navigation-aus');
   check('Formularaktionen erreichen bei versteckter Navigation den Bildschirmrand',await page.locator('.contact-profile-mobile>.mobile-ui-actions').evaluate(e=>Math.abs(e.getBoundingClientRect().bottom-innerHeight)<=2));
   await page.locator('#cpCanInitiate').selectOption('bedingt');check('Bedingte Kontaktaufnahme zeigt Begründung',await page.locator('#cpLimitReason').isVisible());await page.locator('#cpLimitReason').fill('Benötigt Unterstützung beim Anrufen');
   await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.locator('[data-mobile-module=contact-monitor]').waitFor();
   check('Profil wird über das bestehende Fachmodell gespeichert',await page.evaluate(()=>state.caseData.contactProfile.evidenceSource==='Layoutprüfung'&&state.caseData.contactProfile.initiationLimitationReason==='Benötigt Unterstützung beim Anrufen'));
   await page.getByRole('button',{name:'Kontaktprofil',exact:true}).click();await page.locator('#cpEvidence').fill('Verwerfen');await page.getByRole('button',{name:'Abbrechen',exact:true}).click();await page.getByRole('button',{name:'Änderungen verwerfen',exact:true}).click();
   check('Verwerfen verändert das gespeicherte Profil nicht',await page.evaluate(()=>state.caseData.contactProfile.evidenceSource==='Layoutprüfung'));
  }
  check('Keine Laufzeitfehler',errors.length===0);
 }finally{fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
