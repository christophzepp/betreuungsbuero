#!/usr/bin/env node
'use strict';
/* Dokumenteninformationen-Kuratierung vom 22.08.2026 (zweite Runde).

   Teil 1: schreibt die recherchierten Vorlageninformationen (Vorlage/Dateiname, Stand,
   Umfang, Urheber, zuständige Stelle, Quelle) aus kuration-dokumentinfo.json in die
   V159-Katalogzeile der App - dauerhaft in der Quelle, wie die Kuratierung vom 12.08.
   Die fünf handkuratierten Golddokumente des Nutzers (Freidokument, Betreuungsanträge,
   Betreuerwechsel, Betreuungsanzeige, Anfangsbericht) werden nicht angefasst; ihre
   Werte kommen weiter aus den bestehenden Laufzeitblöcken.

   Teil 2: hinterlegt je Dokument passende Standardwerte für die Export-Einstellungen
   des Dialogs (Standardempfänger und Standardausgabe). Gespeicherte Nutzerwerte haben
   weiter Vorrang; die Vorgaben greifen nur, solange nichts gespeichert ist.

   Aufruf:  node server/tools/v159-kuratierung/dokumentinfo-patch.js            */

const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const DATEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'kuration-dokumentinfo.json'), 'utf8'));

let html = fs.readFileSync(APP, 'utf8');
const vorher = html.length;

/* ------------------------------------------------ Teil 1: V159-Katalogzeile */
const zeilen = html.split('\n');
const zeilenNr = zeilen.findIndex((line) => line.startsWith('const V159={'));
if (zeilenNr < 0) throw new Error('V159-Katalogzeile nicht gefunden.');
const alt = zeilen[zeilenNr];
if (!alt.endsWith(';')) throw new Error('V159-Zeile endet nicht mit Semikolon.');
const v159 = JSON.parse(alt.slice('const V159='.length, -1));
if (!Array.isArray(v159.catalog) || v159.catalog.length !== 83) {
  throw new Error(`Katalog hat ${v159.catalog && v159.catalog.length} Einträge statt 83.`);
}

const GOLD = new Set(['free_document', 'care_application_person', 'care_application_zepp',
  'care_change_person', 'care_change_zepp', 'letter_care_notice', 'initial']);
const nachId = new Map(v159.catalog.map((c) => [c.id, c]));
let geaendert = 0;
for (const [id, patch] of Object.entries(DATEN)) {
  if (id.startsWith('_')) continue;
  if (GOLD.has(id)) throw new Error(`${id} ist ein Golddokument des Nutzers und wird nicht angefasst.`);
  const eintrag = nachId.get(id);
  if (!eintrag) throw new Error(`Katalogeintrag ${id} fehlt.`);
  for (const [feld, wert] of Object.entries(patch)) {
    if (eintrag[feld] !== wert) { eintrag[feld] = wert; geaendert++; }
  }
}
const neu = 'const V159=' + JSON.stringify(v159) + ';';
if (neu.includes('<script') || neu.includes('</script')) throw new Error('Script-Tag-Sequenz in der JSON-Zeile.');
JSON.parse(neu.slice('const V159='.length, -1)); // Gegenprobe: bleibt parsebar
zeilen[zeilenNr] = neu;
html = zeilen.join('\n');
console.log(`Teil 1: ${geaendert} Katalogfelder gesetzt (V159-Zeile).`);

/* -------------------------------------- Teil 2: Export-Standardwerte je Dokument */
/* Empfänger: 'authority' = zuständige Behörde (amtliche Anträge), 'export' = beim
   Export auswählen (Briefe, Bescheinigungen, persönliche Verfügungen). Gerichts-
   dokumente behalten den bestehenden Standard 'court'. Ausgabe: amtliche Formulare
   als "Anschreiben + Formular", Briefe als Briefkopfversion. */
const DEFAULTS_MARKER = 'const DOC_EXPORT_DEFAULTS_V260=';
if (!html.includes(DEFAULTS_MARKER)) {
  const behoerde = (defaultMode) => ({ recipientType: 'authority', defaultMode });
  const exportWahl = (defaultMode) => ({ recipientType: 'export', defaultMode });
  const map = {};
  [ 'housing_benefit_application', 'housing_entitlement_application', 'rent_certificate_jc',
    'disability_change_application', 'disability_initial_application',
    'pension_application', 'drv_confidentiality_release',
    'sgb12_continuation_application', 'sgb12_initial_application', 'sgb12_social_assistance_application',
    'sgb12_asset_declaration', 'sgb12_social_assistance_short',
    'sgb9_confidentiality_release', 'sgb9_initial_application',
    'sgb2_annex_uf', 'sgb2_withdrawal', 'sgb2_annex_vm', 'sgb2_income_certificate', 'sgb2_annex_ek',
    'sgb2_annex_se', 'sgb2_annex_sv', 'sgb2_employment_certificate', 'sgb2_annex_uh1', 'sgb2_annex_uh2',
    'sgb2_annex_uh3', 'sgb2_annex_ki', 'sgb2_annex_hg', 'sgb2_annex_wep', 'sgb2_annex_meb',
    'sgb2_annex_kdu', 'sgb2_annex_bb', 'sgb2_annex_ve', 'sgb2_annex_eks',
    'citizen_benefit_initial', 'citizen_benefit_continuation',
    'alg1_health_questionnaire', 'alg1_initial_application',
    'child_benefit_application', 'child_benefit_child_annex', 'child_benefit_diversion',
    'maintenance_advance_application', 'naturalization_application',
    'broadcast_registration', 'broadcast_change_notice', 'broadcast_exemption_application',
    'care_register_application'
  ].forEach((id) => { map[id] = behoerde('combined'); });
  [ 'letter_file_handover', 'letter_care_end', 'letter_death_notice', 'letter_sgb12_informal',
    'letter_sgb9_informal', 'letter_sgb2_informal', 'letter_alg1_employment_certificate',
    'letter_information_notice', 'letter_benefit_notice', 'letter_gkv_claims',
    'letter_gkv_membership', 'letter_bank_registration'
  ].forEach((id) => { map[id] = exportWahl('letterhead'); });
  [ 'rent_certificate', 'rent_offer_certificate' ].forEach((id) => { map[id] = exportWahl('combined'); });
  [ 'funeral_directive', 'power_of_attorney', 'care_directive', 'advance_directive'
  ].forEach((id) => { map[id] = exportWahl('print'); });

  const konst = '/* Export-Standardwerte je Dokument (Kuratierung 22.08.2026): amtliche Anträge gehen an die\n'
    + '   zuständige Behörde als "Anschreiben + Formular", Briefe als Briefkopfversion mit Empfänger-\n'
    + '   auswahl beim Export, persönliche Verfügungen als Druckansicht. Gespeicherte Werte gehen vor. */\n'
    + DEFAULTS_MARKER + JSON.stringify(map) + ';\n';

  const anker = 'function getExportOptions(id){';
  if (!html.includes(anker)) throw new Error('getExportOptions nicht gefunden.');
  html = html.replace(anker, konst + anker);

  const altEmpfaenger = "    recipientType:saved.recipientType||'court',";
  if (html.split(altEmpfaenger).length !== 2) throw new Error('recipientType-Standard nicht eindeutig.');
  html = html.replace(altEmpfaenger,
    "    recipientType:saved.recipientType||(DOC_EXPORT_DEFAULTS_V260[id]||{}).recipientType||'court',");

  const altModus = "defaultMode:withoutLetterhead?(['print','combined'].includes(savedDefaultMode)?savedDefaultMode:'print'):(savedDefaultMode||'print'),";
  if (html.split(altModus).length !== 2) throw new Error('defaultMode-Standard nicht eindeutig.');
  html = html.replace(altModus,
    "defaultMode:withoutLetterhead?(['print','combined'].includes(savedDefaultMode)?savedDefaultMode:'print'):(savedDefaultMode||(DOC_EXPORT_DEFAULTS_V260[id]||{}).defaultMode||'print'),");

  console.log(`Teil 2: Export-Standardwerte für ${Object.keys(map).length} Dokumente hinterlegt.`);
} else {
  console.log('Teil 2: Export-Standardwerte sind bereits hinterlegt.');
}

fs.writeFileSync(APP, html);
console.log(`Größe: ${vorher} -> ${html.length} (${html.length - vorher >= 0 ? '+' : ''}${html.length - vorher} Zeichen)`);
