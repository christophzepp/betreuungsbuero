/* Reine Zuordnungsvorschläge: gemeinsame Kontaktangaben und fallbezogene Referenzen trennen. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.__abAssignmentData=factory()})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const fields=['role','fileNumber','processNumber','customerNumber'];
 const text=v=>String(v||'').trim();
 const norm=v=>text(v).normalize('NFKC').toLocaleLowerCase('de-DE').replace(/[\s.,–—-]+/g,' ').trim();
 function matches(source,contacts){
  return (contacts||[]).filter(c=>{
   if(c.__merged)return false;
   if(norm(source.institution)){if(norm(source.institution)!==norm(c.institution))return false;if(norm(source.firstName)||norm(source.lastName))return norm(source.firstName)===norm(c.firstName)&&norm(source.lastName)===norm(c.lastName);return !norm(c.firstName)&&!norm(c.lastName)}
   return !!norm(source.lastName)&&norm(source.firstName)===norm(c.firstName)&&norm(source.lastName)===norm(c.lastName)&&!!text(source.email)&&text(source.email).toLowerCase()===text(c.email).toLowerCase();
  });
 }
 function suggest(source,context,target){
  const values={role:text(target?.role||source.role),fileNumber:text(target?.fileNumber),processNumber:text(target?.processNumber),customerNumber:text(target?.customerNumber)},origins={};
  for(const k of fields)if(target&&text(target[k]))origins[k]='Kontakt im Zielfall';
  if(!origins.role&&values.role)origins.role='Rolle des Ausgangskontakts';
  const data=context.caseData||{},care=data.care||{},court=norm(care.courtName),role=norm(values.role);
  // Das Betreuungsaktenzeichen gehört nur zum tatsächlich zuständigen Betreuungsgericht.
  if(!values.fileNumber&&court&&court===norm(source.institution)&&role.includes('betreuungsgericht')){
   values.fileNumber=text(care.fileNumber||context.fileNumber);if(values.fileNumber)origins.fileNumber='Betreuungsdaten des Zielfalls';
  }
  const providerRefs=[...new Set((data.benefits||[]).filter(b=>norm(b.provider)===norm(source.institution)&&source.institution).map(b=>text(b.fileNumber)).filter(Boolean))];
  if(!values.fileNumber&&providerRefs.length===1){values.fileNumber=providerRefs[0];origins.fileNumber='Leistungsträger im Zielfall'}
  return {values,origins};
 }
 function standards(target,shared){
  const result={};for(const [purpose,pid] of Object.entries(target._standardRecipients||{})){
   if(!pid||shared.people?.some(p=>p.id===pid)){result[purpose]=pid;continue}
   const old=target.people?.find(p=>p.id===pid),same=(shared.people||[]).filter(p=>old&&p.name===old.name&&p.email===old.email);
   if(same.length!==1){const e=Error('Ein Standardempfänger verwendet einen anderen Ansprechpartner im Zielfall. Bitte die Ansprechpartner vor dem Verknüpfen abgleichen.');e.status=409;throw e}result[purpose]=same[0].id;
  }return result;
 }
 return {fields,matches,suggest,standards};
});
