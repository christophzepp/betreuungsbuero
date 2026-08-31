// Server-API der Extension (Plan Abschnitt BR): alle Aufrufe gehen an die Bearer-Fassade
// /api/ext/* des Betreuungsbuero-Servers. Extension-SEITEN (Panel/Options) und der Background-
// Worker umgehen CORS fuer Origins mit erteilter Host-Permission - Content-Scripts duerfen den
// Server dagegen NIE direkt ansprechen (sie erben den Seiten-Origin). Serverseitig existiert
// vom Token nur der SHA-256-Hash; hier lebt der Klartext ausschliesslich in storage.local.
/* global BX */
// eslint-disable-next-line no-unused-vars
const BxaApi = (() => {

  async function settings() {
    const s = await BX.storage.local.get(['serverUrl', 'apiToken']);
    return { serverUrl: (s.serverUrl || '').replace(/\/+$/, ''), apiToken: s.apiToken || '' };
  }

  async function call(path, { method = 'GET', body = null, auth = true } = {}) {
    const { serverUrl, apiToken } = await settings();
    if (!serverUrl) throw new Error('Keine Server-URL konfiguriert (Optionen der Erweiterung).');
    if (auth && !apiToken) throw new Error('Kein API-Token konfiguriert (Optionen der Erweiterung).');
    const headers = {};
    if (auth) headers.Authorization = 'Bearer ' + apiToken;
    if (body != null) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(serverUrl + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
    } catch (_e) {
      throw new Error('Server nicht erreichbar (' + serverUrl + '). Host-Zugriff erlaubt und Server gestartet?');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Serverfehler HTTP ' + res.status));
    return data;
  }

  // Roh-Bytes eines Falldokuments (Feature v0.2.0 #6 Upload-Helfer) - liefert einen Blob statt JSON.
  async function callBlob(path) {
    const { serverUrl, apiToken } = await settings();
    if (!serverUrl) throw new Error('Keine Server-URL konfiguriert (Optionen der Erweiterung).');
    if (!apiToken) throw new Error('Kein API-Token konfiguriert (Optionen der Erweiterung).');
    let res;
    try {
      res = await fetch(serverUrl + path, { headers: { Authorization: 'Bearer ' + apiToken } });
    } catch (_e) {
      throw new Error('Server nicht erreichbar (' + serverUrl + ').');
    }
    if (!res.ok) throw new Error('Serverfehler HTTP ' + res.status);
    return await res.blob();
  }

  return {
    settings,
    handshake: () => call('/api/ext/handshake', { auth: false }),
    tokenCheck: () => call('/api/ext/token-check', { method: 'POST' }),
    cases: () => call('/api/ext/cases'),
    filldata: (caseId) => call('/api/ext/cases/' + encodeURIComponent(caseId) + '/filldata'),
    siteProfiles: () => call('/api/ext/site-profiles'),
    sendPortals: () => call('/api/ext/send-portals'),
    siteProfileSave: (profile) => profile.id
      ? call('/api/ext/site-profiles/' + encodeURIComponent(profile.id), { method: 'PUT', body: profile })
      : call('/api/ext/site-profiles', { method: 'POST', body: profile }),
    siteProfileDelete: (id) => call('/api/ext/site-profiles/' + encodeURIComponent(id), { method: 'DELETE' }),
    aiMapFields: (payload) => call('/api/ext/ai/map-fields', { method: 'POST', body: payload }),
    aiChat: (payload) => call('/api/ext/ai/chat', { method: 'POST', body: payload }),
    aiAgentStep: (payload) => call('/api/ext/ai/agent-step', { method: 'POST', body: payload }),
    formProtocol: (caseId, payload) => call('/api/ext/cases/' + encodeURIComponent(caseId) + '/form-protocol', { method: 'POST', body: payload }),
    // v0.2.0: Statistik-Rueckmeldung (#11), Dokumentenliste + Byte-Abruf fuer Upload-Helfer (#6)
    profileApplyStat: (id, hits, misses) => call('/api/ext/site-profiles/' + encodeURIComponent(id) + '/apply-stat', { method: 'POST', body: { hits, misses } }),
    caseDocuments: (caseId) => call('/api/ext/cases/' + encodeURIComponent(caseId) + '/documents'),
    caseDocumentBlob: (caseId, docId) => callBlob('/api/ext/cases/' + encodeURIComponent(caseId) + '/documents/' + encodeURIComponent(docId) + '/file')
  };
})();
