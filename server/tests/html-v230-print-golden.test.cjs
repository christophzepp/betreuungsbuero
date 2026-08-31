'use strict';
/* Render-Vergleichstest fuer das v230-Drucklayout (Phase 5.3/5.2, Abnahme 13.08.2026):
   laedt pdf-lib+fontkit und den unified-document-print-layout-v230-Block DIREKT aus der
   App-HTML in eine VM, rendert das Vermoegensverzeichnis (echtes annual_assets-Schema,
   deterministische Musterdaten, fixes Datum, eingebettete DejaVu-Bloecke) und vergleicht
   Seite 1 (CI-Kopf), Seite 3 (Tabelle) und Seite 4 (Uebertrag/Summenblock) pixelweise
   gegen die abgenommenen Golden-Referenzen.

   Golden bewusst AKTUALISIEREN (nur nach Sichtpruefung!):
     GOLDEN_AKTUALISIEREN=1 node --test tests/html-v230-print-golden.test.cjs

   Voraussetzungen wie html-overlay-golden: macOS (sips), python3+PIL. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const WERKZEUG = path.join(__dirname, '..', 'tools', 'pdf-overlay');
const GOLDEN = path.join(__dirname, 'golden');
const AKTUALISIEREN = process.env.GOLDEN_AKTUALISIEREN === '1';
const APP = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const SEITEN = { 1: 'v230_annual_assets_s1.png', 3: 'v230_annual_assets_s3.png', 4: 'v230_annual_assets_s4.png' };

function verfuegbar() {
  try { execFileSync('sips', ['--help'], { stdio: 'ignore' }); } catch (_e) { return 'sips fehlt (kein macOS)'; }
  try { execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }); } catch (_e) { return 'python3/PIL fehlt'; }
  return null;
}

function balancedAb(html, startIdx) {
  let depth = 0, i = startIdx;
  for (;;) {
    const ch = html[i];
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return i + 1; }
    else if (ch === "'" || ch === '"' || ch === '`') { const q = ch; i++; while (html[i] !== q) { if (html[i] === '\\') i++; i++; } }
    i++;
  }
}

test('v230-Druck des Vermögensverzeichnisses entspricht den Golden-Referenzen', { timeout: 300000 }, async (t) => {
  const grund = verfuegbar();
  if (grund) { t.skip('uebersprungen: ' + grund); return; }

  const html = fs.readFileSync(APP, 'utf8');
  const lines = html.split('\n');

  const pdflibIdx = lines.findIndex(l => l.length > 500000 && l.includes('PDFDocument'));
  assert.ok(pdflibIdx > 0, 'pdf-lib-Block nicht gefunden');
  let bs = pdflibIdx; while (!lines[bs].trimStart().startsWith('<script')) bs--;
  let be = pdflibIdx; while (lines[be].trim() !== '</' + 'script>') be++;
  let pdflibJs = lines.slice(bs, be + 1).join('\n');
  pdflibJs = pdflibJs.slice(pdflibJs.indexOf('>') + 1);
  pdflibJs = pdflibJs.slice(0, pdflibJs.lastIndexOf('</' + 'script>'));

  const v230Start = lines.findIndex(l => l.includes('<script id="unified-document-print-layout-v230">'));
  assert.ok(v230Start > 0, 'v230-Block nicht gefunden');
  const v230Ende = lines.findIndex((l, i) => i > v230Start && l.trim() === '</' + 'script>');
  const v230Js = lines.slice(v230Start + 1, v230Ende).join('\n');

  const fontZeile = id => {
    const zeile = lines.find(l => l.startsWith(`<script id="${id}"`));
    assert.ok(zeile, id + ' fehlt');
    return zeile.slice(zeile.indexOf('>') + 1, zeile.lastIndexOf('</'));
  };

  const schemaAnker = html.indexOf('annual_assets:{sections:[');
  assert.ok(schemaAnker > 0, 'annual_assets-Schema nicht gefunden');
  const schemaJs = html.slice(schemaAnker + 'annual_assets:'.length, balancedAb(html, schemaAnker + 'annual_assets:'.length));
  let spreadJs = '';
  for (const name of ['COMMON_CONTACT_FIELDS', 'GOAL_FIELDS', 'PERSPECTIVE_FIELDS']) {
    const d = html.indexOf('const ' + name + '=');
    assert.ok(d > 0, name + ' nicht gefunden');
    spreadJs += html.slice(d, balancedAb(html, d + ('const ' + name + '=').length)) + ';\n';
  }

  const sandbox = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, Promise };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  sandbox.__fontB64 = {
    tpl_font_dejavu_regular: fontZeile('tpl_font_dejavu_regular'),
    tpl_font_dejavu_bold: fontZeile('tpl_font_dejavu_bold')
  };
  vm.createContext(sandbox);
  vm.runInContext(pdflibJs, sandbox, { filename: 'pdflib-block.js' });

  vm.runInContext(`
const OFFICE={name:'Betreuungsbüro Zepp',degree:'',address:'Marktplatz 8, 56346 St. Goarshausen',phone:'0151/29818142',email:'betreuungen.zepp@outlook.de',bank:'',iban:'',bic:'',tax:''};
function officeNameWithDegree(){return OFFICE.name+(OFFICE.degree?' ('+OFFICE.degree+')':'')}
const state={caseData:{person:{firstName:'Max',lastName:'Mustermann',birthDate:'1954-03-12'},care:{fileNumber:'XVII 123/24',courtName:'Amtsgericht Musterstadt'}},reports:{}};
function fullName(){return [state.caseData.person.firstName,state.caseData.person.lastName].filter(Boolean).join(' ')}
function isEmpty(v){return v===undefined||v===null||v===''||(Array.isArray(v)&&v.length===0)}
function normalizePdfDate(v){if(v===undefined||v===null||v==='')return '';const m=String(v).match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);return m?m[3]+'.'+m[2]+'.'+m[1]:String(v)}
function fmtDEDate(v){return normalizePdfDate(v)}
function todayDE(){return '01.03.2026'} /* FIX: Golden muss deterministisch sein */
function phase3Value(data,id){return data?.fields?.[id]?.value??''}
function pdfSafeText(v){return String(v??'').replace(/[\\u0000-\\u001f\\u007f]/g,' ').replace(/[\\u2013\\u2014]/g,'-').replace(/[\\u201e\\u201c\\u201d]/g,'"').replace(/[\\u2019]/g,"'").replace(/\\u2026/g,'...').replace(/\\u2192/g,'->').replace(/[^\\x20-\\x7E\\xA0-\\xFF\\u20AC\\n]/g,'?')}
function getDocumentOptions(id){return {signatureId:'caregiver',ownSignature:false,foreignSignatures:0}}
async function phase3EmbedSignature(){return null}
function docSignatureDataUrl(){return ''}
window.__sigStore={caregiverCached:()=>({caregiver:{firstName:'Christoph',lastName:'Zepp'}}),ensureCaregiver:async()=>{}};
const OFFICIAL_PDF_TEMPLATES={};
const OFFICIAL_STRUCTURED_TABLES={household:{columns:[{key:'firstName',label:'Vorname'},{key:'lastName',label:'Nachname'},{key:'birthDate',label:'Geburtsdatum'},{key:'relationship',label:'Verwandtschaftsverhältnis'}]}};
const REPORTS=[{id:'annual_assets',title:'Vermögensverzeichnis'}];
window.phase3ComponentBytes=async()=>{throw new Error('nicht im Test')};
function __b64decode(b64){
  const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lut=new Uint8Array(256);for(let i=0;i<abc.length;i++)lut[abc.charCodeAt(i)]=i;
  let len=b64.length;while(len>0&&b64[len-1]==='=')len--;
  const out=new Uint8Array(Math.floor(len*3/4));let o=0;
  for(let i=0;i<len;i+=4){const a=lut[b64.charCodeAt(i)],b=lut[b64.charCodeAt(i+1)],c=lut[b64.charCodeAt(i+2)]||0,d=lut[b64.charCodeAt(i+3)]||0;
    out[o++]=a<<2|b>>4;if(o<out.length)out[o++]=(b&15)<<4|c>>2;if(o<out.length)out[o++]=(c&3)<<6|d;}
  return out;
}
async function embeddedPdfBytes(id){const b64=__fontB64[id];return b64?__b64decode(b64):null}
${spreadJs}
const SCHEMAS={annual_assets:${schemaJs}};
`, sandbox, { filename: 'stubs.js' });
  vm.runInContext(v230Js, sandbox, { filename: 'v230-block.js' });

  vm.runInContext(`
const langerText='Die Rentenzahlungen (gesetzliche Rente und Witwerrente) gehen auf dem Girokonto ein. '.repeat(14)+'Größere Verfügungen erfolgen nur mit gerichtlicher Genehmigung (§ 1849 BGB). Besonderheiten: Namen wie Nguyễn Thị Hồng, Łukasz Wróbel oder Дмитрий müssen korrekt erscheinen.';
const fields={};
for(const sec of SCHEMAS.annual_assets.sections||[]){
  for(const f of sec.fields||[]){
    if(f.type==='signatureOwn'||f.type==='signatureExternal')continue;
    let wert='';
    if(f.type==='assetTable'){
      wert=[
        {type:'Vermögen',category:'Girokonto',institution:'Sparkasse Rhein-Lahn',amount:'2314,80'},
        {type:'Vermögen',category:'Tagesgeld',institution:'Sparkasse Rhein-Lahn',amount:'8150,00'},
        {type:'Vermögen',category:'Sparbuch',institution:'Volksbank Rhein-Nahe',amount:'12960,45'},
        {type:'Vermögen',category:'Bausparvertrag Nr. 003221100',institution:'Debeka Bausparkasse',amount:'4420,00'},
        {type:'Vermögen',category:'Festgeld (12 Monate)',institution:'Volksbank Rhein-Nahe',amount:'3500,00'},
        {type:'Vermögen',category:'Genossenschaftsanteile Mitgl.-Nr. 44 210',institution:'Volksbank Rhein-Nahe eG',amount:'520,00'},
        {type:'Vermögen',category:'Mietkautionskonto',institution:'Sparkasse Rhein-Lahn',amount:'1740,00'},
        {type:'Vermögen',category:'Wertpapierdepot 774 512 998',institution:'DWS Investment',amount:'6310,22'},
        {type:'Vermögen',category:'Bargeld (Barkasse, verwahrt)',institution:'—',amount:'148,50'},
        {type:'Schulden',category:'Zahnarztrechnung offen',institution:'Dr. Beispiel, Musterstadt',amount:'480,00'},
        {type:'Vermögen',category:'Sterbegeldversicherung Police 88-221',institution:'Muster Versicherung AG',amount:'5200,00'},
        {type:'Vermögen',category:'PKV-Beitragsrückerstattung (angekündigt)',institution:'Muster Krankenversicherung',amount:'312,00'}
      ];
      for(let z=1;z<=40;z++)wert.push({type:z%5===0?'Schulden':'Vermögen',category:'Weitere Position Nr. '+z,institution:'Institut '+z,amount:String(100+z*7)+',50'});
    }
    else if(f.type==='incomeTable')wert=[{type:'Altersrente',provider:'Deutsche Rentenversicherung',amount:'1480,00'},{type:'Witwerrente',provider:'Deutsche Rentenversicherung',amount:'420,00'}];
    else if(f.type==='officialTable')wert=[{firstName:'Max',lastName:'Mustermann',birthDate:'12.03.1954',relationship:'—'}];
    else if(f.type==='textarea')wert=langerText;
    else if(f.type==='select')wert=(f.options||[]).find(o=>o)||'ja';
    else if(f.type==='date')wert='2026-02-15';
    else if(f.type==='number')wert='40063,97';
    else if(f.type==='checks')wert=Array.isArray(f.options)&&f.options.length?[f.options[0]]:['ja'];
    else wert='Beispielwert für '+f.id;
    fields[f.id]={value:wert,source:'test',reviewed:true};
  }
}
state.reports.annual_assets={fields};
`, sandbox, { filename: 'musterdaten.js' });

  const bytes = await vm.runInContext(
    "createUnifiedDocumentPrintPdf('annual_assets',null,'Vermögensverzeichnis')", sandbox);
  const fertigBytes = Buffer.from(bytes);
  assert.ok(fertigBytes.length > 10000, 'Renderer lieferte kein plausibles PDF');

  const pdfPfad = path.join(WERKZEUG, 'vorlagen', 'v230-golden.pdf');
  fs.writeFileSync(pdfPfad, fertigBytes);
  execFileSync('node', ['seiten-rendern.js', pdfPfad], { cwd: WERKZEUG, stdio: 'ignore' });

  for (const [seite, goldenName] of Object.entries(SEITEN)) {
    const istPfad = path.join(WERKZEUG, 'vorlagen', 'render', `v230-golden_s${seite}.png`);
    const sollPfad = path.join(GOLDEN, goldenName);
    assert.ok(fs.existsSync(istPfad), 'Render fehlt: ' + istPfad);
    if (AKTUALISIEREN) { fs.copyFileSync(istPfad, sollPfad); continue; }
    assert.ok(fs.existsSync(sollPfad), 'Golden fehlt: ' + sollPfad + ' (mit GOLDEN_AKTUALISIEREN=1 erzeugen)');
    const urteil = execFileSync('python3', ['-c', `
from PIL import Image, ImageChops
import sys
a=Image.open(${JSON.stringify(istPfad)}).convert('L'); b=Image.open(${JSON.stringify(sollPfad)}).convert('L')
if a.size!=b.size: print('GROESSE', a.size, b.size); sys.exit(0)
d=ImageChops.difference(a,b)
h=d.histogram(); gesamt=a.size[0]*a.size[1]
mittel=sum(i*n for i,n in enumerate(h))/gesamt
stark=sum(n for i,n in enumerate(h) if i>32)/gesamt
print('OK' if (mittel<1.5 and stark<0.004) else 'ABWEICHUNG', round(mittel,3), round(stark*100,3))
`], { encoding: 'utf8' }).trim();
    assert.ok(urteil.startsWith('OK'), `v230 Seite ${seite}: ${urteil} — bei gewollter Layoutänderung Golden nach Sichtprüfung aktualisieren`);
  }
});
