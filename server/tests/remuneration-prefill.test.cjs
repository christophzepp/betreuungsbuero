'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const R=require('../src/shared/remuneration-prefill');
test('Standalone HTML and server use exactly the same prefill rules',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
 const embedded=html.match(/<script id="remuneration-prefill-rules">([\s\S]*?)<\/script>/)[1];
 assert.equal(embedded.trim(),fs.readFileSync(path.resolve(__dirname,'../src/shared/remuneration-prefill.js'),'utf8').trim());
});
test('Qualification: old grades, current stages, recognizable degrees and explicit precedence',()=>{
 for(const [einstufung,expected] of [['A','1'],['B','1'],['C','2'],['1','1'],['2','2']])assert.equal(R.qualification({einstufung,qualification:'unbekannt'}).value,expected);
 for(const qualification of ['Sozialpädagogin (B.A.)','Sozialarbeit M.A.','Diplom-Sozialpädagoge','Bachelor of Laws','Volljuristin'])assert.equal(R.qualification({qualification}).value,'2',qualification);
 assert.equal(R.qualification({qualification:'Verwaltungsfachangestellte'}).value,'1');
 assert.equal(R.qualification({einstufung:'1',qualification:'Bachelor of Laws'}).value,'1');
 for(const qualification of ['', 'Soziale Arbeit','Studium laufend Bachelor','Bachelor ohne Abschluss','Master abgebrochen'])assert.equal(R.qualification({qualification}).value,'',qualification);
});
test('Assigned guardian only, with unique legacy-name compatibility',()=>{
 const persons=[{id:'guardian',firstName:'Bea',lastName:'Beispiel'},{id:'user',firstName:'Ina',lastName:'Login'}];
 const entries={guardian:{einstufung:'C'},user:{einstufung:'A'}};
 assert.equal(R.guardianStage('guardian',persons,entries).value,'2');
 assert.equal(R.guardianStage('',persons,entries).value,'');
 assert.equal(R.guardianStage('missing',persons,entries).value,'');
 assert.equal(R.guardianStage('bea beispiel',persons,entries).value,'2');
 assert.equal(R.guardianStage('guardian',persons,{'bea beispiel':{einstufung:'B'}}).value,'1');
 assert.equal(R.guardianStage('  Bea  Beispiel ',[],{'bea beispiel':{einstufung:'C'}}).value,'2');
 persons.push({id:'duplicate',firstName:'Bea',lastName:'Beispiel'});
 assert.equal(R.guardianStage('bea beispiel',persons,{'bea beispiel':{einstufung:'C'}}).value,'');
 assert.equal(R.guardianStage('guardian',persons,{'bea beispiel':{einstufung:'C'}}).value,'');
 assert.equal(R.guardianStage('guardian',persons,entries).value,'2');
});
test('Housing: actual residence precedes old masterdata; ambiguous institutions stay unclassified',()=>{
 const h=type=>R.housing({accommodation:{type:'Pflegeheim',currentResidence:{type}}});
 for(const type of ['eigene Häuslichkeit','Eigenheim','Ambulant betreute Wohnform','Betreutes Wohnen','Wohngemeinschaft','Mietwohnung','nichtstationäre Betreuung'])assert.equal(h(type).value,'A',type);
 for(const type of ['Pflegeheim','Vollstationäre Pflegeeinrichtung','Altenheim'])assert.equal(h(type).value,'S',type);
 for(const type of ['Krankenhaus','Besondere Wohnform / Eingliederungshilfe','Heim/Einrichtung','Kurzzeitpflegeeinrichtung','Reha- oder Therapieeinrichtung'])assert.equal(h(type).value,'',type);
 assert.equal(R.housing({accommodation:{type:'Eigenheim'}}).value,'A');
 assert.equal(R.housing({}).value,'');
});
test('Assets: source priority, threshold, incomplete data, genuine zero, no blanket debt deduction',()=>{
 const a=(begin,end=[],debtsEnd=[])=>R.assets({assets:{begin:begin.map(amount=>({amount})),end:end.map(amount=>({amount})),debtsEnd:debtsEnd.map(amount=>({amount}))}});
 assert.equal(a([]).value,'');assert.equal(a(['']).value,'');assert.equal(a(['unbekannt']).value,'');
 assert.equal(a([0]).value,'M');assert.equal(a(['10.000,00']).value,'M');assert.equal(a(['10.000,01']).value,'NM');
 assert.equal(a([20000],[5000]).value,'M');assert.match(a([20000],[5000]).detail,/Abschlussvermögen/);
 assert.equal(a([5000],['']).value,'');assert.equal(a([20000],[],[30000]).value,'NM');
 assert.equal(a([15000,-9000]).value,'NM');assert.equal(a([9999.99,0.02]).value,'NM');
 assert.equal(a([20000]).kind,'proposal');assert.match(a([20000]).detail,/Schutzvermögen/);
});
test('Auto values follow changes; existing, imported and deliberately cleared manual values survive',()=>{
 const cd={care:{remStage:'1'},assets:{begin:[{amount:5000}]},accommodation:{type:'Pflegeheim'}};
 const source=()=>({remStage:{value:'2',ready:true,context:'guardian'},assetStatus:R.assets(cd),housingCategory:R.housing(cd)});
 R.apply(cd,source());assert.equal(cd.care.remStage,'1');assert.equal(cd.care.assetStatus,'M');assert.equal(cd.care.housingCategory,'S');
 cd.assets.begin[0].amount=15000;cd.accommodation.type='Eigenheim';R.apply(cd,source());assert.equal(cd.care.assetStatus,'NM');assert.equal(cd.care.housingCategory,'A');
 cd.care.housingCategory='S';R.apply(cd,source());assert.equal(cd.care._remunerationPrefill.housingCategory.mode,'manual');
 cd.care._remunerationPrefill.assetStatus={mode:'manual'};cd.care.assetStatus='';R.apply(cd,source());assert.equal(cd.care.assetStatus,'');
 delete cd.care._remunerationPrefill.remStage;cd.care.remStage='';R.apply(cd,source());assert.equal(cd.care.remStage,'2');
 const pending={...source(),remStage:{ready:false,context:'guardian'}};R.apply(cd,pending);assert.equal(cd.care.remStage,'2','transient outage preserves the current auto stage');
 pending.remStage.context='new-guardian';R.apply(cd,pending);assert.equal(cd.care.remStage,'','reassignment never retains the previous guardian stage');
 assert.equal(cd.care.housingCategory,'S');
 const roundtrip=JSON.parse(JSON.stringify(cd));R.apply(roundtrip,source());assert.equal(roundtrip.care.assetStatus,'');
});
