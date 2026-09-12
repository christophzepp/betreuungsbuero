/* Gemeinsame Validierung der Adressbuch-Erweiterungen im Browser und auf dem Server. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.__abExtrasData=api})(typeof window==='object'?window:globalThis,function(){
'use strict';
const fail=m=>{throw Error(m)},arrayFields=['tags','groups','customFields'];
function labels(value){if(!Array.isArray(value)||value.length>100)fail('Höchstens 100 Schlagwörter oder Gruppen sind möglich.');const seen=new Set();return value.map(v=>{if(typeof v!=='string'||!v.trim()||v.length>100)fail('Bitte kurze, nicht leere Bezeichnungen verwenden.');return v.trim()}).filter(v=>{const key=v.toLocaleLowerCase('de');if(seen.has(key))return false;seen.add(key);return true})}
function customFields(value){if(!Array.isArray(value)||value.length>100)fail('Höchstens 100 Zusatzfelder sind möglich.');const seen=new Set();return value.map(f=>{
 if(!f||typeof f!=='object'||Array.isArray(f)||typeof f.id!=='string'||!f.id||f.id.length>128||seen.has(f.id))fail('Jedes Zusatzfeld benötigt eine eindeutige Kennung.');seen.add(f.id);
 if(typeof f.label!=='string'||!f.label.trim()||f.label.length>100||!['text','number','date','select'].includes(f.type)||typeof f.value!=='string'||f.value.length>2000)fail('Bitte Name, Art und Wert des Zusatzfelds prüfen.');
 const options=f.type==='select'?labels(f.options||[]):[],v=f.value.trim();
 if(v&&f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))fail('Bitte ein gültiges Datum angeben.');
 if(v&&f.type==='number'&&!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(v))fail('Bitte eine gültige Zahl angeben.');
 if(f.type==='select'&&(!options.length||v&&!options.includes(v)))fail('Bitte Auswahlmöglichkeiten und gewählten Wert prüfen.');
 return {id:f.id,label:f.label.trim(),type:f.type,value:v,options};
})}
function imageData(v){if(v==='')return v;if(typeof v!=='string'||v.length>28000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(v))fail('Bitte ein kompaktes PNG- oder JPEG-Kontaktbild verwenden.');const [header,payload]=v.split(',');if(payload.length%4||!(header.includes('png')?payload.startsWith('iVBORw0KGgo'):payload.startsWith('/9j/')))fail('Ungültiges Kontaktbild.');return v}
function clean(c){const out={};for(const k of ['tags','groups'])if(Object.hasOwn(c,k))out[k]=labels(c[k]);if(Object.hasOwn(c,'customFields'))out.customFields=customFields(c.customFields);if(Object.hasOwn(c,'imageData'))out.imageData=imageData(c.imageData);if(Object.hasOwn(c,'imageKind')){if(!['','photo','logo'].includes(c.imageKind))fail('Ungültige Bildart.');out.imageKind=c.imageKind}return out}
function quality(c){const issues=[];const add=(code,label)=>{if(!issues.some(i=>i.code===code))issues.push({code,label})};
 if(![c.institution,c.lastName,c.firstName].some(v=>String(v||'').trim()))add('name','Name oder Institution fehlt');
 const profiles=[c,...(c.people||[])];
 if(!profiles.some(p=>[p.email,p.phone,p.mobile,p.fax,p.phoneNumber,p.mobileNumber,p.faxNumber,...(p.contactWays||[]).map(w=>w.value)].some(Boolean)))add('channels','Kein Kontaktweg hinterlegt');
 for(const p of profiles){for(const email of [p.email,...(p.contactWays||[]).filter(w=>w.type==='email').map(w=>w.value)].filter(Boolean))if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))add('email','E-Mail-Adresse prüfen');
  for(const tel of [p.phone,p.mobile,p.fax,...(p.contactWays||[]).filter(w=>['phone','mobile','fax'].includes(w.type)).map(w=>w.value)].filter(Boolean))if(String(tel).replace(/\D/g,'').length<3)add('phone','Rufnummer prüfen');
  if(p.preferredChannel&&p.preferredChannel!=='post'&&!p[p.preferredChannel]&&!p[p.preferredChannel+'Number']&&!(p.contactWays||[]).some(w=>w.type===p.preferredChannel))add('preferred','Bevorzugter Kontaktweg fehlt');
 }
 const addresses=[c,...(c.addresses||[])];for(const a of addresses)if([a.street,a.house,a.postbox,a.postal,a.city].some(Boolean)){
  if(!((a.street&&a.house)||a.postbox)||!a.postal||!a.city)add('address','Postanschrift unvollständig');
  if(a.postal&&(!a.country||/^(de|deutschland|germany)$/i.test(a.country))&&!/^\d{5}$/.test(a.postal))add('postal','Deutsche Postleitzahl prüfen');
 }
 if(c.preferredChannel==='post'&&!addresses.some(a=>((a.street&&a.house)||a.postbox)&&a.city&&a.postal))add('address','Postanschrift unvollständig');
 if(c.preferredAddressId&&!(c.addresses||[]).some(a=>a.id===c.preferredAddressId))add('preferredAddress','Bevorzugte Anschrift fehlt');
 return issues;
}
return {arrayFields,labels,customFields,imageData,clean,quality};
});
