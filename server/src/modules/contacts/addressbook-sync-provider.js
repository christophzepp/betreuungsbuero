'use strict';
// Existing connection credentials stay in their existing OAuth/DAV adapters.
const crypto=require('node:crypto'),T=require('../../../frontend/addressbook-contact-tools'),codec=require('../../../frontend/addressbook-vcard');
const graph=require('../../integrations/calendar/microsoft-calendar'),google=require('../../integrations/calendar/google-calendar'),dav=require('../../integrations/calendar/caldav');
const EXTRA='String {86c24e0c-8be8-43b2-a6cb-ab467ee6a7ba} Name AddressbookSync';
const KEY='Betreuungsbuero.AddressbookSync';
const SCALARS=['title','firstName','lastName','institution','street','house','houseLetter','postal','city','country','postbox','email','phone','mobile','fax','preferredAddressId','preferredChannel','phoneHours','absentFrom','absentUntil','absenceNote'];
const ARRAYS=['contactWays','addresses','people'];
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,20),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),json=s=>{try{return JSON.parse(s)}catch(_){return null}};
function profile(c={}){return JSON.parse(JSON.stringify(Object.fromEntries([...SCALARS.map(k=>[k,String(c[k]||'')]),...ARRAYS.map(k=>[k,c[k]||[]])])))}
function allWays(c){const out=[...(c.contactWays||[])];for(const type of Object.keys(T.TYPES))if(c[type]&&!out.some(w=>w.type===type&&w.value===c[type]))out.unshift({id:'main-'+type,type,label:T.TYPES[type],value:c[type],preferred:true});return out}
function native(c,provider,raw={}){
 const street=[c.street,[c.house,c.houseLetter].filter(Boolean).join('')].filter(Boolean).join(' '),ways=allWays(c),emails=ways.filter(w=>w.type==='email');
 if(provider==='microsoft')return {givenName:c.firstName,surname:c.lastName,title:c.title,companyName:c.institution,businessAddress:{...(raw.businessAddress||{}),street,city:c.city,postalCode:c.postal,countryOrRegion:c.country},emailAddresses:emails.slice(0,3).map(w=>({address:w.value,name:w.label})),businessPhones:[c.phone].filter(Boolean),mobilePhone:c.mobile||null};
 return {names:[{...(raw.names?.[0]||{}),givenName:c.firstName,familyName:c.lastName,honorificPrefix:c.title}],organizations:[{...(raw.organizations?.[0]||{}),name:c.institution},...(raw.organizations||[]).slice(1)],addresses:[{...(raw.addresses?.[0]||{}),streetAddress:street,city:c.city,postalCode:c.postal,country:c.country},...(raw.addresses||[]).slice(1)],emailAddresses:emails.map(w=>({value:w.value,type:w.label})),phoneNumbers:ways.filter(w=>T.PHONE_TYPES.includes(w.type)).map(w=>({value:w.value,type:w.type==='mobile'?'mobile':w.type==='fax'?'workFax':'main',formattedType:w.label}))};
}
function decodeNative(raw,provider){
 const c={},ways=[];function add(type,value,label,preferred=false){if(!value)return;const id='remote-'+hash(type+'|'+value);if(ways.some(w=>w.id===id))return;ways.push({id,type,value,label:label||T.TYPES[type],preferred:preferred&&!ways.some(w=>w.type===type&&w.preferred)});if(!c[type]||preferred)c[type]=value}
 if(provider==='microsoft'){
  Object.assign(c,{firstName:raw.givenName||'',lastName:raw.surname||'',title:raw.title||'',institution:raw.companyName||''});const a=raw.businessAddress||{};Object.assign(c,{street:a.street||'',city:a.city||'',postal:a.postalCode||'',country:a.countryOrRegion||''});
  for(const [i,e] of (raw.emailAddresses||[]).entries())add('email',e.address,e.name,i===0);for(const [i,v] of (raw.businessPhones||[]).entries())add('phone',v,'Telefon Büro',i===0);for(const v of raw.homePhones||[])add('phone',v,'Telefon privat');add('mobile',raw.mobilePhone,'Mobiltelefon',true);
 }else{const n=raw.names?.[0]||{},a=raw.addresses?.[0]||{};Object.assign(c,{firstName:n.givenName||'',lastName:n.familyName||'',title:n.honorificPrefix||'',institution:raw.organizations?.[0]?.name||'',street:a.streetAddress||'',city:a.city||'',postal:a.postalCode||'',country:a.country||''});for(const [i,e] of (raw.emailAddresses||[]).entries())add('email',e.value,e.formattedType||e.type,i===0);for(const w of raw.phoneNumbers||[])add(/fax/i.test(w.type)?'fax':/mobile/i.test(w.type)?'mobile':'phone',w.value,w.formattedType||w.type,!!w.metadata?.primary)}
 c.house='';c.houseLetter='';Object.assign(c,require('./sync').splitContactFields(c));c.contactWays=ways;for(const type of Object.keys(T.TYPES))c[type]=c[type]||'';return c;
}
function davNative(card,addressIds){
 const plain=card.replace(/\r?\n[ \t]/g,'').split(/\r?\n/).filter(l=>!/^X-(BETREUUNGSBUERO-DATA|ADDRESSBOOK-SYNC):/.test(l)).join('\r\n'),parsed=codec.parse(plain)[0]||{},split=require('./sync').splitContactFields;
 if(addressIds){const main=(parsed.addresses||[]).find(a=>addressIds[a.id]==='');for(const k of ['street','house','houseLetter','postal','city','country','postbox'])parsed[k]=main?split(main)[k]||'':'';
  parsed.addresses=(parsed.addresses||[]).filter(a=>addressIds[a.id]!=='').map(a=>({...split(a),id:addressIds[a.id]||a.id}));parsed.preferredAddressId=addressIds[parsed.preferredAddressId]??parsed.preferredAddressId??'';
 }
 return profile(split(parsed));
}
function unpack(extra,current){
 const out=extra?.data?profile(extra.data):profile(current),baseline=extra?.native;
 if(!baseline)return out;
 for(const [key,value] of Object.entries(current))if(key!=='contactWays'&&!same(value,baseline[key])){
  if(['addresses','people'].includes(key)&&Array.isArray(value))out[key]=value.map(row=>{const before=baseline[key]?.find(x=>x.id===row.id),stored=out[key]?.find(x=>x.id===row.id);if(!before||!stored)return row;const next={...stored};for(const [field,v] of Object.entries(row))if(!same(v,before[field]))next[field]=v;return next});else out[key]=value;
 }
 if(!same(current.contactWays,baseline.contactWays)){
  const before=new Set((baseline.contactWays||[]).map(w=>w.type+'|'+w.value));out.contactWays=[...out.contactWays.filter(w=>!before.has(w.type+'|'+w.value)),...current.contactWays];
  const seen=new Set();out.contactWays=out.contactWays.filter(w=>{const key=w.type+'|'+w.value;if(seen.has(key))return false;seen.add(key);return true});for(const type of ['email',...T.PHONE_TYPES]){let found=false;for(const w of out.contactWays.filter(w=>w.type===type)){w.preferred=!found&&w.value===out[type];if(w.preferred)found=true}}
 }
 return out;
}
function record(raw,provider){const extra=json(provider==='microsoft'?(raw.singleValueExtendedProperties||[]).find(x=>x.id===EXTRA)?.value:(raw.userDefined||[]).find(x=>x.key===KEY)?.value);return {uid:String(provider==='microsoft'?raw.id:String(raw.resourceName||'').replace(/^people\//,'')),etag:provider==='microsoft'?raw['@odata.etag']||(raw.changeKey?'W/"'+raw.changeKey+'"':''):raw.metadata?.sources?.find(x=>x.type==='CONTACT')?.etag||'',marker:extra?.bindingId||'',data:unpack(extra,decodeNative(raw,provider)),raw}}
async function response(res){const data=await res.json().catch(()=>({}));if(!res.ok){const e=new Error(([401,403].includes(res.status)?'Zugriff auf Online-Kontakte fehlt. Bitte die bestehende Verbindung prüfen und bei Bedarf erneut anmelden.':data.error?.message)||'Online-Kontakt konnte nicht gelesen oder gespeichert werden.');e.status=res.status===412||data.error?.status==='FAILED_PRECONDITION'?409:res.status;throw e}return data}
function scoped(url,base){const u=new URL(url),b=new URL(base);if(u.origin!==b.origin||u.pathname!==b.pathname)throw Error('Der Anbieter lieferte eine unerwartete Kontakt-Fortsetzung.');return u.href}
async function list(conn,book){
 const refresh=require('./sync').tokenRefreshPersister(conn.id);
 if(['nextcloud','icloud'].includes(conn.provider))return (await dav.fetchVcards(conn,book,true)).map(c=>{
  // Read ordinary fields even when another client preserved an older app extension.
  const unfolded=c.rawVcard.replace(/\r\n[ \t]/g,''),extraLine=unfolded.split(/\r?\n/).find(l=>l.startsWith('X-ADDRESSBOOK-SYNC:')),extra=extraLine?json(extraLine.slice(19).replace(/\\n/g,'\n').replace(/\\([,;\\])/g,'$1')):null;
  const current=davNative(unfolded,extra?.addressIds);return {uid:c.uid,href:c.href,etag:c.etag,marker:extra?.bindingId||'',data:unpack(extra,current),rawVcard:c.rawVcard};
 });
 const provider=conn.provider,adapter=provider==='microsoft'?graph:google,base=provider==='microsoft'?'https://graph.microsoft.com/v1.0/me/'+(book?'contactFolders/'+encodeURIComponent(book)+'/contacts':'contacts'):'https://people.googleapis.com/v1/people/me/connections';
 let url=provider==='microsoft'?base+'?$top=100&$expand='+encodeURIComponent("singleValueExtendedProperties($filter=id eq '"+EXTRA+"')"):base+'?personFields=names,emailAddresses,phoneNumbers,addresses,organizations,metadata,userDefined&sources=READ_SOURCE_TYPE_CONTACT&pageSize=200';const out=[],seen=new Set();
 while(url){if(seen.has(url))throw Error('Wiederholte Kontaktseite des Anbieters.');seen.add(url);const data=await response(await adapter.contactRequest(conn,scoped(url,base),{signal:AbortSignal.timeout(30000)},refresh));for(const raw of data.value||data.connections||[])out.push(record(raw,provider));url=provider==='microsoft'?data['@odata.nextLink']||'':data.nextPageToken?base+'?personFields=names,emailAddresses,phoneNumbers,addresses,organizations,metadata,userDefined&sources=READ_SOURCE_TYPE_CONTACT&pageSize=200&pageToken='+encodeURIComponent(data.nextPageToken):'';}
 return out;
}
async function save(conn,book,binding,data,remote){
 const refresh=require('./sync').tokenRefreshPersister(conn.id);
 if(['nextcloud','icloud'].includes(conn.provider)){
  const uid=remote?.uid||binding.id,base=new URL(book.endsWith('/')?book:book+'/'),href=new URL(remote?.href||encodeURIComponent(uid)+'.vcf',base);if(href.origin!==base.origin||!href.pathname.startsWith(base.pathname))throw Error('Der CardDAV-Kontakt liegt außerhalb des gewählten Adressbuchs.');if(remote&&!remote.etag)throw Error('Der Online-Kontakt hat keine Versionskennung. Bitte den Anbieter prüfen.');
  const vcard=codec.stringify({...data,id:uid});
  // Native baseline comes from the exact standard representation, with folded extension removed.
  const ids=[...([data.street,data.postbox,data.city,data.postal].some(Boolean)?['']:[]),...(data.addresses||[]).map(a=>a.id)],addressIds=Object.fromEntries(ids.map((id,i)=>['address-item'+(i+1),id]));const extra={bindingId:binding.id,data:profile(data),addressIds,native:davNative(vcard,addressIds)};
  const line=codec.fold('X-ADDRESSBOOK-SYNC:'+JSON.stringify(extra).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,'));const retained=(remote?.rawVcard||'').replace(/\r?\n[ \t]/g,'').split(/\r?\n/).filter(l=>{const key=l.split(':')[0].split(';')[0].split('.').at(-1).toUpperCase();return key&&!['BEGIN','END','VERSION','UID','FN','N','ORG','ADR','LABEL','EMAIL','TEL','URL','X-BB-CONTACTWAY','AGENT','X-ABLABEL','X-BETREUUNGSBUERO-DATA','X-ADDRESSBOOK-SYNC'].includes(key)});const end=vcard.lastIndexOf('END:VCARD');const body=vcard.slice(0,end)+retained.map(l=>codec.fold(l)).join('\r\n')+'\r\n'+line+'\r\nEND:VCARD\r\n';
  const res=await dav.contactRequest(href.href,{method:'PUT',headers:{Authorization:dav.contactAuth(conn),'Content-Type':'text/vcard; charset=utf-8',...(remote?{'If-Match':remote.etag}:{'If-None-Match':'*'})},body});if(!res.ok){const e=new Error('CardDAV konnte den Kontakt nicht speichern (Status '+res.status+').');e.status=res.status===412?409:res.status;throw e}return {uid,href:href.href};
 }
 const provider=conn.provider,adapter=provider==='microsoft'?graph:google,raw=remote?.raw||{},payload=native(data,provider,raw),extra={bindingId:binding.id,data:profile(data),native:decodeNative(payload,provider)};
 const serialized=JSON.stringify(extra);if(serialized.length>30000)throw Error('Die Kontaktdaten überschreiten die Größe der Zusatzfelder dieses Online-Anbieters.');
 let url;if(provider==='microsoft'){
  payload.singleValueExtendedProperties=[{id:EXTRA,value:serialized}];url='https://graph.microsoft.com/v1.0/me/'+(book?'contactFolders/'+encodeURIComponent(book)+'/contacts':'contacts')+(remote?'/'+encodeURIComponent(remote.uid):'');if(remote&&!remote.etag)throw Error('Microsoft lieferte keine Versionskennung. Bitte erneut laden.');
 }else{
  payload.userDefined=[...(raw.userDefined||[]).filter(x=>x.key!==KEY),{key:KEY,value:serialized}];if(remote){if(!remote.etag)throw Error('Google lieferte keine Versionskennung. Bitte erneut laden.');payload.resourceName=raw.resourceName;payload.metadata={sources:raw.metadata.sources};payload.etag=raw.etag;url='https://people.googleapis.com/v1/people/'+encodeURIComponent(remote.uid)+':updateContact?updatePersonFields=names,organizations,addresses,emailAddresses,phoneNumbers,userDefined&personFields=names,organizations,addresses,emailAddresses,phoneNumbers,metadata,userDefined'}else url='https://people.googleapis.com/v1/people:createContact';
 }
 const r=await response(await adapter.contactRequest(conn,url,{method:remote?'PATCH':'POST',headers:{'Content-Type':'application/json',...(provider==='microsoft'&&remote?{'If-Match':remote.etag}:{})},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)},refresh));return {uid:provider==='microsoft'?String(r.id):String(r.resourceName||'').replace(/^people\//,''),href:''};
}
module.exports={list,save,profile,record,native,decodeNative,unpack,EXTRA,KEY};
