'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
const bank=html.split('<script id="banking-modul-v1">')[1].split('</script>')[0];
function source(a,b){const i=bank.indexOf(a),j=bank.indexOf(b,i);assert.ok(i>=0&&j>i);return bank.slice(i,j)}
function loader(api){const c={S:{caseSel:'a',accounts:[],orders:[],recurring:[],txns:{old:[{id:'old'}]},kontoFilter:'',lade:false},BM:{loadedScope:''},api:(method,url)=>api(url),bmScope:()=>c.S.caseSel,zeichne:()=>c.draws++,draws:0,indikator(){},datumIsoLokal:()=> '2026-03-07',zeitraumVon:()=>new Date(),fallKonten:()=>c.S.accounts.filter(a=>a.caseId===c.S.caseSel).map(a=>({...a,verbunden:true,hx:a})),Promise};vm.createContext(c);vm.runInContext(source('let bankLoadSequence=0;','/* ---------- Ansicht'),c);return c}
function responses(url){if(url==='/api/bank/accounts')return{accounts:[{iban:'a-iban',caseId:'a',name:'Konto A'},{iban:'b-iban',caseId:'b',name:'Konto B'}]};if(url==='/api/bank/orders')return{orders:[]};if(url==='/api/bank/recurring')return{recurring:[]};if(url==='/api/bank/iban-case-map')return{map:{}};if(url==='/api/cases')return{cases:[]};return{transactions:[{id:url.includes('a-iban')?'a-tx':'b-tx'}]}}
test('Banking: verspätete Antwort eines verlassenen Falls überschreibt weder Umsätze noch Kontofilter',async()=>{
 let release,started;const pending=new Promise(r=>started=r);const c=loader(async url=>{if(url.includes('iban=a-iban')){started();await new Promise(r=>release=r)}return responses(url)});
 const first=c.ladeAlles();await pending;c.S.caseSel='b';c.S.kontoFilter='b-iban';await c.ladeAlles();release();await first;
 assert.equal(c.S.txns['b-iban'][0].id,'b-tx');assert.equal(c.S.txns['a-iban'],undefined);assert.equal(c.S.kontoFilter,'b-iban');assert.equal(c.BM.loadedScope,'b');
});
test('Banking: fehlgeschlagener Kontoabruf markiert unvollständige Daten, ohne alte Umsätze als aktuell auszugeben',async()=>{
 const c=loader(async url=>{if(url.includes('transactions?'))throw Error('offline');return responses(url)});await c.ladeAlles();assert.match(c.S.txnErrors['a-iban'],/Konto A: offline/);assert.equal(Object.keys(c.S.txns).length,0);assert.equal(c.S.lade,false);
});
test('Banking: maximale Servergrenze und Kappungszahlen bleiben erhalten',async()=>{
 let request;const c=loader(async url=>{if(url.includes('transactions?')){request=url;return{transactions:[{id:'one'}],gekappt:true,gesamt:2401,geliefert:2000,hinweis:'begrenzt'}}return responses(url)});await c.ladeAlles();assert.match(request,/limit=2000/);assert.equal(c.S.txnGekappt['a-iban'].gesamt,2401);assert.equal(c.S.txnGekappt['a-iban'].geliefert,2000);
});
test('Banking: fehlgeschlagene Kontenübersicht meldet den Fehler und beendet den Ladezustand',async()=>{
 const c=loader(async()=>{throw Error('nicht erreichbar')});await c.ladeAlles();assert.equal(c.S.fehler,'nicht erreichbar');assert.equal(c.S.lade,false);assert.equal(c.BM.loadedScope,'');
});
function filters(){const c={S:{suchtext:'',kontoFilter:'',orders:[],recurring:[],txns:{}},BM:{direction:'all',status:'all',recStatus:'all'},mobile:true,bmVisible:()=>c.mobile,fallIbans:()=>[{iban:'A'},{iban:'B'}],fallKonten:()=>[{iban:'A',caseId:'case-a',caseLabel:'Mara',label:'Girokonto'},{iban:'B',caseId:'case-b',caseLabel:'Jonas',label:'Sparkonto'}],fallLabel:id=>id||'',normIban:v=>String(v).replace(/\s/g,'').toUpperCase()};vm.createContext(c);vm.runInContext(source('function bmMatch(row){','function bmNode(')+source('function sichtTxns(){','function kontoOptionen('),c);return c}
test('Banking: Richtung und Suche bleiben mit Kontofilter kombinierbar und behalten Fallmetadaten',()=>{
 const c=filters();c.S.txns={A:[{id:'in',amount:100,counterparty:'Rente'},{id:'out',amount:-15,counterparty:'Rente Rückzahlung'}],B:[{id:'other',amount:200,counterparty:'Rente'}]};c.S.kontoFilter='A';c.S.suchtext='rente';c.BM.direction='in';const r=c.sichtTxns();assert.equal(r.length,1);assert.equal(r[0].id,'in');assert.equal(r[0]._caseId,'case-a');assert.equal(r[0]._kontoIban,'A');
});
test('Banking: Auftragsfilter gilt auch für den gemeinsamen Export- und Sammeleingang',()=>{
 const c=filters();c.S.orders=[{id:'one',kontoIban:'A',empfaengerName:'Stadtwerke',status:'freigegeben'},{id:'hidden',kontoIban:'A',empfaengerName:'Versicherung',status:'freigegeben'},{id:'draft',kontoIban:'A',empfaengerName:'Stadtwerke',status:'entwurf'},{id:'other',kontoIban:'C',empfaengerName:'Stadtwerke',status:'freigegeben'}];c.BM.status='freigegeben';c.S.suchtext='stadtwerke';assert.deepEqual(Array.from(c.fallOrders(),o=>o.id),['one']);
});
test('Banking: Intervallstatus und Name sind kombinierbar; Desktop übernimmt keine mobilen Statusfilter',()=>{
 const c=filters();c.S.recurring=[{id:'active',kontoIban:'A',empfaengerName:'Beitrag',aktiv:true},{id:'paused',kontoIban:'A',empfaengerName:'Beitrag',aktiv:false}];c.BM.recStatus='paused';c.S.suchtext='beitrag';assert.deepEqual(Array.from(c.fallRecurring(),r=>r.id),['paused']);c.mobile=false;assert.equal(c.fallRecurring().length,2);
});
test('Banking: Büroübersicht verändert weder Fall noch offene Zahlungsformulare',async()=>{
 const state={officeMode:false,caseSel:'case-a',payOpen:true,payVor:{zweck:'Entwurf'},txns:{old:[1]}};const c={window:{},S:state,api:async(method,url)=>url.endsWith('accounts')?{accounts:[{iban:'office',caseId:'',saldo:0},{iban:'case',caseId:'case-a',saldo:100}]}:url.endsWith('orders')?{orders:[{kontoIban:'office',status:'entwurf'},{kontoIban:'case',status:'freigegeben'}]}:{transactions:[{id:'one'}]},normIban:v=>v,datumIsoLokal:()=>'',zeitraumVon:()=>null};vm.createContext(c);vm.runInContext(source('window.__bankOffenZaehlen=async function(){','/* Banking #5'),c);const before=JSON.stringify(state),r=await c.window.__bankOffenZaehlen();assert.equal(JSON.stringify(state),before);assert.equal(r.zurFreigabe,1);assert.equal(r.freigegeben,0);assert.equal(r.saldo,0);assert.equal(r.konten,1);
});
