// Formular-Scanner (Content-Script, Plan Abschnitt BR Phase E2): baut je interaktivem Element
// einen kompakten Deskriptor. Traversiert das Top-Dokument, offene Shadow Roots und same-origin-
// iframes (cross-origin ist technisch unzugaenglich und wird nur als Hinweis gezaehlt).
// Elemente leben NUR hier (Ref-Map) - nach aussen gehen ausschliesslich serialisierbare Daten.
(() => {
  if (window.__BXA_SCANNER__) return;

  const state = {
    refs: new Map(),   // ref -> WeakRef(Element)
    byEl: new WeakMap(), // Element -> ref: Refs bleiben ueber Re-Scans STABIL (Audit 2026-07-18).
    // Frueher leerte jeder Scan die Map und vergab r1..rN neu - im Panel gehaltene Refs (Pruefliste,
    // Profil-Aktionen) zeigten dann auf ZUFAELLIG gleichnummerierte Elemente der neuen Seite; ein
    // veralteter Aktions-Button konnte so die Submit-Sperre umgehen. Jetzt behaelt jedes Element
    // seinen Ref, der Zaehler laeuft weiter, und Refs auf entfernte Elemente laufen kontrolliert
    // ins Leere (get prueft isConnected).
    counter: 0,
    crossOriginFrames: 0
  };
  // Instanz-Kennung im Ref (Regressionspruefung 2026-07-18): nach einer ECHTEN Navigation wird ein
  // frischer Scanner injiziert, dessen Zaehler sonst wieder bei r1 begaenne - im Panel gehaltene
  // Alt-Refs traefen dann namensgleiche Elemente der NEUEN Seite. Mit Nonce sind Refs verschiedener
  // Dokument-Instanzen garantiert disjunkt; Alt-Refs laufen ins Leere statt ins falsche Ziel.
  const instanceId = Math.random().toString(36).slice(2, 8);

  function refFor(el) {
    let ref = state.byEl.get(el);
    if (!ref) {
      ref = 'r' + instanceId + '.' + (++state.counter);
      state.byEl.set(el, ref);
      // WeakRef statt harter Referenz: die Map darf abgehaengte DOM-Teilbaeume nicht fuer die
      // Dokument-Lebensdauer festpinnen (Speicher bei SPA-Wizards mit vielen Re-Scans).
      state.refs.set(ref, new WeakRef(el));
    }
    return ref;
  }

  function text(el) { return (el && (el.textContent || '')).replace(/\s+/g, ' ').trim(); }

  function labelFor(el, doc) {
    // 1) <label for=...>
    if (el.id) {
      try {
        const l = (el.getRootNode() || doc).querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return text(l);
      } catch (_e) { /* CSS.escape/invalid id */ }
    }
    // 2) umschliessendes <label>
    const wrap = el.closest && el.closest('label');
    if (wrap) return text(wrap).slice(0, 160);
    // 3) aria-label / aria-labelledby
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const root = el.getRootNode() || doc;
      const parts = labelledBy.split(/\s+/).map(id => text(root.getElementById ? root.getElementById(id) : null)).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    // 4) Tabellen-/Definitionskontext: vorhergehende Zelle bzw. dt
    const cell = el.closest && el.closest('td,th,dd');
    if (cell) {
      const prev = cell.previousElementSibling;
      if (prev && text(prev)) return text(prev).slice(0, 160);
      if (cell.tagName === 'DD' && cell.previousElementSibling?.tagName === 'DT') return text(cell.previousElementSibling);
    }
    // 5) naechstliegender Vortext (vorheriges Geschwister-Element mit Text)
    let n = el.previousElementSibling;
    for (let i = 0; n && i < 3; i++, n = n.previousElementSibling) {
      const t = text(n);
      if (t && t.length <= 120 && !n.matches('input,select,textarea,button')) return t;
    }
    return '';
  }

  function sectionContext(el) {
    const parts = [];
    // fieldset>legend-Kette (verschachtelte Sektionen)
    let node = el;
    while (node && node.closest) {
      const fs = node.closest('fieldset');
      if (!fs) break;
      const legend = fs.querySelector(':scope > legend');
      if (legend) parts.unshift(text(legend));
      node = fs.parentElement;
    }
    // section[aria-label]
    const sec = el.closest && el.closest('section[aria-label],[role="group"][aria-label]');
    if (sec) parts.unshift(sec.getAttribute('aria-label'));
    // naechste vorausgehende Ueberschrift (im DOM rueckwaerts, begrenzt)
    let cur = el, steps = 0;
    outer: while (cur && steps < 400) {
      let sib = cur.previousElementSibling;
      while (sib && steps < 400) {
        steps++;
        if (/^H[1-6]$/.test(sib.tagName)) { parts.unshift(text(sib)); break outer; }
        const inner = sib.querySelector && sib.querySelector('h1,h2,h3,h4,h5,h6');
        if (inner) { parts.unshift(text([...sib.querySelectorAll('h1,h2,h3,h4,h5,h6')].pop())); break outer; }
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
    }
    return parts.filter(Boolean).join(' | ').slice(0, 240);
  }

  function isVisible(el) {
    if (!el.getClientRects().length) return false;
    const st = el.ownerDocument.defaultView.getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  const BUTTON_SEL = 'button,input[type="submit"],input[type="button"],a[role="button"],[role="button"]';
  const FIELD_SEL = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]),select,textarea,[contenteditable="true"]';

  // Robuste Selektor-Kette fuer Site-Profile (Training): beim Anwenden wird der Reihe nach
  // probiert - Behoerdenseiten aendern gern IDs bei Relaunches.
  function selectorChain(el, label, scope) {
    const chain = [];
    const step = (by, v) => ({ by, v, ...(scope ? { scope } : {}) });
    if (el.id) chain.push(step('id', el.id));
    if (el.name) chain.push(step('name', el.name));
    if (label) chain.push(step('label', label));
    try {
      // kurzer CSS-Pfad (max. 4 Ebenen mit nth-of-type)
      const parts = [];
      let cur = el;
      for (let i = 0; cur && cur.nodeType === 1 && i < 4; i++, cur = cur.parentElement) {
        let seg = cur.tagName.toLowerCase();
        if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
        const sibs = cur.parentElement ? [...cur.parentElement.children].filter(c => c.tagName === cur.tagName) : [];
        if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
        parts.unshift(seg);
      }
      if (parts.length) chain.push(step('css', parts.join('>')));
    } catch (_e) { /* optional */ }
    return chain;
  }

  function describe(el, frameLabel) {
    const kind = el.matches(BUTTON_SEL) ? 'button' : 'field';
    const ref = refFor(el);
    const label = kind === 'button'
      ? (text(el) || el.value || el.getAttribute('aria-label') || el.title || '')
      : labelFor(el, el.ownerDocument);
    const d = {
      ref, kind,
      tag: el.tagName.toLowerCase(),
      // Auch <button> besitzt einen echten Typ. Innerhalb eines Formulars ist der Browser-Default
      // "submit"; das muss bis ins Panel gelangen, damit die harte Absende-Bestaetigung greift.
      type: (el.tagName === 'INPUT' || el.tagName === 'BUTTON') ? (el.type || el.tagName.toLowerCase()) : (el.tagName === 'SELECT' ? 'select' : (el.tagName === 'TEXTAREA' ? 'textarea' : (el.isContentEditable ? 'contenteditable' : el.tagName.toLowerCase()))),
      label: String(label || '').slice(0, 200),
      placeholder: el.getAttribute ? (el.getAttribute('placeholder') || '') : '',
      name: el.name || '', id: el.id || '',
      autocomplete: el.getAttribute ? (el.getAttribute('autocomplete') || '') : '',
      title: el.title || '',
      required: !!el.required,
      value: kind === 'field' ? String(el.value || el.textContent || '').slice(0, 120) : '',
      sectionContext: sectionContext(el),
      frame: frameLabel || '',
      selectorChain: selectorChain(el, label, frameLabel)
    };
    if (d.type === 'select') {
      d.options = [...el.options].slice(0, 60).map(o => ({ value: o.value, text: text(o).slice(0, 80) }));
    }
    if (d.type === 'radio' || d.type === 'checkbox') d.checked = !!el.checked;
    return d;
  }

  function collectRoots(root, frameLabel, roots, seen) {
    if (!root || seen.has(root)) return;
    seen.add(root);
    roots.push({ root, frameLabel });
    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    const start = root.nodeType === 9 ? (root.documentElement || root) : root;
    if (doc && start) {
      // Nicht nur Shadow Roots der Hauptseite, sondern auch ineinander verschachtelte offene
      // Shadow Roots rekursiv erfassen.
      const walker = doc.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        if (node.shadowRoot) collectRoots(node.shadowRoot, frameLabel + '»shadow', roots, seen);
        node = walker.nextNode();
      }
    }
    // same-origin-iframes in Dokumenten UND Shadow Roots. Cross-Origin-Zugriffe bleiben ein reiner
    // Hinweis und brechen den restlichen Scan nicht ab.
    for (const frame of root.querySelectorAll ? root.querySelectorAll('iframe,frame') : []) {
      try {
        const fdoc = frame.contentDocument;
        if (fdoc) collectRoots(fdoc, frameLabel + '»' + (frame.title || frame.name || 'iframe'), roots, seen);
        else state.crossOriginFrames++;
      } catch (_e) { state.crossOriginFrames++; }
    }
  }

  function scan() {
    // BEWUSST kein refs.clear()/counter=0 mehr - siehe Kommentar an state.byEl. Nur tote
    // Eintraege (Element vom GC abgeraeumt) ausduennen.
    for (const [ref, wr] of state.refs) { if (!wr.deref()) state.refs.delete(ref); }
    state.crossOriginFrames = 0;
    const roots = [];
    collectRoots(document, '', roots, new Set());
    const descriptors = [];
    for (const { root, frameLabel } of roots) {
      for (const el of root.querySelectorAll(FIELD_SEL + ',' + BUTTON_SEL)) {
        if (descriptors.length >= 400) break;
        if (!isVisible(el)) continue;
        descriptors.push(describe(el, frameLabel));
      }
      if (descriptors.length >= 400) break; // Sicherheitsdeckel ueber ALLE Wurzeln
    }
    return { descriptors, crossOriginFrames: state.crossOriginFrames, url: location.href, title: document.title };
  }

  function get(ref) {
    const wr = state.refs.get(ref);
    const el = wr && wr.deref();
    // Entfernte Elemente (Seitenwechsel im SPA-Wizard) NICHT mehr herausgeben - der Aufrufer
    // meldet dann sauber "Element nicht mehr vorhanden" statt ein falsches Ziel zu treffen.
    return (el && el.isConnected) ? el : null;
  }

  // Profil-Anwendung: Selektor-Kette -> Element -> frischer Ref (Registrierung wie beim Scan).
  function resolveInRoot(root, step) {
    let el = null;
    try {
      if (step.by === 'id') el = root.getElementById ? root.getElementById(step.v) : root.querySelector('#' + CSS.escape(step.v));
      else if (step.by === 'name') el = root.querySelector(`[name="${CSS.escape(step.v)}"]`);
      else if (step.by === 'css') el = root.querySelector(step.v);
      else if (step.by === 'label') {
        const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        for (const l of root.querySelectorAll('label')) {
          if (norm(l.textContent) === norm(step.v)) {
            el = l.control || (l.getAttribute('for') ? (root.getElementById ? root.getElementById(l.getAttribute('for')) : null) : l.querySelector('input,select,textarea,button'));
            if (el) break;
          }
        }
      }
    } catch (_e) { el = null; }
    return el;
  }

  function resolveChain(chain) {
    const roots = [];
    collectRoots(document, '', roots, new Set());
    for (const step of chain || []) {
      // Neue Profile tragen den Scan-Bereich (iframe/Shadow Root) mit. Bei Altprofilen oder nach
      // einer kleinen Seitenaenderung werden danach weiterhin alle zugaenglichen Bereiche erprobt.
      const ordered = step.scope
        ? [...roots.filter(r => r.frameLabel === step.scope), ...roots.filter(r => r.frameLabel !== step.scope)]
        : roots;
      for (const candidate of ordered) {
        const el = resolveInRoot(candidate.root, step);
        if (el) return { ref: refFor(el), matchedBy: step.by, scope: candidate.frameLabel };
      }
    }
    return null;
  }

  window.__BXA_SCANNER__ = { scan, get, resolveChain, describe: (el) => describe(el, ''), _state: state };
})();
