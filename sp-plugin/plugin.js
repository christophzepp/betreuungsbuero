/* Super-Productivity-Plugin "Betreuungsbüro Sync" (PLAN-AUFGABEN-SYNC, Etappe 6).
 *
 * Verdrahtung der geprüften Kernlogik (sync-core.js) mit Super Productivitys PluginAPI.
 * Defensive Bauweise: jede PluginAPI-Methode wird vor Gebrauch geprüft (die Plugin-API ist
 * jung und wächst je SP-Version) - fehlt etwas, meldet das Plugin das lesbar statt zu raten.
 *
 * Einrichtung: siehe README.md (Server-URL + API-Token, beides landet in SPs synchronisiertem
 * Plugin-Speicher). Abgleich: alle 60 Sekunden + nach jedem Task-Ereignis (entprellt).
 */

/* global PluginAPI */
'use strict';

(function () {
  const CORE = (typeof module !== 'undefined' && module.exports) || (typeof window !== 'undefined' && window.__bbSyncCore);
  // sync-core.js wird von SP als zweite Datei geladen (siehe README) und meldet sich unter
  // window.__bbSyncCore; im Node-Prüfstand kommt es per require.
  const core = CORE && CORE.reconcile ? CORE : (typeof require === 'function' ? require('./sync-core.js') : null);

  if (typeof PluginAPI === 'undefined') {
    // Ausserhalb von SP (z. B. im Pruefstand) ist hier Schluss - plugin.js ist nur Verdrahtung.
    return;
  }

  const api = PluginAPI;
  const has = (name) => typeof api[name] === 'function';
  const snack = (msg, type) => { if (has('showSnack')) api.showSnack({ msg, type: type || 'SUCCESS' }); };

  let cfg = { baseUrl: '', token: '' };
  let mapping = {};
  let busy = false;
  let timer = null;

  async function loadState() {
    if (!has('loadSyncedData')) return;
    try {
      const raw = await api.loadSyncedData();
      const data = raw ? JSON.parse(raw) : {};
      cfg = Object.assign(cfg, data.cfg || {});
      mapping = data.mapping || {};
    } catch (_e) { /* Erststart */ }
  }
  async function saveState() {
    if (!has('persistDataSynced')) return;
    await api.persistDataSynced(JSON.stringify({ cfg, mapping }));
  }

  async function spTaskList() {
    if (!has('getTasks')) throw new Error('PluginAPI.getTasks fehlt in dieser SP-Version.');
    const tasks = await api.getTasks();
    return (tasks || []).map((t) => ({
      id: t.id, title: t.title || '', notes: t.notes || '', isDone: !!t.isDone,
      dueDay: t.dueDay || '', updatedAt: t.modified || t.created || 0
    }));
  }

  async function applyOps(ops, client) {
    let changed = false;
    for (const op of ops) {
      try {
        if (op.type === 'sp-create' && has('addTask')) {
          const spId = await api.addTask({
            title: (op.remote.readOnly ? '🔒 ' : '') + op.remote.title,
            notes: op.remote.description || '',
            dueDay: op.remote.dueAt || undefined
          });
          if (spId) { mapping[String(op.remote.id)] = String(spId); changed = true; }
        } else if (op.type === 'sp-update' && has('updateTask')) {
          await api.updateTask(op.spId, {
            title: (op.remote.readOnly ? '🔒 ' : '') + op.remote.title,
            dueDay: op.remote.dueAt || undefined,
            isDone: !!op.remote.done
          });
        } else if (op.type === 'sp-complete' && has('updateTask')) {
          await api.updateTask(op.spId, { isDone: true });
        } else if (op.type === 'remote-complete') {
          await client.updateTodo(op.remoteId, { done: true });
        } else if (op.type === 'remote-update') {
          await client.updateTodo(op.remoteId, op.patch);
        } else if (op.type === 'mapping-drop') {
          delete mapping[String(op.remoteId)];
          changed = true;
        }
      } catch (error) {
        console.warn('[bb-sync] Schritt fehlgeschlagen:', op.type, error.message);
      }
    }
    if (changed) await saveState();
  }

  async function runSync(quiet) {
    if (busy) return;
    if (!cfg.baseUrl || !cfg.token) { if (!quiet) snack('Bitte zuerst Server-URL und API-Token hinterlegen.', 'ERROR'); return; }
    busy = true;
    try {
      const client = core.createClient({ baseUrl: cfg.baseUrl, token: cfg.token });
      const [remote, sp] = await Promise.all([client.listTodos(), spTaskList()]);
      const ops = core.reconcile({ remoteTodos: remote.todos || [], spTasks: sp, mapping });
      await applyOps(ops, client);
      if (!quiet) snack(`Abgleich fertig (${ops.length} Schritt${ops.length === 1 ? '' : 'e'}).`);
    } catch (error) {
      if (!quiet) snack(`Abgleich fehlgeschlagen: ${error.message}`, 'ERROR');
      console.warn('[bb-sync]', error);
    } finally {
      busy = false;
    }
  }

  function scheduleSoon() {
    clearTimeout(timer);
    timer = setTimeout(() => runSync(true), 2500);
  }

  (async function init() {
    await loadState();
    if (has('registerHook')) {
      try { api.registerHook('taskComplete', scheduleSoon); } catch (_e) { /* Hook-Namen variieren je Version */ }
      try { api.registerHook('taskUpdate', scheduleSoon); } catch (_e) { /* dito */ }
    }
    if (has('registerHeaderButton')) {
      api.registerHeaderButton({
        label: 'Büro-Sync',
        icon: 'sync',
        onClick: () => runSync(false)
      });
    }
    if (has('registerSidePanelButton') && has('showIndexHtmlAsView')) {
      // Optionaler Einstellungsdialog - erst relevant, wenn ein index.html mitgeliefert wird.
    }
    // Erstkonfiguration ohne eigene Oberfläche: über den Dialog der PluginAPI, wenn vorhanden.
    if (!cfg.baseUrl && has('openDialog')) {
      try {
        const result = await api.openDialog({
          title: 'Betreuungsbüro Sync einrichten',
          htmlContent: '<p>Server-URL und API-Token eintragen (Token: Admin-Panel → Browser-Extension/API-Tokens).</p>',
          fields: [
            { name: 'baseUrl', label: 'Server-URL', type: 'text' },
            { name: 'token', label: 'API-Token', type: 'password' }
          ]
        });
        if (result && result.baseUrl) { cfg = { baseUrl: result.baseUrl, token: result.token || '' }; await saveState(); }
      } catch (_e) { /* Dialog-API nicht vorhanden - README beschreibt den Speicherweg */ }
    }
    setInterval(() => runSync(true), 60000);
    runSync(true);
  })();
})();
