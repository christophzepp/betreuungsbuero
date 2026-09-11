'use strict';
const fail=message=>{const e=new Error(message);e.status=400;throw e};
const addressFields=['label','street','house','houseLetter','postal','city','postbox','country'];
function addresses(value){
 if(!Array.isArray(value)||value.length>30)fail('Höchstens 30 Anschriften sind möglich.');const seen=new Set();
 return value.map(a=>{if(!a||typeof a!=='object'||typeof a.id!=='string'||!a.id||a.id.length>128||seen.has(a.id))fail('Jede Anschrift benötigt eine eindeutige ID.');seen.add(a.id);const out={id:a.id};for(const k of addressFields){if(a[k]!=null&&typeof a[k]!=='string')fail('Anschriftenfelder müssen Text enthalten.');out[k]=String(a[k]||'').trim().slice(0,1000)}if(!out.label)fail('Bitte die Anschrift benennen.');return out});
}
function validate(v){
 if(v.preferredChannel&&!['email','phone','mobile','post','fax'].includes(v.preferredChannel))fail('Ungültiger bevorzugter Kontaktweg.');
 for(const k of ['absentFrom','absentUntil'])if(v[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(v[k])||!Number.isFinite(Date.parse(v[k]))||new Date(v[k]).toISOString().slice(0,10)!==v[k]))fail('Bitte ein gültiges Abwesenheitsdatum angeben.');
 if(v.absentFrom&&v.absentUntil&&v.absentFrom>v.absentUntil)fail('Das Ende der Abwesenheit liegt vor dem Beginn.');
 if(v.substitutePersonId&&v.substitutePersonId===v.id)fail('Ein Ansprechpartner kann sich nicht selbst vertreten.');
}
const validPurpose=p=>typeof p==='string'&&(/^(document|mail|role:(court|doctor|insurance))$/.test(p)||/^report:[a-zA-Z0-9_.-]{1,150}$/.test(p));
module.exports={addresses,validate,validPurpose};
