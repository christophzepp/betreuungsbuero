'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const PDFLib=require('@cantoo/pdf-lib');
const html=fs.readFileSync(path.join(__dirname,'../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
const v159=JSON.parse(html.split('\n').find(l=>l.startsWith('const V159=')).slice(11,-1));
function fixture(overrides={}){
 const data={avi_file_number:'XVII 123/26',avi_person:'Erika Muster',avi_birth:'1950-05-14',avi_date:'2026-09-20',avi_place:'Musterstadt',avi_signed_date:'2026-09-20',asset_inventory_items:[
 {category:'Bargeld',description:'Bargeldbestand',amount:75.20},
 ...Array.from({length:4},(_,i)=>({category:'Girokonto',description:'Konto '+(i+1),institution:'Musterbank '+(i+1),reference:'DE0000000000000000000'+i,amount:1000.25+i,ownerShare:'100 %'})),
 {category:'Sparguthaben',institution:'Beispielbank',reference:'DE00000000000000000009',amount:10000.50},
 ...['Wertpapiere / Fonds','Bausparvertrag / Lebensversicherung','Genossenschaftsanteil','Immobilie / Grundstück','Unternehmen / Beteiligung','Ausstehende Forderung','Hausrat / Wertgegenstand','Fahrzeug / Wertgegenstand','Tiere / Vorräte','Gesamthandsgemeinschaft','Erbrechtlicher Anspruch','Sonstiges Vermögen','Hypothek / Grundschuld','Sonstige Schuld'].map((category,i)=>({category,description:'Prüfposten '+category,reference:'Referenz '+i,ownerShare:'50 %',amount:100+i}))
 ],avi_income:[{type:'Altersrente',provider:'Rentenstelle',amount:1491.17},{type:'Arbeitslohn',provider:'Musterfirma',amount:110.25},{type:'Pflegegeld',amount:350},{type:'Wohngeld',amount:120}],avi_expenses:[{type:'Miete',creditor:'Wohnbau',amount:780},{type:'Heimkosten',amount:200},{type:'Sozialversicherung',amount:85.99},{type:'Hypothek',amount:120},{type:'Haftpflichtversicherung',amount:12.5},{type:'Kreditrate',amount:80},{type:'Lebenshaltung',amount:355}],avi_relatives:[{name:'Eva Muster',relationship:'Tochter',address:'Musterweg 1, 12345 Musterstadt'}],avi_gifts:'Nicht bekannt',avi_notes:'Synthetische Prüfdaten. Keine echten Personen oder Konten.',...overrides};
 const ctx={PDFLib,Uint8Array,Date,console,V159:v159,OFFICIAL_PDF_TEMPLATES:v159.pdfTemplates,
 reportFieldValue:(_,id)=>data[id]??'',isEmpty:v=>v===undefined||v===null||v===''||(Array.isArray(v)&&v.length===0),
 pdfSafeText:v=>String(v??''),v159Norm:v=>String(v??'').toLowerCase(),getDocumentOptions:()=>({ownSignature:false}),docSignatureDataUrl:()=>'',
 embeddedPdfBytes:async id=>Uint8Array.from(Buffer.from(html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)</script>'))[1],'base64'))};ctx.window=ctx;
 const declarations=['const V159_ASSET_CATEGORIES=','function v159AssetTotals('].map(prefix=>html.split('\n').find(l=>l.startsWith(prefix))).join('\n');
 const start=html.indexOf('function v159AssetNumber('),end=html.indexOf('\nconst v159OldCreateOfficialPdf=',start);
 Object.assign(ctx,new Function('scope','with(scope){'+declarations+'\n'+html.slice(start,end)+';return {v159CreateAssetInventoryPdf,v159AssetWrap,v159AssetNumber}}')(ctx));
 return {ctx,data,create:()=>ctx.v159CreateAssetInventoryPdf()};
}
function layoutFixture(){
 const paragraph='Eine ausführliche Beschreibung mit mehreren Angaben zum Bewertungsstichtag, zur Herkunft des Guthabens und zum Anteil der betreuten Person.';
 return fixture({
  avi_person:'Dr. Alexandra Friederike Beispiel-Mustermann von der langen Musterstraße',
  avi_court:'Amtsgericht Musterstadt – Betreuungsgericht, Zweigstelle Musterhausen',
  avi_file_number:'XVII 123456/2026 – Sonderabteilung 42',
  asset_inventory_items:[
   ...Array.from({length:8},(_,i)=>({category:i<4?'Girokonto':'Sparguthaben',description:'Prüfkonto '+(i+1),institution:'Überregionale Musterbank für Sparanlagen und Vermögensverwaltung eG',reference:'DE'+String(i+1).padStart(20,'0'),amount:i===0?987654321.98:i===1?-2345.67:12345.67+i,ownerShare:'50 %'})),
   {category:'Bargeld',description:'Haushaltskasse\nFremdwährung: zum Stichtagskurs umgerechnet',amount:253.19},
   {category:'Immobilie / Grundstück',description:paragraph.repeat(4),amount:1234567.89},
   {category:'Wertpapiere / Fonds',description:'Depotposition mit langer Referenz',reference:'REF'+('1234567890'.repeat(35)),amount:10000.25},
   {category:'Hausrat / Wertgegenstand',description:'Möbel, Haushaltsgegenstände und Bücher aus der früheren Wohnung',amount:1200},
   {category:'Sonstige Schuld',description:paragraph.repeat(12),creditor:'Musterkreditgeber',amount:23456.78}
  ],
  avi_income:Array.from({length:9},(_,i)=>({type:i<4?'Altersrente':'Sonstiges Einkommen',provider:'Versorgungswerk der Musterberufe, Rentenstelle '+(i+1)+' in Beispielstadt',reference:'Rentenreferenz '+(i+1),amount:1234.56+i})),
  avi_expenses:Array.from({length:10},(_,i)=>({type:i<5?'Miete einschließlich Nebenkosten':'Private Haftpflichtversicherung',creditor:'Wohnungsbau- und Versorgungsgesellschaft Musterhausen '+(i+1)+' mbH',amount:345.67+i})),
  avi_relatives:Array.from({length:14},(_,i)=>({name:'Angehörige '+(i+1)+' Alexandra Beispiel-Mustermann',relationship:'Verwandtschaftsverhältnis: Enkeltochter',address:'Sehr lange Musterstraße '+(i+1)+', Haus B, Wohnung 123, 12345 Musterstadt-Beispielhausen'})),
  avi_gifts:'Ja',avi_gift_details:paragraph+'\nEmpfängerin: Erika Beispiel; Anlass: Unterstützung.\nDatum: 01.09.2026; Wert: 250,00 EUR.',
  avi_notes:Array.from({length:10},(_,i)=>'Absatz '+(i+1)+': '+paragraph.repeat(2)).join('\n\n')+'\nENDE-DER-LAYOUTPRÜFUNG'
 }).data;
}
module.exports={fixture,layoutFixture,v159,PDFLib,html};
