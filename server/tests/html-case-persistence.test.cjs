'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),'utf8');
const script=html.split('<script id="online-realtime-sync-script-v1">')[1].split('/* ======================================================================\n   NUTZERCHAT')[0];
const copy=x=>JSON.parse(JSON.stringify(x));
function client(){
 const elements=new Map(),listeners=new Map(),timers=new Map();let tick=0;
 function node(){return {style:{},dataset:{},children:[],setAttribute(){},appendChild(child){this.children.push(child);this.firstChild=this.children[0];this.lastChild=child;if(child.id)elements.set(child.id,child);return child;}}}
 const document={body:node(),createElement:node,getElementById:id=>elements.get(id)||null,querySelectorAll:()=>[],addEventListener:(k,f)=>listeners.set('document:'+k,f)};
 const baseline={person:{firstName:'Test'},healthInfo:{notes:''},livelihood:{income:[],expenses:[]},exportHistory:[],archives:[]};
 const server={a:copy(baseline),b:copy(baseline)},requests=[];
 const c={console,document,Blob,Headers,Request,Response,URL,crypto:require('node:crypto').webcrypto,location:{protocol:'http:',host:'local.invalid'},state:{caseData:copy(baseline),ui:{},archives:[],reports:{}},currentReport:'initial',clone:copy,saveState(){},toast(){},renderCaseReview(){},updateCaseHeader(){},__appMode:'online',__activeServerCaseId:'a',__onlineCaseCache:new Map([['a',{data:{stammdaten:copy(baseline)}}]]),__wieOnline:()=>true,__accBaselineJson:null,
  setTimeout:(f,ms)=>{const id=++tick;timers.set(id,{f,ms});return id},clearTimeout:id=>timers.delete(id),setInterval:()=>0,
  addEventListener:(k,f)=>listeners.set(k,f),WebSocket:class {static OPEN=1;static CONNECTING=0;readyState=0;addEventListener(){}},
  fetch:async(url,opt={})=>{const id=/cases\/([^/]+)/.exec(url)?.[1];requests.push({url,opt});if(opt.method==='PATCH'){for(const p of JSON.parse(opt.body).patches)server[id][p.path]=copy(p.value);return Response.json({ok:true})}return Response.json({data:server[id]})}
 };
 c.window=c;vm.createContext(c);vm.runInContext(script,c);c.__onlineRealtime.joinCase('a');
 return {c,server,requests,listeners,timers,elements,run:s=>vm.runInContext(s,c)};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
test('Falldaten: Gesundheit und Lebensunterhalt sind erst nach Serverbestätigung gespeichert',async()=>{
 const {c,server,requests}=client(),gate=deferred(),send=c.fetch;c.fetch=async(...args)=>{await gate.promise;return send(...args)};
 c.state.caseData.healthInfo.notes='Neu';c.state.caseData.livelihood.expenses.push({id:'e',monthly:'750'});c.saveState();
 const saving=c.__saveCaseNow();assert.equal(c.__onlineRealtime.saveStatus().pending,true);assert.equal(server.a.healthInfo.notes,'');gate.resolve();await saving;
 assert.equal(server.a.healthInfo.notes,'Neu');assert.equal(server.a.livelihood.expenses[0].monthly,'750');assert.equal(c.__onlineRealtime.saveStatus().pending,false);assert.equal(c.__onlineRealtime.saveStatus().state,'saved');assert.equal(requests.length,1);
});
test('Falldaten: Netzwerk-, Rechte-, Anmelde- und Serverfehler bleiben ungespeichert und wiederholbar',async()=>{
 for(const status of [0,401,403,413,500,503,200]){const {c,server,timers}=client(),send=c.fetch;c.state.caseData.healthInfo.notes='Entwurf';c.fetch=async()=>{if(!status)throw Error('offline');return new Response(status===200?'<html>Login</html>':'{}',{status})};
  await assert.rejects(c.__saveCaseNow());assert.equal(c.__onlineRealtime.saveStatus().state,'error');assert.equal(c.__onlineRealtime.saveStatus().pending,true);assert.equal(c.state.caseData.healthInfo.notes,'Entwurf');assert.equal(server.a.healthInfo.notes,'');
  assert.ok([...timers.values()].some(t=>t.ms===2000),'Automatischer Wiederholungsversuch geplant');c.fetch=send;await c.__saveCaseNow();assert.equal(server.a.healthInfo.notes,'Entwurf');assert.equal(c.__onlineRealtime.saveStatus().pending,false);
 }
});
test('Falldaten: überlappende Speicheraufrufe senden alte und neue Eingabe in richtiger Reihenfolge',async()=>{
 const {c,server,requests}=client(),gate=deferred(),send=c.fetch;let active=0,max=0;c.fetch=async(...args)=>{active++;max=Math.max(max,active);if(requests.length===0)await gate.promise;const r=await send(...args);active--;return r};
 c.state.caseData.healthInfo.notes='Alt';const first=c.__saveCaseNow();c.state.caseData.healthInfo.notes='Neu';const second=c.__saveCaseNow();gate.resolve();await Promise.all([first,second]);
 assert.equal(max,1);assert.equal(requests.length,2);assert.equal(server.a.healthInfo.notes,'Neu');assert.equal(c.__onlineRealtime.saveStatus().pending,false);
});
test('Falldaten: späte Antwort eines alten Falls verändert die Basis des neuen Falls nicht',async()=>{
 const {c,server}=client(),gate=deferred(),send=c.fetch;c.fetch=async(...args)=>{await gate.promise;return send(...args)};c.state.caseData.healthInfo.notes='Fall A';const saving=c.__saveCaseNow();
 c.state={caseData:copy(server.b),ui:{},archives:[],reports:{}};c.__activeServerCaseId='b';c.__onlineRealtime.joinCase('b');c.state.caseData.healthInfo.notes='Fall B';gate.resolve();await assert.rejects(saving,/gewechselt/);await c.__saveCaseNow();assert.equal(server.a.healthInfo.notes,'Fall A');assert.equal(server.b.healthInfo.notes,'Fall B');
});
test('Falldaten: Wiederöffnen aus dem Cache erhält neu angelegte Abschnitte',async()=>{
 const {c}=client();c.state.caseData.healthInfo={notes:'Neu ersetzt'};await c.__saveCaseNow();assert.equal(c.__onlineCaseCache.get('a').data.stammdaten.healthInfo.notes,'Neu ersetzt');
});
test('Falldaten: Neuladen warnt bei offenen Änderungen, pagehide verwirft sie nicht',async()=>{
 const {c,listeners,server}=client(),gate=deferred(),send=c.fetch;c.fetch=async(...args)=>{await gate.promise;return send(...args)};c.state.caseData.healthInfo.notes='Vor Neuladen';c.saveState();
 const event={preventDefault(){this.prevented=true}};listeners.get('beforeunload')(event);assert.equal(event.prevented,true);listeners.get('pagehide')({persisted:true});assert.equal(c.__onlineRealtime.zustand().fall,'a');gate.resolve();await c.__saveCaseNow();assert.equal(server.a.healthInfo.notes,'Vor Neuladen');const clean={preventDefault(){this.prevented=true}};listeners.get('beforeunload')(clean);assert.equal(clean.prevented,undefined);
});
test('Falldaten: Background- und Online-Ereignis sichern noch ausstehende Eingaben',async()=>{
 const {c,server,listeners}=client();c.state.caseData.healthInfo.notes='Hintergrund';c.document.visibilityState='hidden';listeners.get('document:visibilitychange')();await c.__saveCaseNow();assert.equal(server.a.healthInfo.notes,'Hintergrund');c.state.caseData.healthInfo.notes='Wieder online';listeners.get('online')();await c.__saveCaseNow();assert.equal(server.a.healthInfo.notes,'Wieder online');
});
test('Falldaten: Fallwechsel-Flush verschluckt Speicherfehler nicht',async()=>{
 const {c}=client();c.state.caseData.healthInfo.notes='Ungespeichert';c.fetch=async()=>new Response('{}',{status:503});await assert.rejects(c.__onlineRealtime.flush(),/503/);assert.equal(c.__onlineRealtime.zustand().fall,'a');
});
test('Falldaten: automatischer Wiederholungsversuch überträgt den letzten Entwurf ohne weiteren Bearbeitungsschritt',async()=>{
 const {c,server,timers,run}=client(),send=c.fetch;c.state.caseData.healthInfo.notes='Verbindung fehlt';c.fetch=async()=>{throw Error('offline')};await assert.rejects(c.__saveCaseNow());
 const retry=[...timers.values()].find(t=>t.ms===2000);c.state.caseData.healthInfo.notes='Letzter Entwurf';c.fetch=send;retry.f();await new Promise(resolve=>setImmediate(resolve));assert.equal(server.a.healthInfo.notes,'Letzter Entwurf');
});
test('Falldaten: keepalive respektiert die Byte-Grenze auch bei mehrbyteigen Zeichen',async()=>{
 const {c,requests}=client();c.state.caseData.healthInfo.notes='🙂'.repeat(17000);await c.__saveCaseNow();assert.equal(requests[0].opt.keepalive,false);c.state.caseData.healthInfo.notes='Klein';await c.__saveCaseNow();assert.equal(requests[1].opt.keepalive,true);
});
test('Lokaler Browser-Speicher: Quotenfehler wird an den aufrufenden Editor weitergegeben',()=>{
 const start=html.indexOf('function saveState(){state.updatedAt='),end=html.indexOf('function loadState()',start),messages=[];
 const c={window:{__appMode:'local'},state:{},stateForBrowserStorage:()=>({}),STORAGE_KEY:'test',localStorage:{setItem(){throw Error('quota')}},console:{warn(){}},toast:m=>messages.push(m),alert(){},updateNavStatus(){}};
 vm.runInNewContext(html.slice(start,end),c);assert.throws(()=>c.saveState(),/quota/);assert.equal(messages.length,1);
});
