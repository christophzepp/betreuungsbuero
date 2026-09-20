'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture,layoutFixture}=require('../tests/helpers/asset-inventory.cjs');
const source=fs.readFileSync(path.join(__dirname,'qa-mobile-completion.cjs'),'utf8').split('(async()=>{const{browser,page}=await setup()')[0];
const setup=new Function('require','__dirname',source+';return setup;')(require,__dirname);
(async()=>{const {browser,page}=await setup();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(data=>{
   closeModal();enterWorkspace();openReport('asset_inventory');
   state.reports.asset_inventory.fields=Object.fromEntries(Object.entries(data).map(([id,value])=>[id,{value,source:'manual',reviewed:true}]));
   state.ui.documentOptions=state.ui.documentOptions||{};state.ui.documentOptions.asset_inventory={signatureId:'qa-signature'};
   const canvas=document.createElement('canvas');canvas.width=520;canvas.height=60;const c=canvas.getContext('2d');c.font='italic 30px serif';c.fillStyle='#163b65';c.fillText('Musterunterschrift',4,39);
   window.__qaSignature=canvas.toDataURL('image/png');const resolve=window.__sigStore.resolve;
   window.__sigStore.resolve=id=>id==='qa-signature'?window.__qaSignature:resolve.call(window.__sigStore,id);
   renderReport();
  },fixture().data);
  assert.ok(await page.locator('[data-table="avi_expenses"]').count());
  const result=await page.evaluate(async()=>{
   const r=await createOfficialPdf('asset_inventory');const pdf=await PDFLib.PDFDocument.load(r.bytes);
   return {bytes:Array.from(r.bytes),pages:pdf.getPageCount(),fields:pdf.getForm().getFields().length,signature:r.log.signature,overflow:r.log.overflow};
  });
  assert.equal(result.signature,'embedded');assert.ok(result.fields>100);
  fs.mkdirSync('/tmp/vvz-qa',{recursive:true});fs.writeFileSync('/tmp/vvz-qa/browser.pdf',Buffer.from(result.bytes));
  console.log('PASS real application: schema, original PDF, signature, fields and pages',JSON.stringify({...result,bytes:result.bytes.length}));
  const snap=await page.evaluate(async()=>{
   const current=JSON.stringify(state.reports.asset_inventory),copy=JSON.parse(current);copy.fields.avi_person.value='Schnappschuss Muster';copy.fields.asset_inventory_items.value=[{category:'Girokonto',description:'Archivkonto',amount:42.12}];copy.fields.avi_expenses={value:[]};copy.fields.avi_monthly_expenses={value:2334.31};
   const bytes=await phase3ComponentBytes({type:'archive',reportId:'asset_inventory',data:copy,label:'Schnappschuss',formStyle:'original'},{});
   const pdf=await PDFLib.PDFDocument.load(bytes),form=pdf.getForm();
   return {person:form.getTextField('vvz_person').getText(),assets:form.getTextField('vvz_assets_total').getText(),expense:form.getTextField('vvz_expense_total').getText(),unchanged:JSON.stringify(state.reports.asset_inventory)===current};
  });
  assert.deepEqual(snap,{person:'Schnappschuss Muster',assets:'42,12',expense:'2.334,31',unchanged:true});console.log('PASS real archive export retains its own data and restores current report');
  const combined=await page.evaluate(async()=>{
   const oldSave=savePhase3ConfigFromDialog,oldParts=phase3Components;
   try{
    savePhase3ConfigFromDialog=()=>({formStyle:'original',formSignature:'none',foreignSignatures:0});
    phase3Components=[{type:'current',reportId:'asset_inventory',label:'Aktuell',enabled:true},{type:'archive',reportId:'asset_inventory',label:'Archiv',enabled:true,data:JSON.parse(JSON.stringify(state.reports.asset_inventory))}];
    const r=await createCombinedPhase3Pdf(),pdf=await PDFLib.PDFDocument.load(r.bytes),f=pdf.getForm();
    return {fields:f.getFields().length,names:f.getFields().map(x=>x.getName()),bytes:Array.from(r.bytes)};
   }finally{savePhase3ConfigFromDialog=oldSave;phase3Components=oldParts}
  });
  assert.equal(combined.fields,result.fields*2);assert.equal(new Set(combined.names).size,combined.fields);
  fs.writeFileSync('/tmp/vvz-qa/combined.pdf',Buffer.from(combined.bytes));console.log('PASS combined PDF retains canonical fields and independent snapshot names');
  const layout=await page.evaluate(async data=>{
   state.reports.asset_inventory.fields=Object.fromEntries(Object.entries(data).map(([id,value])=>[id,{value,source:'manual',reviewed:true}]));
   const r=await createOfficialPdf('asset_inventory'),pdf=await PDFLib.PDFDocument.load(r.bytes);
   return {bytes:Array.from(r.bytes),pages:pdf.getPageCount(),overflow:r.log.overflow};
  },layoutFixture());
  fs.writeFileSync('/tmp/vvz-qa/layout.pdf',Buffer.from(layout.bytes));
  console.log('PASS layout stress export',JSON.stringify({...layout,bytes:layout.bytes.length}));
  const compact=await page.evaluate(async data=>{
   state.reports.asset_inventory.fields=Object.fromEntries(Object.entries(data).map(([id,value])=>[id,{value,source:'manual',reviewed:true}]));
   state.ui.documentOptions.asset_inventory.signatureId='blank';
   const r=await createOfficialPdf('asset_inventory'),pdf=await PDFLib.PDFDocument.load(r.bytes),form=pdf.getForm();
   return {bytes:Array.from(r.bytes),signature:r.log.signature,gifts:form.getTextField('vvz_gift_details').getText(),multiline:form.getTextField('vvz_gift_details').isMultiline(),reference:form.getTextField('vvz_securities').getText(),overflow:r.log.overflow};
  },fixture({avi_gifts:'Ja',avi_gift_details:'Erika Beispiel, Musterstraße 1, 12345 Musterstadt\nUnterstützung am 01.09.2026\nGeldbetrag: 250,00 EUR',asset_inventory_items:[{category:'Wertpapiere / Fonds',reference:'R'.repeat(100),amount:2500}]}).data);
  assert.equal(compact.signature,'blank');assert.equal(compact.multiline,true);assert.equal(compact.reference,'R'.repeat(100));assert.ok(!compact.overflow.includes('gift_details'));
  fs.writeFileSync('/tmp/vvz-qa/compact.pdf',Buffer.from(compact.bytes));console.log('PASS multiline gifts, unbroken reference and deliberately blank signature');
  const missing=await page.evaluate(async()=>{state.ui.documentOptions.asset_inventory.signatureId='does-not-exist';try{await createOfficialPdf('asset_inventory');return ''}catch(e){return e.message}});
  assert.match(missing,/Unterschrift/);assert.deepEqual(errors,[]);console.log('PASS missing signature error and no runtime errors');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
