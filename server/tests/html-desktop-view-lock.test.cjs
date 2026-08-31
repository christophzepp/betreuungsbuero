const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', '..', 'outputs', 'Betreuungsbuero_Dokumentenassistent_v0_7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const scripts = [];
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
while ((match = scriptRe.exec(html))) scripts.push({ attrs: match[1] || '', body: match[2] || '' });

assert.equal(scripts.length, 309, 'Scriptblockzahl hat sich verändert.');
let jsCount = 0;
scripts.forEach((script, index) => {
  if (/\btype\s*=\s*(['"]?)(?!text\/javascript|application\/javascript|module)\w/i.test(script.attrs)) return;
  jsCount += 1;
  new vm.Script(script.body, { filename: `html-desktop-view-lock-${index + 1}.js` });
});
assert.equal(jsCount, 229, 'JavaScript-Blockzahl hat sich verändert.');

assert(
  !html.includes('@media(max-width:900px) and (hover:hover) and (pointer:fine)'),
  'Schmale Desktop-Browser dürfen die Sidebar nicht per Override zwanghaft offen halten.'
);
assert(
  html.includes("const MOBILE_QUERY = window.matchMedia('(max-width: 1024px)');")
    && html.includes("const iPhoneOrIPod = /\\b(iPhone|iPod)\\b/i.test(ua);")
    && html.includes("const androidPhone = /\\bAndroid\\b/i.test(ua) && /\\bMobile\\b/i.test(ua);")
    && html.includes("navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1")
    && html.includes('return !iPadOrIPadOS && (iPhoneOrIPod || androidPhone);'),
  'Mobile-Shell muss auf echte Smartphone-Kennungen begrenzt sein und iPadOS ausschließen.'
);
assert(
  html.includes('@media(max-width:900px){.step-grid,.review-grid{grid-template-columns:1fr}.workspace{grid-template-columns:1fr}.sidebar{display:none}'),
  'Bestehende schmale Desktop-Ansicht muss die linke Sidebar weiterhin einklappen.'
);
assert(
  html.includes('document.documentElement.classList.toggle(\'mobile-online-active\', active);'),
  'Mobile-Shell-Klasse muss weiterhin zentral über syncMobileMode geschaltet werden.'
);
assert(
  html.includes('return PHONE_USER_AGENT && MOBILE_QUERY.matches && isAppReady();'),
  'Fensterbreite allein darf die Mobile-Shell nicht aktivieren.'
);

const desktopCaseOptions = html.match(/function caseOptionsHtml\(showActiveHint=true\)\{[\s\S]*?\n  \}/)?.[0] || '';
const mobileStartCaseOptions = html.match(/function startCaseOptionsHtml\(\)\{[\s\S]*?\n  \}/)?.[0] || '';
assert(
  html.includes("return document.documentElement.classList.contains('mobile-online-active')?'':' (aktueller Fall)';")
    && html.includes("return document.documentElement.classList.contains('mobile-online-active')?'Dieser Fall':'Aktueller Fall';")
    && desktopCaseOptions.includes('window.__casePickerCurrentHint()')
    && html.includes('${caseOptionsHtml(false)}')
    && !mobileStartCaseOptions.includes('(aktueller Fall)'),
  'Alle mobilen Fallauswahlen müssen den Zusatz „aktueller Fall“ ausblenden; Desktop muss ihn behalten.'
);

console.log('HTML Desktop-Ansicht: Smartphone-Erkennung schließt Desktop/iPad/Desktop-Website aus; schmale Desktop-Browser klappen nur die Sidebar ein; 309 Blöcke, 229 JS, 0 Syntaxfehler');
