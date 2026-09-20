'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixture=fs.readFileSync(path.join(__dirname,'qa-mobile-completion.cjs'),'utf8').split('(async()=>{const{browser,page}=await setup()')[0];
const setup=new Function('require','__dirname',fixture+';return setup;')(require,__dirname);
(async()=>{const{browser,page}=await setup();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
const check=(name,value)=>{assert.ok(value,name);console.log('PASS '+name)};
try{
 await page.setViewportSize({width:1560,height:1080});
 await page.evaluate(()=>{
  window.__qaOfficeSend={simplefax:{username:'office-fax',password:'stored-test-password',loginUrl:'https://example.invalid/fax/login',inboxUrl:'https://example.invalid/fax/inbox',composeUrl:'https://example.invalid/fax/new'}};
  window.__qaPersonalSend={ebo:{username:'personal-ebo',password:'personal-secret'}};
  window.__qaBriefkopf=null;
  const oldFetch=window.fetch;
  window.fetch=async(url,opt={})=>{
   const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
   if(url==='/api/me')return json({sendCredentials:{...__qaPersonalSend,...__qaOfficeSend},sendSources:{ebo:__qaOfficeSend.ebo?'admin':'user',simplefax:__qaOfficeSend.simplefax?'admin':'none'}});
   if(url==='/api/my-settings/send'){
    if(opt.method==='PUT'){__qaPersonalSend=JSON.parse(opt.body).value;return json({ok:true})}
    return json({value:__qaPersonalSend});
   }
   if(url==='/api/admin/send-credentials')return json({services:['ebo','simplefax'].map(service=>({service,...__qaOfficeSend[service],password:undefined,hasPassword:!!__qaOfficeSend[service]?.password}))});
   if(String(url).startsWith('/api/admin/send-credentials/')){
    if(window.__qaFailSend)return json({error:'Test: Versandwege nicht gespeichert'},503);
    const service=String(url).split('/').at(-1);
    if(opt.method==='DELETE')delete __qaOfficeSend[service];
    else {const data=JSON.parse(opt.body);__qaOfficeSend[service]={...data,password:data.password||__qaOfficeSend[service]?.password||''};}
    return json({ok:true});
   }
   if(url==='/api/office-json/briefkopf'){
    if(opt.method==='PUT'){__qaBriefkopf=JSON.parse(opt.body).data;return json({ok:true})}
    return json({data:__qaBriefkopf});
   }
   return oldFetch(url,opt);
  };
  openEinstellungenApp('versand');
 });
 await page.locator('#globalSimpleFaxUsername').waitFor({state:'visible'});
 check('One shipping form without obsolete file naming or duplicate admin section',await page.evaluate(()=>!document.getElementById('einVsAdm')&&!document.getElementById('einVsMs')&&!/Dateinamen bei Exporten|Dateiname und Speicherort/.test(document.querySelector('#einSvcEinbettHost').textContent)));
 check('Saved office URL loads in the form',await page.locator('#globalSimpleFaxLoginUrl').inputValue()==='https://example.invalid/fax/login');
 check('Saved password is masked and acknowledged',await page.locator('#globalSimpleFaxPassword').inputValue()===''&&/Gespeichert/.test(await page.locator('#globalSimpleFaxPassword').getAttribute('placeholder')));
 await page.locator('#globalSimpleFaxUsername').fill('changed-office-fax');
 await page.evaluate(()=>saveGlobalServiceSettings());
 check('Top form saves immediately as office default and retains a blank password',await page.evaluate(()=>__qaOfficeSend.simplefax.username==='changed-office-fax'&&__qaOfficeSend.simplefax.password==='stored-test-password'&&__officeCredentials.sendCredentials.simplefax.username==='changed-office-fax'));
 check('Shipping credentials stay out of local case state',await page.evaluate(()=>!Object.keys(state.ui.exportGlobal||{}).some(k=>/^(ebo|simpleFax)/.test(k))));
 await page.evaluate(()=>window.__qaFailSend=true);await page.locator('#globalSimpleFaxUsername').fill('failed-change');await page.evaluate(()=>saveGlobalServiceSettings());
 check('Save errors remain visible',await page.locator('#sendSettingsStatus').innerText().then(t=>t.includes('nicht gespeichert')));
 await page.evaluate(async()=>{window.__qaFailSend=false;await removeOfficeSendCredentials('ebo');__currentUser.isAdmin=false;__currentUser.canManageCredentials=true;await __loadSendSettings();showGlobalServiceSettings()});
 check('Office defaults are locked for users, unconfigured services remain editable',await page.locator('#globalSimpleFaxUsername').isDisabled()&&await page.locator('#globalEboUsername').isEnabled());
 await page.locator('#globalEboUsername').fill('changed-personal-ebo');await page.evaluate(()=>saveGlobalServiceSettings());
 check('Personal save keeps the office service and the saved personal password',await page.evaluate(()=>__qaPersonalSend.ebo.username==='changed-personal-ebo'&&__qaPersonalSend.ebo.password==='personal-secret'&&__qaOfficeSend.simplefax.username==='changed-office-fax'));
 await page.evaluate(async()=>{
  __currentUser.isAdmin=true;
  window.officeProfile={contactName:'Erika Test',companyName:'Büro Test',street:'Teststraße 12',postalCode:'12345',city:'Musterstadt',country:'Deutschland',formattedAddress:'Teststraße 12, 12345 Musterstadt, Deutschland'};
  await __briefkopfSpeichern(__briefkopfStandardKarte());
  openEinstellungenApp('briefkopf');
 });
 await page.locator('[data-sel="signatur"]').waitFor({state:'visible'});await page.locator('[data-sel="signatur"]').click();
 await page.getByLabel('Text unter der Unterschrift',{exact:true}).fill('Erika Test · Rechtliche Betreuung');
 check('Signature caption updates in the editor preview',await page.locator('.bk-sheet [data-zone="signatur"]').innerText().then(t=>t.includes('Erika Test · Rechtliche Betreuung')));
 check('Country is omitted by default without changing stored office profile',await page.evaluate(()=>!__briefkopfWert('ANSCHRIFT').includes('Deutschland')&&officeProfile.country==='Deutschland'));
 await page.locator('[data-opt="landAnzeigen"]').check();
 await page.locator('.bk-tools [data-act="save"]').click();
 await page.waitForFunction(()=>__qaBriefkopf?.landAnzeigen===true);
 check('Caption and country flag persist together',await page.evaluate(()=>__qaBriefkopf.signatur.text==='Erika Test · Rechtliche Betreuung'&&__briefkopfSignaturText()==='Erika Test · Rechtliche Betreuung'&&__briefkopfWert('ANSCHRIFT').endsWith(', Deutschland')));
 await page.screenshot({path:'/tmp/polish-letterhead-editor.png'});
 await page.evaluate(()=>{closeModal();enterWorkspace();openReport('free_document')});
 check('Document signature uses the saved caption',await page.evaluate(()=>documentSignatureLabel()==='Erika Test · Rechtliche Betreuung'));
 // Capture actual PDF text drawing while using the real font/layout/rendering implementation.
 const pdf=await page.evaluate(async()=>{
  const texts=[],old=PDFLib.PDFPage.prototype.drawText;
  PDFLib.PDFPage.prototype.drawText=function(text,options){texts.push(String(text));return old.call(this,text,options)};
  try{const bytes=await freeDocumentCreateRichPdf(true);return{bytes:bytes.length,hasCaption:texts.includes('Erika Test · Rechtliche Betreuung'),hasCountry:texts.some(s=>s.includes('Deutschland'))}}
  finally{PDFLib.PDFPage.prototype.drawText=old;}
 });
 check('Real free-document PDF renders the saved caption and enabled country',pdf.bytes>1000&&pdf.hasCaption&&pdf.hasCountry);
 await page.evaluate(()=>{const k=__briefkopfStandardKarte();k.signatur={an:false,text:'Erika Test · Rechtliche Betreuung'};__briefkopfVorschauSetzen(k)});
 const hidden=await page.evaluate(async()=>{
  const texts=[],old=PDFLib.PDFPage.prototype.drawText;
  PDFLib.PDFPage.prototype.drawText=function(text,options){texts.push(String(text));return old.call(this,text,options)};
  try{await freeDocumentCreateRichPdf(true);return{caption:texts.some(t=>t.includes('Erika Test · Rechtliche Betreuung')),country:texts.some(t=>t.includes('Deutschland'))}}
  finally{PDFLib.PDFPage.prototype.drawText=old;__briefkopfVorschauSetzen(null)};
 });
 check('Real PDF omits disabled caption and country',!hidden.caption&&!hidden.country);
 check('No JavaScript runtime errors',errors.length===0);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
