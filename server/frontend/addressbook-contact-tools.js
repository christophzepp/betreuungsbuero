/* Gemeinsame Kontaktprüfung für Browser, Server und Austausch. Texte sind Daten, niemals HTML. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.__abContactTools=api})(typeof window==='object'?window:globalThis,function(){
'use strict';
const TYPES={email:'E-Mail',phone:'Telefon',mobile:'Mobiltelefon',fax:'Fax'};
const norm=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,' ').trim();
const phone=v=>String(v||'').replace(/^\+49|^0049/,'0').replace(/\D/g,'');
function ways(value){if(!Array.isArray(value))throw Error('Kontaktwege müssen eine Liste sein.');const ids=new Set(),preferred=new Set();return value.map(w=>{
 if(!w||typeof w!=='object'||Array.isArray(w)||typeof w.id!=='string'||!w.id||w.id.length>128||ids.has(w.id))throw Error('Jeder Kontaktweg benötigt eine eindeutige Kennung.');ids.add(w.id);
 if(!Object.hasOwn(TYPES,w.type)||typeof w.label!=='string'||!w.label.trim()||w.label.length>200||typeof w.value!=='string'||!w.value.trim()||w.value.length>1000||w.preferred!=null&&typeof w.preferred!=='boolean')throw Error('Bitte Art, Bezeichnung und Wert des Kontaktwegs prüfen.');
 const out={id:w.id,type:w.type,label:w.label.trim(),value:w.value.trim(),preferred:!!w.preferred};if(out.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.value))throw Error('Bitte eine gültige E-Mail-Adresse angeben.');if(out.type!=='email'&&phone(out.value).length<3)throw Error('Bitte eine gültige Rufnummer angeben.');
 if(out.preferred){if(preferred.has(out.type))throw Error('Je Kontaktart ist nur ein bevorzugter Kontaktweg möglich.');preferred.add(out.type)}return out;
})}
// Die bevorzugten benannten Wege speisen auch alle bestehenden Empfänger- und Exportfunktionen.
function withWays(next,before={}){const out={...next};if(!Object.hasOwn(next,'contactWays'))return out;out.contactWays=ways(next.contactWays);const sameWays=Array.isArray(before.contactWays)&&JSON.stringify(out.contactWays)===JSON.stringify(ways(before.contactWays));for(const type of Object.keys(TYPES)){
 let chosen=out.contactWays.find(w=>w.type===type&&w.preferred);const old=(before.contactWays||[]).find(w=>w.type===type&&w.preferred);
 if(chosen&&Object.hasOwn(next,type)&&out[type]!==before[type]&&sameWays){if(out[type])chosen.value=out[type];else{out.contactWays=out.contactWays.filter(w=>w.id!==chosen.id);chosen=null}}
 if(chosen)out[type]=chosen.value;else if(old&&out[type]===old.value)out[type]='';
 if(chosen||old&&out[type]!==before[type])if(type!=='email'){out[type+'Area']='';out[type+'Number']=out[type]||''}
}out.contactWays=ways(out.contactWays);return out}
const title=c=>[c.institution,[c.title,c.firstName,c.lastName].filter(Boolean).join(' ')].filter(Boolean).join(' – ')||'Kontakt';
function tokensim(a,b){if(!a||!b)return 0;if(a===b)return 1;const aa=new Set(a.split(' ')),bb=new Set(b.split(' '));return [...aa].filter(x=>bb.has(x)).length/Math.max(aa.size,bb.size)}
function duplicates(proposal,records){
 const p=proposal||{},pn=norm([p.firstName,p.lastName].filter(Boolean).join(' ')),pi=norm(p.institution),pe=new Set([p.email,...(p.contactWays||[]).filter(w=>w.type==='email').map(w=>w.value)].filter(Boolean).map(v=>String(v).trim().toLowerCase())),pt=new Set([p.phone,p.mobile,p.fax,...(p.contactWays||[]).filter(w=>w.type!=='email').map(w=>w.value)].map(phone).filter(v=>v.length>=6));
 const matches=[];for(const r of records){const c=r.contact||r,pname=norm([c.firstName,c.lastName].filter(Boolean).join(' ')),institution=norm(c.institution),emails=[c.email,...(c.contactWays||[]).filter(w=>w.type==='email').map(w=>w.value),...(c.people||[]).flatMap(p=>[p.email,...(p.contactWays||[]).filter(w=>w.type==='email').map(w=>w.value)])].filter(Boolean).map(v=>String(v).trim().toLowerCase()),phones=[c.phone,c.mobile,c.fax,...(c.contactWays||[]).filter(w=>w.type!=='email').map(w=>w.value),...(c.people||[]).flatMap(p=>[p.phone,p.fax,...(p.contactWays||[]).filter(w=>w.type!=='email').map(w=>w.value)])].map(phone),reasons=[];let score=0;
 if(emails.some(x=>pe.has(x))){score+=6;reasons.push('Gleiche E-Mail-Adresse')}
 if(phones.some(x=>x.length>=6&&pt.has(x))){score+=5;reasons.push('Gleiche Rufnummer')}
 if(pn.length>=5&&tokensim(pn,pname)>=.8){score+=5;reasons.push('Ähnlicher Personenname')}
 if(pi.length>=5&&tokensim(pi,institution)>=.8){score+=5;reasons.push('Ähnliche Institution')}
 if(score&&norm(p.city)&&norm(p.city)===norm(c.city)){score++;reasons.push('Gleicher Ort')}
 if(score>=5)matches.push({...r,label:title(c),score,reasons});
 }return matches.sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label,'de'));
}
function signature(raw){
 if(typeof raw!=='string'||raw.length>50000)throw Error('Bitte höchstens 50.000 Zeichen Signaturtext einfügen.');
 const text=raw.replace(/\r\n?/g,'\n'),all=text.split('\n').map(x=>x.trim()).filter(Boolean);let start=all.findIndex(x=>/^(mit (freundlichen|besten|herzlichen) grüßen|freundliche grüße|viele grüße|best regards|kind regards|--$)/i.test(x));const lines=(start>=0?all.slice(start+1):all).slice(0,60),c={},contactWays=[];
 const emails=[...new Set(lines.join('\n').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[])];emails.forEach((email,i)=>contactWays.push({id:'signature-email-'+i,type:'email',label:i?'Weitere E-Mail':'E-Mail',value:email,preferred:i===0}));if(emails[0])c.email=emails[0];
 for(const [i,line] of lines.entries()){
  const m=/^(telefon|tel\.?|fon|durchwahl|mobil(?:telefon)?|mobile|handy|fax|telefax)\s*[:.]?\s*(\+?[\d(][\d\s()+/.-]{4,})/i.exec(line);if(m){const type=/fax/i.test(m[1])?'fax':/mobil|handy/i.test(m[1])?'mobile':'phone',value=m[2].trim();if(phone(value).length>=6){contactWays.push({id:'signature-phone-'+i,type,label:m[1].replace(/\.$/,''),value,preferred:!c[type]});if(!c[type])c[type]=value}}
  const address=/^(?:D[- ]?)?(\d{5})\s+([\p{L}][\p{L}\s().-]+)$/u.exec(line);if(address&&!c.postal){c.postal=address[1];c.city=address[2].trim();const previous=lines[i-1]||'',st=/^(.+?)\s+(\d+(?:[-/]\d+)?)\s*([a-z]?)$/i.exec(previous);if(st&&!/@|tel|fax|mobil/i.test(previous)){c.street=st[1];c.house=st[2];c.houseLetter=st[3]}}
  if(!c.institution&&/\b(GmbH|gGmbH|AG|e\.?\s?V\.?|Amtsgericht|Landgericht|Kanzlei|Praxis|Klinik|Pflegedienst|Krankenkasse|Stadtverwaltung|Stiftung)\b/i.test(line)&&!/@|https?:|\d{5}/i.test(line))c.institution=line;
 }
 const candidate=lines.find(line=>/^(?:(?:Dr\.|Prof\.)\s+)*[\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+){1,3}$/u.test(line)&&line!==c.institution&&!/grüße|regards|geschäftsführung|abteilung|telefon|postfach|straße|strasse|team|service|datenschutz/i.test(line));
 if(candidate){const m=/^((?:(?:Dr\.|Prof\.)\s+)*)(.*)$/.exec(candidate);c.title=m[1].trim();const parts=m[2].split(/\s+/);c.lastName=parts.pop();c.firstName=parts.join(' ')}
 if(contactWays.length)c.contactWays=contactWays;return c;
}
return {TYPES,ways,withWays,duplicates,signature,title,norm,phone};
});
