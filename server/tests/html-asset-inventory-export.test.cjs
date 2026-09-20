'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,v159,PDFLib}=require('./helpers/asset-inventory.cjs');
test('VVZ: korrekte Kategoriensummen, kumulative Überträge und vollständige Anlagen',async()=>{
 const f=fixture(),r=await f.create(),pdf=await PDFLib.PDFDocument.load(r.bytes),form=pdf.getForm();
 const value=n=>form.getTextField('vvz_'+n).getText();
 assert.equal(value('transfer_1'),value('carry_2'));
 assert.equal(value('transfer_2'),value('carry_3'));
 assert.equal(value('transfer_1'),'14.496,70');
 assert.equal(value('transfer_2'),'14.808,70');
 assert.equal(value('assets_total'),'15.348,70');
 assert.equal(value('debts_total'),'225,00');
 assert.equal(value('income_pension_amount'),'1.491,17');assert.equal(value('income_total'),'2.071,42');
 assert.equal(value('expense_rent_amount'),'780,00');assert.equal(value('expense_total'),'1.633,49');
 assert.match(value('current_overflow'),/2 weitere Konten/);
 assert.equal(value('savings_0_reference'),'DE00000000000000000009');assert.ok(!r.log.overflow.includes('savings_0_reference'));
 assert.equal(value('signed_date'),'20.09.2026');assert.equal(value('signature'),undefined);
 assert.equal(form.getCheckBox('vvz_gift_unknown').isChecked(),true);
 assert.ok(pdf.getPageCount()>6);assert.equal(form.getFields().length,Object.keys(v159.assetCoordinates).length);
 for(const page of pdf.getPages()){assert.ok(Math.abs(page.getWidth()-595.28)<.01);assert.ok(Math.abs(page.getHeight()-841.89)<.01)}
 for(const field of form.getFields())for(const widget of field.acroField.getWidgets()){
  const rect=widget.getRectangle();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=596&&rect.y+rect.height<=842,field.getName());assert.ok(widget.getAppearances().normal,field.getName());
 }
});
test('VVZ: sichtbare Formulartexte passen vollständig in ihre Felder, auch mit Zeilenumbrüchen und langen Referenzen',async()=>{
 const {layoutFixture}=require('./helpers/asset-inventory.cjs'),f=fixture(layoutFixture()),appearances=[];
 // Prüft die tatsächlich an den PDF-Appearance-Zeichner übergebenen Zeilen.
 f.ctx.PDFLib={...PDFLib,drawTextField:options=>{appearances.push(options);return PDFLib.drawTextField(options)}};
 const r=await f.create(),pdf=await PDFLib.PDFDocument.load(r.bytes),form=pdf.getForm();
 assert.equal(form.getTextField('vvz_savings_0_reference').getText(),'DE00000000000000000005');
 assert.equal(form.getTextField('vvz_cash').getText(),'Haushaltskasse\nFremdwährung: zum Stichtagskurs umgerechnet');
 assert.equal(form.getTextField('vvz_cash').isMultiline(),true);
 assert.ok(r.log.overflow.includes('relative_0_name'));
 assert.equal(form.getTextField('vvz_relative_0_name').getText(),'Anlage, Nr. 1');
 assert.ok(appearances.length>=100);
 for(const ap of appearances)for(const line of ap.textLines){
  assert.ok(line.x>=1.99&&line.y>=1.99,JSON.stringify({width:ap.width,height:ap.height,x:line.x,y:line.y}));
  assert.ok(line.x+line.width<=ap.width-1.99&&line.y+line.height<=ap.height-1.99,'Appearance must fit without clipping');
 }
 for(const key of ['income_work','income_pension','income_care','income_other','expense_rent','expense_home']){
  const text=v159.assetCoordinates[key],amount=v159.assetCoordinates[key+'_amount'];
  assert.equal(text.y+text.height,amount.y+amount.height,key+' starts alongside its amount');
 }
});
test('VVZ: Schnappschuss ohne neue Felder behält Gesamtausgaben, leere Unterschriftsdaten und Nullwerte',async()=>{
 const {create}=fixture({asset_inventory_items:[],avi_income:[],avi_expenses:[],avi_monthly_expenses:2334.31,avi_place:'',avi_signed_date:''});
 const r=await create(),pdf=await PDFLib.PDFDocument.load(r.bytes),f=pdf.getForm();
 assert.equal(f.getTextField('vvz_expense_total').getText(),'2.334,31');assert.match(f.getTextField('vvz_expense_other').getText(),/Altbestand/);
 assert.equal(f.getTextField('vvz_signed_date').getText(),undefined);assert.equal(f.getTextField('vvz_assets_total').getText(),'0,00');
});
test('VVZ: sehr lange Angaben bleiben vollständig und führen zu weiteren Anlageseiten',async()=>{
 const f=fixture({avi_notes:'Lange Angabe '.repeat(4000)+'ENDE-DER-ANGABEN'}),r=await f.create(),pdf=await PDFLib.PDFDocument.load(r.bytes);
 assert.ok(pdf.getPageCount()>10);assert.equal(r.unmapped.length,0);
});
test('VVZ: Anlagen behalten alle Daten ohne Duplikate, Seitenüberlauf oder verwaiste Überschriften',async()=>{
 const {layoutFixture}=require('./helpers/asset-inventory.cjs'),data=layoutFixture();
 data.avi_person='Sehr langer Name '.repeat(90)+'NAMENSENDE';
 data.avi_notes='Zusammenhängender Absatz zur Prüfung von langen Fortsetzungen. '.repeat(400)+'NOTIZENENDE';
 const f=fixture(data),drawings=[];
 f.ctx.PDFLib={...PDFLib,PDFDocument:{load:async(...args)=>{
  const pdf=await PDFLib.PDFDocument.load(...args),add=pdf.addPage.bind(pdf);
  pdf.addPage=(...params)=>{const page=add(...params),draw=page.drawText.bind(page),lines=[];drawings.push(lines);
   page.drawText=(text,options)=>{lines.push({text,...options,width:options.font.widthOfTextAtSize(text,options.size)});return draw(text,options)};return page};
  return pdf;
 }}};
 await f.create();
 const text=drawings.flat().map(x=>x.text).join(' ');
 assert.ok(text.includes('NAMENSENDE'));assert.ok(text.includes('NOTIZENENDE'));
 assert.equal(text.split('Angehörige 14 Alexandra').length-1,1,'relative appears once, fully, beyond the ten form rows');
 assert.equal(text.split('Empfängerin: Erika Beispiel').length-1,1,'gift details are not duplicated');
 assert.equal(text.split('987.654.321,98 EUR').length-1,1,'individual amount remains attached to its item');
 for(const lines of drawings){
  assert.ok(lines.some(l=>l.text.startsWith('Anlage ')&&l.y===28));
  for(const [i,l] of lines.entries()){
   assert.ok(l.x>=39.99&&l.x+l.width<=555.01,'text stays within the page width');
   if(l.y!==28)assert.ok(l.y>=54&&l.y<=794,'body stays clear of footer and page edge');
   if(l.size===10)assert.ok(lines.slice(i+1).some(n=>n.size===9&&n.y>=54),'section heading has body content on the same page');
  }
 }
 assert.ok(text.includes('(Fortsetzung)'));
});
test('VVZ: gewählte, aber nicht ladbare Unterschrift blockiert den unvollständigen Export',async()=>{
 const f=fixture();f.ctx.getDocumentOptions=()=>({ownSignature:true,signatureId:'missing'});
 await assert.rejects(f.create(),/gewählte Unterschrift/);
});
test('VVZ: Kategoriezuordnung unterscheidet Sparkonto und Bausparen vor allgemeinen Konten',()=>{
 const {html}=require('./helpers/asset-inventory.cjs'),vm=require('node:vm'),ctx={v159Norm:v=>v.toLowerCase()};vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('function v159AssetCategory('),html.indexOf('\nconst V159_ASSET_CATEGORIES=')),ctx);
 assert.equal(ctx.v159AssetCategory('Sparkonto'),'Sparguthaben');assert.equal(ctx.v159AssetCategory('Bausparvertrag'),'Bausparvertrag / Lebensversicherung');assert.equal(ctx.v159AssetCategory('Girokonto'),'Girokonto');
});
