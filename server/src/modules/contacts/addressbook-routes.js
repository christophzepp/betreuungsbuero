'use strict';
const express=require('express'),crypto=require('node:crypto'),db=require('../../database');
const {requireAuth,requireViewCases,requireEditCases}=require('../../middleware/authentication');
const A=require('./addressbook'),router=express.Router();
router.use(requireAuth,requireViewCases);
router.use(require('../office/events').middleware('officeContacts'));
const handle=fn=>(req,res)=>{try{res.json(fn(req))}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Adressbuch konnte nicht gespeichert werden.'})}};
router.get('/contact',handle(r=>A.details(r.query.scope,r.query.caseId||'',r.query.id,r.session)));
router.patch('/contact',requireEditCases,handle(r=>{
 const {scope,caseId='',id,patch,version}=r.body;A.authorize(r.session,scope,caseId,true);const changes=A.validatePatch(patch);
 const row=A.get(scope,caseId,id);if(!row)A.fail(404,'Kontakt nicht gefunden.');const next={...A.data(row),...changes};
 if(!String(next.institution||'').trim()&&!String(next.lastName||'').trim())A.fail(400,'Bitte Institution oder Nachname angeben.');
 if(!version)A.fail(400,'Die Kontaktversion fehlt. Bitte neu laden.');A.replace(scope,caseId,id,changes,r.session,version);return A.details(scope,caseId,id,r.session);
}));
router.post('/contact',requireEditCases,handle(r=>{
 const {scope,caseId='',patch}=r.body;A.authorize(r.session,scope,caseId,true);const next=A.validatePatch(patch);
 if(!String(next.institution||'').trim()&&!String(next.lastName||'').trim())A.fail(400,'Bitte Institution oder Nachname angeben.');
 const id=crypto.randomUUID();next.status=next.status||'Aktiv';next._category=next._category||'soziales';next.createdAt=new Date().toISOString();
 if(scope==='case'){if(!db.prepare('SELECT id FROM cases WHERE id=?').get(caseId))A.fail(404,'Fall nicht gefunden.');db.prepare('INSERT INTO case_contacts(id,case_id,data_json,updated_by) VALUES(?,?,?,?)').run(id,caseId,JSON.stringify(next),r.session.userId)}
 else db.prepare('INSERT INTO office_contacts(id,data_json,updated_by) VALUES(?,?,?)').run(id,JSON.stringify(next),r.session.userId);
 A.record(scope,caseId,id,null,next,r.session);A.notify(scope,caseId,id,next);return A.details(scope,caseId,id,r.session);
}));
router.post('/assign',requireEditCases,handle(r=>A.assign(r.body,r.session)));
router.post('/standard',requireEditCases,handle(r=>A.standard(r.body,r.session)));
router.post('/restore',requireEditCases,handle(r=>{
 const {scope,caseId='',id,historyId,version}=r.body;A.authorize(r.session,scope,caseId,true);
 const h=db.prepare('SELECT * FROM addressbook_history WHERE id=? AND scope=? AND contact_id=? AND case_id=?').get(historyId,scope,id,caseId);if(!h)A.fail(404,'Änderung nicht gefunden.');
 const patch={};for(const [k,v] of Object.entries(JSON.parse(h.changes_json)))if(A.FIELDS.includes(k))patch[k]=v.before??(k==='people'?[]:'');
 if(!Object.keys(patch).length)A.fail(400,'Fallzuordnungen und Standardempfänger bitte unter „Fälle & Standard“ ändern.');
 const row=A.get(scope,caseId,id);if(!row)A.fail(404,'Kontakt nicht gefunden.');const next={...A.data(row),...patch};if(!next.institution&&!next.lastName)A.fail(400,'Die Anlage eines Kontakts lässt sich hier nicht rückgängig machen.');
 if(!version)A.fail(400,'Kontaktversion fehlt.');A.replace(scope,caseId,id,patch,r.session,version);return A.details(scope,caseId,id,r.session);
}));
router.post('/detach',requireEditCases,handle(r=>{
 const {scope,caseId='',id,targetCaseId,contactId}=r.body;A.authorize(r.session,scope,caseId);A.authorize(r.session,'case',targetCaseId,true);
 const cid=A.centralId(scope,id),row=A.get('case',targetCaseId,contactId);if(!cid||!row||A.centralId('case',contactId)!==cid)A.fail(404,'Zuordnung nicht gefunden.');
 db.transaction(()=>{db.prepare('DELETE FROM addressbook_links WHERE case_contact_id=?').run(contactId);const next=A.data(row);delete next.centralContactId;db.prepare('UPDATE case_contacts SET data_json=? WHERE id=?').run(JSON.stringify(next),contactId);A.record('case',targetCaseId,contactId,A.data(row),next,r.session)})();
 A.notify('case',targetCaseId,contactId,A.data(A.get('case',targetCaseId,contactId)));
 return A.details(scope,caseId,id,r.session);
}));
module.exports=router;
