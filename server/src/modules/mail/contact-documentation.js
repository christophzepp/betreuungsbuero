'use strict';
const db = require('../../database'), A = require('../contacts/addressbook');
const { parseUserPermissions } = require('../../middleware/authorization');
const { darfBearbeiten } = require('../cases/case-visibility');
function currentSession(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user || !user.active) throw Error('Das Benutzerkonto ist nicht mehr aktiv.');
  const p = parseUserPermissions(user).online;
  return { userId: user.id, isAdmin: !!user.is_admin, canEditCases: !!p.editCases, canSendMail: !!p.sendMail, displayName: user.display_name || user.username };
}
function authorize(session, caseId) {
  if (!session?.isAdmin && !session?.canEditCases || !darfBearbeiten(session, caseId)) A.fail(403, 'Für die Falldokumentation fehlt die Schreibberechtigung.');
  if (!db.prepare('SELECT id FROM cases WHERE id=?').get(caseId)) A.fail(404, 'Der Dokumentationsfall wurde nicht gefunden.');
}
function resolve(session, caseId, to, preferred) {
  if (!caseId) return null;
  authorize(session, caseId);
  const addresses = new Set((String(to || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []));
  const matches = value => addresses.has(String(value || '').trim().toLowerCase());
  function link(scope, row, personId = '') {
    const c = A.data(row), p = (c.people || []).find(p => p.id === personId);
    if (personId && !p) return null;
    const profile=p||c, own=[profile.email,...(profile.contactWays||[]).filter(w=>w.type==='email').map(w=>w.value)].filter(Boolean),matchedEmail=(own.length?own:[c.email,...(c.contactWays||[]).filter(w=>w.type==='email').map(w=>w.value)]).find(matches);if(!matchedEmail)return null;
    const person = p?.name || [c.title, c.firstName, c.lastName].filter(Boolean).join(' ');
    return { scope, caseId: scope === 'office' ? '' : caseId, contactId: row.id, personId,
      snapshot: { label: [c.institution, person].filter(Boolean).join(' – '), institution: c.institution || '', person, role: c.role || '', fileNumber: c.fileNumber || '', processNumber: c.processNumber || '', customerNumber: c.customerNumber || '', email: matchedEmail, phone: p?.phone || c.phone || '' } };
  }
  if (preferred?.contactId) {
    const scope = preferred.scope || 'case';
    if (scope === 'case' && preferred.caseId !== caseId) A.fail(400, 'Der ausgewählte Kontakt gehört zu einem anderen Fall.');
    const row = A.get(scope, scope === 'office' ? '' : caseId, String(preferred.contactId));
    const result = row && link(scope, row, String(preferred.personId || ''));
    if (!result) A.fail(400, 'Kontakt oder Empfänger wurde geändert. Bitte den Kontakt erneut auswählen.');
    return result;
  }
  const hits = [];
  for (const row of db.prepare('SELECT * FROM case_contacts WHERE case_id=?').all(caseId)) {
    const c = A.data(row), base = link('case', row); if (base) hits.push(base);
    for (const p of c.people || []) {const person=link('case',row,p.id);if(person)hits.push(person)}
  }
  return hits.length === 1 ? hits[0] : null;
}
function documentMessage(account, message, input, session) {
  const caseId = String(input.caseId || ''); authorize(session, caseId);
  const outgoing = String(message.from?.address || '').toLowerCase() === String(account.email || '').toLowerCase();
  const counterpart = outgoing ? (message.to || []).map(a => a.address).join(', ') : message.from?.address || '';
  const contactLink = resolve(session, caseId, counterpart, input.contactLink);
  const mailMessageId = String(message.messageId || ''), mailDispatchId = outgoing ? require('./identity').dispatchId(message.dispatchId) : '';
  const mailSource = { accountId: account.id, folder: String(input.folder || ''), uid: String(message.uid || input.uid || '') };
  const fingerprint = mailMessageId || mailSource.folder + '|' + mailSource.uid;
  const id = 'mail-doku-' + require('node:crypto').createHash('sha256').update(JSON.stringify([caseId, account.id, fingerprint])).digest('hex');
  let saved, action = 'create';
  db.transaction(() => {
    const existing = db.prepare('SELECT * FROM case_doku_entries WHERE case_id=?').all(caseId).find(row => {
      const d = JSON.parse(row.data_json);
      return row.id === id || d.mailAccountId === account.id && ((mailMessageId && d.mailMessageId === mailMessageId) || (mailDispatchId && d.mailDispatchId === mailDispatchId));
    });
    if (existing) {
      const data = { ...JSON.parse(existing.data_json), mailMessageId, mailAccountId: account.id, mailSource };
      if (!data.contactLink && contactLink) data.contactLink = contactLink;
      db.prepare("UPDATE case_doku_entries SET data_json=?,updated_at=datetime('now'),updated_by=? WHERE id=?").run(JSON.stringify(data),session.userId,existing.id);
      saved = { id: existing.id, data }; action = 'update'; return;
    }
    const time = Date.parse(message.date), date = new Date(Number.isFinite(time) ? time : Date.now()).toISOString().slice(0,10);
    const text = String(message.text || message.html || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,4000);
    const data = { year:date.slice(0,4), date, actorGroup:'', actor:message.from?.name || message.from?.address || '', type:'Kommunikation & Kontakt',
      detail:outgoing?'E-Mail gesendet':'E-Mail eingegangen', contactType:'Schriftlich (E-Mail)', note:'',
      freeDetail:(outgoing?'An: ':'Von: ')+counterpart+' – Betreff: '+(message.subject||'(ohne Betreff)')+(text?' – Inhalt: '+text:''),
      contactLink, mailMessageId, mailDispatchId, mailAccountId:account.id, mailSource, source:{module:'mail',id:fingerprint,accountId:account.id} };
    const attachments=(message.attachments||[]).map(a=>a.filename).filter(Boolean);if(attachments.length)data.freeDetail+=' – Anhänge: '+attachments.join(', ');
    db.prepare('INSERT INTO case_doku_entries(id,case_id,data_json,updated_by) VALUES(?,?,?,?)').run(id,caseId,JSON.stringify(data),session.userId);saved={id,data};
  })();
  require('../contacts/addressbook-communications').indexMessages(account.id, input.folder || 'INBOX', [message]);
  A.notifyDoku(caseId,saved.id,saved.data,session,action);return saved;
}
module.exports = { currentSession, authorize, resolve, documentMessage };
