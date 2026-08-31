// Erstinbetriebnahme ("Erstlauf") - Nutzerauftrag 2026-07-26.
//
// Zweck: Auf einer komplett leeren Datenbank gibt es kein Nutzerkonto, kein Buero und keine
// Rechte. Ohne diesen Baustein waere eine Neuinstallation (frischer Server, Docker-Erststart,
// Wiederherstellung aus dem Nichts) nicht bedienbar - man kaeme nicht am Login vorbei.
//
// SICHERHEIT - warum die Sperre so gebaut ist:
// Dieser Weg legt einen ADMINISTRATOR an. Ein Einrichtungsweg, der spaeter noch erreichbar
// waere, ist eine Hintertuer. Die Sperre stuetzt sich deshalb auf DREI unabhaengige Signale,
// von denen JEDES EINZELNE bereits schliesst (ODER-Verknuepfung):
//   1. app_setup: ausdrueckliche Marke "wurde eingerichtet" (siehe db.js). Ueberlebt jedes
//      DELETE auf users - das ist der Kern der Sperre.
//   2. users: es existiert mindestens ein Konto.
//   3. sqlite_sequence: fuer die AUTOINCREMENT-Tabelle users steht dort der hoechste je
//      vergebene Schluessel. Ein DELETE FROM users setzt diesen Zaehler NICHT zurueck.
//      Damit ist selbst eine Installation gesperrt, die die Marke aus Punkt 1 nie erhalten hat.
// Um /setup wieder zu oeffnen, muesste jemand mit direktem Dateizugriff alle drei Spuren
// gleichzeitig faelschen - wer den hat, braucht keine Hintertuer mehr.
//
// Zusaetzlich optional: ist die Umgebungsvariable SETUP_TOKEN gesetzt, muss ihr Wert beim
// Abschicken angegeben werden. Damit kann ein oeffentlich erreichbarer Server abgesichert
// werden, ohne dass irgendein Geheimnis im Quelltext steht.
//
// Es werden BEWUSST keine Demo-/Beispieldaten angelegt: ein leeres Buero ist der richtige
// Startzustand. Angelegt werden ausschliesslich das Administratorkonto und die Buero-Grunddaten,
// die die Dokumentvorlagen fuer den Briefkopf brauchen (siehe unten).

const express = require('express');
const db = require('../../database/index');
const { hashPassword } = require('../../middleware/authentication');
const { PERMISSION_KEYS, MODES, PERMISSION_DEFS, serializePermissions } = require('../../middleware/authorization');

const router = express.Router();

const MIN_PASSWORT_LAENGE = 12;

/* ===================== Zustand ===================================================== */

// Punkt 3 der Sperre. Eigene Funktion mit try/catch, weil sqlite_sequence in einer ganz frischen
// Datei zwar existiert (SQLite legt sie mit der ersten AUTOINCREMENT-Tabelle an), aber noch keine
// Zeile fuer users hat - und weil ein fehlender Zaehler die Einrichtung nicht blockieren darf.
function jeNutzerVergeben() {
  try {
    const row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'users'").get();
    return !!(row && Number(row.seq) > 0);
  } catch (_e) {
    return false;
  }
}

function setupOffen() {
  try {
    if (db.prepare('SELECT id FROM app_setup WHERE id = 1').get()) return false;   // 1. Marke
    if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return false;   // 2. Nutzer
    if (jeNutzerVergeben()) return false;                                          // 3. Zaehler
    return true;
  } catch (_e) {
    // Im Zweifel GESCHLOSSEN: ein Fehler beim Pruefen darf niemals einen offenen
    // Administrator-Anlegeweg bedeuten.
    return false;
  }
}

function tokenErwartet() {
  return !!String(process.env.SETUP_TOKEN || '').trim();
}
function tokenStimmt(eingabe) {
  const soll = String(process.env.SETUP_TOKEN || '').trim();
  if (!soll) return true;
  return String(eingabe || '').trim() === soll;
}

/* ===================== Pruefungen =================================================== */

const t = (v) => String(v == null ? '' : v).trim();

// Passwortguete: Mindestlaenge plus zwei Selbstverstaendlichkeiten. Es gibt bewusst KEIN
// Standardpasswort im Quelltext - auch kein "muss beim ersten Login geaendert werden".
// Der Mindestwert liegt ueber den 8 Zeichen des normalen Passwortwechsels (routes/auth.js),
// weil dieses eine Konto von Anfang an volle Administratorrechte hat.
function passwortFehler(passwort, benutzername) {
  const p = String(passwort || '');
  if (!p) return 'Bitte ein Passwort vergeben.';
  if (p.length < MIN_PASSWORT_LAENGE) {
    return `Das Passwort ist zu kurz: ${p.length} von mindestens ${MIN_PASSWORT_LAENGE} Zeichen. `
      + 'Eine leicht merkbare Folge aus vier bis fuenf Woertern ist eine gute Wahl.';
  }
  const u = t(benutzername).toLowerCase();
  if (u && p.toLowerCase().includes(u)) return 'Das Passwort darf den Benutzernamen nicht enthalten.';
  if (new Set(p).size < 4) return 'Das Passwort besteht aus zu wenigen verschiedenen Zeichen.';
  return null;
}

/* ===================== Rechte ======================================================= */

// Vollrechte-Matrix in der BESTEHENDEN Struktur (users.permissions_json = {local:{...},online:{...}}).
// Quelle der Schluessel ist ausschliesslich der Katalog aus permissions.js - dadurch bekommt das
// erste Konto automatisch auch jedes kuenftig ergaenzte Recht, ohne dass hier etwas nachgezogen
// werden muss. serializePermissions ist derselbe Weg, den das Admin-Panel benutzt.
function vollrechteMatrix() {
  const zweig = {};
  for (const key of PERMISSION_KEYS) zweig[key] = true;
  const input = {};
  for (const mode of MODES) input[mode] = { ...zweig };
  return JSON.parse(serializePermissions(input, null));
}

// Spiegelt den Online-Zweig in die Alt-Spalten (can_view_cases, ...) - exakt das, was
// persistPermissions() in routes/admin.js tut. Die Spaltennamen kommen aus PERMISSION_DEFS.legacy,
// der einzigen Quelle dafuer.
function altSpaltenSpiegeln(userId, matrix) {
  const sets = [];
  const values = [];
  for (const key of PERMISSION_KEYS) {
    const spalte = PERMISSION_DEFS[key].legacy;
    if (!spalte) continue;
    sets.push(`${spalte} = ?`);
    values.push(matrix.online[key] ? 1 : 0);
  }
  if (!sets.length) return;
  values.push(userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/* ===================== Buero-Grunddaten ============================================= */
//
// Welche Felder braucht der Briefkopf wirklich? Nachgesehen im Bestand
// (outputs/...v0_7.html, applyOfficeBranding + refreshOfficeProfileCache):
//   OFFICE.name    <- firstName + lastName, ersatzweise companyName
//   OFFICE.address <- street, postalCode + city, country  (zusammengesetzt)
//   OFFICE.phone   <- phone        OFFICE.email <- email
//   OFFICE.degree  <- academicDegree   OFFICE.tax <- taxNumber
//   OFFICE.bank/iban/bic <- erste Zeile aus office_bank_accounts
// Pflicht ist hier deshalb nur, was ein Dokument ohne Luecke braucht: ein Name und eine
// Anschrift. Telefon/E-Mail sind empfohlen (sie stehen im Briefkopf), aber nicht erzwungen.
// Steuernummer, Bankverbindung, Logo, akademischer Grad: spaeter in den Einstellungen.
// Ein GERICHT wird hier bewusst NICHT abgefragt - im Bestand ist das Betreuungsgericht eine
// FALLBEZOGENE Angabe in den Stammdaten (Gericht/Aktenzeichen je Fall), kein bueroweites Feld;
// office_profile hat keine entsprechende Spalte.

const upsertProfileStmt = db.prepare(`
  INSERT INTO office_profile (
    id, company_name, salutation, first_name, last_name, academic_degree, street, postal_code, city, country,
    phone, mobile, email, fax, website, tax_number, vat_id
  ) VALUES (
    1, @companyName, @salutation, @firstName, @lastName, @academicDegree, @street, @postalCode, @city, @country,
    @phone, @mobile, @email, @fax, @website, @taxNumber, @vatId
  )
  ON CONFLICT(id) DO UPDATE SET
    company_name = excluded.company_name, salutation = excluded.salutation,
    first_name = excluded.first_name, last_name = excluded.last_name, academic_degree = excluded.academic_degree,
    street = excluded.street, postal_code = excluded.postal_code, city = excluded.city, country = excluded.country,
    phone = excluded.phone, mobile = excluded.mobile, email = excluded.email, fax = excluded.fax,
    website = excluded.website, tax_number = excluded.tax_number, vat_id = excluded.vat_id,
    updated_at = datetime('now')
`);

/* ===================== API ========================================================== */

// Was der Nutzer als Naechstes tun sollte - abgeleitet aus dem, was der Bestand verlangt, bevor
// die jeweiligen Bausteine arbeiten koennen (KI-Verbindungs-Gate, Mailkonten, Kalender, Rechte).
const NAECHSTE_SCHRITTE = [
  'Anmelden - mit dem eben angelegten Konto, Modus „Online".',
  'Bürostammdaten vervollständigen: Logo, Bankverbindung, Steuernummer, Fax/Web (Einstellungen → Bürostammdaten). Sie erscheinen im Briefkopf jedes Dokuments.',
  'KI-Verbindung hinterlegen (Einstellungen → KI). Ohne Schlüssel öffnen die KI-Bausteine nur die Einstellungen.',
  'E-Mail-Konto einrichten (Einstellungen → E-Mail/Postfach), damit Versand und Posteingang laufen.',
  'Kalender/Kontakte verbinden (Einstellungen → Kalender & Kontakte), falls Nextcloud, Google oder Microsoft im Einsatz ist.',
  'Weitere Mitarbeiterkonten anlegen und Rechte vergeben (Admin → Admin-Bereich → Nutzer).'
];

router.get('/api/setup/state', (req, res) => {
  /* Demo-Modus (30.08.2026): die Login-Seite blendet den Demo-Zugang nur ein, wenn der
     Admin ihn eingeschaltet hat - dies ist die einzige sitzungsfreie Konfig-Route. */
  let demoErlaubt = false;
  try { demoErlaubt = require('../demo/routes').demoErlaubt(); } catch (_e) { /* Demo-Modul fehlt/DB zu frueh */ }
  res.json({
    offen: setupOffen(),
    tokenNoetig: tokenErwartet(),
    minPasswortLaenge: MIN_PASSWORT_LAENGE,
    demoErlaubt
  });
});

router.post('/api/setup', async (req, res) => {
  if (!setupOffen()) {
    return res.status(409).json({
      error: 'Dieser Server ist bereits eingerichtet. Der Einrichtungsweg ist dauerhaft geschlossen. '
        + 'Weitere Konten legt ein Administrator im Admin-Bereich der App an.'
    });
  }
  const b = req.body || {};
  if (!tokenStimmt(b.setupToken)) {
    return res.status(403).json({ error: 'Das Einrichtungs-Kennwort (SETUP_TOKEN) stimmt nicht.' });
  }

  const username = t(b.username);
  const password = String(b.password || '');
  const passwordRepeat = String(b.passwordRepeat || '');
  if (!username) return res.status(400).json({ error: 'Bitte einen Benutzernamen fuer das Administratorkonto angeben.', feld: 'username' });
  if (username.length < 3) return res.status(400).json({ error: 'Der Benutzername muss mindestens 3 Zeichen lang sein.', feld: 'username' });
  if (/\s/.test(username)) return res.status(400).json({ error: 'Der Benutzername darf keine Leerzeichen enthalten.', feld: 'username' });
  const pwFehler = passwortFehler(password, username);
  if (pwFehler) return res.status(400).json({ error: pwFehler, feld: 'password' });
  if (password !== passwordRepeat) {
    return res.status(400).json({ error: 'Die beiden Passworteingaben stimmen nicht ueberein.', feld: 'passwordRepeat' });
  }

  const companyName = t(b.companyName);
  const officeFirst = t(b.officeFirstName);
  const officeLast = t(b.officeLastName);
  const street = t(b.street);
  const postalCode = t(b.postalCode);
  const city = t(b.city);
  if (!companyName && !(officeFirst && officeLast)) {
    return res.status(400).json({
      error: 'Bitte eine Bürobezeichnung ODER Vor- und Nachname angeben - daraus entsteht die Absenderzeile im Briefkopf.',
      feld: 'companyName'
    });
  }
  if (!street) return res.status(400).json({ error: 'Bitte Straße und Hausnummer des Büros angeben.', feld: 'street' });
  if (!postalCode) return res.status(400).json({ error: 'Bitte die Postleitzahl des Büros angeben.', feld: 'postalCode' });
  if (!city) return res.status(400).json({ error: 'Bitte den Ort des Büros angeben.', feld: 'city' });

  // Hashen VOR der Transaktion: bcrypt ist asynchron, better-sqlite3-Transaktionen sind synchron.
  // Derselbe Weg wie die bestehende Nutzerverwaltung (auth.hashPassword -> bcrypt, 12 Runden).
  const passwordHash = await hashPassword(password);

  let userId;
  try {
    userId = db.transaction(() => {
      // Zweite Pruefung INNERHALB der Transaktion (Wettlauf zweier gleichzeitiger Aufrufe).
      if (!setupOffen()) throw new Error('BEREITS_EINGERICHTET');

      const displayName = t(b.displayName) || [t(b.firstName), t(b.lastName)].filter(Boolean).join(' ') || username;
      const info = db.prepare(`
        INSERT INTO users (username, password_hash, display_name, allow_local, allow_online, is_admin, allow_mode_switch)
        VALUES (?, ?, ?, 1, 1, 1, 1)
      `).run(username, passwordHash, displayName);
      const id = info.lastInsertRowid;

      // Profilfelder wie im Admin-Panel (applyProfileFields), nur die hier abgefragten.
      db.prepare(`UPDATE users SET first_name = ?, last_name = ?, email = ?, active = 1 WHERE id = ?`)
        .run(t(b.firstName), t(b.lastName), t(b.email), id);

      const matrix = vollrechteMatrix();
      db.prepare('UPDATE users SET permissions_json = ? WHERE id = ?').run(JSON.stringify(matrix), id);

      // Personenregister (Etappe 1): auch das Erstkonto haengt von Anfang an an einer Person.
      try { require('../office/persons-routes').ensurePersonForUser(id); } catch (_e) {}
      altSpaltenSpiegeln(id, matrix);

      upsertProfileStmt.run({
        companyName,
        salutation: t(b.officeSalutation),
        firstName: officeFirst,
        lastName: officeLast,
        academicDegree: t(b.academicDegree),
        street,
        postalCode,
        city,
        country: t(b.country),
        phone: t(b.officePhone),
        mobile: '',
        email: t(b.officeEmail),
        fax: '',
        website: '',
        taxNumber: t(b.taxNumber),
        vatId: ''
      });

      // Marke setzen - ab hier ist /setup dauerhaft zu (auch nach Serverneustart, auch wenn
      // die Nutzerzeile wieder geloescht wird). Kein OR IGNORE: ein zweiter, gleichzeitiger
      // Aufruf soll hier hart scheitern statt still ein zweites Konto anzulegen.
      db.prepare('INSERT INTO app_setup (id, completed_by, note) VALUES (1, ?, ?)')
        .run(username, 'Erstinbetriebnahme über /setup');

      // Protokolleintrag - ohne Passwort, ohne Hash (siehe audit.js).
      db.prepare(`
        INSERT INTO audit_log (actor_user_id, actor_username, action, target_type, target_id, details_json)
        VALUES (?, ?, 'setup.complete', 'user', ?, ?)
      `).run(id, displayName, String(id), JSON.stringify({ username, companyName }));

      return id;
    })();
  } catch (error) {
    if (error && error.message === 'BEREITS_EINGERICHTET') {
      return res.status(409).json({ error: 'Dieser Server wurde soeben bereits eingerichtet.' });
    }
    if (error && /UNIQUE/.test(String(error.message))) {
      return res.status(409).json({ error: 'Dieser Benutzername ist bereits vergeben.' });
    }
    console.error('[setup] Einrichtung fehlgeschlagen:', error && error.message);
    return res.status(500).json({ error: 'Die Einrichtung ist fehlgeschlagen. Bitte den Serverbetreiber informieren.' });
  }

  // BEWUSST kein Passwort, kein Hash und keine Zugangsdaten in der Antwort oder im Log.
  console.log(`[setup] Erstinbetriebnahme abgeschlossen. Administratorkonto angelegt (id=${userId}). /setup ist jetzt dauerhaft gesperrt.`);
  res.status(201).json({ ok: true, username, naechsteSchritte: NAECHSTE_SCHRITTE });
});

/* ===================== Seite ======================================================== */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SEITEN_STIL = `
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       background:#eef1f6;color:#1d2430}
  main{max-width:760px;margin:0 auto;padding:32px 20px 64px}
  h1{font-size:26px;margin:0 0 6px}
  .lead{color:#55617a;margin:0 0 26px}
  .karte{background:#fff;border:1px solid #dbe1ec;border-radius:12px;padding:22px 24px;margin:0 0 20px;
         box-shadow:0 1px 3px rgba(16,24,40,.05)}
  .karte h2{font-size:17px;margin:0 0 4px}
  .karte .hinweis{color:#6a7488;font-size:13px;margin:0 0 18px}
  .reihe{display:flex;gap:14px;flex-wrap:wrap}
  .feld{flex:1 1 220px;min-width:0;margin:0 0 14px}
  label{display:block;font-size:13px;font-weight:600;margin:0 0 5px}
  label .opt{font-weight:400;color:#8b93a5}
  input{width:100%;padding:9px 11px;border:1px solid #c6cede;border-radius:8px;font-size:15px;background:#fff;color:inherit}
  input:focus{outline:2px solid #2f6fdb;outline-offset:0;border-color:#2f6fdb}
  button{background:#2f6fdb;color:#fff;border:0;border-radius:8px;padding:12px 22px;font-size:15px;
         font-weight:600;cursor:pointer}
  button:disabled{opacity:.6;cursor:progress}
  .meldung{display:none;border-radius:8px;padding:12px 14px;margin:0 0 18px;font-size:14px}
  .meldung.fehler{display:block;background:#fdecec;border:1px solid #f3b9b9;color:#8f1d1d}
  ol{padding-left:20px;margin:12px 0 0}
  ol li{margin:0 0 9px}
  .fuss{color:#6a7488;font-size:13px;margin-top:22px}
  a{color:#2f6fdb}
  @media (prefers-color-scheme:dark){
    body{background:#12161d;color:#e6e9ef}
    .karte{background:#1a1f28;border-color:#2c3442;box-shadow:none}
    .lead,.karte .hinweis,.fuss{color:#9aa3b5}
    input{background:#131820;border-color:#39424f;color:#e6e9ef}
    .meldung.fehler{background:#3a1d1d;border-color:#6d3232;color:#ffc9c9}
  }
`;

function feld(id, label, opts = {}) {
  const optional = opts.optional ? ' <span class="opt">(optional)</span>' : '';
  const typ = opts.type || 'text';
  const auto = opts.autocomplete ? ` autocomplete="${esc(opts.autocomplete)}"` : ' autocomplete="off"';
  const ph = opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : '';
  const basis = opts.basis ? ` style="flex-basis:${esc(opts.basis)}"` : '';
  return `<div class="feld"${basis}><label for="${id}">${label}${optional}</label>`
    + `<input id="${id}" name="${id}" type="${typ}"${auto}${ph}></div>`;
}

function seiteEinrichten() {
  const tokenBlock = tokenErwartet()
    ? `<div class="karte"><h2>Einrichtungs-Kennwort</h2>
        <p class="hinweis">Dieser Server verlangt zusätzlich das beim Betrieb hinterlegte Einrichtungs-Kennwort (SETUP_TOKEN).</p>
        <div class="reihe">${feld('setupToken', 'Einrichtungs-Kennwort', { type: 'password' })}</div></div>`
    : '';
  return `<title>Ersteinrichtung – Betreuungsbüro</title><style>${SEITEN_STIL}</style>
<main>
  <h1>Ersteinrichtung</h1>
  <p class="lead">Diese Datenbank ist noch leer. Legen Sie jetzt das erste Konto und die Grunddaten Ihres Büros an.
     Danach ist diese Seite dauerhaft gesperrt.</p>
  <div class="meldung" id="meldung"></div>
  <form id="formular">
    ${tokenBlock}
    <div class="karte">
      <h2>1. Administratorkonto</h2>
      <p class="hinweis">Dieses Konto erhält alle Rechte und darf später weitere Konten anlegen.
         Das Passwort vergeben Sie selbst – es gibt kein voreingestelltes Passwort.</p>
      <div class="reihe">
        ${feld('username', 'Benutzername', { autocomplete: 'username', placeholder: 'z. B. c.zepp' })}
        ${feld('displayName', 'Anzeigename', { optional: true, placeholder: 'erscheint in der App' })}
      </div>
      <div class="reihe">
        ${feld('firstName', 'Vorname', { optional: true })}
        ${feld('lastName', 'Nachname', { optional: true })}
      </div>
      <div class="reihe">
        ${feld('email', 'E-Mail-Adresse', { optional: true, type: 'email', autocomplete: 'email' })}
      </div>
      <div class="reihe">
        ${feld('password', `Passwort (mindestens ${MIN_PASSWORT_LAENGE} Zeichen)`, { type: 'password', autocomplete: 'new-password' })}
        ${feld('passwordRepeat', 'Passwort wiederholen', { type: 'password', autocomplete: 'new-password' })}
      </div>
    </div>
    <div class="karte">
      <h2>2. Büro-Grunddaten</h2>
      <p class="hinweis">Nur das Nötigste für den Briefkopf Ihrer Dokumente: ein Name und eine Anschrift.
         Logo, Bankverbindung, Steuernummer und alles Weitere ergänzen Sie später in den Einstellungen.</p>
      <div class="reihe">
        ${feld('companyName', 'Bürobezeichnung', { placeholder: 'z. B. Betreuungsbüro Musterstadt' })}
      </div>
      <div class="reihe">
        ${feld('officeFirstName', 'Vorname (Briefkopf)', { optional: true })}
        ${feld('officeLastName', 'Nachname (Briefkopf)', { optional: true })}
      </div>
      <div class="reihe">
        ${feld('street', 'Straße und Hausnummer', { basis: '100%' })}
      </div>
      <div class="reihe">
        ${feld('postalCode', 'PLZ', { basis: '120px' })}
        ${feld('city', 'Ort')}
        ${feld('country', 'Land', { optional: true, placeholder: 'nur bei Auslandsanschrift' })}
      </div>
      <div class="reihe">
        ${feld('officePhone', 'Telefon', { optional: true })}
        ${feld('officeEmail', 'E-Mail des Büros', { optional: true, type: 'email' })}
      </div>
    </div>
    <button type="submit" id="absenden">Einrichtung abschließen</button>
  </form>
  <p class="fuss">Es werden keine Beispieldaten angelegt. Sie starten mit einem leeren Büro.</p>
</main>
<script>
(function(){
  var form=document.getElementById('formular');
  var meldung=document.getElementById('meldung');
  var knopf=document.getElementById('absenden');
  function zeigeFehler(text,feld){
    meldung.className='meldung fehler';
    meldung.textContent=text;
    window.scrollTo({top:0,behavior:'smooth'});
    if(feld){var el=document.getElementById(feld); if(el)el.focus();}
  }
  form.addEventListener('submit',async function(ev){
    ev.preventDefault();
    meldung.className='meldung';
    var daten={};
    Array.prototype.forEach.call(form.querySelectorAll('input'),function(i){daten[i.name]=i.value;});
    knopf.disabled=true; knopf.textContent='Wird eingerichtet …';
    try{
      var antwort=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(daten)});
      var ergebnis=await antwort.json().catch(function(){return {};});
      if(!antwort.ok){ zeigeFehler(ergebnis.error||'Die Einrichtung ist fehlgeschlagen.',ergebnis.feld); return; }
      location.href='/setup/fertig';
    }catch(e){
      zeigeFehler('Der Server ist nicht erreichbar. Bitte erneut versuchen.');
    }finally{
      knopf.disabled=false; knopf.textContent='Einrichtung abschließen';
    }
  });
})();
</script>`;
}

function seiteGesperrt() {
  return `<title>Bereits eingerichtet – Betreuungsbüro</title><style>${SEITEN_STIL}</style>
<main>
  <h1>Bereits eingerichtet</h1>
  <p class="lead">Dieser Server ist eingerichtet. Der Einrichtungsweg ist dauerhaft geschlossen –
     das verhindert, dass jemand nachträglich ein Administratorkonto anlegt.</p>
  <div class="karte">
    <h2>Was Sie stattdessen tun können</h2>
    <ol>
      <li><a href="/">Zur Anmeldung</a> und mit einem vorhandenen Konto anmelden.</li>
      <li>Weitere Konten legt ein Administrator in der App an: Admin → Admin-Bereich → Nutzer.</li>
      <li>Passwort vergessen? Im Anmeldefenster „Passwort vergessen“ benachrichtigt den Administrator.</li>
    </ol>
  </div>
</main>`;
}

function seiteFertig() {
  const punkte = NAECHSTE_SCHRITTE.map((s) => `<li>${esc(s)}</li>`).join('');
  return `<title>Einrichtung abgeschlossen – Betreuungsbüro</title><style>${SEITEN_STIL}</style>
<main>
  <h1>Einrichtung abgeschlossen</h1>
  <p class="lead">Das Administratorkonto und die Büro-Grunddaten sind angelegt. Sie können sich jetzt normal anmelden.
     Diese Einrichtungsseite ist ab sofort dauerhaft gesperrt.</p>
  <div class="karte">
    <h2>Nächste Schritte</h2>
    <ol>${punkte}</ol>
  </div>
  <p><a href="/"><button type="button">Zur Anmeldung</button></a></p>
</main>`;
}

function sendeSeite(res, koerper) {
  res.status(200).type('html').send('<!doctype html><html lang="de"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow">' + koerper + '</head><body></body></html>');
}

router.get('/setup', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendeSeite(res, setupOffen() ? seiteEinrichten() : seiteGesperrt());
});

router.get('/setup/fertig', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // Nach dem Abschluss ist setupOffen() false - deshalb hat diese Seite eine eigene Adresse.
  sendeSeite(res, setupOffen() ? seiteEinrichten() : seiteFertig());
});

/* ===================== Weiche ======================================================= */
//
// Solange nicht eingerichtet, landet jeder Seitenaufruf auf /setup. Sobald eingerichtet, gibt
// die Weiche sofort ab - eine bestehende Installation merkt von diesem Baustein NICHTS
// (keine Umleitung, kein zusaetzlicher Datenbankzugriff ausser der Zustandsabfrage).
// Wird bewusst erst kurz vor express.static montiert: alle /api-Routen liegen davor und bleiben
// unberuehrt (ein Client, der 401 erwartet, bekommt weiterhin 401 und keine Umleitung).
function guard(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path === '/setup' || req.path.startsWith('/setup/')) return next();
  if (!setupOffen()) return next();
  const akzeptiert = String(req.headers.accept || '');
  if (!akzeptiert.includes('text/html') && req.path !== '/') return next();
  return res.redirect(302, '/setup');
}

module.exports = router;
module.exports.guard = guard;
module.exports.setupOffen = setupOffen;
