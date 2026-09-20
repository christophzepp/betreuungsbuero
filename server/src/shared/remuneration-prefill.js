/* Shared with the standalone HTML (remuneration-prefill-rules). Keep the embedded copy in sync. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__remunerationPrefillRules = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const fields = ['remStage', 'assetStatus', 'housingCategory'];
  const text = v => String(v == null ? '' : v).trim();
  const norm = v => text(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const result = (value, detail, kind = 'source') => ({value, detail, kind, ready: true});
  function explicitStage(value) {
    return ({A:'1', B:'1', C:'2', '1':'1', '2':'2'})[text(value).toUpperCase()] || '';
  }
  function qualification(entry) {
    const explicit = explicitStage(entry?.einstufung);
    if (explicit) return result(explicit, 'Einstufung des zuständigen Betreuers im Qualifikationsmanager');
    const q = norm(entry?.qualification);
    if (!q) return result('', 'Beim zuständigen Betreuer fehlt eine Qualifikation oder Einstufung.');
    // Only recognizable qualifications; an unfinished degree is not a completed qualification.
    if (/laufend|studierend|student|abgebrochen|ohne abschluss|nicht abgeschlossen|in ausbildung/.test(q))
      return result('', 'Der Abschluss ist nicht eindeutig. Bitte im Qualifikationsmanager einstufen.');
    if (/\b(bachelor|master|diplom|dipl\.|staatsexamen|volljurist)|\b[mb]\.\s*(a|sc|eng)\.|abgeschlossen.*hochschulstudium/.test(q))
      return result('2', 'Vorschlag aus dem Hochschulabschluss des zuständigen Betreuers; gerichtliche Einstufung prüfen.', 'proposal');
    if (/abgeschlossene.*ausbildung|ohne.*ausbildung|rechtsanwaltsfachangestellt|verwaltungsfachangestellt|pflegefach(kraft|mann|frau)/.test(q))
      return result('1', 'Vorschlag aus dem Berufsabschluss des zuständigen Betreuers; gerichtliche Einstufung prüfen.', 'proposal');
    return result('', 'Die Qualifikation lässt sich nicht eindeutig zuordnen. Bitte im Qualifikationsmanager einstufen.');
  }
  function guardianStage(guardian, persons, entries) {
    const key = text(guardian);
    if (!key) return result('', 'Noch kein zuständiger rechtlicher Betreuer zugewiesen.');
    persons = Array.isArray(persons) ? persons : [];
    entries = entries && typeof entries === 'object' ? entries : {};
    const name = p => norm([p.firstName, p.lastName].filter(Boolean).join(' '));
    const byId = persons.find(p => text(p.id || p.key) === key);
    const sameName = persons.filter(p => name(p) === norm(key));
    if (!byId && sameName.length > 1) return result('', 'Der Betreuername ist mehrdeutig. Bitte eine Person zuweisen.');
    const person = byId || sameName[0];
    const id = person && text(person.id || person.key);
    let entry = Object.hasOwn(entries, id || key) ? entries[id || key] : null;
    if (!entry && person && persons.filter(p => name(p) === name(person)).length === 1)
      entry = Object.hasOwn(entries, name(person)) ? entries[name(person)] : null;
    if (!entry && !byId && Object.hasOwn(entries, norm(key))) entry = entries[norm(key)];
    return qualification(entry);
  }
  function housing(cd) {
    const a = cd?.accommodation || {};
    const type = text(a.currentResidence?.type) || text(a.type);
    const n = norm(type);
    const from = a.currentResidence?.type ? 'Wohnmenü – aktueller Wohnort' : 'Unterkunftsart';
    if (!n) return result('', 'Im Wohnmenü fehlt die aktuelle Wohnform.');
    if (/\b(nicht|teil)stationar|ambulant|betreutes (einzel)?wohnen|eigene hauslichkeit|eigenheim|eigentumswohnung|mietwohnung|\bwohnung\b|wohngemeinschaft|\bwg\b|frauenhaus|obdachlos/.test(n))
      return result('A', from + ': ' + type);
    if (/\b(voll)?stationar|pflegeheim|altenheim|seniorenheim|dauerpflege/.test(n) && !/kurzzeit|tagespflege/.test(n))
      return result('S', from + ': ' + type);
    return result('', from + ': ' + type + ' – bitte die Wohnform für die Vergütung festlegen.');
  }
  function amount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let s = text(value).replace(/\s|€/g, '');
    if (!s) return null;
    if (/^[+-]?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    return /^[+-]?\d+(\.\d{1,2})?$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
  }
  function assets(cd) {
    const a = cd?.assets || {};
    const end = Array.isArray(a.end) ? a.end : [], begin = Array.isArray(a.begin) ? a.begin : [];
    const rows = end.length ? end : begin;
    if (!rows.length) return result('', 'In der Vermögensaufstellung sind noch keine Werte erfasst.');
    const values = rows.map(row => amount(row?.amount));
    if (values.some(v => v === null)) return result('', 'Die Vermögensaufstellung enthält Positionen ohne gültigen Betrag.');
    // No blanket deduction of debts or negative account balances from deployable assets.
    const total = values.reduce((sum, value) => sum + Math.max(0, Math.round(value * 100)), 0) / 100;
    const formatted = total.toLocaleString('de-DE', {style:'currency', currency:'EUR'});
    return {...result(total <= 10000 ? 'M' : 'NM',
      'Vorschlag aus ' + (end.length ? 'Abschlussvermögen' : 'Anfangsvermögen') + ': ' + formatted +
      ' (positive Vermögenswerte, Grenze 10.000 €). Schutzvermögen und Einzelfall prüfen; Schulden werden nicht pauschal abgezogen.', 'proposal'), total};
  }
  function apply(cd, sources) {
    if (!cd) return false;
    cd.care = cd.care || {};
    const care = cd.care, before = JSON.stringify(care);
    const meta = care._remunerationPrefill = care._remunerationPrefill || {};
    for (const key of fields) {
      const current = text(care[key]), prior = meta[key], source = sources[key];
      // Existing/imported/manual values win, including a deliberate empty selection.
      if (prior?.mode === 'manual') continue;
      if ((!prior && current) || (prior?.mode === 'auto' && current !== prior.value)) {
        meta[key] = {mode:'manual'}; continue;
      }
      if (!source || (source.ready === false && prior?.context === source.context)) continue;
      const value = source.ready === false ? '' : source.value;
      care[key] = value;
      meta[key] = {mode:'auto', value, context:source.context || ''};
    }
    return before !== JSON.stringify(care);
  }
  return {fields, explicitStage, qualification, guardianStage, housing, amount, assets, apply};
});
