// Panel-Logik (Plan Abschnitt BR, Phasen E2-E6): Fallauswahl, Scan+Heuristik, Prüfliste,
// Site-Profile inkl. Aktions-Buttons (Training), KI-Feldzuordnung/-Chat, Agent mit harter
// Submit-Sperre, Ausfuellprotokoll (PDF + Falldokumentation). Grundsatz: NICHTS wird ohne
// die Pruefliste ausgefuellt, NICHTS je automatisch abgesendet.
/* global BX, BxaApi, BxaMatcher, BxaPdf, bxaBuildDictionary, bxaBuildActiveContactDictionary, bxaDictionaryIndex, bxaNorm */

const EXT_VERSION = (BX.runtime.getManifest && BX.runtime.getManifest().version) || '0.5.0';
const SUPPORTED_API_LEVEL = 1;
// Harte Submit-Sperre (Agent + Aktions-Buttons): Muster verbindlicher Klicks.
const SUBMIT_RX = /(absenden|abschicken|senden|übermitteln|uebermitteln|beantragen|verbindlich|kostenpflichtig|bestätigen|bestaetigen|abgeben|einreichen|submit)/i;

const P = {
  handshake: null, user: null, perms: null, serverOk: false, readOnly: false,
  sourceMode: 'server', // 'server' | 'local'
  cases: [], localCases: [], caseId: '', caseLabel: '',
  filldata: null, dict: [], baseDict: [], dictIdx: new Map(),
  tabId: null, winId: null, pageInfo: null,
  descriptors: [], proposals: [],
  profiles: [], localProfiles: [], matchedProfile: null, resolvedActions: [],
  training: { active: false, fields: [], actions: [], pending: null },
  protocol: null,
  activeContact: '', uploadDocs: [], scannedUrls: new Set(), pageSeq: 0,
  attachments: [], // lokale Dateien (v0.2.1): {id,name,mime,size,base64,isText,text?,aiSend}
  agent: { running: false, stop: false, steps: 0, maxSteps: 15, lastHash: '', dupCount: 0, confirmResolve: null }
};
let attachSeq = 0;
let caseLoadSeq = 0;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ===== Verbindung / Handshake / Faelle =====

async function refreshConnection() {
  const conn = $('connStatus');
  P.serverOk = false; P.readOnly = false;
  try {
    P.handshake = await BxaApi.handshake();
    // Versions-Durchsetzung (Phase E7): inkompatible Fassade -> Banner + Read-only.
    if (P.handshake.apiLevel > SUPPORTED_API_LEVEL || cmpVer(EXT_VERSION, P.handshake.minExtensionVersion) < 0) {
      P.readOnly = true;
      $('versionBanner').textContent = 'Diese Erweiterungs-Version ist veraltet (Server verlangt mind. ' + P.handshake.minExtensionVersion + ', API-Level ' + P.handshake.apiLevel + '). Bitte Erweiterung aktualisieren – Schreibfunktionen sind deaktiviert.';
      $('versionBanner').classList.remove('hidden');
    } else {
      $('versionBanner').classList.add('hidden');
    }
    const check = await BxaApi.tokenCheck();
    P.user = check.user; P.perms = check.permissions; P.serverOk = true;
    conn.innerHTML = '<span class="punkt"></span>' + esc(check.user.displayName || check.user.username);
    conn.title = 'Mit dem Büro verbunden';
  } catch (e) {
    P.user = null; P.perms = null;
    conn.innerHTML = '<span class="punkt rot"></span>getrennt';
    conn.title = String(e.message || e);
  }
  P.aiAvailable = !!(P.serverOk && P.handshake?.features?.ai && hasExtPermission('viewCases') && hasExtPermission('useAi'));
  P.agentAvailable = !!(P.serverOk && P.handshake?.features?.agent && hasExtPermission('editCases') && hasExtPermission('useAi'));
  $('btnAiMap').classList.toggle('hidden', !P.aiAvailable);
  // KI-Tab (Umbau 2026-07-18): Bausteine nach Verfuegbarkeit zeigen; ohne beides erklaert
  // ein Hinweis den Tab statt einer leeren Seite.
  $('secAi').classList.toggle('hidden', !P.aiAvailable);
  $('secAgent').classList.toggle('hidden', !P.agentAvailable && !P.agent.running);
  const kiInfo = $('secKiInfo');
  if (kiInfo) kiInfo.classList.toggle('hidden', P.aiAvailable || P.agentAvailable);
  if (typeof renderAiFileAttach === 'function') renderAiFileAttach(); // KI-Doku-Auswahl braucht features
}
function hasExtPermission(key) {
  return !!(P.user?.isAdmin || P.perms?.[key]);
}
function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

async function loadCases() {
  const sel = $('caseSelect');
  const stored = await BX.storage.local.get(['localCases']);
  Object.assign(stored, await sitzungLesen('selectedCaseId'));
  const rawLocalCases = Array.isArray(stored.localCases) ? stored.localCases : [];
  let localCasesChanged = false;
  P.localCases = rawLocalCases.map((entry) => {
    if (entry && entry.id) return entry;
    localCasesChanged = true;
    return { ...(entry || {}), id: newLocalCaseId() };
  });
  if (localCasesChanged) await BX.storage.local.set({ localCases: P.localCases });
  P.cases = [];
  if (P.serverOk) {
    try { const response = await BxaApi.cases(); P.cases = Array.isArray(response.cases) ? response.cases : []; } catch (e) { toast(e.message); }
  }
  sel.innerHTML = '<option value="">– Fall wählen –</option>' +
    (P.cases.length ? '<optgroup label="Server">' + P.cases.map(c => `<option value="srv:${esc(c.id)}">${esc(c.label)}</option>`).join('') + '</optgroup>' : '') +
    (P.localCases.length ? '<optgroup label="Lokal (in Erweiterung)">' + P.localCases.map(c => `<option value="loc:${esc(c.id)}">${esc(c.label)}</option>`).join('') + '</optgroup>' : '');
  // Migration der frueheren indexbasierten Auswahl. Danach bleibt die Auswahl auch dann dieselbe
  // Person, wenn in den Optionen ein anderer lokaler Fall geloescht oder eingefuegt wird.
  let selectedCaseId = stored.selectedCaseId || '';
  const oldLocalIndex = /^loc:(\d+)$/.exec(selectedCaseId);
  if (oldLocalIndex && P.localCases[Number(oldLocalIndex[1])]) selectedCaseId = 'loc:' + P.localCases[Number(oldLocalIndex[1])].id;
  if (selectedCaseId && [...sel.options].some(o => o.value === selectedCaseId)) {
    sel.value = selectedCaseId;
    if (selectedCaseId !== stored.selectedCaseId) await sitzungSchreiben({ selectedCaseId });
    await onCaseChosen();
  }
  // Der Startzustand zeigt die Zahl der erreichbaren Faelle - die steht erst jetzt fest.
  updateEmptyState();
  if (document.body.dataset.ansicht === 'fallwahl') renderFallListe($('fallSuche').value);
}

function newLocalCaseId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (_e) { /* Fallback */ }
  return 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function onCaseChosen() {
  const v = $('caseSelect').value;
  const loadSeq = ++caseLoadSeq;
  resetCaseBoundState();
  await sitzungSchreiben({ selectedCaseId: v });
  if (loadSeq !== caseLoadSeq) return;
  if (!v) {
    aktualisiereKontext();
    renderCopyList('');
    populateAiFieldSelect();
    updateEmptyState();
    return;
  }
  try {
    let filldata;
    if (v.startsWith('srv:')) {
      P.sourceMode = 'server';
      P.caseId = v.slice(4);
      filldata = await BxaApi.filldata(P.caseId);
      if (loadSeq !== caseLoadSeq || $('caseSelect').value !== v) return;
      P.filldata = filldata;
      P.caseLabel = filldata.case?.label || '';
    } else {
      P.sourceMode = 'local';
      const localToken = v.slice(4);
      const lc = P.localCases.find(entry => String(entry.id) === localToken)
        || (/^\d+$/.test(localToken) ? P.localCases[Number(localToken)] : null);
      if (!lc) throw new Error('Lokaler Fall nicht mehr vorhanden. Bitte Fallliste neu laden.');
      filldata = {
        case: { id: '', label: lc.label || '', fileNumber: lc.fileNumber || '' },
        caseData: lc.caseData, contacts: lc.contacts || [], reports: lc.reports || {},
        documentationEntries: lc.documentationEntries || lc.caseData?.documentationEntries || [],
        officeProfile: lc.officeProfile || {}, officeBankAccounts: lc.officeBankAccounts || [],
        officeEmployees: lc.officeEmployees || []
      };
      P.filldata = filldata;
      P.caseLabel = lc.label;
    }
    P.baseDict = bxaBuildDictionary(P.filldata);
    P.activeContact = '';
    rebuildDict();
    aktualisiereKontext();
    populateAiFieldSelect();
    populateContactSelect();
    renderCopyList('');
    $('secCopy').classList.toggle('hidden', !P.dict.length);
  } catch (e) {
    if (loadSeq !== caseLoadSeq) return;
    resetCaseBoundState();
    aktualisiereKontext();
    toast('Falldaten: ' + e.message);
  }
  updateEmptyState();
}

// Jeder Fallwechsel ist eine harte Datenschutz- und Zustandsgrenze. Ohne diesen Reset blieb die
// Prüfliste des vorherigen Falls anklickbar und ein altes Protokoll konnte dem neuen Fall zugeordnet
// werden. Laufendes Training/Agent werden ebenfalls beendet, bevor ihre asynchronen Antworten mit
// neuen Falldaten zusammentreffen können.
function resetCaseBoundState() {
  const previousTab = P.tabId;
  if (P.training.active && previousTab != null) {
    try { const pr = BX.tabs.sendMessage(previousTab, { type: 'BXA_PICK_STOP' }); if (pr?.catch) pr.catch(() => {}); } catch (_e) { /* best effort */ }
  }
  if (P.agent.running) { P.agent.stop = true; agentConfirm(false); }
  P.filldata = null; P.baseDict = []; P.dict = []; P.dictIdx = new Map();
  P.caseId = ''; P.caseLabel = ''; P.activeContact = ''; P.uploadDocs = [];
  P.attachments = []; // temporaere Anlagen duerfen nicht unbemerkt in den naechsten Fall wandern
  P.tabId = null; P.winId = null; P.pageInfo = null; P.descriptors = []; P.proposals = [];
  P.protocol = null; P.matchedProfile = null; P.resolvedActions = [];
  P.scannedUrls = new Set(); P.pageSeq = 0; P.pageOrder = []; P.pageMemory = {};
  P.currentScanUrl = ''; P.pendingChipUrl = '';
  P.training = { active: false, fields: [], actions: [], pending: null };
  for (const id of ['secCopy', 'secReview', 'secUpload', 'secProtocol', 'secProfile', 'secTraining']) {
    const el = $(id); if (el) el.classList.add('hidden');
  }
  for (const id of ['reviewList', 'actionBar', 'requiredWarn', 'protocolInfo', 'scanInfo']) {
    const el = $(id); if (el) { el.textContent = ''; if (id === 'requiredWarn') el.classList.add('hidden'); }
  }
  const contactRow = $('rowContact'); if (contactRow) contactRow.classList.add('hidden');
  const contactSelect = $('contactSelect'); if (contactSelect) contactSelect.innerHTML = '<option value="">– kein bestimmter Kontakt –</option>';
  const pageChips = $('pageChips'); if (pageChips) { pageChips.innerHTML = ''; pageChips.classList.add('hidden'); }
  const pageBanner = $('pageChangeBanner'); if (pageBanner) pageBanner.classList.add('hidden');
  const aiResult = $('aiChatResult'); if (aiResult) aiResult.classList.add('hidden');
  const aiText = $('aiChatText'); if (aiText) aiText.value = '';
  const aiConsent = $('aiConsent'); if (aiConsent) aiConsent.checked = false;
  const agentLogBox = $('agentLog'); if (agentLogBox) agentLogBox.textContent = '';
  const uploadField = $('uploadFieldSelect'); if (uploadField) uploadField.innerHTML = '';
  const uploadDoc = $('uploadDocSelect'); if (uploadDoc) uploadDoc.innerHTML = '';
  const trainPending = $('trainPending'); if (trainPending) trainPending.classList.add('hidden');
  const trainIntro = $('secTrainIntro'); if (trainIntro) trainIntro.classList.remove('hidden');
  const reviewCount = $('reviewCount'); if (reviewCount) reviewCount.textContent = '';
  const fillCount = $('fillCount'); if (fillCount) fillCount.textContent = '0';
  const kopfZeile = $('reviewHead'); if (kopfZeile) kopfZeile.classList.add('hidden');
  const seitenZeile = $('pSeite'); if (seitenZeile) seitenZeile.classList.add('hidden');
  const wirt = $('pageHost'); if (wirt) wirt.textContent = '';
  const pChip = $('profileChip'); if (pChip) { pChip.textContent = ''; pChip.classList.add('hidden'); }
  const band = $('aufnahmeband'); if (band) band.classList.add('hidden');
  const trainSymbol = $('btnTrainingToggle'); if (trainSymbol) trainSymbol.classList.remove('an');
  if (typeof aktualisiereKontext === 'function') aktualisiereKontext();
  if ($('fileList')) renderFileList();
  if ($('aiFileAttach')) renderAiFileAttach();
}

// Aktives Dictionary = Basis-Datenwerte + (falls gewaehlt) generische Schluessel des aktiven
// Kontakts (Feature v0.2.0 #7). So koennen Kontakt-Felder eines Formulars gezielt gefuellt werden.
function rebuildDict() {
  P.dict = [...P.baseDict, ...contactDict()];
  P.dictIdx = bxaDictionaryIndex(P.dict);
}

function contactDict() {
  if (P.activeContact === '' || !P.filldata) return [];
  const c = (P.filldata.contacts || [])[Number(P.activeContact)];
  if (!c) return [];
  return bxaBuildActiveContactDictionary(c);
}

function populateContactSelect() {
  const sel = $('contactSelect');
  const contacts = (P.filldata && P.filldata.contacts) || [];
  $('rowContact').classList.toggle('hidden', !contacts.length);
  sel.innerHTML = '<option value="">– kein bestimmter Kontakt –</option>' + contacts.map((c, i) => {
    const name = [c.institution, [c.firstName || c.vorname, c.lastName || c.nachname].filter(Boolean).join(' ')].filter(Boolean).join(' – ') || ('Kontakt ' + (i + 1));
    return `<option value="${i}">${esc(name.slice(0, 60))}</option>`;
  }).join('');
  sel.value = P.activeContact;
}

function onContactChosen() {
  P.activeContact = $('contactSelect').value;
  rebuildDict();
  renderCopyList($('copySearch') ? $('copySearch').value : '');
  populateAiFieldSelect();
  // Wenn bereits gescannt: Prüfliste mit dem aktiven Kontakt neu berechnen.
  if (P.descriptors.length) {
    P.proposals = collapseRadioGroups(BxaMatcher.match(P.descriptors, P.dict, $('contextMode').value));
    for (const p of P.proposals) p.checked = p.confidence >= 0.6;
    renderReview();
  }
  toast(P.activeContact === '' ? 'Kontakt-Auswahl aufgehoben.' : 'Kontaktdaten stehen zum Ausfüllen bereit.');
}

// ===== Werte zum Kopieren (Feature v0.2.0 #2) =====

function renderCopyList(query) {
  const box = $('copyList');
  if (!box) return;
  const q = bxaNorm(query || '');
  const hits = P.dict.filter(e => !q || bxaNorm(e.label + ' ' + e.value + ' ' + e.key).includes(q)).slice(0, 60);
  box.innerHTML = hits.length
    ? hits.map((e, i) => `<div class="copyrow" data-i="${i}" title="Klick: Wert kopieren und in das zuvor markierte Feld der Seite eintragen"><b>${esc(e.label)}</b><span class="v">${esc(String(e.value).slice(0, 60))}</span></div>`).join('')
    : '<div class="hint" style="padding:6px">Kein Treffer.</div>';
  box.querySelectorAll('.copyrow').forEach(row => row.addEventListener('click', () => copyValue(hits[Number(row.dataset.i)].value, row)));
}

// Direkt-Eintrag (Nutzerwunsch 2026-07-18): den geklickten Wert zusaetzlich in das zuvor
// markierte Feld der Webseite schreiben. BEWUSST nur, wenn Tab + Host-Berechtigung ohnehin
// vorhanden sind - ein blosser Kopier-Klick darf keine Berechtigungs-Abfrage ausloesen.
async function tryFillActive(value) {
  if (P.readOnly) return { ok: false, reason: 'Schreibfunktionen deaktiviert.' };
  try {
    const tab = await activeTab();
    const has = await BX.permissions.contains({ origins: [new URL(tab.url).origin + '/*'] }).catch(() => false);
    if (!has) return { ok: false };
    await ensureContent(tab.id);
    const r = await send({ type: 'BXA_FILL_ACTIVE', value });
    return (r && r.ok) ? r : { ok: false };
  } catch (_e) { return { ok: false }; }
}

async function copyValue(value, row) {
  const text = String(value == null ? '' : value);
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (_e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    } catch (_e2) { ok = false; }
  }
  if (ok && row) { row.classList.add('copied'); setTimeout(() => row.classList.remove('copied'), 900); }
  const fill = await tryFillActive(text);
  if (fill.ok) toast('In Feld' + (fill.label ? ' „' + fill.label + '"' : '') + ' eingetragen' + (ok ? ' und kopiert.' : '.'));
  else toast(ok ? 'Kopiert: ' + text.slice(0, 40) : 'Kopieren nicht möglich (Zwischenablage gesperrt).');
}

// ===== Lokale Dateien (Feature v0.2.1): Upload-Helfer-Quelle + KI-Kontext =====

function bytesToBase64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
function isTextFile(file) {
  return /^text\//.test(file.type || '') || file.type === 'application/json'
    || /\.(txt|csv|md|json|log|xml|html?)$/i.test(file.name || '');
}
function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    r.readAsArrayBuffer(file);
  });
}

async function onFilesPicked(fileList) {
  const files = [...(fileList || [])];
  for (const f of files) {
    try {
      const u8 = await readFileBytes(f); // immer Bytes (fuer Upload); Text zusaetzlich fuer KI
      const mime = f.type || 'application/octet-stream';
      const att = { id: 'a' + (++attachSeq), name: f.name || 'datei', mime, size: f.size, base64: bytesToBase64(u8), isText: false, text: '', aiSend: false };
      if (isTextFile(f)) { att.isText = true; try { att.text = new TextDecoder('utf-8').decode(u8); } catch (_e) { att.text = ''; } }
      P.attachments.push(att);
    } catch (e) { toast('„' + (f.name || 'Datei') + '": ' + (e.message || e)); }
  }
  $('filePicker').value = '';
  renderFileList();
  renderAiFileAttach();
  await refreshUploadHelper();
}

function removeAttachment(id) {
  P.attachments = P.attachments.filter(a => a.id !== id);
  renderFileList();
  renderAiFileAttach();
  refreshUploadHelper();
}

function fmtSize(n) { return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

// ===== Persistente Dokumentenablage (Nutzerwunsch 2026-07-18: eBO/Fax-Versand vorbereiten) =====
// Kleine, dauerhafte Ablage in storage.local (ueberlebt Panel-Schliessen/Browser-Neustart) fuer
// wiederkehrende Anhaenge (Bestellungsurkunde, Betreuerausweis, Briefkopf ...). Budget bewusst
// begrenzt - storage.local ist kein Dokumentenarchiv, das bleibt der Server/die Fallablage.
const VAULT_BUDGET = 8 * 1024 * 1024; // Summe der Dateigroessen
function vaultUsed() { return (P.vault || []).reduce((a, v) => a + (v.size || 0), 0); }
async function loadVault() {
  try { const s = await BX.storage.local.get(['docVault']); P.vault = Array.isArray(s.docVault) ? s.docVault : []; }
  catch (_e) { P.vault = []; }
}
async function saveVault() { try { await BX.storage.local.set({ docVault: P.vault || [] }); } catch (e) { toast('Ablage speichern: ' + (e.message || e)); } }
async function vaultAddFromAttachment(id) {
  const a = P.attachments.find(x => x.id === id);
  if (!a) return;
  if ((P.vault || []).some(v => v.name === a.name && v.size === a.size)) { toast('„' + a.name + '" liegt bereits in der Ablage.'); return; }
  if (vaultUsed() + a.size > VAULT_BUDGET) { toast('Ablage voll (max. ' + fmtSize(VAULT_BUDGET) + ') – bitte zuerst Einträge löschen.'); return; }
  P.vault.push({ id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: a.name, mime: a.mime, size: a.size, base64: a.base64, addedAt: new Date().toISOString() });
  await saveVault();
  renderFileList();
  await refreshUploadHelper();
  toast('„' + a.name + '" dauerhaft in der Ablage gespeichert.');
}
async function vaultRemove(id) {
  P.vault = (P.vault || []).filter(v => v.id !== id);
  await saveVault();
  renderFileList();
  await refreshUploadHelper();
}

function renderFileList() {
  const box = $('fileList');
  const sess = P.attachments.length
    ? P.attachments.map(a => `<div class="fileitem"><span class="fn" title="${esc(a.name)}">${esc(a.name)}</span><span class="fmeta">${a.isText ? 'Text' : (a.mime || '').split('/')[1] || 'Datei'} · ${fmtSize(a.size)}</span><button class="filex" data-vault="${esc(a.id)}" title="Dauerhaft in der Ablage speichern">📌</button><button class="filex" data-rm="${esc(a.id)}" title="Entfernen">×</button></div>`).join('')
    : '<div class="hint">Keine Dateien geladen.</div>';
  const vault = (P.vault || []).length
    ? `<div class="hint" style="margin-top:8px"><b>Dokumentenablage</b> (dauerhaft, ${fmtSize(vaultUsed())} von ${fmtSize(VAULT_BUDGET)})</div>` +
      P.vault.map(v => `<div class="fileitem"><span class="fn" title="${esc(v.name)}">${esc(v.name)}</span><span class="fmeta">${fmtSize(v.size)}</span><button class="filex" data-vrm="${esc(v.id)}" title="Aus der Ablage löschen">×</button></div>`).join('')
    : '';
  box.innerHTML = sess + vault;
  box.querySelectorAll('button[data-rm]').forEach(b => b.addEventListener('click', () => removeAttachment(b.dataset.rm)));
  box.querySelectorAll('button[data-vault]').forEach(b => b.addEventListener('click', () => vaultAddFromAttachment(b.dataset.vault)));
  box.querySelectorAll('button[data-vrm]').forEach(b => b.addEventListener('click', () => vaultRemove(b.dataset.vrm)));
}

// KI-Dokumentauswahl: nur relevant, wenn KI verfügbar UND Dateien vorhanden.
function renderAiFileAttach() {
  const wrap = $('aiFileAttach');
  const usable = P.aiAvailable && P.attachments.length;
  wrap.classList.toggle('hidden', !usable);
  if (!usable) return;
  $('aiFileList').innerHTML = P.attachments.map(a =>
    `<label class="checkline"><input type="checkbox" data-ai-att="${esc(a.id)}" ${a.aiSend ? 'checked' : ''}> ${esc(a.name)}${a.isText ? '' : ((/^image\//.test(a.mime) || a.mime === 'application/pdf') ? '' : ' <span class="hint">(Typ evtl. nicht KI-lesbar)</span>')}</label>`).join('');
  $('aiFileList').querySelectorAll('input[data-ai-att]').forEach(cb => cb.addEventListener('change', () => {
    const a = P.attachments.find(x => x.id === cb.dataset.aiAtt); if (a) a.aiSend = cb.checked;
  }));
}

// ===== Tab / Injection / Berechtigung =====

async function activeTab() {
  const tabs = await BX.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('Kein Webseiten-Tab aktiv.');
  P.tabId = tab.id;
  P.winId = tab.windowId;
  return tab;
}

async function ensurePermission(url) {
  const origin = new URL(url).origin + '/*';
  const has = await BX.permissions.contains({ origins: [origin] }).catch(() => false);
  if (has) return true;
  const granted = await BX.permissions.request({ origins: [origin] }).catch(() => false);
  // Firefox erteilt permissions.request nur synchron in der User-Geste - nach den awaits hier
  // schlaegt die Nachfrage dort still fehl. Der Hinweis fuehrt zum funktionierenden Weg.
  if (!granted) throw new Error('Zugriff auf ' + new URL(url).origin + ' wurde nicht erlaubt. Bitte einmalig oben „Seiten-Zugriff erlauben" nutzen (Firefox erteilt Berechtigungen nur direkt im Klick).');
  return true;
}

// "Seiten-Zugriff erlauben" nur solange noetig zeigen (Nutzerwunsch 2026-07-18): sobald der
// pauschale Host-Zugriff erteilt ist, verschwindet der Hinweis-Banner dauerhaft.
async function refreshGrantBanner() {
  const b = $('grantBanner');
  if (!b) return;
  let has = false;
  try { has = await BX.permissions.contains({ origins: ['https://*/*', 'http://*/*'] }); } catch (_e) { has = false; }
  b.classList.toggle('hidden', has);
}

// Leerzustand (Nutzerwunsch 2026-07-18): ohne gewaehlten Fall nur die Kurzanleitung zeigen -
// Scan-/Datei-Sektionen waeren leer und verstellen sonst den Blick.
function updateEmptyState() {
  const has = !!P.dict.length;
  const intro = $('secIntro');
  if (intro) intro.classList.toggle('hidden', has);
  const scanSec = $('secScan');
  if (scanSec) scanSec.classList.toggle('hidden', !has);
  const filesSec = $('secFiles');
  if (filesSec) filesSec.classList.toggle('hidden', !has);
  // Der Startzustand zeigt, DASS Faelle da sind - die Namen erst nach dem Waehlen.
  const zahl = $('introCaseCount');
  const sel = $('caseSelect');
  if (zahl && sel) {
    const anzahl = [...sel.options].filter(o => o.value).length;
    zahl.textContent = anzahl ? String(anzahl) : '–';
    const verdeckt = $('introVerdeckt');
    if (verdeckt) {
      [...verdeckt.children].forEach((zeile, i) => zeile.classList.toggle('hidden', i >= Math.max(1, Math.min(3, anzahl))));
      verdeckt.classList.toggle('hidden', !anzahl);
    }
  }
  if (typeof aktualisiereKontext === 'function') aktualisiereKontext();
}

async function ensureContent(tabId) {
  try {
    const r = await BX.tabs.sendMessage(tabId, { type: 'BXA_PING' });
    if (r && r.ok) return;
  } catch (_e) { /* noch nicht injiziert */ }
  try {
    // WICHTIG: fuehrender Slash = wurzel-relativ. Chrome loest 'content/..' relativ zur Erweiterungs-
    // Wurzel auf, FIREFOX aber relativ zur aufrufenden Seite (panel/) -> 'panel/content/..' ->
    // "Unable to load script". '/content/..' funktioniert in BEIDEN Browsern.
    await BX.scripting.executeScript({
      target: { tabId },
      files: ['/content/scanner.js', '/content/filler.js', '/content/overlay.js', '/content/main.js']
    });
  } catch (e) {
    throw new Error('Hilfsskript konnte nicht in die Seite geladen werden: ' + (e.message || e));
  }
  // Nach der Injektion auf Antwortbereitschaft warten (Listener aus main.js), bevor die erste echte
  // Nachricht geht - robust gegen Timing/Reihenfolge.
  for (let i = 0; i < 12; i++) {
    try { const r = await BX.tabs.sendMessage(tabId, { type: 'BXA_PING' }); if (r && r.ok) return; } catch (_e) { /* */ }
    await new Promise(res => setTimeout(res, 60));
  }
  throw new Error('Hilfsskript antwortet nicht (blockiert die Seite evtl. Erweiterungen?).');
}

async function send(msg) {
  return BX.tabs.sendMessage(P.tabId, msg);
}

// ===== Scan + Heuristik + Pruefliste =====

/* Seiten-Wechsler (Nutzerwunsch 2026-07-17): je erkannter URL werden Titel, Reihenfolge und die
   zuletzt getroffenen Häkchen-Entscheidungen gemerkt. Geht man im Online-Formular eine Seite
   ZURÜCK (oder klickt einen Seiten-Chip), wird automatisch neu erkannt und die Entscheidungen
   dieser Seite kehren zurück - vorher blieb das Panel nach einem Zurück einfach stehen. */
function rememberPageDecisions() {
  if (!P.currentScanUrl || !Array.isArray(P.proposals) || !P.proposals.length) return;
  P.pageMemory = P.pageMemory || {};
  const m = {};
  for (const p of P.proposals) m[(p.fieldLabel || '') + '|' + p.key] = !!p.checked;
  P.pageMemory[P.currentScanUrl] = m;
}
function restorePageDecisions(url) {
  const m = (P.pageMemory || {})[url];
  if (!m) return;
  for (const p of P.proposals) { const k = (p.fieldLabel || '') + '|' + p.key; if (k in m) p.checked = m[k]; }
}
function renderPageChips() {
  const el = $('pageChips');
  if (!el) return;
  const pages = P.pageOrder || [];
  el.classList.toggle('hidden', pages.length < 2);
  el.innerHTML = pages.map(p => `<button class="pagechip ${p.url === P.currentScanUrl ? 'active' : ''}" data-purl="${esc(p.url)}" title="${esc(p.title || p.url)}">Seite ${p.seq}</button>`).join('');
  el.querySelectorAll('[data-purl]').forEach(b => b.addEventListener('click', () => gotoScannedPage(b.getAttribute('data-purl'))));
}
async function gotoScannedPage(url) {
  try {
    const tab = await activeTab();
    if (tab.url === url) { await doScan(); return; }
    P.pendingChipUrl = url;
    await BX.tabs.update(P.tabId, { url });
    toast('Seite wird aufgerufen – danach wird automatisch neu erkannt.');
    // Fallback: reine Hash-Wechsel (#step_…, typisch für Formular-Wizards) lösen KEIN
    // onUpdated 'complete' aus – nach kurzer Wartezeit trotzdem neu erkennen.
    setTimeout(() => { if (P.pendingChipUrl === url) { P.pendingChipUrl = ''; doScan(); } }, 700);
  } catch (e) { toast(String(e.message || e)); }
}

async function doScan() {
  if (!P.dict.length) { toast('Bitte zuerst einen Fall wählen.'); return; }
  try {
    const tab = await activeTab();
    await ensurePermission(tab.url);
    await ensureContent(tab.id);
    P.pageInfo = await send({ type: 'BXA_PAGE_INFO' });
    $('pageChangeBanner').classList.add('hidden');
    // Mehrseiten-Gedächtnis (Feature v0.2.0 #8 + Seiten-Wechsler): jede NEUE URL zählt als weitere
    // Formularseite; vor dem Wechsel die Entscheidungen der bisherigen Seite sichern.
    rememberPageDecisions();
    P.pageOrder = P.pageOrder || [];
    if (P.pageInfo?.url && !P.scannedUrls.has(P.pageInfo.url)) {
      P.scannedUrls.add(P.pageInfo.url);
      P.pageSeq++;
      P.pageOrder.push({ url: P.pageInfo.url, title: P.pageInfo.title || '', seq: P.pageSeq });
    }
    P.currentScanUrl = P.pageInfo?.url || '';
    const scan = await send({ type: 'BXA_SCAN' });
    P.descriptors = scan.descriptors || [];
    const fields = P.descriptors.filter(d => d.kind === 'field').length;
    const buttons = P.descriptors.length - fields;
    $('scanInfo').textContent = `${fields} Felder, ${buttons} Buttons erkannt` + (P.pageSeq > 1 ? ` · Formularseite ${P.pageSeq}` : '') + (scan.crossOriginFrames ? ` – ${scan.crossOriginFrames} fremde(r) iframe(s) nicht zugänglich` : '');
    P.proposals = collapseRadioGroups(BxaMatcher.match(P.descriptors, P.dict, $('contextMode').value));
    for (const p of P.proposals) p.checked = p.confidence >= 0.6;
    restorePageDecisions(P.currentScanUrl);
    populateAiFieldSelect(); // KI-Tab kennt sonst die Freitextfelder der Seite nicht (kein Popover-Hook mehr)
    // Profil-Aktionsleiste gegen veraltete Refs sichern (Audit 2026-07-18, kritisch): nach jedem
    // Scan nur Aktionen behalten, deren Element weiterhin erkannt wird - sonst koennte ein alter
    // Button auf einer neuen Formularseite ein FALSCHES Element klicken (Submit-Sperre prueft nur
    // das alte Label). Refs sind elementstabil UND tragen eine Instanz-Nonce des Scanners - Refs
    // einer frueheren Dokument-Instanz (echte Navigation) fallen hier sicher heraus.
    if (P.resolvedActions.length) {
      const validNow = new Set(P.descriptors.map(d => d.ref));
      P.resolvedActions = P.resolvedActions.filter(a => validNow.has(a.ref));
      const bar = $('actionBar');
      bar.innerHTML = P.resolvedActions.map((a, i) =>
        `<button data-ai="${i}" title="${esc(a.action)}">${esc(a.label || a.action)}</button>`).join('');
      bar.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => runProfileAction(Number(btn.dataset.ai))));
    }
    renderReview();
    aktualisiereSeitenzeile();
    renderPageChips();
    $('btnTrainAi').classList.toggle('hidden', !P.aiAvailable);
    await refreshUploadHelper();
    await matchProfiles();
  } catch (e) { toast(String(e.message || e)); }
}

// Upload-Helfer (Feature v0.2.0 #6, erweitert v0.2.1): erscheint, wenn das Formular Datei-Felder
// hat UND eine Quelle vorhanden ist - Server-Dokumente (Zwischenspeicher) ODER lokal geladene
// Dateien (vom Rechner). So funktioniert der Upload auch bei Lokal-Fällen und ganz ohne Server.
// Passfoto der betreuten Person (v0.4.2): kommt als JPEG-DataURL in caseData.person.photo mit
// (Server-Fall wie lokal geladener Fall) und ist damit direkt als Upload-Quelle nutzbar.
function caseFotoInfo() {
  try {
    const dataUrl = String(P.filldata?.caseData?.person?.photo || '');
    const match = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(dataUrl);
    return match ? { dataUrl, mime: match[1].toLowerCase() } : null;
  } catch (_e) { return null; }
}
function caseFotoDataUrl() {
  return caseFotoInfo()?.dataUrl || '';
}
function caseFotoName() {
  const p = P.filldata?.caseData?.person || {}; const d = new Date(); const z = n => String(n).padStart(2, '0');
  const mime = caseFotoInfo()?.mime || 'image/jpeg';
  const extension = { 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }[mime] || '.jpg';
  return (String(d.getFullYear()).slice(2) + z(d.getMonth() + 1) + z(d.getDate()) + ' ' + (p.lastName || '') + ' ' + (p.firstName || '') + ' Passfoto').replace(/\s+/g, ' ').trim() + extension;
}
async function refreshUploadHelper() {
  const fileFields = P.descriptors.filter(d => d.kind === 'field' && d.type === 'file');
  if (P.sourceMode === 'server' && P.caseId && P.serverOk && (P.user?.isAdmin || P.perms?.viewDocuments)) {
    try { P.uploadDocs = (await BxaApi.caseDocuments(P.caseId)).documents || []; } catch (_e) { P.uploadDocs = []; }
  } else { P.uploadDocs = []; }
  const foto = caseFotoDataUrl();
  const usable = fileFields.length && (P.uploadDocs.length || P.attachments.length || (P.vault || []).length || foto);
  $('secUpload').classList.toggle('hidden', !usable);
  if (!usable) return;
  $('uploadFieldSelect').innerHTML = fileFields.map(d => `<option value="${esc(d.ref)}">${esc((d.label || d.name || d.ref).slice(0, 50))}</option>`).join('');
  const srv = P.uploadDocs.length
    ? '<optgroup label="Fallakte auf dem Server">' + P.uploadDocs.map(d => {
      const pathHint = d.path ? ' – ' + String(d.path).split('/').slice(-3, -1).join(' / ') : '';
      const missing = d.available === false;
      return `<option value="srv:${esc(d.id)}" ${missing ? 'disabled' : ''} title="${esc(d.path || '')}">${esc((d.filename || d.id).slice(0, 70))} (${fmtSize(d.size || 0)})${esc(pathHint)}${missing ? ' – Datei fehlt' : ''}</option>`;
    }).join('') + '</optgroup>' : '';
  const loc = P.attachments.length
    ? '<optgroup label="Vom Rechner">' + P.attachments.map(a => `<option value="loc:${esc(a.id)}">${esc(a.name.slice(0, 50))} (${fmtSize(a.size)})</option>`).join('') + '</optgroup>' : '';
  const vlt = (P.vault || []).length
    ? '<optgroup label="Dokumentenablage">' + P.vault.map(v => `<option value="vlt:${esc(v.id)}">${esc(v.name.slice(0, 50))} (${fmtSize(v.size)})</option>`).join('') + '</optgroup>' : '';
  const fotoOpt = foto ? '<optgroup label="Aus den Stammdaten"><option value="foto:case">Passfoto der betreuten Person</option></optgroup>' : '';
  $('uploadDocSelect').innerHTML = fotoOpt + srv + loc + vlt;
  const fr = $('uploadFotoRow');
  if (fr) {
    fr.classList.toggle('hidden', !foto);
    if (foto) { const im = $('uploadFotoThumb'); if (im) im.src = foto; }
  }
}

async function doUploadSet() {
  if (P.readOnly) { toast('Schreibfunktionen deaktiviert (Version veraltet).'); return; }
  const ref = $('uploadFieldSelect').value;
  const val = $('uploadDocSelect').value;
  if (!ref || !val) { toast('Bitte Datei-Feld und Dokument wählen.'); return; }
  try {
    let base64, filename, mime;
    if (val === 'foto:case') {
      const foto = caseFotoInfo();
      if (!foto) { toast('Kein Passfoto im Fall hinterlegt (Stammdaten der Software).'); return; }
      base64 = foto.dataUrl.split(',')[1] || ''; filename = caseFotoName(); mime = foto.mime;
    } else if (val.startsWith('loc:')) {
      const a = P.attachments.find(x => x.id === val.slice(4));
      if (!a) { toast('Datei nicht mehr vorhanden.'); return; }
      base64 = a.base64; filename = a.name; mime = a.mime;
    } else if (val.startsWith('vlt:')) {
      const v = (P.vault || []).find(x => x.id === val.slice(4));
      if (!v) { toast('Ablage-Eintrag nicht mehr vorhanden.'); return; }
      base64 = v.base64; filename = v.name; mime = v.mime;
    } else {
      const docId = val.slice(4);
      const doc = P.uploadDocs.find(d => String(d.id) === String(docId));
      const blob = await BxaApi.caseDocumentBlob(P.caseId, docId);
      base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      filename = (doc && doc.filename) || 'dokument'; mime = (doc && doc.mimeType) || blob.type || 'application/octet-stream';
    }
    const res = await send({ type: 'BXA_SET_FILE', ref, base64, filename, mime });
    toast(res.ok ? 'Datei in das Feld eingesetzt: ' + (res.applied || '') : 'Datei-Einsetzen fehlgeschlagen: ' + (res.reason || ''));
  } catch (e) { toast('Upload-Helfer: ' + (e.message || e)); }
}

// Radios einer Gruppe (gleicher name + gleicher Datenschlüssel) zu EINER Prüflisten-Zeile
// zusammenfassen (refs[] behält alle Optionen zum Anklicken der passenden). Sonst erschiene je
// Option eine verwirrende Zeile mit derselben Zielwert-Angabe.
function collapseRadioGroups(proposals) {
  const out = [];
  const seen = new Map(); // name+key -> Eintrag in out
  for (const p of proposals) {
    const desc = P.descriptors.find(d => d.ref === p.ref);
    if (desc && desc.type === 'radio' && desc.name) {
      const gk = desc.name + '::' + p.key;
      if (seen.has(gk)) { seen.get(gk).refs.push(p.ref); continue; }
      const entry = { ...p, refs: [p.ref], fieldLabel: p.keyLabel };
      seen.set(gk, entry);
      out.push(entry);
    } else {
      out.push(p);
    }
  }
  return out;
}

function reviewGruppen() {
  /* Reihenfolge ist Absicht: zuerst, was ein Auge braucht, danach nach Zugehoerigkeit.
     Vorher stand alles in einer Liste, in der die unsichere Zuordnung genauso aussah wie die
     sichere - die Verwechslung "betreute Person <-> Betreuer" war farblich nicht zu sehen. */
  const gruppen = [
    { schluessel: 'unsicher', klasse: 'unsicher', titel: '\u26a0 Bitte ansehen', eintraege: [] },
    { schluessel: 'person', klasse: 'person', titel: 'Betreute Person', eintraege: [] },
    { schluessel: 'buero', klasse: 'buero', titel: 'Betreuer & B\u00fcro', eintraege: [] },
    { schluessel: 'rest', klasse: 'neutral', titel: 'Weitere Felder', eintraege: [] }
  ];
  const nach = Object.fromEntries(gruppen.map(g => [g.schluessel, g]));
  P.proposals.forEach((p, i) => {
    const eintrag = { p, i };
    if (p.confidence < 0.6) nach.unsicher.eintraege.push(eintrag);
    else if (p.group === 'betreute_person') nach.person.eintraege.push(eintrag);
    else if (p.group === 'betreuer_buero') nach.buero.eintraege.push(eintrag);
    else nach.rest.eintraege.push(eintrag);
  });
  return gruppen.filter(g => g.eintraege.length);
}

function herkunftChip(p) {
  if (p.confidence < 0.6) return { klasse: 'warn', text: 'unsicher' };
  const text = p.source === 'ki' ? 'KI' : p.source === 'profil' ? 'Profil' : 'Heuristik';
  if (p.source === 'ki') return { klasse: 'lila', text };
  if (p.source === 'profil') return { klasse: p.group === 'betreuer_buero' ? 'ocker' : 'blau', text };
  return { klasse: '', text };
}

function renderReview() {
  const list = $('reviewList');
  $('secReview').classList.remove('hidden');
  $('reviewHead').classList.remove('hidden');
  $('reviewCount').textContent = P.proposals.length ? P.proposals.length + ' Zuordnungen' : '';
  if (!P.proposals.length) {
    list.innerHTML = '<div class="hinweisleiste grau"><span class="zeichen">?</span><div><b>Keine Zuordnung gefunden.</b> '
      + 'Diese Seite kennt das B\u00fcro noch nicht \u2014 \u00fcber das Trainings-Symbol oben anlernen'
      + (P.aiAvailable ? ' oder KI-Vorschl\u00e4ge holen' : '') + '.</div></div>';
    updateFillCount();
    return;
  }
  list.innerHTML = reviewGruppen().map(g => `
    <div class="gruppe ${g.klasse}">
      <div class="kopfzeile">${g.titel} <span class="anzahl">${g.eintraege.length}</span></div>
      ${g.eintraege.map(({ p, i }) => {
        const chip = herkunftChip(p);
        const breite = Math.max(6, Math.min(100, Math.round((p.confidence || 0) * 100)));
        return `<label class="feld ${p.checked ? '' : 'aus'}">
          <input type="checkbox" class="haken" data-i="${i}" ${p.checked ? 'checked' : ''} ${P.readOnly ? 'disabled' : ''}>
          <span>
            <span class="beschriftung">${esc(p.fieldLabel)}</span>
            <span class="wert">\u2190 ${esc(p.keyLabel)}: <b>${esc(String(p.value).slice(0, 80))}</b></span>
          </span>
          <span class="rechts">
            <span class="chip ${chip.klasse}">${esc(chip.text)}</span>
            <span class="balken ${p.confidence < 0.6 ? 'mittel' : ''}" title="Konfidenz ${(p.confidence * 100).toFixed(0)}%"><i style="width:${breite}%"></i></span>
          </span>
        </label>`;
      }).join('')}
    </div>`).join('');
  list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
    P.proposals[Number(cb.dataset.i)].checked = cb.checked;
    cb.closest('.feld').classList.toggle('aus', !cb.checked);
    updateFillCount();
  }));
  updateFillCount();
}
function updateFillCount() {
  const offen = P.proposals.filter(p => p.checked).length;
  $('fillCount').textContent = String(offen);
  aktualisiereHauptknopf();
  aktualisiereSchritte();
}

async function doFill() {
  if (P.readOnly) { toast('Schreibfunktionen deaktiviert (Version veraltet).'); return; }
  const items = P.proposals.filter(p => p.checked).map(p => ({ ref: p.ref, refs: p.refs, value: p.value, key: p.key }));
  if (!items.length) { toast('Nichts angehakt.'); return; }
  try {
    const res = await send({ type: 'BXA_FILL', items });
    const ok = res.results.filter(r => r.ok);
    const fail = res.results.filter(r => !r.ok);
    // Ausfuellprotokoll (Nutzeranforderung "Dokumentierung"): lokal in der Historie + Sektion.
    // Radio-Gruppen melden die Ref der TATSAECHLICH getroffenen Option zurueck (item.refs),
    // nicht item.ref - beide abgleichen, sonst fehlen Radio-Felder im Protokoll (Audit 2026-07-18).
    const hitRefs = new Set(ok.map(r => r.ref));
    const filledFields = items.filter(it => hitRefs.has(it.ref) || (it.refs || []).some(r => hitRefs.has(r))).map(it => {
      const p = P.proposals.find(x => x.ref === it.ref);
      return { label: p?.fieldLabel || it.ref, key: it.key, value: String(it.value) };
    });
    P.protocol = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      ts: new Date().toISOString(), url: P.pageInfo?.url || '', title: P.pageInfo?.title || '',
      caseId: P.sourceMode === 'server' ? P.caseId : '', caseLabel: P.caseLabel,
      fields: filledFields, actions: P.protocol && sameProtocolPage() ? P.protocol.actions : [],
      failed: fail.map(f => ({ ref: f.ref, reason: f.reason }))
    };
    await appendProtocolHistory(P.protocol);
    renderProtocol();
    toast(`${ok.length} Feld(er) ausgefüllt${fail.length ? ', ' + fail.length + ' fehlgeschlagen' : ''}.`);
    await checkRequiredFields();
  } catch (e) { toast(String(e.message || e)); }
}
function sameProtocolPage() { return P.protocol && P.pageInfo && P.protocol.url === P.pageInfo.url; }

// Pflichtfeld-Check (Feature v0.2.0 #3): frischer Scan (aktuelle Werte!) -> Pflichtfelder, die
// noch leer sind. So sieht die Nutzerin vor dem manuellen Absenden, was fehlt.
async function checkRequiredFields() {
  const warn = $('requiredWarn');
  try {
    const scan = await send({ type: 'BXA_SCAN' });
    const missing = (scan.descriptors || []).filter(d => d.kind === 'field' && d.required && !String(d.value || '').trim() && !(d.type === 'checkbox' && d.checked));
    if (!missing.length) { warn.classList.add('hidden'); return; }
    const labels = missing.slice(0, 12).map(d => '• ' + esc((d.label || d.name || d.id || d.type).slice(0, 60))).join('<br>');
    warn.innerHTML = `<b>${missing.length} Pflichtfeld(er) noch leer:</b><br>${labels}${missing.length > 12 ? '<br>…' : ''}`;
    warn.classList.remove('hidden');
  } catch (_e) { warn.classList.add('hidden'); }
}

async function appendProtocolHistory(protocol) {
  const s = await BX.storage.local.get(['protocolHistory']);
  const hist = Array.isArray(s.protocolHistory) ? s.protocolHistory : [];
  // Aktionen aktualisieren dasselbe Protokoll statt bei jedem Klick eine Dublette anzulegen.
  if (protocol.id) {
    const existing = hist.findIndex(entry => entry && entry.id === protocol.id);
    if (existing >= 0) hist.splice(existing, 1);
  }
  hist.unshift(protocol);
  await BX.storage.local.set({ protocolHistory: hist.slice(0, 100) });
}

// ===== Protokoll / Dokumentation / PDF =====

function renderProtocol() {
  if (!P.protocol) return;
  $('secProtocol').classList.remove('hidden');
  $('protocolInfo').textContent = `${P.protocol.fields.length} Feld(er) dokumentiert – ${P.protocol.title || P.protocol.url}`;
  $('btnDoku').classList.toggle('hidden', !(P.serverOk && P.sourceMode === 'server' && P.caseId && P.perms && (P.perms.editCases || P.user?.isAdmin)));
  aktualisiereSchritte();
  aktualisiereHauptknopf();
}

async function protocolPdfBytes() {
  const pr = P.protocol;
  const screenshot = await captureScreenshotForPdf();
  return BxaPdf.buildProtocolPdf({
    title: 'Ausfüllprotokoll Online-Formular',
    meta: [
      ['Webseite', pr.title || '-'], ['Adresse', pr.url], ['Fall', pr.caseLabel || '-'],
      ['Zeitpunkt', new Date(pr.ts).toLocaleString('de-DE')],
      ['Erstellt mit', 'Betreuungsbüro Formular-Assistent v' + EXT_VERSION]
    ],
    fields: pr.fields.map(f => [f.label, f.value]),
    actions: (pr.actions || []).map(a => a),
    footer: 'Hinweis: Dieses Protokoll dokumentiert die von der Erweiterung eingetragenen Werte. Das Absenden des Formulars erfolgte ausschließlich manuell durch die Nutzerin/den Nutzer.',
    screenshot
  });
}

// Screenshot-Nachweis (Feature v0.2.0 #5): erfasst die sichtbare Seite als JPEG und liefert die
// Bytes (Latin1) + Pixelmasse fuer die PDF-Einbettung. Nur wenn die Checkbox aktiv ist.
async function captureScreenshotForPdf() {
  if (!$('chkScreenshot') || !$('chkScreenshot').checked) return null;
  try {
    const dataUrl = await BX.tabs.captureVisibleTab(P.winId, { format: 'jpeg', quality: 75 });
    if (!dataUrl || dataUrl.indexOf(',') < 0) return null;
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const dims = await imageDims(dataUrl);
    if (!dims.w || !dims.h) return null;
    return { data: bin, w: dims.w, h: dims.h };
  } catch (_e) { return null; }
}
function imageDims(url) {
  return new Promise(resolve => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve({ w: 0, h: 0 });
    im.src = url;
  });
}
function protocolPdfName() {
  const d = new Date(P.protocol.ts);
  const stamp = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const site = (P.protocol.title || new URL(P.protocol.url || 'http://formular').hostname).replace(/[^\wäöüÄÖÜß -]+/g, '').slice(0, 40).trim() || 'Formular';
  return `${stamp} Ausfuellprotokoll ${site}.pdf`;
}

async function downloadProtocolPdf() {
  if (!P.protocol) return;
  const bytes = await protocolPdfBytes();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = protocolPdfName();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function sendProtocolToCase() {
  if (!P.protocol || !P.caseId) return;
  try {
    const bytes = await protocolPdfBytes();
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    await BxaApi.formProtocol(P.caseId, {
      siteName: P.protocol.title || '', url: P.protocol.url,
      fields: P.protocol.fields.map(f => ({ label: f.label, value: f.value })),
      actionsUsed: P.protocol.actions || [],
      pdfBase64: btoa(bin), filename: protocolPdfName()
    });
    toast('In Falldokumentation übernommen (inkl. Protokoll-PDF im Dokumenten-Zwischenspeicher).');
  } catch (e) { toast('Dokumentation: ' + e.message); }
}

// ===== Site-Profile (Training + Anwendung, Phase E3+) =====

// Versanddienste (eBO/Simple-Fax/...) aus den Buero-Versand-Zugangsdaten - NUR URLs, nie
// Zugangsdaten. Route ist mit dem sendMail-Recht gegatet; 403/aeltere Server -> leere Liste.
async function loadSendPortals() {
  if (!(P.serverOk && P.handshake && hasExtPermission('sendMail'))) { P.sendPortals = []; return; }
  try { P.sendPortals = (await BxaApi.sendPortals()).portals || []; }
  catch (_e) { P.sendPortals = []; }
}
const SEND_SERVICE_LABELS = { simplefax: 'Simple Fax', 'simple-fax': 'Simple Fax', ebo: 'eBO (eboConnect)', ebeihilfe: 'eBeihilfe', email: 'E-Mail' };
async function loadProfiles() {
  const s = await BX.storage.local.get(['localProfiles', 'profileCache']);
  P.localProfiles = s.localProfiles || [];
  if (P.serverOk && P.handshake?.features?.siteProfiles) {
    try {
      P.profiles = (await BxaApi.siteProfiles()).profiles;
      await BX.storage.local.set({ profileCache: P.profiles });
    } catch (_e) { P.profiles = s.profileCache || []; }
  } else {
    P.profiles = s.profileCache || [];
  }
}

function urlMatchesPattern(url, pattern) {
  try { return url.startsWith(pattern); } catch (_e) { return false; }
}

// Gruppen-Schluessel: erster Begriff des Formularnamens (vor ':', sonst erstes Wort) - die
// Buero-Konvention "Rundfunkbeitrag: Abmeldung ..." buendelt so alle Formulare eines Traegers.
function portalGroupKey(name) {
  const s = String(name || '').trim();
  const i = s.indexOf(':');
  const key = (i > 0 ? s.slice(0, i) : (s.split(/\s+/)[0] || '')).trim();
  return key || 'Weitere';
}

// Formulare & Portale, nach Traeger gruppiert (Nutzerwunsch 2026-07-18): jede Gruppe auf-/
// zuklappbar (P.groupsOpen), Eintraege behalten ihre Detail-Klappe (P.formsOpen); bei aktivem
// Filter sind alle Treffer-Gruppen offen. Versanddienste als eigene erste Gruppe (nur URLs,
// nie Zugangsdaten - Anmeldung uebernimmt der Browser-Passwortmanager).
function renderPortals() {
  const sec = $('secPortals'), list = $('portalList');
  if (!sec || !list) return;
  P.formsOpen = P.formsOpen || new Set();
  P.groupsOpen = P.groupsOpen || new Set();
  const all = [
    ...(P.profiles || []).map(p => ({ ...p, _scope: 'büroweit' })),
    ...(P.localProfiles || []).map(p => ({ ...p, _scope: 'lokal' }))
  ];
  const sendP = P.sendPortals || [];
  sec.classList.toggle('hidden', !all.length && !sendP.length);
  if (!all.length && !sendP.length) { list.innerHTML = ''; return; }
  const qRaw = String(($('formsFilter') && $('formsFilter').value) || '');
  const q = qRaw.trim().toLowerCase(); // normalisiert NUR fuer den Vergleich, nie ins Feld zurueck
  const rows = all
    .map((p, i) => {
      const m = p.mapping || p;
      const pats = m.urlPatterns || [];
      const openUrl = String(m.portalUrl || '').trim() || String(pats[0] || '').trim();
      return { p, m, pats, openUrl, key: (p.id || 'x') + ':' + i };
    })
    .filter(r => !q || (r.p.name + ' ' + r.pats.join(' ')).toLowerCase().includes(q))
    .sort((a, b) => String(a.p.name).localeCompare(String(b.p.name), 'de'));
  const rowHtml = (r) => {
    const n = (r.m.fields || []).length;
    const acts = (r.m.actions || []).length;
    const note = String(r.m.portalNote || '').trim();
    const open = P.formsOpen.has(r.key);
    const details = !open ? '' : `<div class="portal-details">
      ${r.pats.length ? `<div class="hint">URL: ${esc(r.pats.join(' · '))}</div>` : ''}
      ${note ? `<div class="hint">${esc(note)}</div>` : ''}
      ${n ? `<div class="portal-chips">${(r.m.fields || []).slice(0, 40).map(f => `<span class="chip">${esc(f.fieldLabel || f.key)}</span>`).join('')}${n > 40 ? `<span class="hint">… +${n - 40}</span>` : ''}</div>` : '<div class="hint">noch keine Felder trainiert</div>'}
      ${acts ? `<div class="hint">Aktionen: ${(r.m.actions || []).map(a => esc(a.type || a.label || '')).join(', ')}</div>` : ''}
    </div>`;
    return `<div class="portal-row${open ? ' open' : ''}">
      <div class="portal-main">
        <button class="portal-toggle" data-toggle="${esc(r.key)}" title="Details auf-/zuklappen">${open ? '▾' : '▸'}</button>
        <div><b>${esc(r.p.name)}</b><span class="hint">${n} Feld(er)${acts ? ', ' + acts + ' Aktion(en)' : ''} · ${esc(r.p._scope)}</span></div>
      </div>
      ${r.openUrl ? `<button class="light" data-portal="${esc(r.openUrl)}">Öffnen ↗</button>` : ''}
    </div>${details}`;
  };
  const grouped = new Map();
  for (const r of rows) {
    const k = portalGroupKey(r.p.name);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(r);
  }
  const groupKeys = [...grouped.keys()].sort((a, b) => a.localeCompare(b, 'de'));
  const sendRows = sendP
    .map(sp => ({ sp, label: SEND_SERVICE_LABELS[String(sp.service || '').toLowerCase()] || sp.service || 'Versanddienst' }))
    .filter(x => !q || ('versanddienste ' + x.label).toLowerCase().includes(q));
  const groupHtml = (key, count, bodyHtml, extraHint) => {
    const open = !!q || P.groupsOpen.has(key);
    return `<div class="pgroup">
      <button class="pgroup-head" data-pgroup="${esc(key)}"><span class="pg-caret">${open ? '▾' : '▸'}</span><b>${esc(key)}</b><span class="hint">${count}</span></button>
      ${open ? `<div class="pgroup-body">${extraHint || ''}${bodyHtml}</div>` : ''}
    </div>`;
  };
  let html = '';
  if (sendRows.length) {
    const body = sendRows.map(({ sp, label }) => {
      const btn = (url, txt) => url ? `<button class="light" data-portal="${esc(url)}">${txt} ↗</button>` : '';
      return `<div class="portal-row"><div class="portal-main"><div><b>${esc(label)}</b><span class="hint">Versanddienst des Büros</span></div></div>${btn(sp.composeUrl, 'Verfassen')}${btn(sp.inboxUrl, 'Posteingang')}${btn(sp.loginUrl, 'Login')}</div>`;
    }).join('');
    html += groupHtml('Versanddienste', sendRows.length, body, '<div class="hint">Anmeldung übernimmt Ihr Browser-Passwortmanager; danach hier scannen, Felder ausfüllen und Dokumente über den Upload-Helfer anhängen. <b>Gesendet wird ausschließlich von Ihnen.</b></div>');
  }
  html += groupKeys.map(k => groupHtml(k, grouped.get(k).length, grouped.get(k).map(rowHtml).join(''))).join('');
  list.innerHTML = `<div class="row small formsbar">
      <input id="formsFilter" type="text" placeholder="Formular suchen …" value="${esc(qRaw)}">
      <button class="icon" id="formsAllOpen" title="alle Gruppen aufklappen">⊞</button>
      <button class="icon" id="formsAllClose" title="alle Gruppen zuklappen">⊟</button>
    </div>
    <div class="portalscroll">${html || '<div class="hint">Kein Treffer.</div>'}</div>`;
  const filt = $('formsFilter');
  filt.addEventListener('input', () => {
    const pos = filt.selectionStart; // Caret ueber das Re-Render retten (sonst springt er ans Ende)
    renderPortals();
    const f = $('formsFilter');
    f.focus();
    try { f.setSelectionRange(pos, pos); } catch (_e) { /* Cursor-Komfort */ }
  });
  $('formsAllOpen').addEventListener('click', () => { P.groupsOpen.add('Versanddienste'); groupKeys.forEach(k => P.groupsOpen.add(k)); renderPortals(); });
  $('formsAllClose').addEventListener('click', () => { P.groupsOpen.clear(); P.formsOpen.clear(); renderPortals(); });
  list.querySelectorAll('[data-pgroup]').forEach(b => b.addEventListener('click', () => {
    const k = b.getAttribute('data-pgroup');
    if (P.groupsOpen.has(k)) P.groupsOpen.delete(k); else P.groupsOpen.add(k);
    renderPortals();
  }));
  list.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const k = b.getAttribute('data-toggle');
    if (P.formsOpen.has(k)) P.formsOpen.delete(k); else P.formsOpen.add(k);
    renderPortals();
  }));
  list.querySelectorAll('[data-portal]').forEach(b => b.addEventListener('click', () => {
    try { BX.tabs.create({ url: b.getAttribute('data-portal') }); } catch (_e) { /* Tab-API fehlt? */ }
  }));
}

async function matchProfiles() {
  await loadProfiles();
  if (!P.sendPortals) await loadSendPortals();
  renderPortals();
  const url = P.pageInfo?.url || '';
  const all = [...P.profiles.map(p => ({ ...p, _scope: 'server' })), ...P.localProfiles.map(p => ({ ...p, _scope: 'lokal' }))];
  P.matchedProfile = all.find(p => (p.mapping?.urlPatterns || p.urlPatterns || []).some(pat => urlMatchesPattern(url, pat))) || null;
  $('secProfile').classList.toggle('hidden', !P.matchedProfile && !P.training.active);
  const chip = $('profileChip');
  if (chip) {
    chip.classList.toggle('hidden', !P.matchedProfile);
    if (P.matchedProfile) { chip.textContent = 'Profil'; chip.className = 'chip blau'; }
  }
  if (P.matchedProfile) {
    // Formular-Statistik + "veraltet"-Warnung (Feature v0.2.0 #11).
    const st = P.matchedProfile.stats;
    let extra = '';
    if (st && st.applyCount) extra = ` · ${st.applyCount}× angewendet`;
    $('profileInfo').innerHTML = `Profil „${esc(P.matchedProfile.name)}" verfügbar (${esc(P.matchedProfile._scope)})${extra}.`
      + (st && st.stale ? ` <span class="chip warn">⚠ möglicherweise veraltet – neu trainieren?</span>` : '');
    $('btnApplyProfile').classList.remove('hidden');
    $('btnDeleteProfile').classList.remove('hidden');
  } else {
    $('profileInfo').textContent = 'Kein Profil für diese Seite. Über „Training" können Sie eines anlegen.';
    $('btnApplyProfile').classList.add('hidden');
    $('btnDeleteProfile').classList.add('hidden');
    $('actionBar').innerHTML = '';
  }
}

async function applyProfile() {
  const prof = P.matchedProfile;
  if (!prof) return;
  const mapping = prof.mapping || prof;
  try {
    await ensureContent(P.tabId);
    const res = await send({ type: 'BXA_RESOLVE_PROFILE', profile: mapping });
    let hits = 0, misses = 0;
    for (const f of res.fields) {
      if (!f.ref) { misses++; continue; }
      const entry = P.dictIdx.get(f.key);
      if (!entry) { misses++; continue; }
      hits++;
      // In die Pruefliste einreihen (Quelle Profil, ersetzt Heuristik-Vorschlag desselben Felds).
      P.proposals = P.proposals.filter(p => p.ref !== f.ref);
      P.proposals.push({ ref: f.ref, fieldLabel: entry.label + ' (Profilfeld)', key: f.key, keyLabel: entry.label, value: entry.value, group: entry.group, confidence: 1, source: 'profil', checked: true });
    }
    renderReview();
    // Aktions-Buttons (Weiter/Upload/...) als Leiste anbieten - Ausfuehrung nur per Klick,
    // submit-artige Labels zusaetzlich mit Einzelbestaetigung.
    P.resolvedActions = res.actions.filter(a => a.ref);
    $('actionBar').innerHTML = P.resolvedActions.map((a, i) =>
      `<button data-ai="${i}" title="${esc(a.action)}">${esc(a.label || a.action)}</button>`).join('');
    $('actionBar').querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => runProfileAction(Number(btn.dataset.ai))));
    toast(`Profil angewendet: ${hits} Feld(er) zugeordnet${misses ? ', ' + misses + ' nicht auffindbar (Seite geändert? → neu trainieren)' : ''}.`);
    // Nutzungsstatistik an den Server melden (Feature v0.2.0 #11): Treffer/Fehlschlaege je Anwendung
    // -> "veraltet?"-Erkennung. Nur fuer Server-Profile (lokale haben keine Statistik).
    if (prof._scope === 'server' && prof.id && P.serverOk) {
      try { await BxaApi.profileApplyStat(prof.id, hits, misses); } catch (_e) { /* Statistik ist unkritisch */ }
    }
  } catch (e) { toast(String(e.message || e)); }
}

async function runProfileAction(i) {
  if (P.readOnly) { toast('Schreibfunktionen deaktiviert (Version veraltet).'); return; }
  const a = P.resolvedActions[i];
  if (!a) return;
  try {
    const label = a.liveLabel || a.label || a.action;
    let confirmed = false;
    if (a.requiresConfirmation || a.type === 'submit' || SUBMIT_RX.test(label) || SUBMIT_RX.test(a.action || '')) {
      if (!confirm(`„${label}" wirkt wie ein VERBINDLICHES Absenden. Wirklich klicken?`)) return;
      confirmed = true;
    }
    let result = await send({ type: 'BXA_CLICK', ref: a.ref, confirmed });
    // Content-seitiger Rueckhalt fuer Altprofile, in denen der echte Button-Typ noch nicht steckt.
    if (result?.requiresConfirmation && !confirmed) {
      if (!confirm(`„${result.label || label}" ist ein Absende-Button. Wirklich klicken?`)) return;
      confirmed = true;
      result = await send({ type: 'BXA_CLICK', ref: a.ref, confirmed: true });
    }
    if (!result?.ok) throw new Error(result?.reason || 'Aktion konnte nicht ausgeführt werden.');
    if (P.protocol && sameProtocolPage()) { P.protocol.actions.push(`${a.label || a.action} (${new Date().toLocaleTimeString('de-DE')})`); await appendProtocolHistory(P.protocol); }
    toast('Aktion ausgeführt: ' + (a.label || a.action));
    // Seitenwechsel-Aktionen: danach automatisch neu erkennen (SPA-Wizards ändern die URL oft nicht,
    // der onUpdated-Listener greift dann nicht). Kurze Wartezeit, bis der neue Schritt gerendert ist.
    if (a.action === 'weiter' || a.action === 'zurueck') setTimeout(() => { doScan(); }, 900);
  } catch (e) { toast(String(e.message || e)); }
}

async function deleteProfile() {
  const prof = P.matchedProfile;
  if (!prof || !confirm(`Profil „${prof.name}" löschen?`)) return;
  try {
    if (prof._scope === 'server') await BxaApi.siteProfileDelete(prof.id);
    else {
      P.localProfiles = P.localProfiles.filter(p => p !== prof && p.id !== prof.id);
      await BX.storage.local.set({ localProfiles: P.localProfiles });
    }
    toast('Profil gelöscht.');
    await matchProfiles();
  } catch (e) { toast(String(e.message || e)); }
}

// ----- Training -----

async function startTraining() {
  if (!P.dict.length) { toast('Bitte zuerst einen Fall wählen (für die Datenfeld-Zuordnung).'); return; }
  try {
    const tab = await activeTab();
    await ensurePermission(tab.url);
    await ensureContent(tab.id);
    P.pageInfo = await send({ type: 'BXA_PAGE_INFO' });
    P.training = { active: true, fields: [], actions: [], pending: null };
    // Bestehendes Profil als Ausgangsbasis laden (weitertrainieren statt neu anfangen).
    await matchProfiles();
    if (P.matchedProfile) {
      const m = P.matchedProfile.mapping || P.matchedProfile;
      P.training.fields = [...(m.fields || [])];
      P.training.actions = [...(m.actions || [])];
      $('trainProfileName').value = P.matchedProfile.name || '';
    } else {
      $('trainProfileName').value = (P.pageInfo.title || new URL(P.pageInfo.url).hostname).slice(0, 60);
    }
    await send({ type: 'BXA_PICK_START' });
    $('secTraining').classList.remove('hidden');
    const intro = $('secTrainIntro');
    if (intro) intro.classList.add('hidden');
    $('secProfile').classList.remove('hidden');
    $('btnTrainAi').classList.toggle('hidden', !P.aiAvailable);
    renderTrainList();
    trainingBandZeigen(true);
    toast('Training aktiv: Feld/Button auf der Seite anklicken.');
  } catch (e) { toast(String(e.message || e)); }
}

function renderTrainList() {
  const rows = [
    ...P.training.fields.map((f, i) => ({ kind: 'field', text: '🔤 ' + (P.dictIdx.get(f.key)?.label || f.key), i })),
    ...P.training.actions.map((a, i) => ({ kind: 'action', text: '🔘 ' + (a.label || a.action) + ' → ' + a.action, i }))
  ];
  $('trainList').innerHTML = rows.length
    ? rows.map(r => `<div class="t"><span>${esc(r.text)}</span><button data-k="${r.kind}" data-i="${r.i}">entfernen</button></div>`).join('')
    : '<div class="hint">Noch keine Zuordnungen.</div>';
  $('trainList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.k === 'field') P.training.fields.splice(Number(b.dataset.i), 1);
    else P.training.actions.splice(Number(b.dataset.i), 1);
    renderTrainList();
  }));
}

function onPicked(descriptor) {
  if (!P.training.active) return;
  P.training.pending = descriptor;
  $('trainPending').classList.remove('hidden');
  try { window.__showPanelTab && window.__showPanelTab('training'); } catch (_e) { /* Tab-Wechsel ist Komfort */ }
  $('trainPickedLabel').textContent = `Ausgewählt: ${descriptor.kind === 'button' ? 'Button' : 'Feld'} „${descriptor.label || descriptor.name || descriptor.id || descriptor.tag}"`;
  const isButton = descriptor.kind === 'button';
  document.querySelector(`input[name=trainKind][value=${isButton ? 'action' : 'field'}]`).checked = true;
  toggleTrainKind();
  if (!isButton) { $('trainKeySearch').value = ''; renderKeyList(''); $('trainKeySearch').focus(); }
}

function toggleTrainKind() {
  const kind = document.querySelector('input[name=trainKind]:checked').value;
  $('trainFieldAssign').classList.toggle('hidden', kind !== 'field');
  $('trainActionAssign').classList.toggle('hidden', kind !== 'action');
}

function renderKeyList(query) {
  const q = bxaNorm(query);
  const hits = P.dict.filter(e => !q || bxaNorm(e.label + ' ' + e.key).includes(q)).slice(0, 30);
  $('trainKeyList').innerHTML = hits.map(e =>
    `<div data-key="${esc(e.key)}"><b>${esc(e.label)}</b> <span class="v">= ${esc(String(e.value).slice(0, 40))}</span></div>`).join('') || '<div class="hint" style="padding:6px">Kein Treffer.</div>';
  $('trainKeyList').querySelectorAll('div[data-key]').forEach(d => d.addEventListener('click', () => assignField(d.dataset.key)));
}

function assignField(key) {
  const desc = P.training.pending;
  if (!desc) return;
  P.training.fields = P.training.fields.filter(f => JSON.stringify(f.selectorChain) !== JSON.stringify(desc.selectorChain));
  P.training.fields.push({ selectorChain: desc.selectorChain, key });
  P.training.pending = null;
  $('trainPending').classList.add('hidden');
  renderTrainList();
  toast('Feld zugeordnet: ' + (P.dictIdx.get(key)?.label || key));
}

function assignAction() {
  const desc = P.training.pending;
  if (!desc) return;
  const action = $('trainActionType').value;
  P.training.actions.push({ selectorChain: desc.selectorChain, action, label: desc.label || action });
  P.training.pending = null;
  $('trainPending').classList.add('hidden');
  renderTrainList();
  toast('Aktion zugeordnet: ' + action);
}

async function saveTraining() {
  const name = $('trainProfileName').value.trim();
  if (!name) { toast('Bitte Profil-Name angeben.'); return; }
  if (!P.training.fields.length && !P.training.actions.length) { toast('Keine Zuordnungen vorhanden.'); return; }
  const u = new URL(P.pageInfo.url);
  const mapping = {
    version: 1,
    urlPatterns: [u.origin + u.pathname],
    contextDefault: $('contextMode').value,
    fields: P.training.fields,
    actions: P.training.actions,
    // Portal-Angaben (in der Haupt-App gepflegt) beim Neu-Training MITNEHMEN - sonst wuerde das
    // Speichern sie leeren (der Server normalisiert fehlende Schluessel zu '').
    portalUrl: (P.matchedProfile && P.matchedProfile.mapping && P.matchedProfile.mapping.portalUrl) || '',
    portalNote: (P.matchedProfile && P.matchedProfile.mapping && P.matchedProfile.mapping.portalNote) || ''
  };
  try {
    if (P.serverOk && P.handshake?.features?.siteProfiles && !P.readOnly && hasExtPermission('editCases')) {
      const existing = P.matchedProfile && P.matchedProfile._scope === 'server' ? P.matchedProfile.id : null;
      await BxaApi.siteProfileSave({ id: existing || undefined, name, urlPattern: mapping.urlPatterns[0], mapping });
      toast('Profil auf dem Server gespeichert (büroweit geteilt).');
    } else {
      const existing = P.localProfiles.findIndex(p => p.name === name);
      const prof = { id: 'loc-' + Date.now(), name, mapping };
      if (existing >= 0) P.localProfiles[existing] = prof; else P.localProfiles.push(prof);
      await BX.storage.local.set({ localProfiles: P.localProfiles });
      toast('Profil lokal in der Erweiterung gespeichert.');
    }
    await stopTraining();
    await matchProfiles();
  } catch (e) { toast('Profil speichern: ' + e.message); }
}

async function stopTraining() {
  P.training.active = false;
  try { await send({ type: 'BXA_PICK_STOP' }); } catch (_e) { /* Tab weg */ }
  $('secTraining').classList.add('hidden');
  const intro = $('secTrainIntro');
  if (intro) intro.classList.remove('hidden');
  $('trainPending').classList.add('hidden');
  trainingBandZeigen(false);
}

// Das Band steht ueber allem, solange aufgezeichnet wird - und das Symbol im Kopf leuchtet mit.
// Ohne diesen sichtbaren Unterschied war "Training laeuft" nur an einem offenen Reiter zu erkennen.
function trainingBandZeigen(an) {
  const band = $('aufnahmeband');
  if (band) {
    band.classList.toggle('hidden', !an);
    // Das Band steht ueber allem - auch ueber Schub und Trainingsflaeche. Ohne diese Hoehe
    // schoeben sich die Flaechen darueber und die Aufzeichnung waere unsichtbar.
    document.body.style.setProperty('--band', an ? band.offsetHeight + 'px' : '0px');
  }
  const symbol = $('btnTrainingToggle');
  if (symbol) {
    symbol.classList.toggle('an', !!an);
    symbol.title = an ? 'Training läuft — Aufzeichnung öffnen' : 'Training: Felder dieser Seite anlernen';
  }
}

// ===== KI: Feldzuordnung + Freitext-Chat (Phase E4) =====

async function aiMapFields() {
  if (!P.aiAvailable) { toast('KI ist nicht verfügbar oder nicht freigeschaltet.'); return; }
  if (!P.descriptors.length) { toast('Bitte zuerst scannen.'); return; }
  try {
    const fields = P.descriptors.filter(d => d.kind === 'field').slice(0, 120).map(d => ({
      ref: d.ref, label: d.label, placeholder: d.placeholder, name: d.name, id: d.id,
      type: d.type, autocomplete: d.autocomplete, sectionContext: d.sectionContext,
      options: d.options ? d.options.slice(0, 20).map(o => o.text) : undefined
    }));
    const keys = P.dict.map(e => ({ key: e.key, label: e.label, group: e.group })); // KEINE Werte!
    const res = await BxaApi.aiMapFields({ fields, keys, pageTitle: P.pageInfo?.title || '' });
    let added = 0;
    for (const m of res.mappings || []) {
      const entry = P.dictIdx.get(m.key);
      const desc = P.descriptors.find(d => d.ref === m.ref);
      if (!entry || !desc) continue;
      P.proposals = P.proposals.filter(p => p.ref !== m.ref || p.source === 'profil');
      if (P.proposals.some(p => p.ref === m.ref)) continue; // Profil gewinnt
      P.proposals.push({ ref: m.ref, fieldLabel: desc.label || desc.name || m.ref, key: m.key, keyLabel: entry.label, value: entry.value, group: entry.group, confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0.5)), source: 'ki', checked: (Number(m.confidence) || 0) >= 0.7 });
      added++;
    }
    renderReview();
    toast('KI: ' + added + ' Zuordnungsvorschläge (nur Feldnamen wurden übertragen, keine Werte).');
  } catch (e) { toast('KI-Zuordnung: ' + e.message); }
}

// KI-Training-Turbo (Feature v0.2.0 #12): die KI ordnet das GANZE Formular zu und uebernimmt die
// Treffer direkt als Trainings-Felder (Selektor-Ketten der Deskriptoren). Nur Feldnamen gehen an
// die KI, keine Werte. Spart das Feld-fuer-Feld-Anklicken beim Anlegen eines Site-Profils.
async function aiTrainWholeForm() {
  if (!P.training.active) { toast('Bitte zuerst das Training starten.'); return; }
  if (!P.descriptors.length) { toast('Bitte zuerst das Formular scannen.'); return; }
  if (!P.aiAvailable) { toast('KI ist nicht verfügbar oder nicht freigeschaltet.'); return; }
  try {
    const fields = P.descriptors.filter(d => d.kind === 'field').slice(0, 120).map(d => ({
      ref: d.ref, label: d.label, placeholder: d.placeholder, name: d.name, id: d.id,
      type: d.type, autocomplete: d.autocomplete, sectionContext: d.sectionContext,
      options: d.options ? d.options.slice(0, 20).map(o => o.text) : undefined
    }));
    const keys = P.dict.map(e => ({ key: e.key, label: e.label, group: e.group })); // KEINE Werte!
    const res = await BxaApi.aiMapFields({ fields, keys, pageTitle: P.pageInfo?.title || '' });
    let added = 0;
    for (const m of res.mappings || []) {
      const desc = P.descriptors.find(d => d.ref === m.ref);
      if (!desc || !desc.selectorChain || !P.dictIdx.get(m.key)) continue;
      P.training.fields = P.training.fields.filter(f => JSON.stringify(f.selectorChain) !== JSON.stringify(desc.selectorChain));
      P.training.fields.push({ selectorChain: desc.selectorChain, key: m.key });
      added++;
    }
    renderTrainList();
    toast('KI-Training: ' + added + ' Feld(er) übernommen. Bitte prüfen und speichern.');
  } catch (e) { toast('KI-Training: ' + (e.message || e)); }
}

function populateAiFieldSelect() {
  const sel = $('aiFieldSelect');
  const texts = P.descriptors.filter(d => d.kind === 'field' && (d.type === 'textarea' || d.type === 'text' || d.type === 'contenteditable'));
  sel.innerHTML = texts.length
    ? texts.map(d => `<option value="${esc(d.ref)}">${esc((d.label || d.name || d.ref).slice(0, 60))}</option>`).join('')
    : '<option value="">– erst scannen –</option>';
}

async function aiChat() {
  if (!P.aiAvailable) { toast('KI ist nicht verfügbar oder nicht freigeschaltet.'); return; }
  const ref = $('aiFieldSelect').value;
  const prompt = $('aiChatPrompt').value.trim();
  if (!prompt) { toast('Bitte beschreiben, was formuliert werden soll.'); return; }
  const consent = $('aiConsent').checked;
  try {
    const desc = P.descriptors.find(d => d.ref === ref);
    // Ausgewaehlte Dokumente (v0.2.1): Text-Dokumente als Auszug, Bilder/PDF als Anhang.
    const chosen = P.attachments.filter(a => a.aiSend);
    const documentTexts = chosen.filter(a => a.isText && a.text).map(a => ({ name: a.name, text: a.text }));
    const attachments = chosen.filter(a => !a.isText && (/^image\//.test(a.mime) || a.mime === 'application/pdf')).map(a => ({ name: a.name, mime: a.mime, base64: a.base64 }));
    const payload = {
      prompt,
      fieldLabel: desc?.label || '', sectionContext: desc?.sectionContext || '',
      pageTitle: P.pageInfo?.title || '',
      // Falldaten NUR mit ausdruecklicher per-Use-Einwilligung (Toggle ist nie vorausgewaehlt).
      caseContext: consent ? P.dict.filter(e => e.group !== 'kontakt').slice(0, 120).map(e => e.label + ': ' + e.value).join('\n') : '',
      documentTexts, attachments
    };
    const res = await BxaApi.aiChat(payload);
    $('aiChatResult').classList.remove('hidden');
    $('aiChatText').value = res.reply || '';
    $('aiConsent').checked = false; // Einwilligung gilt pro Anfrage
  } catch (e) { toast('KI-Chat: ' + e.message); }
}

async function aiApply() {
  if (P.readOnly) { toast('Schreibfunktionen deaktiviert (Version veraltet).'); return; }
  const ref = $('aiFieldSelect').value;
  const text = $('aiChatText').value;
  if (!ref || !text) return;
  try {
    const res = await send({ type: 'BXA_FILL', items: [{ ref, value: text }] });
    toast(res.results?.[0]?.ok ? 'Text eingetragen.' : 'Eintragen fehlgeschlagen: ' + (res.results?.[0]?.reason || ''));
  } catch (e) { toast(String(e.message || e)); }
}

// ===== KI-Agent (Phase E6) - harte Guardrails im CODE, nicht nur im Prompt =====

function agentLog(text, cls) {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  $('agentLog').appendChild(div);
  $('agentLog').scrollTop = $('agentLog').scrollHeight;
}

function compactSnapshot(scan) {
  return {
    url: scan.url, title: scan.title,
    fields: scan.descriptors.filter(d => d.kind === 'field').slice(0, 80).map(d => ({ ref: d.ref, label: d.label, type: d.type, value: d.value ? '(ausgefüllt)' : '', section: d.sectionContext.slice(0, 80), options: d.options ? d.options.slice(0, 12).map(o => o.text) : undefined, required: d.required })),
    buttons: scan.descriptors.filter(d => d.kind === 'button').slice(0, 30).map(d => ({ ref: d.ref, label: d.label }))
  };
}

async function agentRun() {
  if (!P.agentAvailable) { toast('Der KI-Agent ist nicht verfügbar oder nicht freigeschaltet.'); return; }
  if (P.readOnly) { toast('Schreibfunktionen deaktiviert.'); return; }
  if (!P.dict.length) { toast('Bitte zuerst einen Fall wählen.'); return; }
  const goal = $('agentGoal').value.trim();
  if (!goal) { toast('Bitte ein Ziel angeben.'); return; }
  P.agent = { running: true, stop: false, steps: 0, maxSteps: Math.min(40, Math.max(1, Number($('agentMaxSteps').value) || 15)), lastHash: '', dupCount: 0, confirmResolve: null };
  $('btnAgentStart').classList.add('hidden');
  $('btnAgentStop').classList.remove('hidden');
  $('agentLog').innerHTML = '';
  agentLog('Agent gestartet. Ziel: ' + goal);
  const allowValues = $('agentAllowValues').checked;
  const history = [];
  let startOrigin = '';
  try {
    // activeTab() erst IM try: ein Reject (kein Webseiten-Tab aktiv) muss durchs finally laufen,
    // sonst blieben Start-Button versteckt und P.agent.running haengen (Audit 2026-07-18).
    const startTab = await activeTab();
    startOrigin = new URL(startTab.url).origin;
    await ensurePermission(startTab.url);
    while (P.agent.running && !P.agent.stop && P.agent.steps < P.agent.maxSteps) {
      P.agent.steps++;
      await ensureContent(P.tabId);
      const info = await send({ type: 'BXA_PAGE_INFO' });
      // Guard: Origin-Wechsel stoppt den Agenten sofort.
      if (new URL(info.url).origin !== startOrigin) { agentLog('Origin-Wechsel erkannt (' + info.url + ') – Agent gestoppt.', 'err'); break; }
      const scan = await send({ type: 'BXA_SCAN' });
      P.descriptors = scan.descriptors;
      const snapshot = compactSnapshot(scan);
      // Guard: identischer Zustand 2x hintereinander -> kein Fortschritt -> Stopp.
      const hash = JSON.stringify(snapshot.fields.map(f => f.ref + f.value)) + snapshot.url;
      if (hash === P.agent.lastHash) { P.agent.dupCount++; } else { P.agent.dupCount = 0; P.agent.lastHash = hash; }
      if (P.agent.dupCount >= 2) { agentLog('Kein Fortschritt erkennbar – Agent gestoppt (bitte manuell weitermachen).', 'err'); break; }

      agentLog(`Schritt ${P.agent.steps}/${P.agent.maxSteps}: Seite analysiert (${snapshot.fields.length} Felder).`);
      const payload = {
        goal, snapshot, history: history.slice(-6),
        keys: P.dict.map(e => ({ key: e.key, label: e.label, group: e.group, ...(allowValues ? { value: String(e.value).slice(0, 120) } : {}) })),
        allowValues
      };
      const res = await BxaApi.aiAgentStep(payload);
      if (res.note) agentLog('KI: ' + res.note);
      const actions = Array.isArray(res.actions) ? res.actions.slice(0, 12) : [];
      const validRefs = new Set(scan.descriptors.map(d => d.ref)); // Guard: Klick-Whitelist
      for (const a of actions) {
        if (P.agent.stop) break;
        if (a.type === 'done') { P.agent.stop = true; agentLog('KI meldet: fertig. ' + (a.reason || ''), 'act'); break; }
        if (a.type === 'ask_user') { P.agent.stop = true; agentLog('KI bittet um manuelle Übernahme: ' + (a.reason || ''), 'act'); break; }
        if (!validRefs.has(a.ref)) { agentLog('Übersprungen (unbekanntes Element): ' + JSON.stringify(a).slice(0, 100), 'err'); continue; }
        if (a.type === 'fill' || a.type === 'select' || a.type === 'check') {
          let value = a.value;
          if (!allowValues && a.key) value = P.dictIdx.get(a.key)?.value ?? '';
          if (value == null || value === '') { agentLog('Übersprungen (kein Wert für ' + (a.key || a.ref) + ')', 'err'); continue; }
          const r = await send({ type: 'BXA_FILL', items: [{ ref: a.ref, value }] });
          const ok = r.results?.[0]?.ok;
          agentLog((ok ? '✓ ' : '✗ ') + 'Feld: ' + (a.reason || a.key || a.ref) + (ok ? '' : ' – ' + (r.results?.[0]?.reason || '')), ok ? 'act' : 'err');
          history.push({ step: P.agent.steps, action: 'fill', target: a.reason || a.key || a.ref, ok: !!ok });
        } else if (a.type === 'click') {
          const desc = scan.descriptors.find(d => d.ref === a.ref);
          const label = desc?.label || a.reason || a.ref;
          // HARTE SUBMIT-SPERRE: verbindlich wirkende Klicks brauchen JEDES MAL die ausdrueckliche
          // Einzelbestaetigung im Panel - kein "nicht mehr fragen".
          let confirmed = false;
          if ((desc && (desc.type === 'submit' || desc.type === 'image')) || SUBMIT_RX.test(label)) {
            agentLog('⏸ Bestätigung erforderlich für Klick: „' + label + '"', 'act');
            const allowed = await agentAwaitConfirm('Der Agent möchte „' + label + '" klicken – das wirkt wie ein verbindliches Absenden/Bestätigen.');
            if (!allowed) { agentLog('Klick abgelehnt – Agent gestoppt.', 'err'); P.agent.stop = true; break; }
            confirmed = true;
          }
          let clickResult = await send({ type: 'BXA_CLICK', ref: a.ref, confirmed });
          if (clickResult?.requiresConfirmation && !confirmed) {
            agentLog('⏸ Bestätigung erforderlich für Klick: „' + (clickResult.label || label) + '"', 'act');
            const allowed = await agentAwaitConfirm('Der Agent möchte „' + (clickResult.label || label) + '" klicken – das ist ein Absende-Button.');
            if (!allowed) { agentLog('Klick abgelehnt – Agent gestoppt.', 'err'); P.agent.stop = true; break; }
            clickResult = await send({ type: 'BXA_CLICK', ref: a.ref, confirmed: true });
          }
          if (!clickResult?.ok) {
            agentLog('✗ Klick fehlgeschlagen: ' + (clickResult?.reason || label), 'err');
            history.push({ step: P.agent.steps, action: 'click', target: label, ok: false });
            continue;
          }
          agentLog('→ Klick: ' + label, 'act');
          history.push({ step: P.agent.steps, action: 'click', target: label, ok: true });
          if (P.protocol && sameProtocolPage()) { P.protocol.actions.push('Agent: ' + label); }
          await new Promise(x => setTimeout(x, 1200)); // Seite reagieren lassen
        } else if (a.type === 'scroll') {
          // bewusst ignoriert (Scan sieht ohnehin das ganze Dokument)
        }
      }
      if (res.done) { agentLog('Agent abgeschlossen.', 'act'); break; }
      await new Promise(x => setTimeout(x, 400));
    }
    if (P.agent.steps >= P.agent.maxSteps) agentLog('Schrittbudget erreicht – Agent gestoppt.', 'err');
  } catch (e) {
    agentLog('Fehler: ' + String(e.message || e), 'err');
  } finally {
    P.agent.running = false;
    $('btnAgentStart').classList.remove('hidden');
    $('btnAgentStop').classList.add('hidden');
    $('agentConfirm').classList.add('hidden');
    agentLog('— Ende —');
  }
}

function agentAwaitConfirm(text) {
  return new Promise(resolve => {
    P.agent.confirmResolve = resolve;
    try { window.__agentEnsureVisible && window.__agentEnsureVisible(); } catch (_e) { /* Anzeige ist Komfort */ }
    $('agentConfirmText').textContent = text;
    $('agentConfirm').classList.remove('hidden');
  });
}
function agentConfirm(answer) {
  $('agentConfirm').classList.add('hidden');
  if (P.agent.confirmResolve) { P.agent.confirmResolve(answer); P.agent.confirmResolve = null; }
}

// ===== Ansichten, Kontextkopf, Schrittleiste (Umbau 31.08.2026) =====
// Vier Flaechen statt drei Reitern: der Assistent traegt den Arbeitsweg, alles Seltene liegt im
// Schub, Training und Fallwahl sind eigene Flaechen. Der Kopf sagt immer, WO man ist.

function zeigeAnsicht(name) {
  const flaechen = { schub: 'schub', fallwahl: 'fallwahl', training: 'trainingFlaeche' };
  for (const [ansicht, id] of Object.entries(flaechen)) {
    const el = $(id);
    if (el) el.classList.toggle('hidden', ansicht !== name);
  }
  document.body.dataset.ansicht = name;
  if (name === 'training') {
    const zeile = $('trainKontext');
    if (zeile) {
      let host = '';
      try { host = P.pageInfo?.url ? new URL(P.pageInfo.url).hostname.replace(/^www\./, '') : ''; } catch (_e) { /* ohne Host */ }
      zeile.textContent = [P.caseLabel, host].filter(Boolean).join(' · ');
    }
  }
  if (name === 'fallwahl') {
    renderFallListe($('fallSuche') ? $('fallSuche').value : '');
    try { $('fallSuche').focus(); } catch (_e) { /* Komfort */ }
  }
}

function initialenVon(label) {
  const teile = String(label || '').replace(/[,;].*$/, '').trim().split(/\s+/).filter(Boolean);
  if (!teile.length) return '?';
  const nach = String(label || '').includes(',') ? String(label).split(',')[0].trim() : teile[teile.length - 1];
  const vor = String(label || '').includes(',') ? (String(label).split(',')[1] || '').trim() : teile[0];
  const a = (vor || '').charAt(0), b = (nach || '').charAt(0);
  return ((a + b) || teile[0].charAt(0)).toUpperCase();
}

function aktualisiereKontext() {
  const hatFall = !!P.caseLabel;
  $('caseInitials').textContent = hatFall ? initialenVon(P.caseLabel) : '?';
  $('caseName').textContent = hatFall ? P.caseLabel : 'Kein Fall gewählt';
  const az = P.filldata?.case?.fileNumber || '';
  $('caseInfo').textContent = hatFall
    ? (az ? az : P.dict.length + ' Datenwerte') + (P.sourceMode === 'local' ? ' · lokaler Fall' : '')
    : 'ohne Fall wird nichts gelesen';
  $('caseSwapLabel').textContent = hatFall ? 'wechseln' : 'Wählen';
  aktualisiereSchritte();
  aktualisiereHauptknopf();
}

function aktualisiereSchritte() {
  const hatFall = !!P.dict.length;
  const hatSeite = !!P.descriptors.length;
  const gefuellt = !!(P.protocol && sameProtocolPage());
  const jetzt = !hatFall ? 1 : !hatSeite ? 2 : !gefuellt ? 3 : 4;
  document.querySelectorAll('#pSchritte .p-schritt').forEach((el, idx) => {
    const nr = idx + 1;
    const fertig = nr < jetzt || (nr === 4 && gefuellt);
    el.classList.toggle('fertig', fertig);
    el.classList.toggle('jetzt', nr === jetzt && !fertig);
    const kreis = el.querySelector('.kreis');
    if (kreis) kreis.textContent = fertig ? '\u2713' : String(nr);
  });
}

// Der Hauptknopf traegt immer den naechsten Schritt - vorher hiess er stur "Ausfuellen (0)",
// auch wenn noch gar nichts gescannt war.
function aktualisiereHauptknopf() {
  const knopf = $('btnFill');
  if (!knopf) return;
  const offen = P.proposals.filter(p => p.checked).length;
  let modus, text;
  if (!P.dict.length) { modus = 'fall'; text = 'Fall wählen'; }
  else if (!P.descriptors.length) { modus = 'scan'; text = 'Formular scannen'; }
  else if (offen) { modus = 'fuellen'; text = 'Werte ausfüllen'; }
  else if (P.protocol && sameProtocolPage()) { modus = 'weiter'; text = 'Nächste Seite scannen'; }
  else { modus = 'scan'; text = 'Erneut scannen'; }
  knopf.dataset.modus = modus;
  $('fillLabel').textContent = text;
  $('fillZahl').classList.toggle('hidden', modus !== 'fuellen');
  knopf.disabled = P.readOnly && modus === 'fuellen';
  const auswahl = $('btnAuswahl');
  if (auswahl) auswahl.classList.toggle('hidden', !P.proposals.length);
}

async function hauptknopfGeklickt() {
  const modus = $('btnFill').dataset.modus || 'fuellen';
  if (modus === 'fall') { zeigeAnsicht('fallwahl'); return; }
  if (modus === 'scan' || modus === 'weiter') { await doScan(); return; }
  await doFill();
}

// Seitenzeile: Domain + erkannte Felder. Steht erst, wenn wirklich gescannt wurde.
function aktualisiereSeitenzeile() {
  const zeile = $('pSeite');
  if (!zeile) return;
  const url = P.pageInfo?.url || '';
  if (!url || !P.descriptors.length) { zeile.classList.add('hidden'); return; }
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_e) { /* rohe URL zeigen */ }
  $('pageHost').textContent = host;
  zeile.classList.remove('hidden');
}

// Fallwahl: die einzige Stelle, an der Klarnamen stehen. Gespeist aus dem (verborgenen) select,
// damit loadCases unveraendert die Wahrheit ueber Server- und Lokalfaelle liefert.
function renderFallListe(filter) {
  const liste = $('fallListe');
  const sel = $('caseSelect');
  if (!liste || !sel) return;
  const suche = String(filter || '').trim().toLowerCase();
  const zeilen = [];
  for (const opt of sel.options) {
    if (!opt.value) continue;
    const bereich = opt.parentElement && opt.parentElement.tagName === 'OPTGROUP' ? opt.parentElement.label : '';
    if (suche && !(opt.textContent + ' ' + bereich).toLowerCase().includes(suche)) continue;
    zeilen.push({ wert: opt.value, label: opt.textContent, bereich });
  }
  if (!zeilen.length) {
    liste.innerHTML = '<p class="hint" style="padding:14px">'
      + (sel.options.length > 1 ? 'Kein Fall passt zur Suche.' : 'Keine Fälle verfügbar. Server-Verbindung prüfen oder in den Einstellungen einen lokalen Fall laden.')
      + '</p>';
    return;
  }
  liste.innerHTML = zeilen.map(z => `
    <button class="fallzeile ${z.wert === sel.value ? 'an' : ''}" data-wert="${esc(z.wert)}">
      <span class="initialen">${esc(initialenVon(z.label))}</span>
      <span class="wer"><b>${esc(z.label)}</b><span>${esc(z.bereich || '')}</span></span>
      <span class="chip oeffnen">öffnen</span>
    </button>`).join('');
  liste.querySelectorAll('.fallzeile').forEach(btn => btn.addEventListener('click', async () => {
    sel.value = btn.dataset.wert;
    zeigeAnsicht('assistent');
    await onCaseChosen();
  }));
}

// Sitzungsspeicher: der gewaehlte Fall ueberlebt bewusst KEINEN Browserneustart (Entscheidung
// 31.08.2026) - das Panel steht offen neben fremden Webseiten. storage.session wird beim
// Schliessen des Browsers geleert; fehlt sie, wird gar nicht gemerkt.
async function sitzungLesen(schluessel) {
  try { if (BX.storage.session) return await BX.storage.session.get([schluessel]); } catch (_e) { /* ohne Gedaechtnis */ }
  return {};
}
async function sitzungSchreiben(objekt) {
  try { if (BX.storage.session) await BX.storage.session.set(objekt); } catch (_e) { /* ohne Gedaechtnis */ }
}

// ===== Wiring =====

document.addEventListener('DOMContentLoaded', async () => {
  // Farbmodus: System, oder was in den Einstellungen gewaehlt wurde.
  try {
    const t = await BX.storage.local.get(['theme']);
    if (t && (t.theme === 'dark' || t.theme === 'light')) document.documentElement.dataset.theme = t.theme;
  } catch (_e) { /* System bleibt */ }

  $('lnkOptions').addEventListener('click', (e) => { e.preventDefault(); BX.runtime.openOptionsPage(); });
  $('btnReloadCases').addEventListener('click', async () => {
    await refreshConnection(); await loadCases(); renderFallListe($('fallSuche').value);
  });
  // Berechtigung SYNCHRON im Klick anfordern (Firefox verwirft die User-Geste nach einem await).
  // Deckt via https://*/* + http://*/* jeden spaeteren permissions.contains-Check ab.
  $('btnGrantSites').addEventListener('click', async () => {
    try {
      const granted = await BX.permissions.request({ origins: ['https://*/*', 'http://*/*'] });
      toast(granted ? 'Seiten-Zugriff erteilt – Formulare können jetzt ausgefüllt werden.' : 'Seiten-Zugriff wurde nicht erteilt.');
      refreshGrantBanner().catch(() => {});
    } catch (e) { toast('Fehler: ' + (e.message || e)); }
  });

  // ===== Flaechen: Fallwahl, Werkzeugschub, Training =====
  $('btnFallwahlOeffnen').addEventListener('click', () => zeigeAnsicht('fallwahl'));
  $('btnFallwahlZu').addEventListener('click', () => zeigeAnsicht('assistent'));
  $('fallSuche').addEventListener('input', (e) => renderFallListe(e.target.value));
  $('btnSchub').addEventListener('click', () => zeigeAnsicht(document.body.dataset.ansicht === 'schub' ? 'assistent' : 'schub'));
  $('btnSchubZu').addEventListener('click', () => zeigeAnsicht('assistent'));
  $('btnTrainingToggle').addEventListener('click', () => zeigeAnsicht('training'));
  $('btnTrainingZu').addEventListener('click', () => zeigeAnsicht('assistent'));
  // Escape schliesst immer nur die oberste Flaeche.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (document.body.dataset.ansicht && document.body.dataset.ansicht !== 'assistent') {
      ev.preventDefault(); zeigeAnsicht('assistent');
    }
  });
  // Auto-Wechsel beim Element-Pick im Training (onPicked ruft das).
  window.__showPanelTab = (name) => zeigeAnsicht(name === 'training' ? 'training' : 'assistent');
  // Laufender Agent darf nie unsichtbar haengen (Audit 2026-07-18): vor jeder Pflicht-
  // Bestaetigung den Schub oeffnen und die Agent-Karte aufklappen.
  window.__agentEnsureVisible = () => {
    $('secAgent').classList.remove('hidden');
    openToolCard('secAgent');
    zeigeAnsicht('schub');
  };

  $('caseSelect').addEventListener('change', onCaseChosen);
  $('contactSelect').addEventListener('change', onContactChosen);
  $('copySearch').addEventListener('input', (e) => renderCopyList(e.target.value));
  $('btnUploadSet').addEventListener('click', doUploadSet);
  const bfd = $('btnFotoDownload');
  if (bfd) bfd.addEventListener('click', () => {
    const d = caseFotoDataUrl();
    if (!d) { toast('Kein Passfoto im Fall hinterlegt.'); return; }
    const a = document.createElement('a'); a.href = d; a.download = caseFotoName();
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('filePicker').addEventListener('change', (e) => onFilesPicked(e.target.files));
  renderFileList();
  $('btnTrainAi').addEventListener('click', aiTrainWholeForm);
  $('btnRescanPage').addEventListener('click', () => { $('pageChangeBanner').classList.add('hidden'); doScan(); });

  // Werkzeug-Karten im Schub: per Klick auf die Ueberschrift auf-/zuklappbar, Zustand gemerkt.
  let toolOpen = {};
  try {
    const s2 = await BX.storage.local.get(['toolCards']);
    if (s2 && s2.toolCards && typeof s2.toolCards === 'object') toolOpen = s2.toolCards;
  } catch (_e) { /* Standard bleibt */ }
  const TOOL_CARDS = { secCopy: 'copy', secFiles: 'files', secPortals: 'portals', secAi: 'ai', secAgent: 'agent' };
  for (const [secId, cardKey] of Object.entries(TOOL_CARDS)) {
    const sec = $(secId);
    if (!sec) continue;
    sec.classList.add('tool');
    sec.classList.toggle('closed', !toolOpen[cardKey]);
    const head = sec.querySelector('h2');
    if (head) head.addEventListener('click', () => {
      sec.classList.toggle('closed');
      toolOpen[cardKey] = !sec.classList.contains('closed');
      try { BX.storage.local.set({ toolCards: toolOpen }); } catch (_e) { /* Merken optional */ }
    });
  }
  function openToolCard(secId) {
    const sec = $(secId);
    if (!sec) return;
    sec.classList.remove('closed');
    const k = TOOL_CARDS[secId];
    if (k) { toolOpen[k] = true; try { BX.storage.local.set({ toolCards: toolOpen }); } catch (_e) { /* Merken optional */ } }
    try { sec.scrollIntoView({ block: 'nearest' }); } catch (_e) { /* Komfort */ }
  }

  const tgStart = $('tgStart');
  if (tgStart) tgStart.addEventListener('click', startTraining);
  // Fussleiste: EIN Hauptknopf, der den naechsten Schritt traegt.
  $('btnFill').addEventListener('click', hauptknopfGeklickt);
  $('btnAuswahl').addEventListener('click', () => {
    const alle = P.proposals.length && P.proposals.every(p => p.checked);
    $('chkAll').checked = !alle;
    $('chkAll').dispatchEvent(new Event('change'));
  });
  $('btnClearHl').addEventListener('click', async () => { try { await send({ type: 'BXA_CLEAR_HIGHLIGHTS' }); } catch (_e) { /* */ } });
  $('chkAll').addEventListener('change', (e) => { P.proposals.forEach(p => { p.checked = e.target.checked; }); renderReview(); });
  // collapseRadioGroups auch hier (Pruefbericht 2026-07-17): ohne die Zusammenfassung entstanden nach
  // einem Kontextwechsel je Radio-OPTION eigene Zeilen, und "Ausfuellen" meldete die nicht passenden
  // Optionen faelschlich als Fehlschlag (der collapste Weg fuellt die Gruppe ueber p.refs korrekt).
  $('contextMode').addEventListener('change', () => { if (P.descriptors.length) { P.proposals = collapseRadioGroups(BxaMatcher.match(P.descriptors, P.dict, $('contextMode').value)); P.proposals.forEach(p => { p.checked = p.confidence >= 0.6; }); renderReview(); } });
  $('btnApplyProfile').addEventListener('click', applyProfile);
  $('btnDeleteProfile').addEventListener('click', deleteProfile);
  // Training beenden fuehrt zurueck zum Assistenten.
  $('btnTrainStop').addEventListener('click', stopTraining);
  $('btnTrainStop').addEventListener('click', () => zeigeAnsicht('assistent'));
  $('btnTrainSave').addEventListener('click', saveTraining);
  $('btnTrainAssignAction').addEventListener('click', assignAction);
  $('trainKeySearch').addEventListener('input', (e) => renderKeyList(e.target.value));
  document.querySelectorAll('input[name=trainKind]').forEach(r => r.addEventListener('change', toggleTrainKind));
  $('btnAiMap').addEventListener('click', aiMapFields);
  $('btnAiChat').addEventListener('click', aiChat);
  $('btnAiApply').addEventListener('click', aiApply);
  $('btnPdf').addEventListener('click', downloadProtocolPdf);
  $('btnPrint').addEventListener('click', async () => { try { await send({ type: 'BXA_PRINT' }); } catch (e) { toast(String(e.message || e)); } });
  $('btnDoku').addEventListener('click', sendProtocolToCase);
  $('btnAgentStart').addEventListener('click', agentRun);
  $('btnAgentStop').addEventListener('click', () => { P.agent.stop = true; agentConfirm(false); });
  $('btnAgentConfirmYes').addEventListener('click', () => agentConfirm(true));
  $('btnAgentConfirmNo').addEventListener('click', () => agentConfirm(false));

  // Pick-Ereignisse aus dem Content-Script (Training) + Rechtsklick-Anstoss (Feature v0.2.0 #4).
  BX.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'BXA_PICKED') onPicked(msg.descriptor);
    else if (msg && msg.type === 'BXA_CONTEXT_FILL') handleContextFill();
  });

  // Mehrseiten-Gedächtnis (Feature v0.2.0 #8): navigiert der aktive Tab auf eine NEUE Seite,
  // waehrend bereits gescannt wurde, Banner "Neue Seite scannen" anbieten.
  if (BX.tabs?.onUpdated) {
    BX.tabs.onUpdated.addListener((tabId, info, tab) => {
      if (tabId !== P.tabId || !P.dict.length || !P.scannedUrls.size) return;
      if (info.status !== 'complete' || !tab || !tab.url) return;
      // Seiten-Chip-Navigation: Zielseite fertig geladen → automatisch neu erkennen.
      if (P.pendingChipUrl && tab.url === P.pendingChipUrl) { P.pendingChipUrl = ''; doScan(); return; }
      if (tab.url === P.currentScanUrl) return;
      // BEKANNTE Seite (z. B. „Zurück" im Formular): automatisch neu erkennen – die gemerkten
      // Häkchen dieser Seite kommen über restorePageDecisions zurück (Nutzerwunsch 2026-07-17).
      if (P.scannedUrls.has(tab.url)) { doScan(); return; }
      $('pageChangeBanner').classList.remove('hidden');
    });
  }

  // Panel-Schliessen beendet einen laufenden Trainings-Pick (Audit 2026-07-18): sonst hielte der
  // capture-Click-Handler der Seite jeden Klick weiter auf, bis die Seite neu geladen wird.
  window.addEventListener('pagehide', () => {
    if (P.training.active && P.tabId != null) {
      try { const pr = BX.tabs.sendMessage(P.tabId, { type: 'BXA_PICK_STOP' }); if (pr && pr.catch) pr.catch(() => {}); } catch (_e) { /* best effort */ }
    }
  });

  refreshGrantBanner().catch(() => {});
  updateEmptyState();
  aktualisiereKontext();
  await refreshConnection();
  await loadCases();
  // Portale schon beim PANEL-START anzeigen (Bugfix 2026-07-17): matchProfiles laeuft sonst erst
  // nach einem Scan - der Kern-Anwendungsfall ist aber "Portal zuerst oeffnen, DANN dort arbeiten".
  try { await loadVault(); } catch (_e) { /* Ablage ist optional */ }
  try { await loadProfiles(); await loadSendPortals(); renderPortals(); renderFileList(); } catch (_e) { /* Portale sind unkritisch */ }
  // Falls die Erweiterung ueber das Rechtsklick-Menue geoeffnet wurde: direkt scannen.
  try {
    const s = await BX.storage.local.get(['contextFill']);
    if (s.contextFill && Date.now() - (s.contextFill.ts || 0) < 15000) {
      await BX.storage.local.remove('contextFill');
      handleContextFill();
    }
  } catch (_e) { /* */ }
});

// Rechtsklick "Mit Falldaten füllen" -> scannt, wenn ein Fall gewaehlt ist (fuellt NICHT automatisch;
// der Nutzer prueft die Prueflliste).
function handleContextFill() {
  if (!P.dict.length) { toast('Bitte zuerst einen Fall wählen, dann „Formular scannen".'); return; }
  doScan();
}
