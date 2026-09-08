'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
const invoice=html.split('<script id="invoice-script-v1">')[1].split('</script>')[0];
function source(a,b){const i=invoice.indexOf(a),j=invoice.indexOf(b,i);assert.ok(i>=0&&j>i,a);return invoice.slice(i,j)}
function context(extra={}){const c={window:{},invoiceEntries:[],invoiceCases:[{id:'a',label:'Mara Hoffmann'}],invoiceFilterYear:'alle',IM:{filters:{},segment:'all',query:''},imMobile:()=>true,imOwned:()=>true,Date,Number,Set,...extra};vm.createContext(c);vm.runInContext(source('function invoiceNrmLabel(','window.__invoiceNrmLabel=')+source('function invoiceIso(','function invoiceRowHTML(')+source('function imDue(','function imBadge('),c);return c}
const open=(id,extra={})=>({id,reNummer:'RE-2026-'+id,reDatum:'2026-01-02',summe:100,faelligAm:'2099-01-01',status:'gestellt',...extra});
test('Rechnungen: Suche, Empfänger, Jahr und Fallfilter kombinieren sich; Fallkennung hat Vorrang',()=>{
 const c=context();c.invoiceEntries=[open('one',{empfaenger:'Gericht',caseId:'a',caseLabel:'Mara Hoffmann',verwendungszweck:'Quartal'}),open('same',{empfaenger:'Gericht',caseId:'b',caseLabel:'Mara Hoffmann',verwendungszweck:'Quartal'}),open('legacy',{empfaenger:'Gericht',caseLabel:'Hoffmann, Mara',verwendungszweck:'Quartal'}),open('other',{empfaenger:'Privat',caseId:'a',verwendungszweck:'Quartal'})];
 assert.deepEqual(Array.from(c.imRows(c.invoiceEntries,{recipient:'Gericht',caseId:'a'},'all','QUARTAL','2026'),x=>x.id).sort(),['legacy','one']);assert.equal(c.imRows(c.invoiceEntries,{},'all','','2025').length,0);
});
test('Rechnungen: Segmente und offener Betrag verwenden dieselbe Statuswahrheit einschließlich Teilzahlung und Storno',()=>{
 const c=context();c.invoiceEntries=[open('open'),open('partial',{eingangsbetrag:25}),open('paid',{eingangsbetrag:100}),open('cancel',{status:'storniert'}),open('over',{faelligAm:'2000-01-01'}),open('draft',{status:'entwurf'})];
 assert.deepEqual(Array.from(c.imRows(c.invoiceEntries,{},'paid'),x=>x.id),['paid']);assert.equal(c.imRows(c.invoiceEntries,{},'open').length,4);assert.deepEqual(Array.from(c.imRows(c.invoiceEntries,{due:'overdue'}),x=>x.id),['over']);assert.equal(c.imRows(c.invoiceEntries,{status:'teilbezahlt'})[0].eingangsbetrag,25);assert.equal(c.invoiceOffenerBetrag(c.invoiceEntries[1]),75);
});
test('Rechnungen: Sortierung nach offenem Betrag und Fälligkeit; Exporte benutzen dieselben mobilen Filter',()=>{
 const c=context();c.invoiceEntries=[open('a',{eingangsbetrag:90,faelligAm:'2099-02-01'}),open('b',{summe:50}),open('c',{summe:20})];c.IM.filters={sort:'amount'};
 assert.deepEqual(Array.from(c.invoiceFilteredEntries(),x=>x.id),['b','c','a']);c.IM.query='2026-b';assert.deepEqual(Array.from(c.invoiceFilteredEntries(),x=>x.id),['b']);c.imMobile=()=>false;assert.equal(c.invoiceFilteredEntries().length,3);
});
function persistence(local,fetch){const c=context({fetch,window:{isBueroLocalMode:()=>local,bueroLocal:{invoiceEntries:[{id:'orphan',caseId:'archived',caseLabel:'Ada Archiv',reportId:'remuneration',bewilligtAm:'2026-01-01',summe:800,eingangsbetrag:200}]},newBueroLocalId:()=> 'new',saveBueroLocal:()=>c.saves++},saves:0});vm.runInContext(source('async function imPersist(','async function imMutate('),c);return c}
test('Rechnungen: lokales Bearbeiten erhält ausgelassene Kennungen und konvertiert nur gesendete Beträge',async()=>{
 const c=persistence(true);const row=await c.imPersist('PUT','orphan',{caseLabel:'Ada Archiv',summe:'900.50',eingangsbetrag:'',eingangDatum:'',faelligAm:'',reDatum:'01.09.2026'});assert.equal(row.caseId,'archived');assert.equal(row.reportId,'remuneration');assert.equal(row.bewilligtAm,'2026-01-01');assert.equal(row.summe,900.5);assert.equal(row.eingangsbetrag,null);assert.equal(row.faelligAm,'2026-10-01');assert.equal(c.saves,1);
});
test('Rechnungen: explizit fallfreie Auswahl leert Zuordnung; unbekannte Rechnung wird nicht versehentlich neu angelegt',async()=>{
 const c=persistence(true);const row=await c.imPersist('PUT','orphan',{caseId:'',caseLabel:''});assert.equal(row.caseId,'');assert.equal(row.caseLabel,'');await assert.rejects(c.imPersist('PUT','gone',{summe:12}),/nicht gefunden/);await c.imPersist('DELETE','orphan');assert.equal(c.window.bueroLocal.invoiceEntries.length,0);
});
test('Rechnungen: Netzwerkvertrag maskiert IDs, erhält partielle Payloads und zeigt Serverfehler',async()=>{
 let call;const c=persistence(false,async(url,opt)=>{call={url,opt};return{ok:true,json:async()=>({invoice:{id:'a/b',summe:500}})}});const row=await c.imPersist('PUT','a/b',{status:'bewilligt',bewilligtAm:'2026-09-07'});assert.equal(row.summe,500);assert.equal(call.url,'/api/invoices/a%2Fb');assert.deepEqual(JSON.parse(call.opt.body),{status:'bewilligt',bewilligtAm:'2026-09-07'});c.fetch=async()=>({ok:false,status:403,json:async()=>({error:'Kein Schreibrecht'})});await assert.rejects(c.imPersist('PUT','a',{}),/Kein Schreibrecht/);
});
function loader(fetchInvoices,extra={}){const c={IM:{seq:0,loading:false,form:null,busy:false,screen:'list',root:{},pending:false},invoiceEntries:[],invoiceCases:[],invoicePipelineDaten:null,fetchInvoices,fetchKnownCases:async()=>[],imOwned:()=>true,imMobile:()=>true,imRender(){},imPermission:()=>true,...extra};vm.createContext(c);vm.runInContext(source('async function imRefresh(){','function imOpen(){'),c);return c}
test('Rechnungen: verspätete ältere Aktualisierung überschreibt neueren Bestand nicht',async()=>{
 let release,n=0;const c=loader(async()=>++n===1?new Promise(r=>release=r):[{id:'new'}]);const first=c.imRefresh();await c.imRefresh();release([{id:'old'}]);await first;assert.equal(c.invoiceEntries[0].id,'new');assert.equal(c.IM.loading,false);
});
test('Rechnungen: geparkter Chat oder verlassenes Modul nimmt keine Antwort an und merkt Aktualisierung vor',async()=>{
 let release;const c=loader(()=>new Promise(r=>release=r));const read=c.imRefresh();c.imOwned=()=>false;release([{id:'old'}]);await read;assert.equal(c.invoiceEntries.length,0);assert.equal(c.IM.pending,true);assert.equal(c.IM.loading,false);
});
test('Rechnungen: Büroaktualisierung ersetzt keinen offenen Entwurf; Lesefehler bleibt vom Leerbestand unterscheidbar',async()=>{
 let reads=0;const c=loader(async()=>{reads++;throw new Error('offline')});c.IM.form={};await c.imRefresh();assert.equal(reads,0);assert.equal(c.IM.pending,true);c.IM.form=null;c.invoiceEntries=[{id:'cached'}];await c.imRefresh();assert.equal(c.IM.error,'offline');assert.equal(c.invoiceEntries[0].id,'cached');assert.equal(c.IM.loaded,undefined);
});
test('Rechnungen: strikte Leser unterscheiden Berechtigungs-/Netzfehler, bestehende Dashboard-Leser behalten ihren Vertrag',async()=>{
 const c={window:{},fetch:async()=>({ok:false,status:403}),toast(){}};vm.createContext(c);vm.runInContext(source('async function fetchInvoices(){','// Lokal-Modus-Pendant'),c);assert.equal((await c.fetchInvoices()).length,0);await assert.rejects(c.fetchInvoices(true),/Keine Berechtigung/);c.fetch=async()=>{throw new Error('offline')};await assert.rejects(c.fetchInvoices(true),/offline/);
});
test('Rechnungen: Zahlungsabgleich identifiziert eine Kontobuchung unabhängig von erneutem Rechnungsvorschlag',()=>{
 const c={};vm.createContext(c);vm.runInContext(source('function imProposalKey(','function imProposalReview('),c);assert.equal(c.imProposalKey({buchungId:'booking',invoiceId:'one'}),c.imProposalKey({buchungId:'booking',invoiceId:'two'}));assert.notEqual(c.imProposalKey({buchungId:'other'}),c.imProposalKey({buchungId:'booking'}));
});
test('Rechnungen: PDF-Gesamteingang steht unter Eingangsbetrag statt unter Zahlungsziel',async()=>{
 const draws=[],font={widthOfTextAtSize:s=>s.length*3},page={drawText:(text,opt)=>draws.push({text,...opt}),drawRectangle(){},drawLine(){}};
 const c=context({PDFLib:{PDFDocument:{create:async()=>({embedFont:async()=>font,addPage:()=>page,save:async()=>[]})},StandardFonts:{Helvetica:'regular',HelveticaBold:'bold'},rgb:()=>null},invoiceOfficeCompanyName:()=> 'Testbüro',pdfSafeText:s=>String(s||''),pdfWrap:s=>[s],todayDE:()=> '07.09.2026',invoiceDiff:r=>r.eingangsbetrag-r.summe,fmtEuro2:n=>Number(n).toFixed(2)+' EUR'});
 vm.runInContext(source('async function createInvoicePdf(rows){','window.__invoiceExportPdf='),c);await c.createInvoicePdf([{summe:20,eingangsbetrag:3},{summe:50,eingangsbetrag:11}]);
 const total=draws.find(x=>x.text==='14.00 EUR'),head=draws.find(x=>x.text==='Eingangsbetrag'),next=draws.find(x=>x.text==='Differenz');assert.ok(total.x>head.x&&total.x<next.x,'Gesamteingang muss im Bereich seiner Betragsspalte liegen');
});
