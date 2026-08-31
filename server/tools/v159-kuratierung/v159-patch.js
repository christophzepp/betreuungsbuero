#!/usr/bin/env node
/* Kuratierungs-Patch für die V159-Katalogzeile der App-HTML (Teil A des Kuratierungsplans).
   Modi: --zeigen (Dry-Run: Ist-Werte + Trefferzählung), --anwenden (schreibt die Datei).
   Arbeitet ausschließlich auf der EINEN Zeile `const V159={...};` — alles andere bleibt byteidentisch. */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = path.resolve(__dirname, '../../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
const SCRATCH = __dirname;
const ANWENDEN = process.argv.includes('--anwenden');

const html = fs.readFileSync(HTML, 'utf8');
const lines = html.split('\n');
const idx = lines.findIndex(l => l.startsWith('const V159={'));
if (idx < 0) { console.error('V159-Zeile nicht gefunden'); process.exit(1); }
const line = lines[idx];
if (!line.endsWith(';')) { console.error('V159-Zeile endet nicht mit ;'); process.exit(1); }
const v159 = JSON.parse(line.slice('const V159='.length, -1));

/* care_change_zepp ist seit dem Nutzer-Block v240 (heute) ebenfalls Handarbeit - nicht anfassen. */
const AUSGENOMMEN = new Set(['free_document','care_application_person','care_application_zepp','care_change_person','care_change_zepp','housing_inspection_inventory','court_payment_notice']);
const stats = { fehlmapping: 0, zeitraum: 0, metadaten: 0, template: 0, briefe: 0, flat: 0 };

/* ---------- A1: Teilwert-Fehlmappings in pdfFields ---------- */
const FIXES = [
  { label: /stra(ß|ss)e\s*\+?\s*haus|haus\w*\s*\+?\s*stra(ß|ss)e/i, alt: 'person.houseNumber', neu: 'person.street' },
  { label: /plz\s*\+?\s*(stadt|ort)|postleitzahl\s*\+?\s*(stadt|ort)/i, alt: 'person.postalCode', neu: 'person.postalCity' },
  /* Betreuer-/Bevollmächtigten-Felder zuerst: JEDES person.*-Mapping dort traegt Daten der
     BETREUTEN Person in Felder der Betreuungsperson (ZTR-Antrag: 9 Felder!). Betreuerdaten
     haben keinen sicheren Stammdatenpfad - ein falsches Mapping ist schlechter als keines. */
  { label: /betreuer|bevollmächtigt/i, altMuster: /^person\./, neu: null },
  { label: /vorname\s*,?\s*\+?\s*(name|nachname)|^name\s*,\s*vorname$/i, alt: 'person.firstName', neu: 'person.fullName' },
  { label: /amts-?\s*\/?\s*(oder\s*)?familiengericht/i, alt: 'person.address', neu: 'care.courtAddress' },
  { label: /geldinstitut/i, alt: 'person.city', neu: 'banks.0.institution' },
];
for (const [docId, fields] of Object.entries(v159.pdfFields || {})) {
  if (AUSGENOMMEN.has(docId)) continue;
  for (const f of fields) {
    const lbl = String(f.label || '') + ' ' + String(f.name || '');
    for (const fix of FIXES) {
      const altTrifft = fix.altMuster ? fix.altMuster.test(f.sourcePath || '') : f.sourcePath === fix.alt;
      if (fix.label.test(lbl) && altTrifft) {
        if (ANWENDEN) { if (fix.neu) f.sourcePath = fix.neu; else delete f.sourcePath; }
        stats.fehlmapping++;
        break;
      }
    }
    /* A2: Berichtszeitraum-Felder ableitbar machen */
    if (!f.sourcePath && !f.deriveKey && /berichtszeitraum/i.test(lbl)) {
      const start = /(beginn|start|anfang|von)/i.test(lbl), ende = /(ende|schluss|bis)/i.test(lbl);
      if (start !== ende) {
        if (ANWENDEN) f.deriveKey = start ? 'periodFrom' : 'periodTo';
        stats.zeitraum++;
      }
    }
  }
}

/* ---------- A1b: Bankfelder der Selbstverwaltungserklärung/Entlastung vorbefüllen ----------
   Die pdf-Ebene dieser beiden Dokumente bleibt sichtbar (amtliche Vorlage braucht die
   Kontrollkaesten), aber IBAN/BIC/Geldinstitut inkl. Duplikatfelder kommen jetzt aus den
   Stammdaten statt leer bzw. falsch (Bridge-Analyse 12.08.2026). */
for (const docId of ['self_management', 'discharge']) {
  for (const f of (v159.pdfFields || {})[docId] || []) {
    const lbl = String(f.label || '');
    let neu = null;
    if (/^IBAN$/i.test(lbl)) neu = 'banks.0.iban';
    else if (/^BIC$/i.test(lbl)) neu = 'banks.0.bic';
    else if (/^geldinstitut/i.test(lbl)) neu = 'banks.0.institution';
    if (neu && f.sourcePath !== neu) { if (ANWENDEN) f.sourcePath = neu; stats.fehlmapping++; }
  }
}

/* ---------- A3: flatSchemas-Kuratierung ---------- */
const flat = v159.flatSchemas || {};
for (const [docId, schema] of Object.entries(flat)) {
  for (const section of schema.sections || []) {
    for (const f of section.fields || []) {
      if (/_reference$/.test(f.id) && !f.sourcePath && !f.deriveKey && !f.hint) {
        if (ANWENDEN) f.hint = 'Aktenzeichen des Leistungsträgers (nicht das Gerichts-Az.) – siehe Leistungen in den Stammdaten.';
        stats.flat++;
      }
    }
  }
}
/* alg1_health_questionnaire: Haushalts-/Einkommens-/Vermögens-Ableitungen sind für einen
   GESUNDHEITSfragebogen fachlich unsinnig – Felder bleiben (Persistenz-IDs!), bekommen aber
   fachliche Labels und keine irreführende Vorbefüllung mehr. */
const alg1h = flat.alg1_health_questionnaire;
if (alg1h) {
  const um = {
    alg1_health_questionnaire_household: 'Gesundheitliche Beschwerden und Diagnosen',
    alg1_health_questionnaire_income: 'Laufende Behandlungen, Ärztinnen/Ärzte und Medikation',
    alg1_health_questionnaire_assets: 'Auswirkungen auf Arbeitsfähigkeit und Belastbarkeit',
  };
  for (const section of alg1h.sections || []) for (const f of section.fields || []) {
    if (um[f.id]) { if (ANWENDEN) { f.label = um[f.id]; delete f.deriveKey; } stats.flat++; }
  }
}
/* rent_offer_certificate: Ein ANGEBOT darf nicht mit der aktuellen Miete/Anschrift vorbefüllt werden. */
const rentOffer = flat.rent_offer_certificate;
if (rentOffer) {
  for (const section of rentOffer.sections || []) for (const f of section.fields || []) {
    if (['accommodation.basicRent','accommodation.serviceCosts','accommodation.heatingCosts'].includes(f.sourcePath) ||
        (/_property$/.test(f.id) && f.sourcePath === 'person.address')) {
      if (ANWENDEN) delete f.sourcePath;
      stats.flat++;
    }
  }
}

/* ---------- A4: Katalog-Metadaten ---------- */
let meta = {};
try { meta = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'kuration-metadaten.json'), 'utf8')); } catch (_e) {}
let tplFixes = {};
try { tplFixes = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'kuration-template-fixes.json'), 'utf8')); } catch (_e) {}
for (const eintrag of v159.catalog || []) {
  if (AUSGENOMMEN.has(eintrag.id)) continue;
  const m = meta[eintrag.id];
  if (m) {
    if (ANWENDEN) { if (m.author) eintrag.author = m.author; if (m.authority) eintrag.authority = m.authority; }
    stats.metadaten++;
  }
  const t = tplFixes[eintrag.id];
  if (t && t.template) { if (ANWENDEN) eintrag.template = t.template; stats.template++; }
  if (eintrag.id === 'accounting') {
    if (ANWENDEN) Object.assign(eintrag, {
      title: 'Rechnungslegung', template: 'Automatisierte Rechnungslegung mit Bank- und Belegimport',
      templateDate: 'V1.57.9', pages: 'dynamisch je Konto', author: 'Betreuungsbüro', authority: 'Betreuungsgericht'
    });
    stats.metadaten++;
  }
}

/* ---------- A5: Brief-Defaulttexte ---------- */
const briefe = v159.letterTemplates || {};
/* Komplett-Ersetzung: die Ist-Texte sind grammatisch defekt ('dass ich ... durch mit beendet ist',
   'gegebenfalls') bzw. tragen einen XX.XX.XXXX-Platzhalter, obwohl das Sterbedatum als eigenes
   Pflichtfeld (letter_death_date) erfasst wird. */
const briefPatches = [
  { id: 'letter_care_end', erkennung: /durch\s+mit\s+beendet/, body: 'hiermit zeige ich an, dass die rechtliche Betreuung der oben genannten Person durch Beschluss des zuständigen Amtsgerichts beendet ist (der Beschluss liegt bei Bedarf anbei). Ich darf Sie bitten, die künftige Kommunikation nicht mehr über mein Büro zu führen.' },
  { id: 'letter_benefit_notice', erkennung: /gegebenfalls/, body: 'in vorbezeichneter Angelegenheit übersende ich Ihnen die aktuelle Aufstellung des Leistungsbezugs zur Kenntnisnahme und gegebenenfalls weiteren Veranlassung.' },
  { id: 'letter_death_notice', erkennung: /XX\.XX\.XXXX/, body: 'hiermit teile ich mit, dass die oben genannte, von mir rechtlich betreute Person verstorben ist; das Sterbedatum ist in diesem Schreiben gesondert angegeben. Sofern mir bereits Unterlagen (z. B. die Sterbeurkunde) vorliegen, sind diese als Anlage beigefügt.' },
];
for (const p of briefPatches) {
  const brief = briefe[p.id];
  if (brief && typeof brief.body === 'string' && p.erkennung.test(brief.body)) {
    if (ANWENDEN) brief.body = p.body;
    stats.briefe++;
  }
}

if (!ANWENDEN) {
  console.log('=== DRY-RUN ===');
  console.log('Treffer:', JSON.stringify(stats));
  console.log('\n--- Brieftexte (Ist) ---');
  for (const id of ['letter_care_end','letter_benefit_notice','letter_death_notice']) {
    console.log('\n[' + id + ']', JSON.stringify((briefe[id]||{}).body||'').slice(0, 600));
  }
  console.log('\n--- Metadaten-Beispiele (Ist) ---');
  for (const e of (v159.catalog||[]).slice(0, 3)) console.log(e.id, '|', e.author, '|', e.authority);
  console.log('\nkuration-metadaten.json Einträge:', Object.keys(meta).length);
  console.log('kuration-template-fixes.json Einträge:', Object.keys(tplFixes).length);
} else {
  lines[idx] = 'const V159=' + JSON.stringify(v159) + ';';
  fs.writeFileSync(HTML, lines.join('\n'));
  console.log('ANGEWENDET:', JSON.stringify(stats));
}
