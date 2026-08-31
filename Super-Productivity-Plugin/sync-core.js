/* Kernlogik des Super-Productivity-Plugins "Betreuungsbüro Sync" - BEWUSST ohne jede
 * SP-Abhängigkeit geschrieben, damit sie im Prüfstand des Servers (node:test) gegen einen
 * Mock der /api/ext-Fassade laufen kann. plugin.js verdrahtet diese Logik mit der
 * PluginAPI von Super Productivity.
 *
 * Abgleichmodell (bewusst schlicht und dadurch vorhersagbar):
 * - Die Büro-Anwendung ist die führende Quelle. Der Feed hierher ist vollständig
 *   (alle offenen + kürzlich erledigte Aufgaben).
 * - mapping: { [remoteId]: spTaskId } lebt in SPs synchronisiertem Plugin-Speicher.
 * - reconcile() vergleicht drei Mengen (remote, SP, mapping) und liefert reine
 *   Arbeitsanweisungen (ops) zurück - wer sie ausführt (plugin.js/Prüfstand), ist egal.
 * - Fristen/Wiedervorlagen (readOnly=true) werden in SP angelegt/aktualisiert, aber
 *   Änderungen AUS SP an ihnen werden nie zurückgeschrieben (Nur-Export des Servers;
 *   der lehnt sie ohnehin mit 403 ab - wir sparen uns den vergeblichen Versuch).
 */

'use strict';

function createClient({ baseUrl, token, fetchImpl }) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) throw new Error('Kein fetch verfügbar.');
  const base = String(baseUrl || '').replace(/\/+$/, '');
  async function call(method, path, body) {
    const res = await f(`${base}/api/ext${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_e) { /* unten */ }
    if (!res.ok) throw new Error((json && json.error) || `Server antwortete mit Status ${res.status}.`);
    return json;
  }
  return {
    listTodos: () => call('GET', '/todos'),
    createTodo: (todo) => call('POST', '/todos', todo),
    updateTodo: (id, patch) => call('PUT', `/todos/${encodeURIComponent(id)}`, patch)
  };
}

/* remoteTodos: [{id,title,description,dueAt,done,priority,readOnly,updatedAt}]
 * spTasks:     [{id,title,notes,isDone,dueDay}]           (SP-Form, von plugin.js geliefert)
 * mapping:     { remoteId: spTaskId }
 * Rückgabe-ops:
 *   {type:'sp-create', remote}                 -> Aufgabe in SP anlegen, danach mapping setzen
 *   {type:'sp-update', spId, remote}           -> SP-Aufgabe an den Bürostand angleichen
 *   {type:'sp-complete', spId}                 -> in SP abhaken (Büro sagt erledigt)
 *   {type:'remote-complete', remoteId}         -> Erledigt-Rückmeldung an das Büro
 *   {type:'remote-update', remoteId, patch}    -> Titel/Datum aus SP zurückschreiben
 *   {type:'mapping-drop', remoteId}            -> Zuordnung aufräumen (SP-Aufgabe verschwunden
 *                                                 UND remote erledigt/verschwunden)
 */
function reconcile({ remoteTodos, spTasks, mapping }) {
  const ops = [];
  const spById = new Map((spTasks || []).map((t) => [String(t.id), t]));
  const seenRemote = new Set();

  for (const remote of remoteTodos || []) {
    const remoteId = String(remote.id);
    seenRemote.add(remoteId);
    const spId = mapping[remoteId];
    const sp = spId ? spById.get(String(spId)) : null;

    if (!sp) {
      if (!remote.done) ops.push({ type: 'sp-create', remote });
      else if (spId) ops.push({ type: 'mapping-drop', remoteId });
      continue;
    }

    // Erledigt-Zustände zuerst - sie schlagen Textunterschiede.
    if (remote.done && !sp.isDone) { ops.push({ type: 'sp-complete', spId: sp.id }); continue; }
    if (!remote.done && sp.isDone) {
      if (remote.readOnly) {
        // Frist in SP abgehakt: dem Büro NICHT melden (Nur-Export) - SP-Seite zurücksetzen,
        // damit die Frist sichtbar offen bleibt.
        ops.push({ type: 'sp-update', spId: sp.id, remote });
      } else {
        ops.push({ type: 'remote-complete', remoteId });
      }
      continue;
    }

    const titleDiffers = String(sp.title || '') !== String(remote.title || '');
    const dueDiffers = String(sp.dueDay || '') !== String(remote.dueAt || '');
    if (titleDiffers || dueDiffers) {
      if (remote.readOnly) {
        ops.push({ type: 'sp-update', spId: sp.id, remote });
      } else {
        // Beide offen, Texte verschieden: das Büro ist die führende Quelle, AUSSER die
        // SP-Seite ist nachweislich neuer (Nutzer hat gerade in SP getippt).
        const spNewer = Number(sp.updatedAt || 0) > Date.parse(remote.updatedAt || 0);
        if (spNewer) ops.push({ type: 'remote-update', remoteId, patch: { title: sp.title, dueAt: sp.dueDay || '' } });
        else ops.push({ type: 'sp-update', spId: sp.id, remote });
      }
    }
  }

  // Zuordnungen, deren Remote-Seite verschwunden ist (aus dem Feedfenster gefallen oder
  // gelöscht): SP-Seite abhaken lassen entscheidet der Nutzer - wir räumen nur das Mapping.
  for (const remoteId of Object.keys(mapping || {})) {
    if (!seenRemote.has(remoteId)) ops.push({ type: 'mapping-drop', remoteId });
  }
  return ops;
}

/* SP-Aufgaben, die es im Büro noch gar nicht gibt (in SP angelegt, kein Mapping-Treffer):
 * bewusst NUR auf ausdrücklichen Knopfdruck übertragen (pushNewFromSp), nie automatisch -
 * sonst würde jede private SP-Notiz im Büro landen. */
function newSpTasks({ spTasks, mapping }) {
  const mapped = new Set(Object.values(mapping || {}).map(String));
  return (spTasks || []).filter((t) => !mapped.has(String(t.id)) && !t.isDone);
}

if (typeof module !== 'undefined') module.exports = { createClient, reconcile, newSpTasks };
