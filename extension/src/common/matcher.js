// Heuristischer Matcher (Plan Abschnitt BR, Phase E2): ordnet gescannte Feld-Deskriptoren den
// Dictionary-Schluesseln zu. Laeuft im PANEL (hat Dictionary + Deskriptoren), nie im Content-
// Script. Scoring: autocomplete-Attribut (stark) > Synonym-Treffer in Label/Name/Placeholder >
// Teilwort-Treffer; der Sektionskontext (fieldset/Ueberschriften) entscheidet die GRUPPE
// (betreute Person vs. Betreuer/Buero) - die zentrale Verwechslungsquelle deutscher
// Behoerdenformulare.
/* global bxaNorm, BXA_SYNONYMS, BXA_AUTOCOMPLETE_MAP, BXA_CONTEXT_GROUPS */

// eslint-disable-next-line no-unused-vars
const BxaMatcher = (() => {

  // Kontext eines Deskriptors -> bevorzugte Gruppe ('betreuer_buero' | 'betreute_person' | null).
  function contextGroup(desc) {
    const ctx = bxaNorm((desc.sectionContext || '') + ' ' + (desc.label || ''));
    if (!ctx) return null;
    for (const word of BXA_CONTEXT_GROUPS.betreuer_buero) if (ctx.includes(bxaNorm(word))) return 'betreuer_buero';
    for (const word of BXA_CONTEXT_GROUPS.betreute_person) if (ctx.includes(bxaNorm(word))) return 'betreute_person';
    return null;
  }

  // Generische, kollisionsanfaellige Tokens: als GANZES Label ("Name") sind sie ein starkes Signal,
  // als Wort in einem laengeren Label ("Name der Bank", "Rechnungsnummer") aber schwach - dort
  // sollen spezifische Domaenenbegriffe (bank, iban, geburtsdatum) gewinnen.
  const WEAK_TOKENS = new Set(['name', 'nummer', 'nr', 'ort', 'stadt', 'land', 'art', 'titel', 'datum']);

  // true, wenn `s` als eigenstaendiges (space-getrenntes) Wort in `text` vorkommt. descText/descAttrs
  // sind bereits bxaNorm-normalisiert (nur [a-z0-9] + Leerzeichen), daher genuegt ein Token-Vergleich -
  // "name" ist KEIN Wort in "dateiname" (ein Token), aber in "p name"/"name der bank".
  function isWord(text, s) {
    return (' ' + text + ' ').indexOf(' ' + s + ' ') >= 0;
  }

  // Basis-Score eines Synonyms gegen den Deskriptor-Text.
  function synonymScore(descText, descAttrs, syn) {
    const s = bxaNorm(syn);
    if (!s) return 0;
    if (descText === s) return 1.0;                       // exaktes Label = starkes Signal (auch fuer WEAK)
    const weak = WEAK_TOKENS.has(s);
    // name/id-ATTRIBUT enthaelt den Begriff als eigenes Wort (nicht als Teilstring! "dateiname"
    // enthaelt "name" NICHT als Wort - behebt die Falsch-Zuordnung Dateiname->Nachname).
    if (isWord(descAttrs, s)) return weak ? 0.55 : 0.8;
    if (descText.includes(s)) {
      if (isWord(descText, s)) return weak ? 0.55 : 0.75; // Wort im Label
      return s.length >= 6 ? 0.55 : 0.25;                 // reiner Teilstring
    }
    return 0;
  }

  // key -> Kandidaten-Synonyme: BXA_SYNONYMS kennt die "nackten" Pfade (person.lastName);
  // Dictionary-Keys tragen Praefixe (case:person.lastName / betreuer:lastName / office:city ...).
  function synonymsForKey(key) {
    const bare = key.replace(/^case:/, '').replace(/^office:/, 'office.').replace(/^betreuer:/, 'betreuer.');
    if (BXA_SYNONYMS[bare]) return BXA_SYNONYMS[bare];
    if (bare === 'fileNumber') return BXA_SYNONYMS['care.fileNumber'];
    // Nur der im Panel aktiv ausgewaehlte Kontakt besitzt indexunabhaengige kontakt.*-Schluessel
    // und darf automatisch vorgeschlagen werden. contact:<index>.* bleibt fuer Suche/Training
    // erreichbar, wird aber nie still als irgendein Kontakt in ein Formular geraten.
    const contact = /^kontakt\.(.+)$/.exec(bare);
    if (contact) {
      const field = contact[1];
      const mapped = {
        firstName: 'person.firstName', lastName: 'person.lastName', fullName: 'person.fullName',
        salutation: 'person.salutation', title: 'person.title', street: 'person.street',
        streetFull: 'person.streetFull', house: 'person.house', postalCode: 'person.postalCode',
        city: 'person.city', country: 'person.country', postbox: 'person.postbox',
        phone: 'person.phone', mobile: 'person.mobile', email: 'person.email', fax: 'person.fax',
        iban: 'banks.0.iban', bic: 'banks.0.bic', bankName: 'banks.0.bankName',
        fileNumber: 'care.fileNumber'
      }[field];
      if (mapped && BXA_SYNONYMS[mapped]) return BXA_SYNONYMS[mapped];
    }
    // Array-Pfade generalisieren: banks.2.iban -> banks.0.iban
    const generalized = bare.replace(/\.\d+\./, '.0.');
    return BXA_SYNONYMS[generalized] || null;
  }

  // Hauptfunktion: descriptors[] x dictionary[] -> Vorschlaege [{ref, key, value, label,
  // confidence, source:'heuristik', group}]. mode: 'betreute_person'|'betreuer_buero'|'auto'.
  function match(descriptors, dictionary, mode = 'auto') {
    const proposals = [];
    for (const desc of descriptors) {
      if (desc.kind === 'button') continue;
      const descText = bxaNorm([desc.label, desc.placeholder, desc.title].filter(Boolean).join(' '));
      const descAttrs = bxaNorm([desc.name, desc.id, desc.autocomplete].filter(Boolean).join(' '));
      if (!descText && !descAttrs) continue;

      const ctxGroup = mode === 'auto' ? contextGroup(desc) : mode;
      let best = null;

      // 1) autocomplete-Attribut = starkes Signal
      const acKey = desc.autocomplete && BXA_AUTOCOMPLETE_MAP[bxaNorm(desc.autocomplete).replace(/ /g, '-')];

      for (const entry of dictionary) {
        let score = 0;
        const syns = synonymsForKey(entry.key);
        if (syns) {
          for (const syn of syns) score = Math.max(score, synonymScore(descText, descAttrs, syn));
        }
        if (acKey && entry.key.endsWith(acKey)) score = Math.max(score, 0.9);
        if (score <= 0) continue;

        // Gruppen-Abgleich: passt die Kontextgruppe, Bonus; widerspricht sie, kraeftiger Malus.
        if (ctxGroup) {
          if (entry.group === ctxGroup) score += 0.15;
          else if ((ctxGroup === 'betreuer_buero' && entry.group === 'betreute_person') ||
                   (ctxGroup === 'betreute_person' && entry.group === 'betreuer_buero')) score -= 0.35;
        } else if (entry.group === 'betreute_person') {
          score += 0.05; // ohne Kontext: betreute Person als leiser Default
        }
        // Kontakt-Eintraege nie ohne expliziten Kontext vorschlagen (zu viele Kandidaten).
        if (entry.group === 'kontakt') score -= 0.4;

        if (score > 0 && (!best || score > best.score)) best = { entry, score };
      }

      if (best && best.score >= 0.45) {
        proposals.push({
          ref: desc.ref, fieldLabel: desc.label || desc.name || desc.id || '(unbenannt)',
          fieldType: desc.type, key: best.entry.key, keyLabel: best.entry.label,
          value: best.entry.value, group: best.entry.group,
          confidence: Math.min(1, Math.round(best.score * 100) / 100), source: 'heuristik'
        });
      }
    }
    return proposals;
  }

  return { match, contextGroup };
})();
