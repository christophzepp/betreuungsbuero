'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appPath = path.resolve(
  __dirname,
  '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
);
const html = fs.readFileSync(appPath, 'utf8');

assert.match(html, /id="startHeroCard" class="hero hero-with-logo" aria-hidden="true"/);
assert.match(html, /#startHeroCard\{display:none!important\}/);
assert.match(html, /<style id="mode-intro-style-v1">[\s\S]*?<\/style>/);
assert.match(
  html,
  /\.mode-intro-next\{[\s\S]*?background:var\(--blue\)[\s\S]*?\.mode-intro-next:hover\{background:var\(--blue2\)/,
  'Der Weiter-Button verwendet nicht das Primärblau der Software.'
);

const scriptMatch = html.match(/<script id="mode-intro-script-v1">([\s\S]*?)<\/script>/);
assert(scriptMatch, 'Das einmalige Modus-Intro fehlt.');
new vm.Script(scriptMatch[1], { filename: 'mode-intro-script-v1.js' });
const script = scriptMatch[1];

[
  "const PREF_KEY='mode-intro'",
  "FALLBACK_PREFIX='betreuungsbuero.modeIntroSeen.v1'",
  /* 30.08.: dritte Variante Demo-Modus (eigener Text, erscheint bei jeder Demo-Anmeldung). */
  "mode==='online'?'Online-Modus':mode==='demo'?'Demo-Modus':'Lokal-Modus'",
  "const demo=!!(detail&&detail.demo)||!!window.__demoModus;",
  "prefs.onlineSeen||fallbackSeen(mode)",
  "prefs.localSeen||localSeen()||fallbackSeen(mode)",
  "state.users[userKey()]={...(state.users[userKey()]||{}),localSeen:true}",
  "await writeServerSeen(mode)",
  "id=\"modeIntroNext\"",
  '>Weiter</button>'
].forEach((contract) => assert(script.includes(contract), `Intro-Vertrag fehlt: ${contract}`));

[
  'id="startTodayOverview"',
  'id="startTodayScopeCase"',
  'id="startTodayScopeAll"',
  'id="startTodayMetrics"',
  'data-start-today-open="calendar"',
  'data-start-today-open="task"',
  'data-start-today-open="deadline"',
  'data-start-today-open="followup"',
  'data-start-today-open="mail"',
  'title="Neuen Kalendereintrag erfassen"',
  'title="Neue Wiedervorlage erfassen"',
  'title="Neue E-Mail im separaten Editor verfassen"',
  "window.__mxOverviewUnreadCount",
  "window.__startTodayOverviewRefresh=refresh",
  "now.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' Uhr'",
  "dateHost.title='Aktueller Tag und lokale Uhrzeit'",
  "window.__caseRefMatches",
  "window.__calEventsAll",
  "window.__todoItemsAll",
  "window.__dashAllCases",
  /* Nutzerwunsch 30.08.2026: Die Leiste startet mit „Alle Fälle"; nur eine ausdrücklich
     gespeicherte Wahl (SCOPE_KEY) stellt „Dieser Fall" wieder her - in beide Richtungen. */
  "let requestedScope='all';",
  "localStorage.getItem(SCOPE_KEY)==='case'?'case':'all'",
  'id="startTodayScopeAll" type="button" data-scope="all" aria-pressed="true"'
].forEach((contract) => assert(html.includes(contract), `Tagesüberblick-Vertrag fehlt: ${contract}`));

[
  'Betreuungsbüro wird gestartet',
  'function beginVisualBoot(mode)',
  'id="loginGateAppBootMark"',
  '>BS</div>',
  'function syncVisualBootBranding(profile)',
  "window.addEventListener('officeProfileSettled',event=>syncVisualBootBranding(event.detail))",
  "document.querySelector('#heroLogo img')||document.querySelector('#workspaceBrandSource img')",
  "mark.classList.add('has-image')",
  "waitForBootEvent('officeProfileSettled'",
  "waitForBootEvent('startTodayOverviewReady'",
  'window.__appVisualReady=new Promise',
  "window.dispatchEvent(new CustomEvent('appVisualReady'",
  "window.__officeProfileReadyPromise=Promise.resolve(refreshOfficeProfileCache())",
  "window.dispatchEvent(new CustomEvent('officeProfileSettled'",
  "await Promise.resolve(window.__onlineInitialCaseReady)",
  "window.dispatchEvent(new CustomEvent('startTodayOverviewReady'))"
].forEach((contract) => assert(html.includes(contract), `Stabiler Startvertrag fehlt: ${contract}`));

assert(
  !script.includes('setTimeout(refresh,500)'),
  'Der Tagesüberblick darf nicht mehr vor dem Login-/Fall-Ready-Signal mit Zwischenwerten rendern.'
);
assert.match(
  html,
  /\.login-gate-overlay\.is-leaving\{opacity:0;pointer-events:none\}/,
  'Der fertige Arbeitsbereich wird nicht in einem kontrollierten Übergang freigegeben.'
);
assert.match(
  html,
  /\.login-gate-appboot-mark\.has-image\{[\s\S]*?width:min\(180px,68vw\)[\s\S]*?height:64px/,
  'Das Bürologo erhält auf dem Startbildschirm kein proportionsgerechtes Querformat.'
);
assert.match(
  html,
  /\.login-gate-appboot-mark img\{[\s\S]*?max-width:100%[\s\S]*?object-fit:contain/,
  'Das Bürologo wird auf dem Startbildschirm verzerrt.'
);

assert.match(
  script,
  /kind==='calendar'[\s\S]*?if\(quick\)Promise\.resolve\(result\)\.then\(\(\)=>window\.__calendarShowNewForm&&window\.__calendarShowNewForm\(\)\)/,
  'Der Kalender-Schnellzugriff öffnet das Formular „Neuer Termin“ nicht.'
);
assert.match(
  script,
  /kind==='mail'&&quick&&typeof window\.__mxQuickCompose==='function'/,
  'Der E-Mail-Schnellzugriff öffnet nicht den separaten Verfassen-Editor.'
);
assert.match(
  script,
  /kind==='followup'&&quick&&window\.__caseOverview&&typeof window\.__caseOverview\.openFollowupQuick==='function'[\s\S]*?window\.__caseOverview\.openFollowupQuick\(\)/,
  'Der Wiedervorlagen-Schnellzugriff verwendet nicht den externen Dialogöffner.'
);

[
  'id="covActionFollowSourceSearch"',
  'id="covActionFollowSourceResults"',
  '<span class="cov-required-pill">Pflichtfeld</span>',
  "if(!Q.source||!text(Q.source.id))",
  'Bitte zuerst das Element auswählen, das wieder vorgelegt werden soll.',
  'Q.sources=followupSourceCandidates(ctx)',
  'filterFollowupSources,',
  'selectFollowupSource,',
  'async function openFollowupQuick(override)',
  "if(!document.querySelector('#modalBody .cov-shell'))",
  'openFollowupQuick,'
].forEach((contract) => assert(
  html.includes(contract),
  `Pflichtbezug für Wiedervorlagen fehlt: ${contract}`
));
assert.match(
  html,
  /function followupSourceCandidates\(ctx\)\{[\s\S]*?item\.kind==='follow'\|\|item\.filterType==='follow'/,
  'Bereits bestehende Wiedervorlagen dürfen nicht als neue Bezugsquelle angeboten werden.'
);
assert.match(
  html,
  /async function createFollowup\(prefill,override,source\)\{[\s\S]*?if\(!source\|\|!sourceId\|\|!sourceType\|\|!sourceRef\)\{/,
  'Die Erzeugung einer Wiedervorlage wird ohne ausgewähltes Element nicht abgebrochen.'
);
[
  'function frMiniVorwaermen()',
  'frMiniWartezeitVorbei=true;frMiniAlleHolen()',
  'refreshFristenIndicator();frMiniVorwaermen();',
  'const alleLaedt=alleModus&&frMiniAlle===null',
  'Fristen werden geladen …'
].forEach((contract) => assert(
  html.includes(contract),
  `Direktes Laden des Fristen-Minwidgets fehlt: ${contract}`
));

assert.match(
  html,
  /\.start-today-scope button\[aria-pressed="true"\]\{background:var\(--blue\)/,
  'Der Bereichsumschalter verwendet nicht das Primärblau der Software.'
);
assert.match(
  html,
  /\.start-today-quick button\.primary\{background:var\(--blue\)/,
  'Der primäre Schnellzugriff verwendet nicht das Primärblau der Software.'
);
assert.match(
  html,
  /\.start-today-quick\{[\s\S]*?grid-template-columns:repeat\(5,62px\)/,
  'Das Desktop-Raster des Tagesüberblicks ist nicht auf fünf Schnellzugriffe ausgelegt.'
);
assert.match(
  html,
  /\.start-today-overview\{[\s\S]*?grid-template-areas:"brand controls" "metrics quick"/,
  'Der Tagesüberblick besitzt nicht die kuratierte zweizeilige Desktop-Anordnung.'
);
assert.match(
  html,
  /@media\(max-width:680px\)\{[\s\S]*?grid-template-areas:"brand scope" "date date" "metrics metrics"[\s\S]*?\.start-today-controls\{display:contents\}[\s\S]*?\.start-today-quick\{display:none\}/,
  'Die mobile Startseite ordnet Fall-Picker und Datum nicht korrekt an oder blendet die alten Schnellzugriffe nicht aus.'
);
assert.match(
  script,
  /class="start-today-metric-add"[\s\S]*?data-start-today-quick="true"/,
  'Den mobilen Übersichtskacheln fehlt die integrierte Plus-Aktion.'
);
assert.match(
  script,
  /opener\.dataset\.startTodayQuick==='true'\|\|opener\.closest\('\.start-today-quick'\)!==null/,
  'Die integrierten Plus-Aktionen werden nicht als Schnellzugriffe behandelt.'
);
assert.match(
  html,
  /\.start-today-metric-label\{[^}]*white-space:normal/,
  'Die Bezeichnungen der Tageskennzahlen dürfen nicht abgeschnitten werden.'
);
assert.match(
  html,
  /\.start-today-brand-logo\.has-image\{[\s\S]*?flex-basis:72px/,
  'Das breite Bürologo erhält im Tagesüberblick nicht genügend Platz.'
);
assert(
  script.includes("target.classList.add('has-image')"),
  'Das Bildformat des Logos wird im Tagesüberblick nicht erkannt.'
);
assert.match(
  html,
  /html\[data-theme="dark"\] \.start-today-overview\{/,
  'Dem Tagesüberblick fehlt die Dark-Mode-Gestaltung.'
);

assert.match(
  html,
  /modeIntroSeen:\(parsed\.modeIntroSeen&&typeof parsed\.modeIntroSeen==='object'\)[\s\S]*?\{version:1,users:\{\}\}/,
  'Der lokale Intro-Status wird nicht mit der Büro-JSON eingelesen.'
);
assert.match(
  html,
  /modeIntroSeen:\{version:1,users:\{\}\}/,
  'Der lokale Büro-Zustand enthält keinen initialen Intro-Status.'
);

console.log('Modus-Intro und Tagesüberblick: Software-Blau, JSON-/Serverstatus, echte Kennzahlen, Fallumschalter und Schnellzugriffe verdrahtet.');
