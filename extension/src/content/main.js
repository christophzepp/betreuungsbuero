// Content-Router (Plan Abschnitt BR): einziger Message-Endpunkt des Content-Scripts. Antwortet
// portabel via sendResponse + return true (Chrome- und Firefox-kompatibel). Seiteninhalt ist
// DATEN - dieses Script fuehrt ausschliesslich vom Panel angeforderte, konkrete Operationen aus.
(() => {
  if (window.__BXA_MAIN__) return;
  window.__BXA_MAIN__ = true;

  const B = (typeof browser !== 'undefined' && browser?.runtime) ? browser : chrome;
  const S = () => window.__BXA_SCANNER__;
  const F = () => window.__BXA_FILLER__;
  const O = () => window.__BXA_OVERLAY__;
  const SUBMIT_RX = /(absenden|abschicken|senden|übermitteln|uebermitteln|beantragen|verbindlich|kostenpflichtig|bestätigen|bestaetigen|abgeben|einreichen|submit)/i;

  function clickMeta(el) {
    const label = String(el.textContent || el.value || el.getAttribute?.('aria-label') || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const tag = el.tagName || '';
    const type = (tag === 'BUTTON' || tag === 'INPUT') ? String(el.type || '').toLowerCase() : '';
    return { label, type, requiresConfirmation: type === 'submit' || type === 'image' || SUBMIT_RX.test(label) };
  }

  // Zuletzt fokussiertes editierbares Element (Nutzerwunsch 2026-07-18: Kopier-Wert direkt ins
  // markierte Feld eintragen). capture-Phase: der Fokus-Zustand bleibt auch erhalten, wenn der
  // Nutzer anschliessend ins Panel klickt (die Seite behaelt ihr activeElement).
  const EDITABLE_SEL = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]),select,textarea,[contenteditable="true"]';
  let lastEditable = null;
  document.addEventListener('focusin', (e) => {
    try {
      const target = e.composedPath ? e.composedPath()[0] : e.target;
      if (target && target.matches && target.matches(EDITABLE_SEL)) lastEditable = target;
    } catch (_err) { /* */ }
  }, true);
  function activeEditable() {
    let el = document.activeElement;
    try {
      // Fokus kann durch mehrere offene Shadow Roots und same-origin-iframes laufen. document.
      // activeElement liefert dort jeweils nur Host bzw. iframe; bis zum echten Feld hinabsteigen.
      while (el) {
        if (el.shadowRoot?.activeElement) { el = el.shadowRoot.activeElement; continue; }
        if ((el.tagName === 'IFRAME' || el.tagName === 'FRAME') && el.contentDocument?.activeElement) { el = el.contentDocument.activeElement; continue; }
        break;
      }
    } catch (_e) { el = null; /* cross-origin */ }
    if (el && el.matches && el.matches(EDITABLE_SEL)) return el;
    if (lastEditable && lastEditable.isConnected) return lastEditable;
    return null;
  }

  async function handle(msg) {
    switch (msg.type) {
      case 'BXA_PING':
        return { ok: true };

      case 'BXA_SCAN':
        return S().scan();

      case 'BXA_PAGE_INFO':
        return { url: location.href, title: document.title, origin: location.origin };

      case 'BXA_FILL': {
        // items: [{ref, value, key}] -> Ergebnis je Item; erfolgreiche Felder werden markiert.
        // Ein item kann mehrere refs tragen (Radio-Gruppe): dann wird die passende Option geklickt,
        // die uebrigen sauber uebersprungen (skipped, KEIN Fehler).
        const results = [];
        for (const item of msg.items || []) {
          const refs = Array.isArray(item.refs) && item.refs.length ? item.refs : [item.ref];
          let done = null;
          for (const ref of refs) {
            const el = S().get(ref);
            if (!el) { if (!done) done = { ref, ok: false, reason: 'Element nicht mehr vorhanden (Seite geändert?)' }; continue; }
            try {
              const r = F().fillOne(el, item.value);
              if (r.ok) { O().highlight(el); done = { ref, ok: true, applied: r.applied || '' }; break; }
              if (r.skipped) { if (!done) done = { ref, ok: false, skipped: true }; continue; }
              done = { ref, ok: false, reason: r.reason || '' };
            } catch (e) {
              done = { ref, ok: false, reason: String(e && e.message || e) };
            }
          }
          results.push(done || { ref: item.ref, ok: false, reason: 'Keine passende Option gefunden.' });
        }
        return { results };
      }

      case 'BXA_FILL_ACTIVE': {
        // Wert in das zuvor angeklickte/fokussierte Feld der Seite schreiben (kein Submit,
        // gleiche Setz-Logik wie beim Ausfuellen der Pruefliste).
        const el = activeEditable();
        if (!el) return { ok: false, reason: 'Kein Eingabefeld auf der Seite ausgewählt.' };
        const r = F().fillOne(el, msg.value);
        if (r.ok) O().highlight(el);
        let label = '';
        try { label = ((el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute('aria-label') || el.name || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 40); } catch (_e) { /* */ }
        return { ok: !!r.ok, reason: r.reason || '', label };
      }

      case 'BXA_CLICK': {
        const el = S().get(msg.ref);
        if (!el) return { ok: false, reason: 'Element nicht mehr vorhanden.' };
        const meta = clickMeta(el);
        // Zweite, content-seitige Absende-Sperre: selbst wenn ein altes Profil den Button-Typ nicht
        // gespeichert hat, darf ein echter Submit niemals ohne die explizite Bestaetigung klicken.
        if (meta.requiresConfirmation && msg.confirmed !== true) {
          return { ok: false, requiresConfirmation: true, label: meta.label, reason: 'Ausdrückliche Bestätigung erforderlich.' };
        }
        O().highlight(el, 'action');
        return { ...F().clickEl(el), label: meta.label, type: meta.type };
      }

      case 'BXA_SET_FILE': {
        // Upload-Helfer (Feature v0.2.0 #6): Panel liefert die Falldokument-Bytes als base64.
        const el = S().get(msg.ref);
        if (!el) return { ok: false, reason: 'Datei-Feld nicht mehr vorhanden.' };
        try {
          const bin = atob(msg.base64 || '');
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          const FileCtor = el.ownerDocument?.defaultView?.File || File;
          const file = new FileCtor([u8], msg.filename || 'dokument', { type: msg.mime || 'application/octet-stream' });
          const r = F().setFile(el, file);
          if (r.ok) O().highlight(el);
          return r;
        } catch (e) {
          return { ok: false, reason: String(e && e.message || e) };
        }
      }

      case 'BXA_RESOLVE_PROFILE': {
        // profile.fields/actions mit selectorChain -> frische Refs + Anwendbarkeits-Report.
        const fields = (msg.profile?.fields || []).map(f => {
          const hit = S().resolveChain(f.selectorChain);
          return { key: f.key, ref: hit?.ref || null, matchedBy: hit?.matchedBy || null };
        });
        const actions = (msg.profile?.actions || []).map(a => {
          const hit = S().resolveChain(a.selectorChain);
          const el = hit?.ref ? S().get(hit.ref) : null;
          const meta = el ? clickMeta(el) : { label: '', type: '', requiresConfirmation: false };
          return { action: a.action, label: a.label, liveLabel: meta.label, type: meta.type,
            requiresConfirmation: meta.requiresConfirmation, ref: hit?.ref || null, matchedBy: hit?.matchedBy || null };
        });
        return { fields, actions, url: location.href };
      }

      case 'BXA_PICK_START':
        O().startPick((el) => {
          const d = S().describe(el);
          // Panel informieren (Panel lauscht auf runtime.onMessage). Ist das Panel geschlossen
          // (kein Empfaenger), den Pick-Modus SOFORT beenden - sonst finge der capture-Click-
          // Handler dauerhaft jeden Klick der Seite ab (Audit 2026-07-18).
          try {
            const pr = B.runtime.sendMessage({ type: 'BXA_PICKED', descriptor: d });
            if (pr && pr.catch) pr.catch(() => O().stopPick());
          } catch (_e) { O().stopPick(); }
        });
        return { ok: true };

      case 'BXA_PICK_STOP':
        O().stopPick();
        return { ok: true };

      case 'BXA_CLEAR_HIGHLIGHTS':
        O().clearHighlights();
        return { ok: true };

      case 'BXA_PRINT':
        // "Seite drucken (PDF)": oeffnet den Druckdialog des Browsers - der Nutzer waehlt dort
        // "Als PDF sichern" und erhaelt die VISUELLE Kopie des ausgefuellten Formulars
        // (zusaetzlich zum eigenen Ausfuellprotokoll-PDF der Extension).
        setTimeout(() => { try { window.print(); } catch (_e) { /* blockiert */ } }, 50);
        return { ok: true };

      default:
        return { error: 'Unbekannter Nachrichtentyp: ' + msg.type };
    }
  }

  B.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('BXA_')) return undefined;
    handle(msg).then(sendResponse).catch(e => sendResponse({ error: String(e && e.message || e) }));
    return true; // async response
  });
})();
