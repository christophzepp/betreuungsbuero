/* vCard 3.0 (RFC 2426): standard properties plus a versioned, lossless application extension. */
(function(root,factory){const codec=factory();if(typeof module==='object'&&module.exports)module.exports=codec;else root.__abVcardCodec=codec})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const T=typeof module==='object'&&module.exports?require('./addressbook-contact-tools'):globalThis.__abContactTools;
 const D=typeof module==='object'&&module.exports?require('./addressbook-extras-data'):globalThis.__abExtrasData;
 const scalar=['country','salutation','title','firstName','lastName','institution','role','street','house','houseLetter','postal','city','postbox','phone','phoneArea','phoneNumber','mobile','mobileArea','mobileNumber','fax','faxArea','faxNumber','email','status','fileNumber','processNumber','customerNumber','iban','bic','bankName','note','_category','preferredAddressId','preferredChannel','phoneHours','absentFrom','absentUntil','absenceNote','substituteContactId','centralContactId'];
 const addressFields=['id','label','street','house','houseLetter','postal','city','postbox','country'];
 const personFields=['id','name','department','role','email','phone','fax','salutation','preferredChannel','phoneHours','absentFrom','absentUntil','absenceNote','substitutePersonId'];
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v),fail=m=>{throw Error('vCard: '+m)};
 const esc=v=>String(v??'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
 const unesc=v=>String(v||'').replace(/\\([nN\\,;:])/g,(_,c)=>/[nN]/.test(c)?'\n':c);
 function split(value,separator=';',parameters=false){const parts=[''];let escaped=false,quoted=false;for(const c of value){if(c===separator&&!escaped&&!quoted)parts.push('');else parts[parts.length-1]+=c;if(parameters&&c==='"'&&!escaped)quoted=!quoted;escaped=c==='\\'&&!escaped}return parts}
 function texts(source,fields,max=2000){if(!object(source))fail('Ungültige Zusatzdaten.');const out={};for(const key of fields)if(Object.hasOwn(source,key)){if(typeof source[key]!=='string'||source[key].length>(key==='note'?20000:max))fail('Ungültiges Feld '+key+'.');out[key]=source[key]}return out}
 function dates(v){if(v.preferredChannel&&!['email','phone','mobile','fax','post','website','portal','messenger','other'].includes(v.preferredChannel))fail('Ungültiger Kontaktweg.');for(const key of ['absentFrom','absentUntil'])if(v[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(v[key])||!Number.isFinite(Date.parse(v[key]))||new Date(v[key]).toISOString().slice(0,10)!==v[key]))fail('Ungültiges Abwesenheitsdatum.');if(v.absentFrom&&v.absentUntil&&v.absentFrom>v.absentUntil)fail('Abwesenheitsende liegt vor dem Beginn.')}
 function clean(source){
  const out={...texts(source,scalar),...D.clean(source)};dates(out);if(Object.hasOwn(source,'contactWays'))out.contactWays=T.ways(source.contactWays);
  for(const [key,fields,max,required] of [['addresses',addressFields,30,'label'],['people',personFields,100,'name']])if(Object.hasOwn(source,key)){
   if(!Array.isArray(source[key])||source[key].length>max)fail('Zu viele oder ungültige '+key+'.');const ids=new Set();
   out[key]=source[key].map(v=>{const row=texts(v,fields,1000);if(!row.id||row.id.length>128||ids.has(row.id)||!row[required]?.trim())fail('Fehlende oder doppelte Kennung in '+key+'.');ids.add(row.id);dates(row);if(key==='people'&&Object.hasOwn(v,'contactWays'))row.contactWays=T.ways(v.contactWays);return row});
  }
  if(out.preferredAddressId&&!(out.addresses||[]).some(a=>a.id===out.preferredAddressId))fail('Bevorzugte Anschrift fehlt.');
  for(const p of out.people||[])if(p.substitutePersonId&&(p.substitutePersonId===p.id||!out.people.some(x=>x.id===p.substitutePersonId)))fail('Vertretung beim Ansprechpartner fehlt.');
  if(Object.hasOwn(source,'_standardRecipients')){if(!object(source._standardRecipients))fail('Ungültige Standardempfänger.');out._standardRecipients={};for(const [purpose,id] of Object.entries(source._standardRecipients)){if(!/^(document|mail|role:(court|doctor|insurance)|report:[a-zA-Z0-9_.-]{1,150})$/.test(purpose)||typeof id!=='string'||(id&&!(out.people||[]).some(p=>p.id===id)))fail('Ungültiger Standardempfänger.');out._standardRecipients[purpose]=id}}
  return out;
 }
 // Fold at 75 UTF-8 octets, including the continuation space; never split a code point.
 function fold(line){let result='',width=0;for(const c of line){const point=c.codePointAt(0),n=point<128?1:point<2048?2:point<65536?3:4;if(width+n>75){result+='\r\n ';width=1}result+=c;width+=n}return result}
 const street=a=>[a.street,[a.house,a.houseLetter].filter(Boolean).join('')].filter(Boolean).join(' ');
 function stringify(source){
  const c=clean(source),name=[c.institution,[c.title,c.firstName,c.lastName].filter(Boolean).join(' ')].filter(Boolean).join(' – ')||c.role||'Kontakt';
  const lines=['BEGIN:VCARD','VERSION:3.0','FN:'+esc(name),'N:'+esc(c.lastName)+';'+esc(c.firstName)+';;'+esc(c.title)+';'];
  if(source.id)lines.push('UID:'+esc(source.id));
  if(c.institution)lines.push('ORG:'+esc(c.institution));if(c.role)lines.push('TITLE:'+esc(c.role));
  const pref=channel=>c.preferredChannel===channel?',PREF':'';
  function channels(profile,target,prefix){
   const used=new Set();for(const [i,w] of (profile.contactWays||[]).entries()){const group=prefix+(i+1)+'.';if(!['email','phone','mobile','fax'].includes(w.type)){target.push(group+(['website','portal'].includes(w.type)?'URL':'X-BB-CONTACTWAY')+';X-ABKIND='+w.type+(w.preferred?';TYPE=PREF':'')+':'+esc(w.value),group+'X-ABLABEL:'+esc(w.label));continue}const type=w.type==='email'?'INTERNET':w.type==='mobile'?'CELL':w.type==='fax'?'FAX':'WORK,VOICE';target.push(group+(w.type==='email'?'EMAIL':'TEL')+';TYPE='+type+(w.preferred?',PREF':'')+':'+esc(w.value));target.push(group+'X-ABLABEL:'+esc(w.label));used.add(w.type+'|'+w.value)}
   for(const [field,type] of [['email','INTERNET'],['phone','WORK,VOICE'],['mobile','CELL'],['fax','FAX']]){const value=profile[field]||[profile[field+'Area'],profile[field+'Number']].filter(Boolean).join('/');if(value&&!used.has(field+'|'+value))target.push((field==='email'?'EMAIL':'TEL')+';TYPE='+type+(profile.preferredChannel===field?',PREF':'')+':'+esc(value))}
  }
  channels(c,lines,'contactway');
  if(c.tags?.length)lines.push('CATEGORIES:'+c.tags.map(esc).join(','));
  if(c.imageData){const [mime,data]=c.imageData.split(',');lines.push((c.imageKind==='logo'?'LOGO':'PHOTO')+';ENCODING=b;TYPE='+(mime.includes('png')?'PNG':'JPEG')+':'+data)}
  const addresses=[...([c.street,c.postbox,c.city,c.postal].some(Boolean)?[{...c,label:'Hauptanschrift',id:''}]:[]),...(c.addresses||[])];
  addresses.forEach((a,i)=>{const group='item'+(i+1)+'.',preferred=c.preferredAddressId?c.preferredAddressId===a.id:!a.id;lines.push(group+'ADR;TYPE=WORK'+(preferred?',PREF':'')+':'+[a.postbox,'',street(a),a.city,'',a.postal,a.country].map(esc).join(';'));lines.push(group+'X-ABLABEL:'+esc(a.label||'Anschrift'));lines.push(group+'LABEL;TYPE=WORK:'+esc([a.label,a.postbox?'Postfach '+a.postbox:street(a),[a.postal,a.city].filter(Boolean).join(' '),a.country].filter(Boolean).join('\n')))});
  for(const p of c.people||[]){const agent=['BEGIN:VCARD','VERSION:3.0','UID:'+esc(p.id),'FN:'+esc(p.name),'N:'+esc(p.name)+';;;;'];if(c.institution||p.department)agent.push('ORG:'+esc(c.institution)+';'+esc(p.department));if(p.role)agent.push('TITLE:'+esc(p.role));channels(p,agent,'personway');agent.push('END:VCARD');lines.push('AGENT:'+esc(agent.join('\n')))}
  const notes=[c.note,c.fileNumber&&'Az.: '+c.fileNumber,c.processNumber&&'Vorgangsnummer: '+c.processNumber,c.customerNumber&&'Kundennummer: '+c.customerNumber,c.status&&'Status: '+c.status].filter(Boolean);if(notes.length)lines.push('NOTE:'+esc(notes.join(' | ')));
  lines.push('X-BETREUUNGSBUERO-DATA:'+esc(JSON.stringify({version:1,sourceId:String(source.id||''),contact:c})),'END:VCARD');
  return lines.map(fold).join('\r\n');
 }
 function property(line){let colon=-1,quoted=false,escaped=false;for(let i=0;i<line.length;i++){const c=line[i];if(c===':'&&!quoted&&!escaped){colon=i;break}if(c==='"'&&!escaped)quoted=!quoted;escaped=c==='\\'&&!escaped}if(colon<0)return null;const [head,...params]=split(line.slice(0,colon),';',true),dot=head.lastIndexOf('.');return {name:head.slice(dot+1).toUpperCase(),group:dot<0?'':head.slice(0,dot).toLowerCase(),params:params.join(';'),value:line.slice(colon+1)}}
 function parse(text,depth=0){
  if(depth>1)fail('Verschachtelte Ansprechpartner werden nicht unterstützt.');if(typeof text!=='string'||text.length>16*1024*1024)fail('Die Datei ist zu groß.');
  const lines=text.replace(/^\uFEFF/,'').replace(/\r\n|\r/g,'\n').replace(/\n[ \t]/g,'').split('\n'),cards=[];let current=null;
  for(const line of lines){if(/^BEGIN:VCARD$/i.test(line.trim())){if(current)fail('Unvollständiger Kontakt.');current=[]}else if(/^END:VCARD$/i.test(line.trim())){if(!current)fail('Ungültiges Kontaktende.');cards.push(current);current=null;if(cards.length>5000)fail('Zu viele Kontakte.')}else if(current&&line)current.push(property(line));else if(line.trim())fail('Ungültiger Inhalt außerhalb eines Kontakts.')}
  if(current)fail('Unvollständiger Kontakt.');
  return cards.map(props=>{
   props=props.filter(Boolean);const extension=props.filter(p=>p.name==='X-BETREUUNGSBUERO-DATA');
   if(extension.length){if(extension.length!==1)fail('Doppelte Zusatzdaten.');let data;try{data=JSON.parse(unesc(extension[0].value))}catch(_){fail('Zusatzdaten sind beschädigt.')}if(!object(data)||data.version!==1)fail('Unbekannte Version der Zusatzdaten.');const c=clean(data.contact);if(typeof data.sourceId!=='string'||data.sourceId.length>128)fail('Ungültige Herkunftskennung.');if(data.sourceId)c._vcardSourceId=data.sourceId;return c}
   const c={},addresses=[],people=[],contactWays=[],rank={};let fn='',preferredChannel='';
   for(const p of props){const value=unesc(p.value),params=p.params.toUpperCase().replace(/"/g,''),preferred=/(?:^|[=;,])PREF(?:[;,]|$)|(?:^|;)PREF=1(?:;|$)/.test(params),put=(field,v)=>{if(c[field]==null||preferred&&!rank[field]){c[field]=v;rank[field]=preferred}};
    if(['TEL','EMAIL'].includes(p.name)){const type=p.name==='EMAIL'?'email':/FAX/.test(params)?'fax':/CELL|MOBILE/.test(params)?'mobile':'phone',label=props.find(x=>x.group===p.group&&x.name==='X-ABLABEL');contactWays.push({id:'way-'+contactWays.length,type,label:label?unesc(label.value):T.TYPES[type],value:value.replace(/^(mailto|tel):/i,''),preferred:preferred&&!contactWays.some(w=>w.type===type&&w.preferred)})}
    if(p.name==='URL'||p.name==='X-BB-CONTACTWAY'){const kind=/X-ABKIND=([a-z]+)/i.exec(p.params)?.[1]?.toLowerCase(),type=kind&&Object.hasOwn(T.TYPES,kind)?kind:p.name==='URL'?'website':'other',label=props.find(x=>x.group===p.group&&x.name==='X-ABLABEL');contactWays.push({id:'way-'+contactWays.length,type,label:label?unesc(label.value):T.TYPES[type],value,preferred:preferred&&!contactWays.some(w=>w.type===type&&w.preferred)})}
    if(p.name==='CATEGORIES')c.tags=split(p.value,',').map(unesc).filter(Boolean);
    if(['PHOTO','LOGO'].includes(p.name)&&/ENCODING=(B|BASE64)(;|$)/.test(params)&&/TYPE=(PNG|JPEG)(;|$)/.test(params)){c.imageData='data:image/'+(/TYPE=PNG/.test(params)?'png':'jpeg')+';base64,'+value;c.imageKind=p.name==='LOGO'?'logo':'photo'}
    if(p.name==='FN')fn=value;
    else if(p.name==='N'){const n=split(p.value).map(unesc);c.lastName=n[0]||'';c.firstName=n[1]||'';c.title=n[3]||''}
    else if(p.name==='ORG')c.institution=unesc(split(p.value)[0]);
    else if(p.name==='TITLE'||p.name==='ROLE'){if(!c.role)c.role=value}
    else if(p.name==='EMAIL'){put('email',value.replace(/^mailto:/i,''));if(preferred)preferredChannel='email'}
    else if(p.name==='TEL'){const field=/FAX/.test(params)?'fax':/CELL|MOBILE/.test(params)?'mobile':'phone';put(field,value.replace(/^tel:/i,''));if(preferred)preferredChannel=field}
    else if(p.name==='ADR'){const a=split(p.value).map(unesc),label=props.find(x=>x.group===p.group&&x.name==='X-ABLABEL');addresses.push({id:'address-'+(p.group?p.group.replace(/[^a-z0-9_-]/gi,'-').slice(0,100):addresses.length),label:label?unesc(label.value):/HOME/.test(params)?'Privatanschrift':/WORK/.test(params)?'Geschäftsanschrift':'Anschrift',postbox:a[0]||'',street:a[2]||'',city:a[3]||'',postal:a[5]||'',country:a[6]||'',preferred})}
    else if(p.name==='NOTE'){c.note=value;const az=/Az\.:\s*([^|]+)/.exec(value);if(az)c.fileNumber=az[1].trim();const status=/Status:\s*([^|]+)/.exec(value);if(status)c.status=status[1].trim()}
    else if(p.name==='AGENT'&&!/VALUE\s*=\s*"?(URI|TEXT)/i.test(params)){const agent=parse(value,depth+1)[0];if(agent){const org=value.split(/\r?\n/).map(property).find(x=>x?.name==='ORG');people.push({id:unesc(value.split(/\r?\n/).map(property).find(x=>x?.name==='UID')?.value||'')||'person-'+people.length,name:[agent.title,agent.firstName,agent.lastName].filter(Boolean).join(' ')||agent.institution||'Ansprechpartner',department:org?unesc(split(org.value)[1]||''):'',role:agent.role||'',email:agent.email||'',phone:agent.phone||'',fax:agent.fax||'',...(agent.contactWays?{contactWays:agent.contactWays}:{})})}}
   }
   if(!c.institution&&!c.firstName&&!c.lastName)c.institution=fn;
   if(addresses.length){c.addresses=addresses.map(({preferred,...a})=>a);const chosen=addresses.find(a=>a.preferred)||addresses[0];c.preferredAddressId=chosen.id;for(const key of ['street','city','postal','postbox','country'])c[key]=chosen[key]}
   if(contactWays.length)c.contactWays=contactWays;if(people.length)c.people=people;if(preferredChannel)c.preferredChannel=preferredChannel;
   return clean(c);
  }).filter(c=>c.firstName||c.lastName||c.institution||c.email);
 }
 return {clean,parse,stringify,fold,scalar};
});
