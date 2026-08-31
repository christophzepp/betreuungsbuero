// Overlay (Content-Script): Hervorhebung ausgefuellter Felder + Pick-Modus fuers Training.
// Styles leben in einem eigenen Shadow Root, damit Seiten-CSS nichts stoert und umgekehrt.
(() => {
  if (window.__BXA_OVERLAY__) return;

  const marked = new Set();

  function highlight(el, kind) {
    try {
      el.setAttribute('data-bxa-filled', kind || '1');
      el.style.setProperty('outline', kind === 'action' ? '2px solid #b58900' : '2px solid #2e7d32', 'important');
      el.style.setProperty('outline-offset', '1px', 'important');
      marked.add(el);
    } catch (_e) { /* readonly style */ }
  }

  function clearHighlights() {
    for (const el of marked) {
      try { el.style.removeProperty('outline'); el.style.removeProperty('outline-offset'); el.removeAttribute('data-bxa-filled'); } catch (_e) { /* weg */ }
    }
    marked.clear();
  }

  // ===== Pick-Modus (Training): Element unter der Maus umranden, Klick waehlt aus =====
  let picking = false;
  let hoverEl = null;
  let onPicked = null;

  function hoverHandler(e) {
    if (!picking) return;
    const el = e.composedPath ? e.composedPath()[0] : e.target;
    if (el === hoverEl || !(el instanceof Element)) return;
    if (hoverEl) { try { hoverEl.style.removeProperty('box-shadow'); } catch (_e) { /* */ } }
    hoverEl = el;
    try { el.style.setProperty('box-shadow', '0 0 0 3px rgba(31,78,120,.7)', 'important'); } catch (_e) { /* */ }
  }

  function clickHandler(e) {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.composedPath ? e.composedPath()[0] : e.target;
    if (hoverEl) { try { hoverEl.style.removeProperty('box-shadow'); } catch (_e) { /* */ } hoverEl = null; }
    if (onPicked && el instanceof Element) onPicked(el);
  }

  function startPick(cb) {
    onPicked = cb;
    picking = true;
    document.addEventListener('mousemove', hoverHandler, true);
    document.addEventListener('click', clickHandler, true);
    document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
  }

  function stopPick() {
    picking = false;
    onPicked = null;
    if (hoverEl) { try { hoverEl.style.removeProperty('box-shadow'); } catch (_e) { /* */ } hoverEl = null; }
    document.removeEventListener('mousemove', hoverHandler, true);
    document.removeEventListener('click', clickHandler, true);
    document.documentElement.style.removeProperty('cursor');
  }

  window.__BXA_OVERLAY__ = { highlight, clearHighlights, startPick, stopPick, isPicking: () => picking };
})();
