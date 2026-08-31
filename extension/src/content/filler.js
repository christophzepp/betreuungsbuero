// Framework-sicherer Filler (Content-Script, Plan Abschnitt BR Phase E2): setzt Werte ueber den
// NATIVEN Property-Setter und feuert input/change/blur mit bubbles:true - so registrieren auch
// React/Angular/Vue-kontrollierte Felder den Wert (deren Value-Getter/Setter sind auf der
// Instanz ueberschrieben; der Prototyp-Setter umgeht das). Nach dem Setzen wird zurueckgelesen.
(() => {
  if (window.__BXA_FILLER__) return;

  function nativeSet(el, value) {
    // Konstruktoren aus dem Fenster des Elements verwenden. Top-Level-Konstruktoren und Events
    // schlagen bei Feldern in same-origin-iframes je nach Browser mit einem Realm-Typfehler fehl.
    const view = el.ownerDocument?.defaultView || window;
    const proto = el instanceof view.HTMLTextAreaElement ? view.HTMLTextAreaElement.prototype
      : el instanceof view.HTMLSelectElement ? view.HTMLSelectElement.prototype
      : view.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fire(el, types) {
    const EventCtor = el.ownerDocument?.defaultView?.Event || Event;
    for (const t of types) {
      try { el.dispatchEvent(new EventCtor(t, { bubbles: true, cancelable: t !== 'blur' })); } catch (_e) { /* exotische Seiten */ }
    }
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  // Beschriftung eines Radio-/Checkbox-Feldes (fuer den Wertabgleich): umschliessendes <label>,
  // label[for], oder direkt folgender Textknoten.
  function optionLabel(el) {
    const wrap = el.closest && el.closest('label');
    if (wrap) return norm(wrap.textContent);
    if (el.id) { try { const l = (el.getRootNode() || document).querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return norm(l.textContent); } catch (_e) { /* */ } }
    let sib = el.nextSibling;
    while (sib) { if (sib.nodeType === 3 && norm(sib.textContent)) return norm(sib.textContent); sib = sib.nextSibling; }
    return '';
  }

  // Datumsformat der Seite erraten: type=date will ISO; deutsche Textfelder meist TT.MM.JJJJ,
  // manche moderne Felder aber ISO (Placeholder/Pattern mit "JJJJ-MM" bzw. "-").
  function coerceDate(el, value) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
    if (el.type === 'date') { // native Datumsfelder verlangen immer ISO
      if (iso) return value;
      if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
      return value;
    }
    const hint = (el.placeholder || '') + ' ' + (el.getAttribute && (el.getAttribute('pattern') || '') || '');
    const wantsIso = /j{4}\s*[-/]\s*m{2}|y{4}\s*[-/]\s*m{2}|\d{4}-\d{2}-\d{2}/i.test(hint);
    if (wantsIso) { // Feld will ISO
      if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
      return value;
    }
    // Default fuer deutsche Behoerden-Textfelder: TT.MM.JJJJ
    if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
    return value;
  }

  function looksLikeDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(v); }

  function fillOne(el, value) {
    const tag = el.tagName;
    if (tag === 'SELECT') {
      const target = norm(value);
      let opt = [...el.options].find(o => norm(o.value) === target)
        || [...el.options].find(o => norm(o.textContent) === target)
        || [...el.options].find(o => norm(o.textContent).includes(target) && target.length >= 3);
      if (!opt) return { ok: false, reason: 'Keine passende Option: ' + value };
      nativeSet(el, opt.value);
      fire(el, ['input', 'change']);
      return { ok: el.value === opt.value, applied: opt.textContent.trim() };
    }
    if (tag === 'INPUT' && (el.type === 'checkbox')) {
      const want = ['ja', 'true', '1', 'x', 'wahr'].includes(norm(value));
      if (el.checked !== want) { el.click(); }
      return { ok: el.checked === want, applied: el.checked ? 'angehakt' : 'nicht angehakt' };
    }
    if (tag === 'INPUT' && el.type === 'radio') {
      // Radios einer Gruppe teilen sich denselben Datenschluessel - der Filler bekommt aber JEDES
      // Radio einzeln. Nur klicken, wenn Wert/Beschriftung des Radios zum Zielwert passt (sonst
      // wuerde der letzte Radio der Gruppe gewinnen statt des richtigen).
      const target = norm(value);
      const label = optionLabel(el);
      const matches = norm(el.value) === target || label === target || (target.length >= 3 && label.includes(target)) || (norm(el.value).length >= 1 && target.includes(norm(el.value)) && norm(el.value).length >= 3);
      if (!matches) return { ok: false, skipped: true, reason: 'Option „' + (label || el.value) + '" ≠ „' + value + '"' };
      if (!el.checked) el.click();
      return { ok: el.checked, applied: label || el.value };
    }
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      fire(el, ['input', 'blur']);
      return { ok: norm(el.textContent) === norm(value), applied: value };
    }
    let v = String(value);
    if (looksLikeDate(v)) v = coerceDate(el, v);
    el.focus();
    nativeSet(el, v);
    fire(el, ['input', 'change', 'blur']);
    // Read-back: manche Frameworks normalisieren (z. B. Datum) - Teilerfolg zaehlt als ok.
    const now = String(el.value);
    return { ok: now !== '' && (now === v || norm(now).includes(norm(v).slice(0, 8))), applied: now };
  }

  function clickEl(el) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (_e) { /* optional */ }
    el.click();
    return { ok: true };
  }

  // Upload-Helfer (Feature v0.2.0 #6): setzt eine Datei in ein <input type=file>. Der Wert eines
  // File-Inputs kann NICHT direkt gesetzt werden - nur ueber ein DataTransfer-Objekt (dessen files
  // der Browser als vertrauenswuerdig akzeptiert). Danach input/change feuern, damit die Seite die
  // Datei registriert. NICHTS wird abgesendet - der Nutzer klickt Upload/Absenden weiterhin selbst.
  function setFile(el, file) {
    if (!el || el.tagName !== 'INPUT' || el.type !== 'file') return { ok: false, reason: 'Kein Datei-Feld.' };
    try {
      const view = el.ownerDocument?.defaultView || window;
      const dt = new view.DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      fire(el, ['input', 'change']);
      return { ok: el.files && el.files.length >= 1, applied: file.name };
    } catch (e) {
      return { ok: false, reason: 'Datei konnte nicht gesetzt werden: ' + String(e && e.message || e) };
    }
  }

  window.__BXA_FILLER__ = { fillOne, clickEl, setFile };
})();
