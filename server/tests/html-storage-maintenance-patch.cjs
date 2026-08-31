'use strict';

/*
 * Sicherheitsprüfung für den zweiten gezielten Patch der 69-MB-App-Datei.
 *
 * Die Sicherung muss mit `cp -p` unmittelbar vor dem Prüflauf erzeugt worden
 * sein. Vor dem Schreiben werden Volltext, mtime, jede Ersetzung (1/1), alle
 * Scriptblöcke und der vollständig zusammengesetzte Kandidat geprüft.
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

const OLD_SETTINGS_HEAD = between(
  backup,
  "  var cfg={defaultDir:'',baseDir:'',caseDirs:{}};",
  '  var h=',
  'Einstellungen-Konfiguration'
);
const NEW_SETTINGS_HEAD = `  var cfg={defaultDir:'',storageRoot:'',legacyLocations:[]};
  try{cfg=await api('/config');}catch(e){T(e.message);}
  D.cfg=cfg;
  var darf=darfSpeicherort();
  var admin=!!nutzer().isAdmin;
  var storageRoot=String(cfg.storageRoot||cfg.baseDir||'');
`;

const OLD_STORAGE_CARD = between(
  backup,
  "    +'<div class=\"dok-karte cfg-k1\"><b>Speicherort (büroweit)</b>'",
  "  h+='<div class=\"dok-karte cfg-k3\"><b>Externe Verbindungen</b>'",
  'Speicherort-Karte'
);
const NEW_STORAGE_CARD = `    +'<div class="dok-karte cfg-k1"><b>Dokumentenspeicher-Wurzel (büroweit)</b>'
    +'<p>Alle neuen Dokumente liegen darunter in echten Ordnern und mit lesbaren Klarnamen. Die Datenbank bleibt Index; je Fall abweichende Blob-Orte werden nicht mehr angelegt.</p>'
    +'<p>Standard: <span class="dok-code">'+esc(cfg.defaultDir||'runtime/data/Dokumentenspeicher')+'</span></p>'
    +(darf?'<p>Abweichende zentrale Wurzel (leer = Standard):</p><input id="dokCfgBase" value="'+esc(storageRoot)+'" placeholder="z. B. /Volumes/NAS/Betreuung/Dokumentenspeicher">'
          :'<p>Zentrale Wurzel: '+(storageRoot?'<span class="dok-code">'+esc(storageRoot)+'</span>':'— (Standard)')+' <span style="color:#8a5a2b">(Änderung nur mit Bürostammdaten-Recht/Admin)</span></p>')
    +(Array.isArray(cfg.legacyLocations)&&cfg.legacyLocations.length
      ?'<p class="unter" style="margin-top:7px">Bisherige Blob-Orte (nur noch Lese-/Umstellungsquelle): '+cfg.legacyLocations.map(function(x){return '<span class="dok-code">'+esc(x)+'</span>';}).join(' · ')+'</p>'
      :'')
    +'</div>';
`;

const OLD_BACKUP_TEXT = `    +'<div class="dok-karte cfg-k6"><b>Sicherung & Synchronisation</b>'
    +'<p>Zeitgesteuerte Sicherung des Dokumentenspeichers: als ZIP-Datei in einen Ordner auf dem Server-Rechner (z. B. externe Platte/NAS) oder additiv auf eine Verbindung - auf der Zielseite wird nie etwas gelöscht. Ein verpasster Termin (Server war aus) wird nicht nachgeholt; der nächste reguläre Termin greift. „Laufend" spiegelt Neues und Geändertes etwa alle 15 Sekunden auf eine Verbindung (additiv - am Ziel wird nie etwas gelöscht); „Stündlich" läuft einmal je Stunde.</p>'`;
const NEW_BACKUP_TEXT = `    +'<div class="dok-karte cfg-k6"><b>Sicherung & Synchronisation</b>'
    +'<p><strong>Gesamtsicherung</strong> sichert die SQLite-Datenbank konsistent mit dem SQLite-eigenen Sicherungsbefehl, sämtliche Dokument-/Modulbestände sowie Rettungsskript und Anleitung in einen externen Ordner. Das Ziel muss außerhalb von Server und Datenverzeichnis liegen und die Schutzdatei <span class="dok-code">.betreuungsbuero-backup-ziel</span> enthalten. Die bisherigen Dokumenten-ZIPs und additiven Verbindungsziele bleiben verfügbar.</p>'`;

const OLD_MODULE_CARD = between(
  backup,
  '    +(function(){   /* Modulordner-Karte (D17) */',
  `    +(function(){
      var ab=`,
  'Modulordner-Karte'
);
const NEW_MODULE_CARD = `    +'<div class="dok-karte cfg-k8"><b>Bestandsumstellung &amp; Plattenabgleich</b>'
    +'<p>Der Prüflauf meldet jede geplante Verschiebung und Namensanpassung, ohne Dateien zu verändern. „Umhängen" arbeitet protokolliert in Abschnitten und kann mit derselben Laufkennung wiederholt werden. Der Plattenabgleich erkennt Finder-Umbenennungen, Verschiebungen, fehlende Dateien, Prüfsummenabweichungen und Waisen; er löscht nichts.</p>'
    +'<div id="dokWartungStatus"><p class="unter">Noch kein Lauf in diesem Dialog.</p></div>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">'
    +(admin?'<button class="dok-btn" onclick="__dok.wartungVorschau()">Umstellung nur prüfen</button><button class="dok-btn pri" onclick="__dok.wartungUmhaengen()">Geprüften Abschnitt umhängen</button>':'<span class="unter">Die Bestandsumstellung ist ausschließlich für Administratoren verfügbar.</span>')
    +(darfSchreiben()?'<button class="dok-btn" onclick="__dok.wartungAbgleich(false)">Platte ↔ Index nur lesen</button><button class="dok-btn" onclick="__dok.wartungAbgleich(true)">Finder-Änderungen einlesen</button>':'')
    +'</div></div>'
`;

const OLD_SETTINGS_CALLS = `  __dok.speicherLaden();
  __dok.aktLaden();
  __dok.impLaden();`;
const NEW_SETTINGS_CALLS = `  __dok.speicherLaden();
  __dok.aktLaden();
  __dok.wartungLaden();
  __dok.impLaden();`;

const OLD_MAINTENANCE_FUNCTIONS = between(
  backup,
  '/* ===== D17: Modulordner-Uebernahme (Einstellungs-Karte) ===== */',
  '/* ===== D13: Wiedervorlage + Datei-in-den-Posteingang ===== */',
  'Wartungsfunktionen'
);
const NEW_MAINTENANCE_FUNCTIONS = `/* ===== Echte Ordner: protokollierte Umstellung und Finder-Abgleich ===== */
async function dokAdminApi(pfad,opts){
  var o=Object.assign({credentials:'same-origin'},opts||{});
  if(o.body&&typeof o.body!=='string'){o.headers=Object.assign({'Content-Type':'application/json'},o.headers||{});o.body=JSON.stringify(o.body);}
  var res=await fetch('/api/admin'+pfad,o);
  var json=null;try{json=await res.json();}catch(_e){}
  if(!res.ok){var err=new Error((json&&json.error)||('Serverfehler ('+res.status+')'));err.status=res.status;err.data=json;throw err;}
  return json||{};
}
function wartungZeige(titel,r){
  var z=el('dokWartungStatus');if(!z)return;
  r=r||{};
  var s=r.summary||{};
  var zeilen=[];
  Object.keys(s).forEach(function(k){var v=s[k];if(v&&typeof v==='object')v=JSON.stringify(v);zeilen.push(esc(k)+': <b>'+esc(String(v))+'</b>');});
  var eintraege=Array.isArray(r.entries)?r.entries:(Array.isArray(r.findings)?r.findings:[]);
  if(!eintraege.length&&r.finder&&r.finder.scan&&Array.isArray(r.finder.scan.findings))eintraege=r.finder.scan.findings;
  var liste=eintraege.slice(0,12).map(function(x){
    var art=x.kind||x.status||'Hinweis',pf=x.storageRelpath||x.targetPath||x.sourcePath||'';
    var fehler=x.error||(x.detail&&x.detail.message)||'';
    return '<li><b>'+esc(String(art))+'</b>'+(pf?' · '+esc(String(pf)):'')+(fehler?' – '+esc(String(fehler)):'')+'</li>';
  }).join('');
  z.innerHTML='<div style="font-size:12.5px"><b>'+esc(titel)+'</b>'
    +(r.runId?' <span class="dok-chip">Lauf '+esc(String(r.runId))+'</span>':'')
    +'<div style="margin-top:4px">'+(zeilen.join(' · ')||'Lauf beendet.')+'</div>'
    +(r.reportPath?'<div class="unter">Protokoll: <span class="dok-code">'+esc(String(r.reportPath))+'</span></div>':'')
    +(liste?'<ul style="margin:6px 0 0 18px;padding:0">'+liste+'</ul>':'')
    +(eintraege.length>12?'<div class="unter">… '+(eintraege.length-12)+' weitere Einträge im Laufprotokoll.</div>':'')
    +'</div>';
}
__dok.wartungLaden=function(){
  var z=el('dokWartungStatus');if(z&&!z.textContent.trim())z.innerHTML='<p class="unter">Noch kein Lauf in diesem Dialog.</p>';
};
__dok.wartungVorschau=async function(){
  var z=el('dokWartungStatus');if(z)z.innerHTML='<div class="dok-lade">Bestand wird nur gelesen …</div>';
  try{
    var r=await dokAdminApi('/document-migration/preview',{method:'POST',body:{}});
    D.migrationRunId=r.runId||'';wartungZeige('Umstellungs-Prüflauf',r);
  }catch(e){wartungZeige('Prüflauf fehlgeschlagen',(e&&e.data)||{summary:{fehler:e.message||String(e)}});}
};
__dok.wartungUmhaengen=async function(){
  if(!D.migrationRunId){T('Bitte zuerst „Umstellung nur prüfen" ausführen.');return;}
  var wort=prompt('Der geprüfte Bestand wird in einem protokollierten Abschnitt umgehängt. Jede Quelle wird per Prüfsumme verifiziert.\\n\\nZum Fortfahren UMHÄNGEN eingeben:','');
  if(wort!=='UMHÄNGEN'){T('Umstellung nicht gestartet.');return;}
  var z=el('dokWartungStatus');if(z)z.innerHTML='<div class="dok-lade">Geprüfter Abschnitt wird umgehängt …</div>';
  try{
    var r=await dokAdminApi('/document-migration/run',{method:'POST',body:{confirm:'UMHÄNGEN',runId:D.migrationRunId,maxItems:100}});
    wartungZeige(r.status==='interrupted'?'Abschnitt beendet – derselbe Knopf setzt fort':'Bestandsumstellung',r);
    await ladeBaum();await ladeListe();
  }catch(e){wartungZeige('Umstellung mit Meldung beendet',(e&&e.data)||{summary:{fehler:e.message||String(e)}});}
};
__dok.wartungAbgleich=async function(anwenden){
  if(anwenden&&!confirm('Erkannte eindeutige Finder-Umbenennungen und -Verschiebungen in den Index einlesen? Fehlende Dateien werden nur als fehlend markiert; es wird nichts gelöscht.'))return;
  var z=el('dokWartungStatus');if(z)z.innerHTML='<div class="dok-lade">Platte und Index werden abgeglichen …</div>';
  try{
    var r=await api(anwenden?'/integrity/apply':'/integrity/scan',{method:'POST',body:{}});
    wartungZeige(anwenden?'Finder-Änderungen eingelesen':'Leseabgleich',r);
    if(anwenden){await ladeBaum();await ladeListe();render();}
  }catch(e){wartungZeige('Abgleich fehlgeschlagen',{summary:{fehler:e.message||String(e)}});}
};
__dok.exportAblageSpeichern=function(){
  var m=(el('dokExpAblModus')||{}).value||'aus',z=String((el('dokExpAblZiel')||{}).value||'Exporte').trim()||'Exporte';
  if(window.__dokExportAblage)window.__dokExportAblage.schreiben({modus:m,ziel:z});
  T(m==='aus'?'Export-Ablage ausgeschaltet.':('Export-Ablage aktiv ('+(m==='auto'?'automatisch in „'+z+'"':'mit Nachfrage')+').'));
};
`;

const OLD_BACKUP_TARGET_TEXT = between(
  backup,
  'function bkZielText(z){',
  '/* ===== D30: Zwei-Wege-Fallordner-Paarung ===== */',
  'Backup-Zieltext'
);
const NEW_BACKUP_TARGET_TEXT = `function bkZielText(z){
  z=z||{};
  if(z.art==='gesamt')return 'Gesamtsicherung nach '+(z.ordner||'?');
  if(z.art==='mount'){var m=(D.bkMounts||[]).find(function(x){return String(x.id)===String(z.mountId);});return 'Verbindung „'+(m?m.label:String(z.mountId||''))+'"'+(z.unterordner?' / '+z.unterordner:'');}
  return 'Dokumenten-ZIP nach '+(z.ordner||'?');
}
`;

const OLD_BACKUP_FORM = between(
  backup,
  'function bkFormHTML(mounts){',
  '__dok.bkFeldWechsel=function(){',
  'Backup-Formular'
);
const NEW_BACKUP_FORM = `function bkFormHTML(mounts){
  var fallOpts=(D.faelle||[]).filter(fallSichtbar).map(function(f){return '<option value="'+esc(f.id)+'">'+esc(f.label)+'</option>';}).join('');
  var mountOpts=mounts.map(function(m){return '<option value="'+esc(m.id)+'">'+esc(m.label)+'</option>';}).join('');
  var tage=BK_TAGE.map(function(tg,i){return '<label style="margin-right:8px;font-size:12.5px;white-space:nowrap"><input type="checkbox" class="dokBkTag" value="'+(i+1)+'"'+(i<5?' checked':'')+'> '+tg+'</label>';}).join('');
  return '<div style="border-top:1px solid #e3e9ef;margin-top:8px;padding-top:8px">'
    +'<b style="font-size:12.5px">Neuer Zeitplan</b>'
    +'<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px">'
    +'<input id="dokBkLabel" placeholder="Bezeichnung (z. B. Tägliche Gesamtsicherung)" style="flex:1 1 220px">'
    +'<select id="dokBkQuelle" onchange="__dok.bkFeldWechsel()"><option value="alles">Gesamter Dokumentenspeicher</option><option value="office">Nur Büroorganisation</option><option value="case">Eine Fallakte</option></select>'
    +'<select id="dokBkFall" style="display:none;max-width:220px">'+fallOpts+'</select>'
    +'</div>'
    +'<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px">'
    +'<select id="dokBkRhythmus" onchange="__dok.bkFeldWechsel()"><option value="laufend">Laufend (Synchronisation)</option><option value="stuendlich">Stündlich</option><option value="taeglich" selected>Täglich</option><option value="woechentlich">Wöchentlich</option><option value="monatlich">Monatlich</option></select>'
    +'<span id="dokBkTage" style="display:none">'+tage+'</span>'
    +'<input id="dokBkMonatstag" type="number" min="1" max="28" value="1" title="Monatstag (1-28)" style="display:none;width:58px">'
    +'<label id="dokBkZeitL" style="font-size:12.5px">um <input id="dokBkZeit" value="02:00" style="width:64px"> Uhr</label>'
    +'</div>'
    +'<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px">'
    +'<select id="dokBkZielArt" onchange="__dok.bkFeldWechsel()"><option value="gesamt" selected>Gesamtsicherung (DB + alle Dateien)</option><option value="zip">Nur Dokumenten-ZIP</option><option value="mount">Dokumente auf Verbindung kopieren</option></select>'
    +'<input id="dokBkOrdner" placeholder="Externer Zielordner, z. B. /Volumes/Backup/Betreuungsbuero" style="flex:1 1 260px">'
    +'<select id="dokBkMount" style="display:none;max-width:200px">'+mountOpts+'</select>'
    +'<input id="dokBkUnter" placeholder="Unterordner auf der Verbindung (optional)" style="display:none;flex:1 1 200px">'
    +'<button class="dok-btn pri" onclick="__dok.bkNeu()">Anlegen</button>'
    +'</div>'
    +'<p id="dokBkMarkerHinweis" style="color:#5a6b7a;font-size:11.5px;margin:4px 0 0">Schutz: Im externen Ziel muss die Datei <span class="dok-code">.betreuungsbuero-backup-ziel</span> liegen. Die Software legt sie nicht still an.</p>'
    +(mounts.length?'':'<p style="color:#5a6b7a;font-size:11.5px;margin:4px 0 0">Für das Ziel „Auf Verbindung kopieren" zuerst oben eine Verbindung anlegen.</p>')
    +'</div>';
}
`;

const OLD_BACKUP_FIELDS = between(
  backup,
  '__dok.bkFeldWechsel=function(){',
  '__dok.bkNeu=async function(){',
  'Backup-Feldwechsel'
);
const NEW_BACKUP_FIELDS = `__dok.bkFeldWechsel=function(){
  var z=(el('dokBkZielArt')||{}).value;
  var gesamt=z==='gesamt';
  var qEl=el('dokBkQuelle');if(qEl){if(gesamt)qEl.value='alles';qEl.disabled=gesamt;}
  var q=qEl&&qEl.value;var f=el('dokBkFall');if(f)f.style.display=(!gesamt&&q==='case')?'':'none';
  var rEl=el('dokBkRhythmus');if(rEl&&gesamt&&(rEl.value==='laufend'||rEl.value==='stuendlich'))rEl.value='taeglich';
  var r=rEl&&rEl.value;var tg=el('dokBkTage');if(tg)tg.style.display=(r==='woechentlich')?'':'none';
  var mt=el('dokBkMonatstag');if(mt)mt.style.display=(r==='monatlich')?'':'none';
  var zl=el('dokBkZeitL');if(zl)zl.style.display=(r==='stuendlich'||r==='laufend')?'none':'';
  var o=el('dokBkOrdner');if(o)o.style.display=(z==='zip'||z==='gesamt')?'':'none';
  var m=el('dokBkMount');if(m)m.style.display=(z==='mount')?'':'none';
  var u=el('dokBkUnter');if(u)u.style.display=(z==='mount')?'':'none';
  var h=el('dokBkMarkerHinweis');if(h)h.style.display=gesamt?'':'none';
};
`;

const OLD_BACKUP_CREATE = between(
  backup,
  '__dok.bkNeu=async function(){',
  '__dok.bkToggle=async function',
  'Backup-Anlage'
);
const NEW_BACKUP_CREATE = `__dok.bkNeu=async function(){
  var rhythmus=(el('dokBkRhythmus')||{}).value||'taeglich';
  var tage=[].map.call(document.querySelectorAll('.dokBkTag:checked'),function(x){return x.value;}).join(',');
  var weekdays=rhythmus==='woechentlich'?tage:(rhythmus==='monatlich'?String((el('dokBkMonatstag')||{}).value||'1'):'');
  var zielArt=(el('dokBkZielArt')||{}).value||'gesamt';
  var quelle=zielArt==='gesamt'?'alles':((el('dokBkQuelle')||{}).value||'alles');
  var ziel=zielArt==='mount'
    ?{art:'mount',mountId:(el('dokBkMount')||{}).value||'',unterordner:(el('dokBkUnter')||{}).value||''}
    :{art:zielArt,ordner:(el('dokBkOrdner')||{}).value||''};
  var body={label:(el('dokBkLabel')||{}).value,interval:rhythmus,weekdays:weekdays,timeHhmm:(el('dokBkZeit')||{}).value,
    quelle:{bereich:quelle,caseId:quelle==='case'?((el('dokBkFall')||{}).value||''):''},ziel:ziel};
  try{await api('/backup-jobs',{method:'POST',body:body});T('Zeitplan angelegt.');__dok.bkLaden();}catch(e){T(e.message);}
};
`;

const OLD_CONFIG_SAVE = between(
  backup,
  '__dok.cfgSpeichern=async function(){',
  '/* ---------- Echtzeit: Aenderungen anderer Fenster/Nutzer einspielen ---------- */',
  'Speicherort-Speichern'
);
const NEW_CONFIG_SAVE = `__dok.cfgSpeichern=async function(){
  var storageRoot=String((el('dokCfgBase')||{}).value||'').trim();
  try{
    await api('/config',{method:'PUT',body:{storageRoot:storageRoot}});
    __dok.dlgZu();T('Zentrale Dokumentenspeicher-Wurzel gespeichert.');
  }catch(e){T(e.message);}
};

`;

const OLD_OUTTAKE_PACKAGE = between(
  backup,
  'function renderPkg(){',
  'function handoverSummary(){',
  'Fallabschluss-Paketansicht'
);
const NEW_OUTTAKE_PACKAGE = `function renderPkg(){
  frame(\`<div class="ci-card"><h2>5 · Vollständiges Übergabepaket erstellen</h2><p class="desc">Erzeugt genau ein Fallübergabe-ZIP nach § 1872 BGB: sämtliche Dokumente der Fallakte in ihrer Ordnerstruktur, Falldaten, Inhaltsverzeichnis als PDF, Übergabeprotokoll und SHA-256-Prüfsummenliste. Fehlt auch nur eine verzeichnete Datei, wird kein unvollständiges Paket erzeugt und der Fehler hier sichtbar aufgelistet.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="ci-btn" onclick="window.__coZip()">Vollständiges Übergabepaket herunterladen</button>
    </div>
    <div class="ci-status" id="coPkgStat" style="margin-top:10px"></div>
    <div class="ci-foot"><button class="ci-btn ghost" onclick="window.__coBack(3)">← Zurück</button><div class="spacer"></div><button class="ci-btn" onclick="window.__coGoArchive()">Weiter: Dokumente erstellen &amp; versenden →</button></div></div>\`);
}
`;

const OLD_OUTTAKE_DOWNLOAD = between(
  backup,
  'window.__coZip=async function(){',
  'window.__coGoArchive=function()',
  'Fallabschluss-Paketdownload'
);
const NEW_OUTTAKE_DOWNLOAD = `window.__coZip=async function(){
  const caseId=String(window.__activeServerCaseId||'');
  if(window.__appMode!=='online'||!caseId){
    status('coPkgStat','Das vollständige §-1872-Paket braucht eine geöffnete Online-Fallakte. Es wurde keine unvollständige Ersatz-ZIP erzeugt.','err');
    return;
  }
  try{
    status('coPkgStat','Vollständigkeit wird geprüft und Paket wird erstellt …','');
    try{if(window.__onlineRealtime&&typeof window.__onlineRealtime.flush==='function')await window.__onlineRealtime.flush();}catch(_flush){}
    const r=await fetch('/api/documents/falluebergabe-zip?caseId='+encodeURIComponent(caseId),{credentials:'same-origin'});
    if(!r.ok){
      let d={};try{d=await r.json();}catch(_json){}
      const fehlt=Array.isArray(d.missing)?d.missing:[];
      const liste=fehlt.slice(0,12).map(x=>(x.path||x.name||x.fileId||'unbekannte Datei')).join(' · ');
      const mehr=fehlt.length>12?(' · … '+(fehlt.length-12)+' weitere'):'';
      status('coPkgStat',(d.error||('Paket fehlgeschlagen (HTTP '+r.status+').'))+(liste?(' Fehlend: '+liste+mehr):''),'err');
      return;
    }
    const blob=await r.blob();
    const dispo=String(r.headers.get('Content-Disposition')||'');
    const m=/filename\\*=UTF-8''([^;]+)/i.exec(dispo);
    let name='Falluebergabe_'+sanitize(fullNm())+'.zip';
    if(m){try{name=decodeURIComponent(m[1]);}catch(_e){}}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();
    setTimeout(()=>{try{URL.revokeObjectURL(url);a.remove();}catch(_e){}},4000);
    const n=r.headers.get('X-Handover-Documents')||'';
    status('coPkgStat','Vollständiges Übergabepaket erstellt'+(n?(' · '+n+' Dokument(e)'):'')+'.','ok');
    toast('Vollständiges Übergabepaket heruntergeladen.');
  }catch(e){
    console.error(e);
    status('coPkgStat','Übergabepaket fehlgeschlagen: '+String((e&&e.message)||e),'err');
  }
};
`;

const OLD_ARCHIVE_PACKAGE_TEXT = `    <p class="desc" style="border:1px solid #cfe0d4;background:#f2f9f4;border-radius:8px;padding:8px 10px"><strong>Dokumentenspeicher übergeben:</strong> Kompletter Fallordner als ZIP, durchsuchbare E-Akte (PDF-Sammelmappe) und Übergabeprotokoll mit Unterschriftszeilen - <button type="button" class="ci-btn" onclick="window.__dokUebergabeDialog?window.__dokUebergabeDialog():alert('Bitte zuerst das Dokumente-Modul einmal öffnen (Online-Modus).')">Übergabepaket erstellen …</button></p>`;
const NEW_ARCHIVE_PACKAGE_TEXT = `    <p class="desc" style="border:1px solid #cfe0d4;background:#f2f9f4;border-radius:8px;padding:8px 10px"><strong>Dokumentenspeicher übergeben:</strong> Ein vollständiges Fallübergabe-ZIP mit allen Dokumenten, Falldaten, Inhaltsverzeichnis-PDF, Übergabeprotokoll und Prüfsummenliste - <button type="button" class="ci-btn" onclick="window.__dokUebergabeDialog?window.__dokUebergabeDialog():alert('Bitte zuerst das Dokumente-Modul einmal öffnen (Online-Modus).')">Übergabepaket erstellen …</button></p>`;

const OLD_HANDOVER_DIALOG = between(
  backup,
  '/* Uebergabepaket (Fallabschluss): ZIP + E-Akte + Uebergabeprotokoll aus einem Dialog */',
  'function ueFallDaten(){',
  'Explorer-Übergabedialog'
);
const NEW_HANDOVER_DIALOG = `/* Vollständiges Fallübergabepaket nach § 1872 BGB aus einem serverseitigen Lauf. */
window.__dokUebergabeDialog=async function(){
  if(!D.faelle||!D.faelle.length){try{var res=await fetch('/api/cases',{credentials:'same-origin'});var j=await res.json();D.faelle=(j.cases||[]).map(function(c){return {id:c.id,label:c.label||c.id,archived:!!c.archived};});}catch(_e){D.faelle=D.faelle||[];}}
  var vor=String(window.__activeServerCaseId||'');
  var opts=D.faelle.filter(fallSichtbar).map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===vor?' selected':'')+'>'+esc(c.label)+(c.archived?' (Archiv)':'')+'</option>';}).join('');
  d8Dlg('<h3>Vollständiges Übergabepaket (§ 1872 BGB)</h3>'
    +'<p class="unter">Ein ZIP enthält sämtliche Dokumente der Fallakte in ihrer Ordnerstruktur, Falldaten, Inhaltsverzeichnis-PDF, Übergabeprotokoll und SHA-256-Prüfsummen. Fehlt eine verzeichnete Datei, wird kein unvollständiges Paket ausgegeben.</p>'
    +'<div class="dok-karte"><b>Fallakte</b><br><select id="dokUeFall" style="margin-top:4px;max-width:100%">'+opts+'</select><div id="dokUeStatus" style="margin-top:8px"></div></div>'
    +'<div class="dok-dlg-fuss">'
    +'<button class="dok-btn pri" onclick="__dok.ueKomplett()">Vollständiges Übergabepaket herunterladen</button>'
    +'<button class="dok-btn" onclick="__dok.d8Zu()">Schließen</button></div>');
};
`;

const OLD_HANDOVER_ACTIONS = between(
  backup,
  "__dok.ueZip=function(){",
  '__dok.ueProtokoll=async function(){',
  'Explorer-Übergabedownload'
);
const NEW_HANDOVER_ACTIONS = `__dok.ueKomplett=async function(){
  var f=ueFallDaten(),z=el('dokUeStatus');if(!f.cid)return;
  if(z)z.innerHTML='<div class="dok-lade">Vollständigkeit wird geprüft und Paket wird erstellt …</div>';
  try{
    var r=await fetch('/api/documents/falluebergabe-zip?caseId='+encodeURIComponent(f.cid),{credentials:'same-origin'});
    if(!r.ok){
      var d={};try{d=await r.json();}catch(_json){}
      var fehlt=Array.isArray(d.missing)?d.missing:[];
      var li=fehlt.slice(0,20).map(function(x){return '<li>'+esc(String(x.path||x.name||x.fileId||'unbekannte Datei'))+'</li>';}).join('');
      if(z)z.innerHTML='<p style="color:#a63a3a;margin:0"><b>'+esc(d.error||('Paket fehlgeschlagen (HTTP '+r.status+').'))+'</b></p>'
        +(li?'<ul style="color:#a63a3a;margin:6px 0 0 18px;padding:0">'+li+'</ul>':'')
        +(fehlt.length>20?'<p class="unter">… '+(fehlt.length-20)+' weitere fehlende Dateien.</p>':'');
      return;
    }
    var blob=await r.blob(),dispo=String(r.headers.get('Content-Disposition')||'');
    var m=/filename\\*=UTF-8''([^;]+)/i.exec(dispo),name='Falluebergabe_'+String(f.label||'Fall').replace(/[^A-Za-z0-9ÄÖÜäöüß _-]/g,'')+'.zip';
    if(m){try{name=decodeURIComponent(m[1]);}catch(_e){}}
    var url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();
    setTimeout(function(){try{URL.revokeObjectURL(url);a.remove();}catch(_e){}},4000);
    var n=r.headers.get('X-Handover-Documents')||'';
    if(z)z.innerHTML='<p style="color:#2c7a46;margin:0"><b>Vollständiges Paket erstellt'+(n?(' · '+esc(n)+' Dokument(e)'):'')+'.</b></p>';
    T('Vollständiges Übergabepaket heruntergeladen.');
  }catch(e){
    if(z)z.innerHTML='<p style="color:#a63a3a;margin:0"><b>'+esc(String((e&&e.message)||e))+'</b></p>';
  }
};
__dok.ueZip=__dok.ueKomplett;
`;

const changes = [
  { name: 'Einstellungen-Konfiguration', alt: OLD_SETTINGS_HEAD, neu: NEW_SETTINGS_HEAD },
  { name: 'Speicherort-Karte', alt: OLD_STORAGE_CARD, neu: NEW_STORAGE_CARD },
  { name: 'Gesamtsicherung-Erklärung', alt: OLD_BACKUP_TEXT, neu: NEW_BACKUP_TEXT },
  { name: 'Bestandswartungs-Karte', alt: OLD_MODULE_CARD, neu: NEW_MODULE_CARD },
  { name: 'Bestandswartung-Laden', alt: OLD_SETTINGS_CALLS, neu: NEW_SETTINGS_CALLS },
  { name: 'Bestandswartungs-Funktionen', alt: OLD_MAINTENANCE_FUNCTIONS, neu: NEW_MAINTENANCE_FUNCTIONS },
  { name: 'Backup-Zieltext', alt: OLD_BACKUP_TARGET_TEXT, neu: NEW_BACKUP_TARGET_TEXT },
  { name: 'Backup-Formular', alt: OLD_BACKUP_FORM, neu: NEW_BACKUP_FORM },
  { name: 'Backup-Feldwechsel', alt: OLD_BACKUP_FIELDS, neu: NEW_BACKUP_FIELDS },
  { name: 'Backup-Anlage', alt: OLD_BACKUP_CREATE, neu: NEW_BACKUP_CREATE },
  { name: 'Speicherort-Speichern', alt: OLD_CONFIG_SAVE, neu: NEW_CONFIG_SAVE },
  { name: 'Fallabschluss-Paketansicht', alt: OLD_OUTTAKE_PACKAGE, neu: NEW_OUTTAKE_PACKAGE },
  { name: 'Fallabschluss-Paketdownload', alt: OLD_OUTTAKE_DOWNLOAD, neu: NEW_OUTTAKE_DOWNLOAD },
  { name: 'Archivierungs-Pakettext', alt: OLD_ARCHIVE_PACKAGE_TEXT, neu: NEW_ARCHIVE_PACKAGE_TEXT },
  { name: 'Explorer-Übergabedialog', alt: OLD_HANDOVER_DIALOG, neu: NEW_HANDOVER_DIALOG },
  { name: 'Explorer-Übergabedownload', alt: OLD_HANDOVER_ACTIONS, neu: NEW_HANDOVER_ACTIONS }
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
  assert.equal(blocks.length, EXPECTED_SCRIPT_COUNT, `${label}: Scriptblockzahl ${blocks.length}/${EXPECTED_SCRIPT_COUNT}`);
  const failures = [];
  let javascriptBlocks = 0;
  blocks.forEach((block, index) => {
    if (/\btype\s*=/i.test(block.attributes)) return;
    javascriptBlocks++;
    try { new vm.Script(block.body, { filename: `${label}-script-${index + 1}.js` }); }
    catch (error) { failures.push({ index: index + 1, message: error.message }); }
  });
  assert.deepEqual(failures, [], `${label}: JavaScript-Syntaxfehler: ${JSON.stringify(failures)}`);
  assert.ok(javascriptBlocks > 0, `${label}: keine JavaScript-Blöcke gefunden`);
  return { blocks: blocks.length, javascriptBlocks };
}

if (mode === 'pre') {
  assert.equal(Buffer.compare(currentBuffer, backupBuffer), 0, 'App-Datei stimmt vor dem Schreiben nicht vollständig mit der Sicherung überein.');
  assert.equal(fs.statSync(htmlPath).mtimeMs, fs.statSync(backupPath).mtimeMs, 'mtime der Sicherung stimmt nicht mit der Quelle überein.');
  scripts(backup, 'Sicherung');
  let candidate = current;
  for (const change of changes) candidate = ers(candidate, change.alt, change.neu, change.name, 'pre');
  scripts(candidate, 'Kandidat');
  console.log(JSON.stringify({
    mode,
    sourceSha256: sha256(currentBuffer),
    candidateSha256: sha256(Buffer.from(candidate)),
    bytes: currentBuffer.length,
    candidateBytes: Buffer.byteLength(candidate),
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
