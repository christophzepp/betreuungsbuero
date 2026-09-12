'use strict';
const db=require('../../database'),A=require('./addressbook'),T=require('../../../frontend/addressbook-contact-tools'),{darfSehen}=require('../cases/case-visibility');
function find(input,session){
 if(!input||typeof input.patch!=='object'||Array.isArray(input.patch)||JSON.stringify(input.patch).length>200000)A.fail(400,'Ungültige Kontaktsuche.');
 const records=[...db.prepare('SELECT * FROM office_contacts').all().map(r=>({...r,scope:'office',case_id:''})),...db.prepare('SELECT c.*,f.label case_label FROM case_contacts c JOIN cases f ON f.id=c.case_id').all().filter(r=>darfSehen(session,r.case_id)).map(r=>({...r,scope:'case'}))];
 const candidates=T.duplicates(input.patch,records.filter(r=>!(r.scope===input.scope&&r.case_id===(input.caseId||'')&&r.id===input.id)).map(r=>({scope:r.scope,caseId:r.case_id,id:r.id,caseLabel:r.case_label||'Büro',contact:A.data(r)}))),seen=new Set();
 // Bei zentralen Kontakten die vorhandene Projektion des Ziel-Falls zuerst anbieten.
 candidates.sort((a,b)=>b.score-a.score||Number(b.caseId===input.caseId)-Number(a.caseId===input.caseId));
 return {candidates:candidates.filter(r=>{const key=A.centralId(r.scope,r.id)||JSON.stringify([r.scope,r.caseId,r.id]);if(seen.has(key))return false;seen.add(key);return true}).slice(0,12).map(({contact,...r})=>({...r,contact:{institution:contact.institution,firstName:contact.firstName,lastName:contact.lastName,email:contact.email,city:contact.city}}))};
}
module.exports={find};
