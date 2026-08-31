// Personenregister (Etappe 1 des Personen-Plans, 29.08.2026).
//
// EINE Liste fuer alle Menschen des Bueros: Nutzerkonten, Mitarbeitende ohne Konto, externe
// Personen. Die Tabelle `persons` ist die fuehrende Quelle der PROFILDATEN; ein Nutzerkonto
// verweist per user_id auf seine Person.
// SPIEGEL-ENTSCHEIDUNG (Etappe 4, 30.08.2026): die Profilfelder werden DAUERHAFT zusaetzlich
// in die users-Spalten gespiegelt - das ist die bewusste Kompatibilitaetsschicht fuer die
// vielen /api/admin/users-Leser (Formulare, Exporte, gatherPersons-Rueckfall). Sie ist
// drift-frei, weil BEIDE Richtungen durch EINEN serverseitigen Schreibpfad in einer
// Transaktion laufen (personInUserSpiegeln / syncPersonFromUser); die Spalten selbst zu
// entfernen braechte keinen Funktionsgewinn, faesste aber jeden users-Leser an.
//
// RECHTE: Lesen fuer alle Angemeldeten (Namen sind im Buero kein Geheimnis - dieselbe Schranke
// wie die bisherige Mitarbeiterliste /api/office-profile/employees). Schreiben verlangt
// Admin- oder Buerostammdaten-Recht (identisch zur bisherigen Mitarbeiterpflege).
// ABER (Bugjagd 30.08.2026): die KENNUNG ist das Gehalts-Pseudonym - wer Kennung UND Namen
// derselben Person sieht, kann jeden "Gehalt MA 1"-Posten deanonymisieren. Deshalb liefert
// publicPerson die Kennung nur an Admins und Traeger des Klarnamen-Rechts financePersonNames;
// notes (das Admin-Notizfeld der Kontoverwaltung) kommt nur an Admins. Fuer alle anderen
// fehlen die Felder schlicht - es gibt clientseitig nichts zu entschluesseln.
//
// KENNUNG ("MA 1"): stabiles Pseudonym fuer anonymisierte Gehaltsangaben (Etappe 3 haengt das
// Klarnamen-Recht daran). Eindeutig erzwungen (Teilindex), und NIE wiederverwendet: interne
// Personen werden deaktiviert statt geloescht, ihre Kennung bleibt damit fuer immer belegt.

const express = require('express');
const crypto = require('crypto');
const db = require('../../database/index');
const { requireAuth } = require('../../middleware/authentication');
const { logAction } = require('../../middleware/audit');

const router = express.Router();
router.use(requireAuth);

function requirePersonsEdit(req, res, next) {
  const s = req.session || {};
  if (s.isAdmin || s.canManageOfficeProfile) return next();
  return res.status(403).json({ error: 'Zum Verwalten von Personen wird das Recht „Bürostammdaten verwalten“ benötigt.' });
}

const getPersonStmt = db.prepare('SELECT * FROM persons WHERE id = ?');
const listPersonsStmt = db.prepare(`
  SELECT p.*, u.username, u.is_admin, u.active AS user_active, u.is_demo AS user_is_demo
  FROM persons p LEFT JOIN users u ON u.id = p.user_id
  WHERE (u.id IS NULL AND ? = 0) OR COALESCE(u.is_demo, 0) = ?
  ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE
`);

function personSicht(session) {
  const s = session || {};
  return { kennung: !!(s.isAdmin || s.canFinancePersonNames), notes: !!s.isAdmin };
}

function publicPerson(row, sicht) {
  sicht = sicht || { kennung: true, notes: true };
  return {
    id: row.id,
    art: row.art === 'extern' ? 'extern' : 'intern',
    userId: row.user_id || null,
    username: row.username || '',
    isAdmin: !!row.is_admin,
    firstName: row.first_name,
    lastName: row.last_name,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim(),
    salutation: row.salutation,
    funktion: row.funktion,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    ...(sicht.kennung ? { kennung: row.kennung } : {}),
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    istBetreuer: row.ist_betreuer === 1,
    ...(sicht.notes ? { notes: row.notes } : {}),
    aktiv: row.aktiv !== 0,
  };
}

const FELDER = {
  firstName: 'first_name', lastName: 'last_name', salutation: 'salutation', funktion: 'funktion',
  email: 'email', phone: 'phone', mobile: 'mobile', kennung: 'kennung',
  joinedAt: 'joined_at', leftAt: 'left_at', notes: 'notes',
};

function kennungKonflikt(kennung, eigeneId) {
  const k = String(kennung || '').trim();
  if (!k) return null;
  const row = db.prepare('SELECT id, first_name, last_name FROM persons WHERE kennung = ? COLLATE NOCASE AND id <> ?')
    .get(k, eigeneId || '');
  return row || null;
}

/* Die users-Spalten spiegeln (dauerhafte Kompatibilitaetsschicht, siehe Kopfkommentar):
   dieselben Profilfelder, damit /api/admin/users, gatherPersons und alle Exporte
   unveraendert weiterlesen koennen. */
const USER_SPIEGEL = {
  first_name: 'first_name', last_name: 'last_name', salutation: 'salutation', funktion: 'job_title',
  email: 'email', phone: 'phone', mobile: 'mobile', kennung: 'ma_kennung',
  joined_at: 'joined_at', left_at: 'left_at', notes: 'notes',
};
/* Zahlen-Spalten getrennt: die Textschleife unten macht `|| ''` - eine 0 wuerde damit als
   Leerstring in einer INTEGER-Spalte landen (30.08.2026). */
const USER_SPIEGEL_ZAHL = { ist_betreuer: 'ist_betreuer' };
function personInUserSpiegeln(person) {
  if (!person.user_id) return;
  const sets = []; const values = [];
  for (const [pCol, uCol] of Object.entries(USER_SPIEGEL)) {
    sets.push(`${uCol} = ?`); values.push(person[pCol] || '');
  }
  for (const [pCol, uCol] of Object.entries(USER_SPIEGEL_ZAHL)) {
    sets.push(`${uCol} = ?`); values.push(person[pCol] ? 1 : 0);
  }
  values.push(person.user_id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

router.get('/', (req, res) => {
  const sicht = personSicht(req.session);
  const demo = req.session && req.session.isDemo ? 1 : 0;
  res.json({ persons: listPersonsStmt.all(demo, demo).map((r) => publicPerson(r, sicht)) });
});

router.post('/', (req, res, next) => {
  /* EXTERNE Personen duerfen auch Fallverwalter anlegen (Etappe 2): die Externe-Person-Wahl
     an der Fall-Vertretung waere sonst fuer Nicht-Admins mit Fallrecht eine Sackgasse.
     Interne Personen bleiben Buerostammdaten-Sache. */
  const s = req.session || {};
  if ((req.body || {}).art === 'extern' && (s.isAdmin || s.canManageOfficeProfile || s.allowCaseManagement)) return next();
  return requirePersonsEdit(req, res, next);
}, (req, res) => {
  const b = req.body || {};
  const art = b.art === 'extern' ? 'extern' : 'intern';
  const firstName = String(b.firstName || '').trim();
  const lastName = String(b.lastName || '').trim();
  if (!firstName && !lastName) return res.status(400).json({ error: 'Bitte mindestens Vor- oder Nachname angeben.' });
  /* Die Kennung ist das MA-Gehalts-Pseudonym - Externe tragen keine (Bugjagd 30.08.2026:
     eine externe Person mit Kennung liesse sich Personalkosten zuordnen und riss den
     Excel-Finanzimport mitten im Ersetzen). */
  if (art === 'extern' && String(b.kennung || '').trim()) {
    return res.status(400).json({ error: 'Externe Personen tragen keine Kennung – die Kennung ist das Pseudonym für interne Gehaltsangaben.' });
  }
  const konflikt = kennungKonflikt(b.kennung, '');
  if (konflikt) {
    return res.status(409).json({ error: `Die Kennung ist bereits vergeben (${[konflikt.first_name, konflikt.last_name].filter(Boolean).join(' ')}). Kennungen werden nie doppelt oder erneut vergeben.` });
  }
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO persons (id, art, user_id, first_name, last_name, salutation, funktion,
      email, phone, mobile, kennung, joined_at, left_at, notes, aktiv)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(id, art, firstName, lastName, String(b.salutation || '').trim(), String(b.funktion || '').trim(),
      String(b.email || '').trim(), String(b.phone || '').trim(), String(b.mobile || '').trim(),
      String(b.kennung || '').trim(), String(b.joinedAt || '').trim(), String(b.leftAt || '').trim(),
      String(b.notes || '').trim());
  if (b.istBetreuer != null) db.prepare('UPDATE persons SET ist_betreuer = ? WHERE id = ?').run(b.istBetreuer ? 1 : 0, id);
  logAction(req, 'person.create', 'person', id, { art });
  res.status(201).json({ person: publicPerson(getPersonStmt.get(id), personSicht(req.session)) });
});

router.put('/:id', requirePersonsEdit, (req, res) => {
  const person = getPersonStmt.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden.' });
  const b = req.body || {};
  if (b.kennung != null) {
    const konflikt = kennungKonflikt(b.kennung, person.id);
    if (konflikt) {
      return res.status(409).json({ error: `Die Kennung ist bereits vergeben (${[konflikt.first_name, konflikt.last_name].filter(Boolean).join(' ')}). Kennungen werden nie doppelt oder erneut vergeben.` });
    }
  }
  const zielArt = (b.art != null && !person.user_id) ? (b.art === 'extern' ? 'extern' : 'intern') : person.art;
  const zielKennung = b.kennung != null ? String(b.kennung).trim() : person.kennung;
  if (zielArt === 'extern' && zielKennung) {
    return res.status(400).json({ error: 'Externe Personen tragen keine Kennung – erst die Kennung entfernen, dann auf extern stellen.' });
  }
  if (zielArt === 'extern' && person.art !== 'extern'
      && db.prepare('SELECT 1 FROM finance_entries WHERE person_id = ? LIMIT 1').get(person.id)) {
    return res.status(409).json({ error: 'Dieser Person sind Personalkosten zugeordnet – sie kann nicht auf extern gestellt werden.' });
  }
  /* Audit 30.08.2026: die Kennung ist der EINZIGE Rundlauf-Anker der Personalkosten
     (Excel Spalte G). Wird sie geleert, waehrend Posten auf die Person zeigen, verliert
     der naechste Export-Import-Rundlauf die Zuordnungen stillschweigend - deshalb 409. */
  if (String(person.kennung || '').trim() && !zielKennung
      && db.prepare('SELECT 1 FROM finance_entries WHERE person_id = ? LIMIT 1').get(person.id)) {
    return res.status(409).json({ error: 'Dieser Person sind Personalkosten zugeordnet – die Kennung kann nicht entfernt werden (sie ist der Sicherungs-Anker der Zuordnung).' });
  }
  const sets = []; const values = [];
  for (const [field, column] of Object.entries(FELDER)) {
    if (b[field] != null) { sets.push(`${column} = ?`); values.push(String(b[field]).trim()); }
  }
  if (b.art != null && !person.user_id) { sets.push('art = ?'); values.push(zielArt); }
  /* Boolean, deshalb nicht in FELDER (dort wird getrimmt): "Fuehrt eigene Betreuungen". */
  if (b.istBetreuer != null) { sets.push('ist_betreuer = ?'); values.push(b.istBetreuer ? 1 : 0); }
  if (b.aktiv != null) {
    /* Aktiv/inaktiv einer Konto-Person laeuft ueber die Kontoverwaltung (dort haengt die
       Letzter-Admin-Sicherung dran) - hier nur fuer Personen ohne Konto. */
    if (person.user_id) return res.status(409).json({ error: 'Diese Person hat ein Nutzerkonto – aktiv/deaktiviert wird über das Konto geregelt.' });
    sets.push('aktiv = ?'); values.push(b.aktiv ? 1 : 0);
  }
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    values.push(person.id);
    db.transaction(() => {
      db.prepare(`UPDATE persons SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      personInUserSpiegeln(getPersonStmt.get(person.id));
    })();
  }
  logAction(req, 'person.update', 'person', person.id, {});
  res.json({ person: publicPerson(getPersonStmt.get(person.id), personSicht(req.session)) });
});

router.delete('/:id', requirePersonsEdit, (req, res) => {
  const person = getPersonStmt.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden.' });
  if (person.user_id) {
    return res.status(409).json({ error: 'Diese Person hat ein Nutzerkonto und wird deaktiviert statt gelöscht.' });
  }
  if (person.art !== 'extern') {
    /* Interne Personen: nie loeschen - ihre Kennung bleibt fuer immer belegt, sonst zeigte eine
       alte "Gehalt MA 1"-Buchung irgendwann auf die falsche Person. */
    return res.status(409).json({ error: 'Interne Personen werden deaktiviert statt gelöscht – ihre Kennung bleibt vergeben.' });
  }
  /* Sicherungs-Audit 30.08.2026: Externe stehen per ID in Fall-Vertretungen und im
     Vertretungsplan. Loeschen ohne Referenzpruefung hinterliesse eine tote UUID - der Name
     fehlte danach in JEDER kuenftigen Sicherung. Gleiches Muster wie die finance_entries-
     Pruefung beim Extern-Stellen: erst Verweise entfernen, dann loeschen. */
  const inFaellen = db.prepare("SELECT COUNT(*) AS n FROM cases WHERE stammdaten_json LIKE '%' || ? || '%'").get(person.id).n;
  const imPlan = db.prepare("SELECT COUNT(*) AS n FROM office_json WHERE key = 'vertretungsplan' AND data_json LIKE '%' || ? || '%'").get(person.id).n;
  if (inFaellen || imPlan) {
    return res.status(409).json({
      error: `Diese Person wird noch verwendet (${inFaellen ? `${inFaellen} Fall/Fälle` : ''}${inFaellen && imPlan ? ', ' : ''}${imPlan ? 'Vertretungsplan' : ''}) – bitte zuerst die Verweise entfernen, sonst bliebe dort ein nicht mehr auflösbarer Eintrag zurück.`,
    });
  }
  db.prepare('DELETE FROM persons WHERE id = ?').run(person.id);
  logAction(req, 'person.delete', 'person', person.id, { art: person.art });
  res.json({ ok: true });
});

/* Beim Anlegen eines Nutzerkontos die Person nachziehen: kommt eine personId mit (der
   "Konto anlegen"-Weg aus dem Personen-Menue reicht sie seit der Bugjagd 30.08.2026 explizit
   durch), wird GENAU diese Person verknuepft - ein im Formular korrigierter Name erzeugt
   damit keine Duplikat-Person mehr, deren Kennung fuer immer auf der Waise klemmte.
   Ohne personId greift der Namensabgleich, aber NUR gegen aktive interne Personen ohne
   Konto - vorher kaperte er auch gleichnamige Externe (die dann samt ihrer Fall-Vertretungs-
   Verweise still zum Mitarbeiter wurden) und Deaktivierte. Sonst entsteht eine neue Person
   aus den Profilfeldern. Wird von den Admin-Nutzerrouten und der Ersteinrichtung gerufen. */
function ensurePersonForUser(userId, personId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  const vorhandene = db.prepare('SELECT * FROM persons WHERE user_id = ?').get(userId);
  if (vorhandene) return vorhandene.id;
  let ohneKonto = null;
  if (personId) {
    const p = getPersonStmt.get(personId);
    if (!p) { const f = new Error('Die gewählte Person wurde nicht gefunden.'); f.code = 'PERSON_FEHLT'; throw f; }
    if (p.user_id) { const f = new Error('Die gewählte Person hat bereits ein Nutzerkonto.'); f.code = 'PERSON_HAT_KONTO'; throw f; }
    ohneKonto = p;
  }
  const key = (a, b) => (String(a || '').trim() + ' ' + String(b || '').trim()).toLowerCase().replace(/\s+/g, ' ').trim();
  const wanted = key(u.first_name, u.last_name);
  if (!ohneKonto && wanted) {
    ohneKonto = db.prepare("SELECT * FROM persons WHERE user_id IS NULL AND art = 'intern' AND aktiv = 1").all()
      .find((p) => key(p.first_name, p.last_name) === wanted) || null;
  }
  if (ohneKonto) {
    db.prepare(`UPDATE persons SET user_id = ?, art = 'intern', updated_at = datetime('now') WHERE id = ?`)
      .run(userId, ohneKonto.id);
    /* Richtung Person -> Konto: die Person traegt den gepflegten Stand (Funktion, Kennung ...),
       das frisch angelegte Konto uebernimmt ihn. */
    personInUserSpiegeln(getPersonStmt.get(ohneKonto.id));
    return ohneKonto.id;
  }
  const id = crypto.randomUUID();
  const kennung = kennungKonflikt(u.ma_kennung, '') ? '' : String(u.ma_kennung || '').trim();
  db.prepare(`INSERT INTO persons (id, art, user_id, first_name, last_name, salutation, funktion,
      email, phone, mobile, kennung, joined_at, left_at, notes, aktiv)
    VALUES (?, 'intern', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, u.first_name || '', u.last_name || '', u.salutation || '', u.job_title || '',
      u.email || '', u.phone || '', u.mobile || '', kennung, u.joined_at || '', u.left_at || '',
      u.notes || '', u.active === 0 ? 0 : 1);
  if (u.ist_betreuer) db.prepare('UPDATE persons SET ist_betreuer = 1 WHERE id = ?').run(id);
  return id;
}

/* Nach einer Profilaenderung ueber die NUTZERverwaltung (PUT /api/admin/users) die Person
   nachziehen - Gegenrichtung zum Spiegel oben. Kennungs-Kollision wirft, damit die Nutzerroute
   sie als 409 melden kann, BEVOR etwas geschrieben ist. */
function syncPersonFromUser(userId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return;
  const person = db.prepare('SELECT * FROM persons WHERE user_id = ?').get(userId);
  if (!person) { ensurePersonForUser(userId); return; }
  const konflikt = kennungKonflikt(u.ma_kennung, person.id);
  if (konflikt) {
    const fehler = new Error(`Die Kennung ist bereits vergeben (${[konflikt.first_name, konflikt.last_name].filter(Boolean).join(' ')}). Kennungen werden nie doppelt oder erneut vergeben.`);
    fehler.code = 'PERSON_KENNUNG_VERGEBEN';
    throw fehler;
  }
  db.prepare(`UPDATE persons SET first_name = ?, last_name = ?, salutation = ?, funktion = ?,
      email = ?, phone = ?, mobile = ?, kennung = ?, joined_at = ?, left_at = ?, notes = ?,
      aktiv = ?, ist_betreuer = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(u.first_name || '', u.last_name || '', u.salutation || '', u.job_title || '',
      u.email || '', u.phone || '', u.mobile || '', String(u.ma_kennung || '').trim(),
      u.joined_at || '', u.left_at || '', u.notes || '', u.active === 0 ? 0 : 1,
      u.ist_betreuer ? 1 : 0, person.id);
}

/* Wird ein Nutzerkonto geloescht, bleibt die PERSON bestehen (Kennung nie wiederverwenden) -
   sie verliert nur ihr Konto. */
function detachPersonFromUser(userId) {
  db.prepare('UPDATE persons SET user_id = NULL, updated_at = datetime(\'now\') WHERE user_id = ?').run(userId);
}

module.exports = router;
module.exports.ensurePersonForUser = ensurePersonForUser;
module.exports.syncPersonFromUser = syncPersonFromUser;
module.exports.detachPersonFromUser = detachPersonFromUser;
module.exports.kennungKonflikt = kennungKonflikt;

/* Sicherungs-Audit 30.08.2026: EINE serverseitige Aufloesung fuer menschenlesbare Artefakte
   (Stammdaten.xlsx-Abbild, Falluebergabe). Personen-ID -> "Vorname Nachname"; unaufloesbar
   -> '' (der Aufrufer laesst das Feld dann weg); Altwerte (Namen) unveraendert. */
const UUID_MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports.personAnzeigeName = function personAnzeigeName(wert) {
  const v = String(wert == null ? '' : wert).trim();
  if (!v) return '';
  if (!UUID_MUSTER.test(v)) return v;
  const p = db.prepare('SELECT first_name, last_name FROM persons WHERE id = ?').get(v);
  return p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() : '';
};
