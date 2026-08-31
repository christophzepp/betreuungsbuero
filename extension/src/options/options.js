// Options-Seite (Plan Abschnitt BR, Phasen E1/E5+): Server-URL + API-Token, lokale Faelle
// (Datensicherung.json-Import), Addon-Backup (Export/Import OHNE Token) und die lokale
// Ausfuellprotokoll-Historie inkl. nachtraeglichem PDF-Download.
/* global BX, BxaApi, BxaPdf */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

async function saveAndCheck() {
  const serverUrl = $('serverUrl').value.trim().replace(/\/+$/, '');
  const apiToken = $('apiToken').value.trim();
  await BX.storage.local.set({ serverUrl, apiToken });
  $('connResult').textContent = 'Prüfe Verbindung…';
  try {
    const hs = await BxaApi.handshake();
    const check = await BxaApi.tokenCheck();
    $('connResult').textContent = `✓ Verbunden als ${check.user.displayName || check.user.username} (Server-API-Level ${hs.apiLevel}). Rechte: Fallansicht ${check.permissions.viewCases ? 'ja' : 'NEIN'}, Fallbearbeitung ${check.permissions.editCases ? 'ja' : 'nein'}.`;
  } catch (e) {
    $('connResult').textContent = '✗ ' + String(e.message || e);
  }
}

async function grantHost() {
  const serverUrl = $('serverUrl').value.trim().replace(/\/+$/, '');
  if (!serverUrl) { toast('Bitte zuerst die Server-URL eintragen.'); return; }
  try {
    const origin = new URL(serverUrl).origin + '/*';
    const granted = await BX.permissions.request({ origins: [origin] });
    toast(granted ? 'Zugriff erlaubt: ' + origin : 'Zugriff nicht erteilt.');
  } catch (e) { toast('Ungültige URL: ' + String(e.message || e)); }
}

// ===== Lokale Faelle (Datensicherung.json) =====

async function renderLocalCases() {
  const s = await BX.storage.local.get(['localCases', 'selectedCaseId']);
  let changed = false;
  const cases = (Array.isArray(s.localCases) ? s.localCases : []).map((entry) => {
    if (entry && entry.id) return entry;
    changed = true;
    return { ...(entry || {}), id: newLocalCaseId() };
  });
  let selectedCaseId = s.selectedCaseId || '';
  const oldLocalIndex = /^loc:(\d+)$/.exec(selectedCaseId);
  if (oldLocalIndex && cases[Number(oldLocalIndex[1])]) {
    selectedCaseId = 'loc:' + cases[Number(oldLocalIndex[1])].id;
    changed = true;
  }
  if (changed) await BX.storage.local.set({ localCases: cases, selectedCaseId });
  $('localCasesList').innerHTML = cases.length
    ? cases.map(c => `<div class="t"><span><b>${esc(c.label)}</b> <span class="hint">(importiert ${esc(c.importedAt || '')})</span></span><button data-id="${esc(c.id)}">löschen</button></div>`).join('')
    : '<div class="hint">Keine lokalen Fälle importiert.</div>';
  $('localCasesList').querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
    const current = await BX.storage.local.get(['localCases', 'selectedCaseId']);
    const list = Array.isArray(current.localCases) ? current.localCases : [];
    const index = list.findIndex(entry => String(entry.id) === String(b.dataset.id));
    if (index < 0) { toast('Der lokale Fall wurde bereits geändert. Bitte Liste neu laden.'); await renderLocalCases(); return; }
    const removed = list.splice(index, 1)[0];
    const update = { localCases: list };
    if (removed?.id && current.selectedCaseId === 'loc:' + removed.id) update.selectedCaseId = '';
    await BX.storage.local.set(update);
    renderLocalCases();
  }));
}

async function importLocalCase(file) {
  try {
    const obj = JSON.parse(await file.text());
    // Validierung exakt wie importProject() der App: eine Datensicherung traegt caseData + reports.
    if (!obj || !obj.caseData || !obj.reports) throw new Error('Keine gültige Datensicherung.json (caseData/reports fehlen).');
    const p = obj.caseData.person || {};
    const label = [p.lastName, p.firstName].filter(Boolean).join(', ') || file.name.replace(/\.json$/i, '');
    const s = await BX.storage.local.get(['localCases']);
    const list = s.localCases || [];
    const entry = {
      id: newLocalCaseId(),
      label,
      importedAt: new Date().toLocaleDateString('de-DE'),
      fileNumber: String(obj.caseData?.care?.fileNumber || ''),
      caseData: obj.caseData,
      contacts: Array.isArray(obj.caseData.contacts) ? obj.caseData.contacts : [],
      reports: obj.reports && typeof obj.reports === 'object' ? obj.reports : {},
      documentationEntries: Array.isArray(obj.caseData.documentationEntries) ? obj.caseData.documentationEntries : [],
      officeProfile: obj.officeProfile && typeof obj.officeProfile === 'object' ? obj.officeProfile : {},
      officeBankAccounts: Array.isArray(obj.officeBankAccounts) ? obj.officeBankAccounts : [],
      officeEmployees: Array.isArray(obj.officeEmployees) ? obj.officeEmployees : []
    };
    const existing = list.findIndex(c => c.label === label);
    if (existing >= 0) {
      // Gleicher Name heisst NICHT gleicher Fall - Ueberschreiben nur mit ausdruecklicher
      // Bestaetigung, sonst als zusaetzlicher Eintrag anlegen (Audit 2026-07-18).
      if (confirm('Ein lokaler Fall „' + label + '" existiert bereits.\n\nOK = vorhandenen Eintrag ERSETZEN\nAbbrechen = als zusätzlichen Eintrag anlegen')) {
        entry.id = list[existing].id || entry.id;
        list[existing] = entry;
      } else {
        let n = 2;
        while (list.some(c => c.label === label + ' (' + n + ')')) n++;
        entry.label = label + ' (' + n + ')';
        list.push(entry);
      }
    } else list.push(entry);
    await BX.storage.local.set({ localCases: list });
    toast('Fall importiert: ' + entry.label);
    renderLocalCases();
  } catch (e) { toast('Import: ' + String(e.message || e)); }
}

function newLocalCaseId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (_e) { /* Fallback */ }
  return 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ===== Addon-Backup (Nutzeranforderung: lokale Speicherung/Backup der Adon-Daten) =====

const BACKUP_KEYS = ['serverUrl', 'localCases', 'localProfiles', 'profileCache', 'protocolHistory', 'selectedCaseId'];

async function backupExport() {
  const data = await BX.storage.local.get(BACKUP_KEYS);
  const backup = {
    kind: 'betreuungsbuero-formular-assistent-backup', version: 1,
    exportedAt: new Date().toISOString(),
    // Bewusst OHNE apiToken: das Token ist ein Geheimnis und laesst sich in der App jederzeit
    // neu erzeugen - ein Backup-File soll gefahrlos ablegbar/weitergebbar sein.
    data
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `FormularAssistent_Backup_${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('Backup exportiert (ohne API-Token).');
}

async function backupImport(file) {
  try {
    const obj = JSON.parse(await file.text());
    if (obj?.kind !== 'betreuungsbuero-formular-assistent-backup' || !obj.data) throw new Error('Keine gültige Backup-Datei dieser Erweiterung.');
    // Nur bekannte Schluessel in erwarteter Form uebernehmen (Audit 2026-07-18): eine praeparierte
    // Datei darf weder apiToken & Co. austauschen noch mit kaputten Formen (protocolHistory als
    // Objekt, optTab-Fantasiewert) Panel/Options lahmlegen.
    const data = {};
    for (const k of BACKUP_KEYS) if (k in obj.data) data[k] = obj.data[k];
    for (const k of ['localCases', 'localProfiles', 'profileCache', 'protocolHistory']) {
      if (k in data && !Array.isArray(data[k])) delete data[k];
    }
    for (const k of ['serverUrl', 'selectedCaseId']) {
      if (k in data && typeof data[k] !== 'string') delete data[k];
    }
    if (!Object.keys(data).length) throw new Error('Backup enthält keine verwertbaren Daten.');
    await BX.storage.local.set(data);
    toast('Backup importiert. (API-Token ggf. neu eintragen.)');
    await init();
  } catch (e) { toast('Backup-Import: ' + String(e.message || e)); }
}

async function wipeAll() {
  if (!confirm('Wirklich ALLE Erweiterungs-Daten löschen (Einstellungen, Token, lokale Fälle, Profile, Protokolle)?')) return;
  await BX.storage.local.clear();
  toast('Alle Daten gelöscht.');
  await init();
}

// ===== Protokoll-Historie =====

async function renderProtocols() {
  const s = await BX.storage.local.get(['protocolHistory']);
  const hist = Array.isArray(s.protocolHistory) ? s.protocolHistory : [];
  $('protocolList').innerHTML = hist.length
    ? hist.slice(0, 30).map((p, i) => `<div class="t"><span><b>${esc(p.title || p.url)}</b> <span class="hint">${esc(new Date(p.ts).toLocaleString('de-DE'))} · ${esc(p.caseLabel || '')} · ${(p.fields || []).length} Felder</span></span><span><button data-pdf="${i}">PDF</button> <button data-del="${i}">löschen</button></span></div>`).join('')
    : '<div class="hint">Noch keine Ausfüllprotokolle.</div>';
  $('protocolList').querySelectorAll('button[data-pdf]').forEach(b => b.addEventListener('click', async () => {
    const hist2 = (await BX.storage.local.get(['protocolHistory'])).protocolHistory || [];
    const pr = hist2[Number(b.dataset.pdf)];
    if (!pr) return;
    const bytes = BxaPdf.buildProtocolPdf({
      title: 'Ausfüllprotokoll Online-Formular',
      meta: [['Webseite', pr.title || '-'], ['Adresse', pr.url], ['Fall', pr.caseLabel || '-'], ['Zeitpunkt', new Date(pr.ts).toLocaleString('de-DE')]],
      fields: (pr.fields || []).map(f => [f.label, f.value]),
      actions: pr.actions || [],
      footer: 'Hinweis: Dieses Protokoll dokumentiert die von der Erweiterung eingetragenen Werte.'
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    a.download = 'Ausfuellprotokoll.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }));
  $('protocolList').querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', async () => {
    const hist2 = (await BX.storage.local.get(['protocolHistory'])).protocolHistory || [];
    hist2.splice(Number(b.dataset.del), 1);
    await BX.storage.local.set({ protocolHistory: hist2 });
    renderProtocols();
  }));
}

// ===== Angelernte Formulare (Site-Profile, bueroweit ueber den Server /api/ext/site-profiles) =====

let SP = [];
const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
function spFind(id) { return SP.find(p => p.id === id); }

// Auf-/Zuklapp-Zustand je Profil-Id + Filtertext (Nutzerwunsch 2026-07-17: klappbar, filterbar,
// Liste scrollbar). Karten starten ZUgeklappt - bei 12+ Formularen bleibt die Liste sonst unlesbar.
const SPOpen = new Set();
let spFilterQ = '';
let spError = '';           // Ladefehler-Text: bleibt sichtbar, bis ein Laden gelingt
let spSkipHarvestOnce = false; // nach frischem Server-Laden nicht vom alten DOM ernten

// Ungespeicherte DOM-Eingaben (Name/URL-Muster) VOR jedem Neu-Rendern ins SP-Modell uebernehmen
// (Audit 2026-07-18): sonst verwarf jeder Filter-Tastendruck/Karten-Toggle stille Edits -
// persistiert wird weiterhin erst durch "Speichern".
function spHarvest() {
  document.querySelectorAll('#siteProfilesList .sp-card').forEach(card => {
    const p = spFind(card.getAttribute('data-sp'));
    if (!p) return;
    const name = card.querySelector('.sp-name');
    if (name) p.name = name.value;
    const pats = card.querySelector('.sp-pats');
    if (pats) {
      p.mapping = p.mapping || {};
      p.mapping.urlPatterns = pats.value.split('\n').map(s => s.trim()).filter(Boolean);
    }
  });
}

function spCard(p) {
  const m = p.mapping || {};
  const pats = ((m.urlPatterns && m.urlPatterns.length) ? m.urlPatterns : [p.urlPattern]).filter(Boolean);
  const fields = m.fields || [];
  const acts = m.actions || [];
  const open = SPOpen.has(p.id);
  const chips = fields.length
    ? fields.map((f, i) => `<span class="sp-chip"><code>${esc(f.key || '?')}</code><button class="sp-x" data-sp-delfield="${esc(p.id)}" data-fi="${i}" title="Zuordnung entfernen">×</button></span>`).join('')
    : '<span class="hint">Keine Feld-Zuordnungen.</span>';
  // Nutzungsstatistik + "veraltet"-Warnung (Feature v0.2.0 #11).
  const st = p.stats || {};
  const staleChip = st.stale ? ' <span class="sp-stale" title="Bei den letzten Anwendungen wurden viele Felder nicht gefunden – die Website hat sich vermutlich geändert. Bitte über „Training“ im Side Panel neu erfassen.">⚠ möglicherweise veraltet</span>' : '';
  const usageChip = st.applyCount ? ` <span class="hint">· ${st.applyCount}× angewendet</span>` : '';
  const body = !open ? '' : `
    <textarea class="sp-pats" rows="${Math.max(1, pats.length)}" placeholder="URL-Muster (eines pro Zeile)">${esc(pats.join('\n'))}</textarea>
    <div class="sp-fields">${chips}</div>
    <div class="row wrap"><button class="light sp-save" data-sp-save="${esc(p.id)}">Speichern</button>${p.updatedAt ? ('<span class="hint">zuletzt geändert ' + esc(p.updatedAt) + (p.updatedBy ? (' · ' + esc(p.updatedBy)) : '') + '</span>') : ''}</div>`;
  return `<div class="sp-card" data-sp="${esc(p.id)}">
    <div class="sp-head"><button class="sp-toggle" data-sp-toggle="${esc(p.id)}" title="auf-/zuklappen">${open ? '▾' : '▸'}</button><input class="sp-name" value="${esc(p.name || '')}" placeholder="Formular-Name"><span class="hint">${fields.length} Feld(er)${acts.length ? (' · ' + acts.length + ' Aktion(en)') : ''}${usageChip}</span>${staleChip}<button class="danger sp-del" data-sp-del="${esc(p.id)}">Löschen</button></div>
    ${body}
  </div>`;
}

function spVisible() {
  const q = spFilterQ.trim().toLowerCase();
  if (!q) return SP;
  return SP.filter(p => {
    const m = p.mapping || {};
    const hay = (p.name || '') + ' ' + ((m.urlPatterns || [p.urlPattern]).filter(Boolean).join(' '));
    return hay.toLowerCase().includes(q);
  });
}

function spPaint() {
  const box = $('siteProfilesList');
  // Ladefehler nicht durch Filter-/Klapp-Interaktionen mit veralteten oder irrefuehrenden
  // Inhalten uebermalen (Audit 2026-07-18).
  if (spError) { box.innerHTML = '<div class="hint">' + esc(spError) + '</div>'; return; }
  if (spSkipHarvestOnce) spSkipHarvestOnce = false; else spHarvest();
  if (!SP.length) { box.innerHTML = '<div class="hint">Noch keine Formulare angelernt. Formulare entstehen über „Training" im Side Panel auf der jeweiligen Behörden-Webseite.</div>'; return; }
  const vis = spVisible();
  box.innerHTML = vis.map(spCard).join('') || '<div class="hint">Kein Formular passt zum Filter.</div>';
  box.querySelectorAll('[data-sp-toggle]').forEach(b => b.addEventListener('click', () => {
    const id = b.getAttribute('data-sp-toggle');
    if (SPOpen.has(id)) SPOpen.delete(id); else SPOpen.add(id);
    spPaint();
  }));
  box.querySelectorAll('[data-sp-del]').forEach(b => b.addEventListener('click', () => spDelete(b.getAttribute('data-sp-del'))));
  box.querySelectorAll('[data-sp-save]').forEach(b => b.addEventListener('click', () => spSave(b.getAttribute('data-sp-save'))));
  box.querySelectorAll('[data-sp-delfield]').forEach(b => b.addEventListener('click', () => spRemoveField(b.getAttribute('data-sp-delfield'), Number(b.getAttribute('data-fi')))));
}

// Filter + Sammel-Auf/Zu + Einstellungs-Tabs (script laeuft am Body-Ende, DOM steht bereits).
(() => {
  const f = $('spFilter');
  if (f) f.addEventListener('input', () => { spFilterQ = f.value || ''; spPaint(); });
  const ao = $('spAllOpen'), ac = $('spAllClose');
  if (ao) ao.addEventListener('click', () => { spVisible().forEach(p => SPOpen.add(p.id)); spPaint(); });
  if (ac) ac.addEventListener('click', () => { SPOpen.clear(); spPaint(); });
  const tabs = $('optTabs');
  if (tabs) {
    const show = (name) => {
      tabs.querySelectorAll('button[data-tab]').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === name));
      document.querySelectorAll('section[data-opttab]').forEach(s => s.classList.toggle('active', s.getAttribute('data-opttab') === name));
      try { BX.storage.local.set({ optTab: name }); } catch (_e) { /* Merken ist optional */ }
    };
    tabs.querySelectorAll('button[data-tab]').forEach(b => b.addEventListener('click', () => show(b.getAttribute('data-tab'))));
    // zuletzt aktiven Tab wiederherstellen - nur wenn es ihn (noch) gibt, sonst blendete ein
    // unbekannter Wert ALLE Sektionen aus (Audit 2026-07-18).
    try { BX.storage.local.get(['optTab']).then(s => { if (s && s.optTab && tabs.querySelector('button[data-tab="' + cssEsc(s.optTab) + '"]')) show(s.optTab); }); } catch (_e) { /* Standard-Tab bleibt */ }
  }
})();

async function renderSiteProfiles() {
  const box = $('siteProfilesList');
  box.innerHTML = '<div class="hint">Lädt …</div>';
  try {
    SP = (await BxaApi.siteProfiles()).profiles || [];
    spError = '';
    spSkipHarvestOnce = true; // frisch vom Server - nicht vom alten DOM ernten
  } catch (e) {
    // SP leeren + Fehler merken: spPaint zeigt dann DIESEN Text statt einer veralteten Liste.
    SP = [];
    spError = 'Nur mit verbundenem Server verfügbar (Server-URL + Token oben eintragen und „Speichern & verbinden"). ' + String(e.message || e);
    box.innerHTML = '<div class="hint">' + esc(spError) + '</div>';
    return;
  }
  spPaint();
}

function spRemoveField(id, fi) {
  const p = spFind(id); if (!p || !p.mapping || !Array.isArray(p.mapping.fields)) return;
  p.mapping.fields.splice(fi, 1); // lokal; erst „Speichern" persistiert
  spPaint();
}
async function spSave(id) {
  const p = spFind(id); if (!p) return;
  const card = document.querySelector('[data-sp="' + cssEsc(id) + '"]'); if (!card) return;
  const name = card.querySelector('.sp-name').value.trim();
  const pats = card.querySelector('.sp-pats').value.split('\n').map(s => s.trim()).filter(Boolean);
  const mapping = Object.assign({}, p.mapping, { urlPatterns: pats, fields: (p.mapping && p.mapping.fields) || [] });
  try { await BxaApi.siteProfileSave({ id, name, urlPattern: pats[0] || p.urlPattern, mapping }); toast('Formular gespeichert.'); await renderSiteProfiles(); }
  catch (e) { toast('Speichern: ' + String(e.message || e)); }
}
async function spDelete(id) {
  const p = spFind(id); if (!p) return;
  if (!confirm('Formular „' + (p.name || id) + '" wirklich löschen? Die Zuordnungen gehen verloren (die Website bleibt unverändert).')) return;
  try { await BxaApi.siteProfileDelete(id); toast('Formular gelöscht.'); await renderSiteProfiles(); }
  catch (e) { toast('Löschen: ' + String(e.message || e)); }
}

async function init() {
  const s = await BX.storage.local.get(['serverUrl', 'apiToken']);
  $('serverUrl').value = s.serverUrl || '';
  $('apiToken').value = s.apiToken || '';
  // Jeder Renderer einzeln abgesichert (Audit 2026-07-18): EIN defekter Datensatz darf nicht
  // den restlichen Seitenaufbau abbrechen (sonst blieb z. B. der Formulare-Tab dauerhaft leer).
  try { await renderLocalCases(); } catch (e) { console.error('Lokale Fälle:', e); }
  try { await renderProtocols(); } catch (e) { console.error('Protokolle:', e); }
  try { await renderSiteProfiles(); } catch (e) { console.error('Formulare:', e); }
}

document.addEventListener('DOMContentLoaded', () => {
  $('btnSave').addEventListener('click', saveAndCheck);
  $('btnGrant').addEventListener('click', grantHost);
  $('localCaseFile').addEventListener('change', (e) => { if (e.target.files[0]) importLocalCase(e.target.files[0]); e.target.value = ''; });
  $('btnBackupExport').addEventListener('click', backupExport);
  $('btnBackupImport').addEventListener('click', () => $('backupFile').click());
  $('backupFile').addEventListener('change', (e) => { if (e.target.files[0]) backupImport(e.target.files[0]); e.target.value = ''; });
  $('btnWipe').addEventListener('click', wipeAll);
  $('btnReloadProfiles').addEventListener('click', renderSiteProfiles);
  init();
});
