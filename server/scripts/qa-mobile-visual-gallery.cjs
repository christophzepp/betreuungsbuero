'use strict';

// Offline review artifact: no API calls, only existing local screenshots.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/analysen/mobile-sichtabgleich-v1');
const manifestPath = path.join(out, 'vergleichsdaten.json');
const modules = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const notes = {
  start: 'Der Startkopf und die Karten wurden angeglichen. Die fünf echten Kennzahlen und alle 30 Schnellaktionen bleiben erhalten; die Beispieldaten des Mockups werden nicht als neue Funktionen übernommen.',
  'case-chat': 'Der doppelte Kopf entfällt. Eingabe und Werkzeuge nutzen die volle Breite; die Auswahl einer Besprechung schließt die Gesprächsliste. Die Hauptansicht zeigt jetzt die Liste, die frühere Aufnahme ein Gespräch. Nachrichten lassen sich unter „Details“ vergleichen.',
  'master-data': 'Der aktuelle Fall erscheint als Identitätskopf. Alle vorhandenen Stammdatenbereiche und ihre echten Eingabefelder bleiben erreichbar. Die Detailaufnahme zeigt die bestehende Bearbeitung, das Mockup eine vereinfachte Leseansicht.',
  'case-overview': 'Verlauf, Wiedervorlagen und Schnellaktionen sind direkt erreichbar. Die Schnellnotiz verwendet den ganzen Arbeitsbereich mit festen Aktionen. Alle 30 bestehenden Schnellaktionen bleiben verfügbar.',
  documentation: 'Die bestehende mobile Dokumentation bleibt die Gestaltungsreferenz. Der reale Wochenkalender ist zusätzlich zur vereinfachten Mockup-Liste erhalten. Die ältere Formularaufnahme zeigt einen anderen Scrollstand.',
  calendar: 'Kopf, Reiter, Filter und Formular wurden abgeglichen. Datum und Heute-Navigation stehen kompakt in einer Zeile. Die echten Kalenderansichten, Serienfelder und weiteren Terminaktionen bleiben erhalten.',
  tasks: 'Kopf, Reiter, Filterblatt, Details und feste Formularaktionen sind angeglichen. Wie vereinbart bleiben die vorhandenen Fall- und Listenzuordnungen erhalten; das Mockup-Feld „Zuständig“ erzeugt keine neue Mitarbeiterzuordnung.',
  deadlines: 'Listen, Filter, Details und Formular wurden verglichen. Gemeinsame Kopfzeile, größere Filterfelder und ruhigere Detailaktionen gleichen den Stil an; fachliche Frist- und Wiedervorlagefelder bleiben erhalten.',
  followups: 'Die Liste, Detailansicht und Eingabe verwenden die gemeinsamen Kopf-, Reiter- und Aktionsstile. Die tatsächlichen Termin-, Fall- und Statusangaben bleiben vollständig sichtbar bzw. erreichbar.',
  contacts: 'Die zuvor schräg bzw. zu schmal angeordneten Filterfelder nutzen die volle Breite. Auswahlfunktionen und alle tatsächlichen Kontaktfelder bleiben neben dem angeglichenen Listen- und Detailstil verfügbar.',
  mail: 'Nachrichtenliste, Filter, Nachricht und Verfassen wurden abgeglichen. Ordner, Anlagen und zusätzliche Mailaktionen bleiben im echten Arbeitsablauf erreichbar; die Beispielnachrichten unterscheiden sich vom Mockup.',
  documents: 'Dateiliste, Filter, Details und Upload wurden abgeglichen. Kopf- und Detailaktionen sind angeglichen; die vorhandenen Datei-, Ordner-, Auswahl- und Uploadfunktionen bleiben erhalten.',
  'case-archive': 'Archivdetails zeigen zunächst lesbaren Inhalt; Bearbeiten bleibt ein eigener Schritt. Doppelte Werkzeugleisten und leere Angabenblöcke entfallen. Die Formularaufnahme zeigt das ebenfalls geprüfte Büroarchiv.',
  'send-history': 'Die Historie nutzt den gemeinsamen Detailkopf und erreichbare Eintragsaktionen. Der Filter hat größere Felder und eine feste Anwenden-Aktion. Die ursprünglichen Versanddaten und Versandbestätigungen bleiben erhalten.',
  banking: 'Umsätze, Filter, Details und Überweisung wurden verglichen. Der klar beschriftete Überweisungszugang und die echte Kontoauswahl bleiben erhalten; echte Finanzaktionen werden nicht auf fiktive Mockup-Aktionen reduziert.',
  cash: 'Kassenliste, Filter, Buchungsdetails und Formular sind abgeglichen. Kennzahlen, Typografie und Detailaktionen wurden angeglichen; Bestand, Buchungen und vorhandene Belegfunktionen bleiben erhalten.',
  assets: 'Anfangsbestand, Filter, Details und Erfassung wurden verglichen. Summen und Detailhierarchie sind deutlicher. Die tatsächlichen Vermögensarten und ihre jeweiligen Fachfelder bleiben erhalten.',
  livelihood: 'Einnahmen, Filter, Details und Formular sind abgeglichen. Die echten Beträge, Bezugszeiträume und weiteren Bereiche bleiben erhalten; Auswahl- und Gesamtsummen behalten ihre eindeutige Bedeutung.',
  debts: 'Forderungen, Filter, Details und Formular wurden verglichen. Reiter und Detailaktionen sind vereinheitlicht. Gläubiger, Forderungsdaten, Zahlungen und zusätzliche Fachaktionen bleiben erhalten.',
  health: 'Übersicht, Medikation, Termine und Notfall sind direkt erreichbar. Filter, Details und Formular wurden abgeglichen. Alle sieben Fachmasken sowie die 16 Vollmachten und Verfügungen wurden zusätzlich funktional geprüft.',
  housing: 'Alle, Verlauf, Adressen und Wohnkosten sind direkt erreichbar. Die Formularaufnahme zeigt den tatsächlichen Adressbereich; der reale Umfang von Wohn- und Adressdaten bleibt erhalten.',
  abilities: 'Alle Bereiche, Erfasst und Noch offen sind direkt erreichbar. Alle elf realen Bereiche bleiben erhalten, einschließlich der eigenen Formulare für Zusatzbereiche; das Mockup enthält nur Beispieldatensätze.',
  needs: 'Die realen sechs Eintragsarten sind über horizontal erreichbare Reiter verfügbar. Alle sechs Fachformulare bleiben erhalten. Die vereinfachten drei Mockup-Gruppen ersetzen diese Eintragsarten nicht.',
  approvals: 'Alle, Laufend und Abgeschlossen sind direkt erreichbar. Filter, Detailhierarchie und Formularaktionen sind angeglichen; Status, Wille und vorhandene Genehmigungsfelder bleiben erhalten.',
  'contact-monitor': 'Alle Fälle, Überfällig und Bald fällig sind direkt erreichbar. Personeninitialen, getrennte Metadaten und Pfeile machen die Liste leichter lesbar. Die Erfassung verwendet weiterhin die echte Kontaktdokumentation.',
  supervision: 'Aktuell und Archiv verwenden die vorhandene Fallabfrage. Personeninitialen, Metadaten und Details wurden angeglichen; Archivierung und die bestehenden zusätzlichen Aktionen bleiben erhalten.',
  inbox: 'Alle, Offen und Erledigt greifen auf die vorhandenen Bearbeitungsstände zu. Die Detailansicht behält ihre echten Eingaben und Vorschlagsaktionen. Für das Filterblatt gibt es keine gleichartige ältere Aufnahme.',
  finance: 'Laufende Posten, Filter, Details und Formular wurden verglichen. Zuvor zu kleine Filterfelder sind jetzt touchgerecht. Echte Betrags-, Zeitraum- und Zuordnungsfelder bleiben erhalten.',
  invoices: 'Liste, Filter, Rechnungsdetails und Formular sind abgeglichen. Zusätzlich behoben: Ein offener Entwurf konnte beim Wechsel auf Desktop durch fortlaufende Layoutsignale in der mobilen Hülle bleiben. Ein Regressionstest prüft den Wechsel samt Entwurfserhalt.',
  mileage: 'Fahrten, Filter, Details und Formular wurden verglichen. Filterfelder sind größer, Reiter und Betragsdarstellung angeglichen. Fahrzeuge, Nachweise und die tatsächlichen Erstattungsdaten bleiben verfügbar.',
  qualifications: 'Personen, Mit Nachweisen und Ohne Nachweis verwenden die tatsächlichen Nachweisdaten. Personeninitialen und Detailaktionen sind angeglichen; echte Personen- und Nachweisformulare bleiben erhalten.',
  user: 'Profil, echte Fallauswahl, Darstellung, Favoriten und Abmelden sind zusammengeführt. „Nachts dunkel“ verwendet die vorhandene zeitgesteuerte Einstellung; das Mockup-Wort „Automatisch“ wird nicht als neue Betriebssystemfunktion erfunden.'
};

// Keep the delivered gallery self-contained, including older scene captures.
for (const m of modules) {
  if (m.id === 'inbox') delete m.scenes.filter.before;
  for (const [scene, data] of Object.entries(m.scenes)) {
    if (data.before?.startsWith('../')) {
      const target = 'vorher/' + m.id + '-' + scene + '.png';
      fs.copyFileSync(path.join(out, data.before), path.join(out, target));
      data.before = target;
    }
  }
  for (const p of [m.before, m.after, ...Object.values(m.scenes).flatMap(s => Object.values(s)),
    ...['overview', 'detail', 'form', 'filter'].map(s => 'mockups/' + m.id + '-' + s + '.png')]) {
    if (!fs.existsSync(path.join(out, p))) throw new Error('Fehlende Aufnahme: ' + p);
  }
  if (!notes[m.id]) throw new Error('Fehlende Erläuterung: ' + m.id);
}
if (modules.length !== 32 || new Set(modules.map(m => m.id)).size !== 32) throw new Error('32 eindeutige Menüs erwartet');
fs.writeFileSync(manifestPath, JSON.stringify(modules, null, 2) + '\n');

const data = JSON.stringify(modules.map(m => ({...m, note: notes[m.id]}))).replace(/</g, '\\u003c');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>32 mobile Menüs · Sichtabgleich</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#edf2f6;color:#233240;font:15px/1.5 system-ui,-apple-system,sans-serif}header{background:#163952;color:white;padding:24px max(20px,calc((100vw - 1300px)/2))}h1{margin:0;font-size:26px}header p{margin:7px 0 0;color:#dce8ef}main{max-width:1340px;margin:auto;padding:22px 20px 44px}.controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap}.field{display:grid;gap:5px}label{font-size:12px;font-weight:700;color:#627586}select,button{border:1px solid #c4d3df;border-radius:8px;background:white;color:#20567e;font:inherit;min-height:44px;padding:8px 12px;cursor:pointer}select{min-width:200px}button:hover{background:#eaf3fa}button:disabled{opacity:.4;cursor:default}:focus-visible{outline:3px solid #3e86ba;outline-offset:3px}.count{margin-left:auto;color:#627586;font-size:13px}.note{background:white;border-left:4px solid #20567e;padding:14px 18px;margin:20px 0}.compare{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start}figure{margin:0;background:white;border:1px solid #ccd8e2;border-radius:12px;overflow:hidden}figcaption{padding:12px 16px;border-bottom:1px solid #ccd8e2;font-weight:700;display:flex;justify-content:space-between;gap:10px}figcaption small{font-weight:400;color:#627586}figure img{display:block;width:100%;height:auto}figure a{display:block}.empty{padding:40px 22px;min-height:220px;color:#627586}.legend{font-size:13px;color:#627586;margin:24px 0 14px}.more{background:white;border:1px solid #ccd8e2;border-radius:10px;padding:14px 18px;margin-top:18px}summary{cursor:pointer;font-weight:600}.refs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}.refs a{color:#20567e;text-decoration:none}.refs img{width:100%;height:280px;object-fit:contain;object-position:top;background:#edf2f6}.refs span{display:block;text-align:center;margin-top:4px}footer{margin-top:24px;font-size:13px;color:#627586}a{color:#20567e}@media(max-width:800px){.compare{gap:10px}.compare figcaption{display:block;padding:8px;font-size:12px}.compare figcaption small{display:block}.count{margin-left:0}}@media(max-width:560px){h1{font-size:22px}.compare{grid-template-columns:1fr}.compare figure{max-width:390px;width:100%;margin:auto}.refs{grid-template-columns:repeat(2,1fr)}main{padding:16px 12px}.controls{gap:8px}select{min-width:0;max-width:calc(100vw - 24px)}.count{width:100%}}
</style></head><body>
<header><h1>32 mobile Menüs im Vergleich</h1><p>Mockup · bisheriger Stand · korrigierte Oberfläche — Prüfung vom 8. September 2026</p></header>
<main><div class="controls"><div class="field"><label for="module">MENÜ</label><select id="module"></select></div><div class="field"><label for="scene">ANSICHT</label><select id="scene"></select></div><button id="prev" aria-label="Vorheriges Menü">←</button><button id="next" aria-label="Nächstes Menü">→</button><span id="count" class="count"></span></div>
<p id="note" class="note"></p><div id="compare" class="compare"></div>
<p class="legend">Verglichen werden Aufbau, Bedienflächen und Hierarchie. Namen, Beträge, Anzahl der Einträge und Scrollpositionen können wegen unterschiedlicher Testdaten abweichen. Alle Aufnahmen zeigen synthetische Daten. Ein Bild anklicken, um es in Originalgröße zu öffnen. „Chats“ in der korrigierten Navigation folgt dem später freigegebenen Chat-Konzept.</p>
<details class="more"><summary>Alle vier Mockup-Ansichten dieses Menüs</summary><p class="legend">Die Entwürfe enthalten teilweise vereinfachte oder beispielhafte Ansichten. Oben sind die verfügbaren Aufnahmen der tatsächlichen Arbeitsabläufe zugeordnet.</p><div class="refs" id="refs"></div></details>
<footer>32 Hauptmenüs · 128 Mockup-Referenzen · 204 bestandene Codeprüfungen · 17 erfolgreiche Browserpakete · 41 ergänzende Prüfungen. Die Browserprüfung erfolgte in Chromium mit Smartphone-Emulation, nicht auf einem physischen iPhone. <a href="../mobile-sichtabgleich-v1.md">Prüfbericht</a> · <a href="pruefergebnisse.json">Prüfergebnisse</a> · <a href="quellstand.json">Quellstand</a></footer></main>
<script>
const modules=${data};
const labels={main:'Hauptansicht',overview:'Übersicht',detail:'Details',form:'Formular',filter:'Filter'};
const menu=document.getElementById('module'),scene=document.getElementById('scene');
modules.forEach((m,i)=>menu.add(new Option(String(i+1).padStart(2,'0')+' · '+m.label,m.id)));
function figure(title,file,subtitle){const f=document.createElement('figure'),c=document.createElement('figcaption');c.append(document.createTextNode(title));const s=document.createElement('small');s.textContent=subtitle;c.append(s);f.append(c);if(file){const a=document.createElement('a');a.href=file;a.target='_blank';a.rel='noopener';const img=document.createElement('img');img.src=file;img.alt=menu.selectedOptions[0].textContent+' – '+title+' – '+scene.selectedOptions[0].textContent;a.append(img);f.append(a)}else{const p=document.createElement('p');p.className='empty';p.textContent='Für diesen Arbeitsablauf liegt keine gleichartige ältere Aufnahme vor.';f.append(p)}return f}
function render(){const m=modules.find(m=>m.id===menu.value),i=modules.indexOf(m);const s=scene.value==='main'?{mockup:'mockups/'+m.id+'-'+m.mainScene+'.png',before:m.before,after:m.after}:m.scenes[scene.value];document.getElementById('compare').replaceChildren(figure('Mockup',s.mockup,'Referenz'),figure('Vorher',s.before,'Bisheriger Bau'),figure('Korrigiert',s.after,'Geprüfter Stand'));document.getElementById('note').textContent=m.note;document.getElementById('count').textContent=(i+1)+' / 32 Menüs';document.getElementById('prev').disabled=i===0;document.getElementById('next').disabled=i===modules.length-1;const refs=document.getElementById('refs');refs.replaceChildren();for(const key of ['overview','detail','form','filter']){const a=document.createElement('a');a.href='mockups/'+m.id+'-'+key+'.png';a.target='_blank';a.rel='noopener';const img=document.createElement('img');img.src=a.href;img.alt=m.label+' – Mockup '+labels[key];img.loading='lazy';const span=document.createElement('span');span.textContent=labels[key];a.append(img,span);refs.append(a)}history.replaceState(null,'','#'+m.id+'/'+scene.value)}
function changeMenu(preferred='main'){const m=modules.find(m=>m.id===menu.value);scene.replaceChildren();for(const key of ['main',...Object.keys(m.scenes)])scene.add(new Option(labels[key],key));scene.value=[...scene.options].some(o=>o.value===preferred)?preferred:'main';render()}
menu.addEventListener('change',()=>changeMenu());scene.addEventListener('change',render);document.getElementById('prev').addEventListener('click',()=>{menu.selectedIndex--;changeMenu()});document.getElementById('next').addEventListener('click',()=>{menu.selectedIndex++;changeMenu()});const initial=location.hash.slice(1).split('/');if(modules.some(m=>m.id===initial[0]))menu.value=initial[0];changeMenu(initial[1]);
</script></body></html>`);
console.log('Galerie erstellt: 32 Menüs; ' + modules.reduce((n, m) => n + Object.keys(m.scenes).length, 0) + ' zusätzliche Szenenzuordnungen; alle Bilddateien vorhanden.');
