// Background (Plan Abschnitt BR): bewusst schlank. Server-API-Aufrufe laufen direkt aus den
// Extension-SEITEN (Panel/Options - beide umgehen CORS mit erteilter Host-Permission genau wie
// der Background). Hier liegen die Dinge mit persistentem Kontext: Panel/Sidebar oeffnen,
// das "Formular bekannt"-Badge (v0.2.0 #1) und das Rechtsklick-Menue (v0.2.0 #4).
/* global BX */

// Chrome: Klick aufs Extension-Icon oeffnet das Side Panel im aktuellen Fenster.
if (BX.sidePanel?.setPanelBehavior) {
  BX.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} else if (BX.sidebarAction && BX.action?.onClicked) {
  // Firefox: sidebarAction.toggle() ist nur in User-Gesten erlaubt - der Action-Klick ist eine.
  BX.action.onClicked.addListener(() => { try { BX.sidebarAction.toggle(); } catch (_e) { /* aeltere FF */ } });
}

// ===== Badge "Formular bekannt" (Feature v0.2.0 #1) =====
// Zeigt am Erweiterungs-Icon einen gruenen Haken, wenn fuer die aktive Seite ein trainiertes
// Site-Profil vorliegt. Datenquelle ist der lokale Profil-Cache (vom Panel bei jedem Laden
// aktualisiert) + lokale Profile - KEIN Serveraufruf bei jedem Tab-Wechsel (schnell, offline-fest).

async function knownProfiles() {
  const s = await BX.storage.local.get(['profileCache', 'localProfiles']);
  return [...(s.profileCache || []), ...(s.localProfiles || [])];
}

function profileMatchesUrl(profiles, url) {
  if (!url || !/^https?:/.test(url)) return false;
  return profiles.some(p => {
    const pats = (p.mapping && p.mapping.urlPatterns) || p.urlPatterns || [];
    return pats.some(pat => { try { return String(url).startsWith(pat); } catch (_e) { return false; } });
  });
}

async function updateBadge(tabId, url) {
  try {
    const match = profileMatchesUrl(await knownProfiles(), url);
    if (match) {
      await BX.action.setBadgeText({ tabId, text: '✓' });
      try { await BX.action.setBadgeBackgroundColor({ tabId, color: '#2e7d32' }); } catch (_e) { /* */ }
      try { await BX.action.setTitle({ tabId, title: 'Formular bekannt – trainiertes Profil verfügbar' }); } catch (_e) { /* */ }
    } else {
      await BX.action.setBadgeText({ tabId, text: '' });
      try { await BX.action.setTitle({ tabId, title: 'Formular-Assistent öffnen' }); } catch (_e) { /* */ }
    }
  } catch (_e) { /* action pro Tab evtl. nicht verfuegbar */ }
}

if (BX.tabs?.onUpdated) {
  BX.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === 'complete' || info.url) updateBadge(tabId, tab && tab.url);
  });
}
if (BX.tabs?.onActivated) {
  BX.tabs.onActivated.addListener(async ({ tabId }) => {
    try { const t = await BX.tabs.get(tabId); updateBadge(tabId, t.url); } catch (_e) { /* */ }
  });
}

// ===== Rechtsklick-Menue "Mit Falldaten füllen" (Feature v0.2.0 #4) =====
// Oeffnet Panel/Sidebar (Klick = User-Geste) und stoesst den Scan an. Es wird NICHTS abgesendet -
// der Nutzer prueft die Prueflliste und fuellt wie gewohnt manuell.
const CTX_FILL = 'bxa-context-fill';
async function installContextMenu() {
  if (!BX.contextMenus) return;
  // removeAll ist asynchron. Ohne await konnte das unmittelbar danach erzeugte Menü vom noch
  // laufenden removeAll wieder entfernt werden und verschwand sporadisch nach Browserstarts.
  try { await BX.contextMenus.removeAll(); } catch (_e) { /* */ }
  try {
    BX.contextMenus.create({ id: CTX_FILL, title: 'Mit Falldaten füllen (Formular-Assistent)', contexts: ['editable', 'page'] });
  } catch (_e) { /* doppelte ID beim Update - Menue existiert bereits */ }
}
let contextMenuInstall = Promise.resolve();
function queueContextMenuInstall() {
  contextMenuInstall = contextMenuInstall.catch(() => {}).then(installContextMenu);
  return contextMenuInstall;
}
if (BX.runtime?.onInstalled) BX.runtime.onInstalled.addListener(() => { queueContextMenuInstall().catch(() => {}); });
if (BX.runtime?.onStartup) BX.runtime.onStartup.addListener(() => { queueContextMenuInstall().catch(() => {}); });
queueContextMenuInstall().catch(() => {});

if (BX.contextMenus?.onClicked) {
  BX.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CTX_FILL) return;
    // Panel/Sidebar ZUERST und synchron oeffnen (Audit 2026-07-18): Firefox verwirft den
    // User-Gesten-Kontext nach einem await (vgl. panel.js btnGrantSites) - stand storage.set
    // davor, schlug sidebarAction.open() still fehl und die Sidebar blieb zu.
    try {
      let opening = null;
      if (BX.sidePanel && BX.sidePanel.open) opening = BX.sidePanel.open({ windowId: tab && tab.windowId });
      else if (BX.sidebarAction && BX.sidebarAction.open) opening = BX.sidebarAction.open();
      if (opening && opening.catch) opening.catch(() => {});
    } catch (_e) { /* */ }
    Promise.resolve(BX.storage.local.set({ contextFill: { ts: Date.now(), tabId: tab && tab.id } }))
      .catch(() => {})
      .then(() => {
        // Panel ist evtl. schon offen -> per Nachricht direkt anstossen (schluckt Fehler, wenn zu).
        try { const pr = BX.runtime.sendMessage({ type: 'BXA_CONTEXT_FILL' }); if (pr && pr.catch) pr.catch(() => {}); } catch (_e) { /* */ }
      });
  });
}
