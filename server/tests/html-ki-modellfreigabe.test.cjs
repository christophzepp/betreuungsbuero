/* Buerofreigabe der KI-Modelle (Nutzerauftrag 04.09.2026): "Admins sollten auch auswaehlen
 * koennen, welche Modelle ueberhaupt zur Verfuegung stehen, wenn sie keine feste Auswahl
 * vorgeben."
 *
 * Geprueft wird die Grenze, an der das Projekt schon einmal Schaden genommen haette:
 * Die FREIGABE ist eine Richtlinie und muss die tatsaechliche Verfuegbarkeit steuern
 * (availableModelOptions, wo auch initializeAIModeModels prueft). Der GENERATIONENFILTER ist
 * reine Anzeige-Kosmetik und darf gespeicherte Einstellungen nie umschreiben - und er muss
 * zuruecktreten, sobald eine ausdrueckliche Freigabe existiert, sonst versteckt er ein bewusst
 * freigegebenes aelteres Modell gleich wieder.
 *
 * Der Prueferstand fuehrt die ECHTEN eingebauten Funktionen aus (per Klammerzaehlung geschnitten).
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const serverPfad = (...t) => path.join(__dirname, '..', 'src', ...t);

function schneiden(startMarke) {
  const start = html.indexOf(startMarke);
  assert.notStrictEqual(start, -1, `${startMarke} fehlt.`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`${startMarke} ist nicht geschlossen.`);
}

function bauSandbox(fenster) {
  const sandbox = {
    window: Object.assign({ __appMode: 'online' }, fenster || {}),
    escAttr: (x) => String(x).replace(/"/g, '&quot;'),
    escapeHTMLText: (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    ensureAIConfig: () => ({ provider: 'openai' })
  };
  const quelle = [
    schneiden('function modelOptionLabel(id)'),
    schneiden('function modellFamilieVersionV262(rohId)'),
    schneiden('function neuesteModellgenerationenV262(models,immerBehalten)'),
    schneiden('function bueroErlaubteModelleV262(provider)'),
    schneiden('function modellAuswahlAnzeigeV262(models,selected,provider)'),
    schneiden('function aiModellFreigabeHTMLV262(provider,pc,klasse,vorauswahl)'),
    schneiden('function availableModelOptions(provider,pc)'),
    'this.F = { bueroErlaubteModelleV262, modellAuswahlAnzeigeV262, aiModellFreigabeHTMLV262,'
      + ' availableModelOptions, neuesteModellgenerationenV262 };'
  ].join('\n');
  vm.createContext(sandbox);
  vm.runInContext(quelle, sandbox);
  return sandbox.F;
}

/* Arrays aus dem VM-Kontext tragen einen fremden Prototyp - deepStrictEqual scheitert daran
 * trotz gleichen Inhalts. Deshalb vor jedem Vergleich in den Host-Realm holen. */
const A = (x) => Array.from(x);

const VOLL = ['gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'];
const onlineMit = (erlaubt) => ({ __appMode: 'online', __officeCredentials: { aiConfig: { openai: { allowedModels: erlaubt } } } });
const lokalMit = (erlaubt) => ({ __appMode: 'local', __localDefaults: { ai: { openai: { allowedModels: erlaubt } } } });

test('Ohne Freigabe bleibt alles beim Alten - nur der Generationenfilter greift', () => {
  const F = bauSandbox({ __appMode: 'online', __officeCredentials: { aiConfig: {} } });
  assert.deepEqual(A(F.bueroErlaubteModelleV262('openai')), []);
  assert.deepEqual(A(F.availableModelOptions('openai', { models: VOLL })), VOLL, 'Freigabe leer => volle Verfuegbarkeit');
  const angezeigt = F.modellAuswahlAnzeigeV262(VOLL, '', 'openai');
  assert.ok(!angezeigt.includes('gpt-4o'), 'Generationenfilter muss ohne Freigabe greifen');
  assert.ok(angezeigt.includes('gpt-5.2'));
});

test('Freigabe beschraenkt die tatsaechliche Verfuegbarkeit (online wie lokal)', () => {
  for (const fenster of [onlineMit(['gpt-5.2', 'gpt-4o']), lokalMit(['gpt-5.2', 'gpt-4o'])]) {
    const F = bauSandbox(fenster);
    assert.deepEqual(A(F.bueroErlaubteModelleV262('openai')), ['gpt-5.2', 'gpt-4o']);
    assert.deepEqual(A(F.availableModelOptions('openai', { models: VOLL })), ['gpt-5.2', 'gpt-4o']);
  }
});

test('Die Freigabe schlaegt den Generationenfilter - ein freigegebenes Altmodell bleibt sichtbar', () => {
  const F = bauSandbox(onlineMit(['gpt-5.2', 'gpt-4o']));
  const verfuegbar = F.availableModelOptions('openai', { models: VOLL });
  const angezeigt = F.modellAuswahlAnzeigeV262(verfuegbar, '', 'openai');
  assert.ok(angezeigt.includes('gpt-4o'), 'gpt-4o ist ausdruecklich freigegeben und darf nicht wegfiltern');
  assert.deepEqual(A(angezeigt), ['gpt-5.2', 'gpt-4o']);
});

test('Ins Leere greifende Freigabe zeigt lieber alles als ein leeres Auswahlfeld', () => {
  const F = bauSandbox(onlineMit(['gibt-es-nicht-mehr']));
  assert.deepEqual(A(F.availableModelOptions('openai', { models: VOLL })), VOLL);
});

test('Kaputte oder fremdartige Freigabewerte werden ignoriert, nicht uebernommen', () => {
  for (const murks of ['kein Array', 42, null, [''], [123, {}]]) {
    const F = bauSandbox(onlineMit(murks));
    assert.deepEqual(A(F.bueroErlaubteModelleV262('openai')), [], `Murks ${JSON.stringify(murks)}`);
    assert.deepEqual(A(F.availableModelOptions('openai', { models: VOLL })), VOLL);
  }
});

test('Admin-Ankreuzliste zeigt ALLE Modelle - sonst waere ein Altmodell nie freigebbar', () => {
  const F = bauSandbox(onlineMit(['gpt-4o']));
  const htmlAus = F.aiModellFreigabeHTMLV262('openai', { models: VOLL }, 'ai-freigabe-box');
  for (const m of VOLL) assert.ok(htmlAus.includes(`value="${m}"`), `${m} fehlt in der Ankreuzliste`);
  const zeile = htmlAus.slice(htmlAus.indexOf('value="gpt-4o"'));
  assert.ok(zeile.slice(0, 40).includes('checked'), 'Freigegebenes Modell muss angehakt sein');
  assert.ok(!htmlAus.slice(htmlAus.indexOf('value="gpt-5.2"'), htmlAus.indexOf('value="gpt-5.2"') + 40).includes('checked'));
});

test('Bereits freigegebene Kennungen bleiben sichtbar, auch wenn der Anbieter sie nicht mehr listet', () => {
  const F = bauSandbox(onlineMit(['alt-und-abgekuendigt']));
  const htmlAus = F.aiModellFreigabeHTMLV262('openai', { models: VOLL }, 'ai-freigabe-box');
  assert.ok(htmlAus.includes('value="alt-und-abgekuendigt"'), 'Bestehende Richtlinie darf nicht unbemerkt verschwinden');
});

test('Ausdrueckliche Vorauswahl schlaegt die wirksame Freigabe (Lokal-Vorgaben-Maske im Online-Betrieb)', () => {
  const F = bauSandbox(onlineMit(['gpt-5.2']));
  const htmlAus = F.aiModellFreigabeHTMLV262('openai', { models: VOLL }, 'ld-freigabe-box-openai', ['gpt-4o']);
  const bei = (m) => htmlAus.slice(htmlAus.indexOf(`value="${m}"`), htmlAus.indexOf(`value="${m}"`) + 40);
  assert.ok(bei('gpt-4o').includes('checked'), 'Der uebergebene Entwurfsstand muss gewinnen');
  assert.ok(!bei('gpt-5.2').includes('checked'), 'Die Online-Richtlinie darf hier nicht durchschlagen');
});

test('Ohne geladene Modellliste erklaert die Maske den naechsten Schritt', () => {
  const F = bauSandbox({ __appMode: 'online', __officeCredentials: { aiConfig: {} } });
  assert.match(F.aiModellFreigabeHTMLV262('openai', { models: [] }, 'ai-freigabe-box'), /Verbindung testen/);
});

test('Serverseite traegt die Freigabe von der Spalte bis ins Login-Paket', () => {
  const schema = fs.readFileSync(serverPfad('database', 'index.js'), 'utf8');
  assert.match(schema, /addColumnIfMissing\('office_ai_config', 'allowed_models'/, 'Migrationszeile fehlt');

  const admin = fs.readFileSync(serverPfad('modules', 'admin', 'routes.js'), 'utf8');
  assert.match(admin, /allowed_models = excluded\.allowed_models/, 'Upsert schreibt die Spalte nicht');
  assert.match(admin, /allowedModels: parseAllowedModels\(r\.allowed_models\)/, 'GET liefert die Freigabe nicht');
  assert.match(admin, /allowedModels !== undefined/, 'PUT muss "nicht genannt" von "leer" unterscheiden');

  const auth = fs.readFileSync(serverPfad('modules', 'auth', 'routes.js'), 'utf8');
  assert.match(auth, /allowed_models FROM office_ai_config/, 'Login-Abfrage holt die Spalte nicht');
  assert.match(auth, /allowedModels: erlaubt/, 'Login-Paket traegt die Freigabe nicht');
});

test('Die Freigabe darf NICHT im Generationenfilter landen (Trennung der Ebenen)', () => {
  const filter = schneiden('function neuesteModellgenerationenV262(models,immerBehalten)');
  assert.ok(!/bueroErlaubteModelleV262/.test(filter),
    'Der Anzeigefilter darf die Richtlinie nicht kennen - sonst verschwimmen Verfuegbarkeit und Kosmetik.');
});
