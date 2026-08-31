'use strict';

/*
 * Sicherheitsprüfung für den gezielten Patch der 69-MB-App-Datei.
 *
 * Aufruf:
 *   HTML_PATCH_BACKUP=/absoluter/pfad/zur/sicherung.html node ... --pre
 *   HTML_PATCH_BACKUP=/absoluter/pfad/zur/sicherung.html node ... --post
 *
 * Die alten Blöcke werden bytegenau aus der unveränderten Sicherung gelesen. Dadurch kann
 * derselbe ers(alt, neu, name)-Prüfer vor dem Schreiben 1/0 und danach 0/1 nachweisen, ohne
 * den 69-MB-Quelltext oder große Alt-Blöcke ein zweites Mal in diesem Prüfskript abzulegen.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
);
const backupPath = path.resolve(String(process.env.HTML_PATCH_BACKUP || ''));
const mode = process.argv.includes('--post') ? 'post' : 'pre';
const EXPECTED_SCRIPT_COUNT = 286;

assert.ok(process.env.HTML_PATCH_BACKUP, 'HTML_PATCH_BACKUP muss auf die Sicherungskopie zeigen.');
assert.ok(fs.existsSync(backupPath), 'Sicherungskopie fehlt: ' + backupPath);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function count(source, needle) {
  assert.ok(needle, 'Leere Suchzeichenfolge ist unzulässig.');
  let total = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    total++;
    offset += needle.length;
  }
  return total;
}

function between(source, start, end, name) {
  const first = source.indexOf(start);
  assert.notEqual(first, -1, `${name}: Startmarke fehlt`);
  assert.equal(source.indexOf(start, first + start.length), -1, `${name}: Startmarke ist nicht eindeutig`);
  const last = source.indexOf(end, first + start.length);
  assert.notEqual(last, -1, `${name}: Endmarke fehlt`);
  return source.slice(first, last);
}

const backupBuffer = fs.readFileSync(backupPath);
const backup = backupBuffer.toString('utf8');
const currentBuffer = fs.readFileSync(htmlPath);
const current = currentBuffer.toString('utf8');

const OLD_HEADER = `/* Plan Abschnitt AM: Ordnergenerator - schlägt für den aktuell geöffneten Fall eine Ordnerstruktur
   vor (feste 9-teilige Standard-Taxonomie + datengetriebene Unterordner aus den erkannten
   Stammdaten), vollständig editierbar (hinzufügen/umbenennen/löschen auf beliebiger Ebene),
   optional per KI-Vorschlag erweiterbar, Export als ZIP mit leeren, korrekt benannten Ordnern`;
const NEW_HEADER = `/* Plan Abschnitt AM: Ordnergenerator - schlägt für den aktuell geöffneten Fall die verbindliche
   13-teilige Registerstruktur 00–12 vor. Unterordner entstehen erst mit der ersten Datei;
   die Struktur bleibt vollständig editierbar (hinzufügen/umbenennen/löschen auf beliebiger Ebene),
   optional per KI-Vorschlag erweiterbar, Export als ZIP mit leeren, korrekt benannten Ordnern`;

const OLD_OG = between(
  backup,
  'function ogBuildBaseline(dIn){',
  '\n\nfunction ogEnsurePlan',
  'Ordnergenerator'
);
const NEW_OG = `function ogBuildBaseline(dIn){
  // Verbindlich sind ausschließlich die Register 00–12. Sämtliche Fach-Unterordner werden
  // bedarfsgerecht mit der ersten Datei erzeugt und deshalb hier nicht vorab angelegt.
  void dIn;
  const root={id:'root',name:'',children:[],origin:'template',sourceRef:null};
  [
    '00 - Eingang',
    '01 - Stammdaten',
    '02 - Kerndokumente',
    '03 - Behörden & Gerichte',
    '04 - Gesundheit & Pflege',
    '05 - Finanzen',
    '06 - Versicherungen',
    '07 - Arbeit & Alltagsstruktur',
    '08 - Unterkunft & Aufenthalt',
    '09 - Persönliches',
    '10 - Berichte & Rechnungslegung',
    '11 - Betreuungsführung',
    '12 - Abschluss & Herausgabe'
  ].forEach(name=>ogAddChild(root,name,'template'));
  return root;
}`;

const OLD_CI = between(
  backup,
  'function ciFolderGuess(hay,paths){',
  '\nfunction ciFolderResolve',
  'Fallbeginn-Klassifikator'
);
const NEW_CI = `function ciFolderGuess(hay,paths){
  const h=' '+String(hay||'').normalize('NFC').toLowerCase()
    .replace(/ß/g,'ss').replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue')
    .normalize('NFD').replace(/\\p{M}/gu,'').replace(/\\s+/g,' ')+' ';
  if(!h.trim())return '';
  let best='',bestLen=0;
  paths.forEach(p=>{
    const seg=ciOgSegKey(p.split('/').pop());
    if(seg.length>=5&&h.includes(seg)&&seg.length>bestLen){best=p;bestLen=seg.length;}
  });
  if(best)return best;
  const CATS=[
    [/\\b(abschluss|herausgabe|uebergabe|nachfolgebetreuung|betreuungsende|erben?)\\b/,'12'],
    [/\\b(vermoegensverzeichnis|jahresbericht|schlussbericht|rechnungslegung|verguetung|abrechnungszeitraum)\\b/,'10'],
    [/\\b(falldokumentation|dokumentationseintrag|hausbesuch|schriftverkehr|dokumentenausgang|telefonvermerk|kontaktvermerk)\\b/,'11'],
    [/(leistungstraeg|sozialleist|rent|grundsicher|wohngeld|kass|jobcenter|sozialamt|arbeitsagentur|beihilfe)/,'05'],
    [/\\b(betreuungsbeschluss|beschluss|bestallung|betreuerausweis|vorsorgevollmacht|patientenverfuegung)\\b/,'02'],
    [/\\b(stammdaten|personalausweis|reisepass|geburtsurkunde|heiratsurkunde|sterbeurkunde|urkunde)\\b/,'01'],
    [/\\b(gesundheit|arzt|aerzt|klinik|pflege|pflegegrad|medikation|medikament|rezept|therapie|befund|gutachten|impfung)\\b/,'04'],
    [/\\b(bank|konto|iban|depot|sparkasse|volksbank|raiffeisen|schulden|glaeubiger|inkasso|mahnung|saldo|handkasse|beleg|zahlung|vermoegen)\\b/,'05'],
    [/\\b(versicherung|versicherer|police|haftpflicht|hausrat|rechtsschutz)\\b/,'06'],
    [/\\b(arbeit|arbeitgeber|werkstatt|wfbm|lohn|gehalt|tagesfoerderung|beschaeftigung)\\b/,'07'],
    [/\\b(miete|wohnung|wohnheim|unterkunft|aufenthalt|nebenkosten|vermieter|strom|energie|heizung)\\b/,'08'],
    [/\\b(gericht|justiz|urteil|behoerde|kreisverwaltung|finanzamt|landesamt|bundesamt|aktenzeichen)\\b/,'03'],
    [/\\b(persoenlich|familie|freizeit|biografie|bedarf|wille|wunsch|angehoerige)\\b/,'09']
  ];
  for(const [re,nr] of CATS){
    if(re.test(h)){
      const top=paths.find(p=>!p.includes('/')&&new RegExp('^'+nr+'\\\\b').test(p));
      if(top)return top;
    }
  }
  return paths.find(p=>!p.includes('/')&&/^00\\b/.test(p))||'';
}`;

const OLD_EMPTY = `    if(!D.imSpiegel&&!D.imKorb&&!D.baum.folders.length&&darfSchreiben()){
      leer+='<br><button class="dok-btn pri" onclick="__dok.standardOrdner()">Standard-Ordnerstruktur anlegen (01–06)</button>'
        +' <button class="dok-btn" onclick="__dok.ogUebernehmen()">Struktur aus dem Ordnergenerator</button>'`;
const NEW_EMPTY = `    if(!D.imSpiegel&&!D.imKorb&&!D.baum.folders.length&&darfSchreiben()&&D.bereich==='case'){
      leer+='<br><button class="dok-btn pri" onclick="__dok.standardOrdner()">Registerstruktur 00–12 anlegen</button>'
        +' <button class="dok-btn" onclick="__dok.ogUebernehmen()">Struktur aus dem Ordnergenerator</button>'`;

const OLD_STANDARD = between(
  backup,
  '__dok.standardOrdner=async function(){',
  '\n__dok.ordnerMenue',
  'Explorer-Standardregister'
);
const NEW_STANDARD = `__dok.standardOrdner=async function(){
  if(!darfSchreiben())return;
  try{var r=await api('/folders/standard',{method:'POST',body:{area:D.bereich,caseId:D.caseId}});
    await ladeBaum();render();var n=Array.isArray(r.created)?r.created.length:0;
    T(n+' Register angelegt; Registerstruktur 00–12 vollständig.');}catch(e){T(e.message);}
};`;

const changes = [
  { name: 'Ordnergenerator-Kommentar', alt: OLD_HEADER, neu: NEW_HEADER },
  { name: 'Ordnergenerator-Register', alt: OLD_OG, neu: NEW_OG },
  { name: 'Fallbeginn-Klassifikator', alt: OLD_CI, neu: NEW_CI },
  { name: 'Explorer-Leerzustand', alt: OLD_EMPTY, neu: NEW_EMPTY },
  { name: 'Explorer-Standardregister', alt: OLD_STANDARD, neu: NEW_STANDARD }
];

function ers(source, alt, neu, name, phase) {
  const oldCount = count(source, alt);
  const newCount = count(source, neu);
  if (phase === 'pre') {
    assert.equal(oldCount, 1, `${name}: alt vor Ersetzung ${oldCount}/1`);
    assert.equal(newCount, 0, `${name}: neu vor Ersetzung ${newCount}/0`);
    const replaced = source.replace(alt, neu);
    assert.equal(count(replaced, alt), 0, `${name}: alt nach Kandidat ${count(replaced, alt)}/0`);
    assert.equal(count(replaced, neu), 1, `${name}: neu nach Kandidat ${count(replaced, neu)}/1`);
    return replaced;
  }
  assert.equal(oldCount, 0, `${name}: alt nach Schreiben ${oldCount}/0`);
  assert.equal(newCount, 1, `${name}: neu nach Schreiben ${newCount}/1`);
  return source;
}

function scripts(source, label) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(source))) blocks.push({ attributes: match[1], body: match[2] });
  assert.equal(
    blocks.length,
    EXPECTED_SCRIPT_COUNT,
    `${label}: Scriptblockzahl ${blocks.length}/${EXPECTED_SCRIPT_COUNT}`
  );
  const failures = [];
  let javascriptBlocks = 0;
  blocks.forEach((block, index) => {
    // PDF-/JSON-Einbettungen sind Script-Tags als Transportbehälter, aber kein JavaScript.
    if (/\btype\s*=/i.test(block.attributes)) return;
    javascriptBlocks++;
    try {
      new vm.Script(block.body, { filename: `${label}-script-${index + 1}.js` });
    } catch (error) {
      failures.push({ index: index + 1, message: error.message });
    }
  });
  assert.deepEqual(failures, [], `${label}: JavaScript-Syntaxfehler: ${JSON.stringify(failures)}`);
  assert.ok(javascriptBlocks > 0, `${label}: keine JavaScript-Blöcke gefunden`);
  return { blocks: blocks.length, javascriptBlocks };
}

if (mode === 'pre') {
  assert.equal(
    Buffer.compare(currentBuffer, backupBuffer),
    0,
    'App-Datei stimmt vor dem Schreiben nicht mehr vollständig mit der Sicherung überein.'
  );
  const sourceStat = fs.statSync(htmlPath);
  const backupStat = fs.statSync(backupPath);
  assert.equal(sourceStat.mtimeMs, backupStat.mtimeMs, 'mtime der Sicherung stimmt nicht mit der Quelle überein.');
  scripts(backup, 'Sicherung');
  let candidate = current;
  for (const change of changes) candidate = ers(candidate, change.alt, change.neu, change.name, 'pre');
  scripts(candidate, 'Kandidat');
  console.log(JSON.stringify({
    mode,
    sourceSha256: sha256(currentBuffer),
    candidateSha256: sha256(Buffer.from(candidate)),
    bytes: currentBuffer.length,
    scripts: EXPECTED_SCRIPT_COUNT,
    replacements: changes.length,
    backupPath
  }, null, 2));
} else {
  for (const change of changes) ers(current, change.alt, change.neu, change.name, 'post');
  scripts(current, 'Ergebnis');
  console.log(JSON.stringify({
    mode,
    backupSha256: sha256(backupBuffer),
    resultSha256: sha256(currentBuffer),
    bytes: currentBuffer.length,
    scripts: EXPECTED_SCRIPT_COUNT,
    replacements: changes.length,
    backupPath
  }, null, 2));
}
