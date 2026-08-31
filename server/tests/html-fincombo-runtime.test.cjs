'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(
  path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'),
  'utf8'
);

function block(tag, id) {
  const match = html.match(new RegExp(`<${tag}[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  assert(match, `${tag}#${id} fehlt.`);
  return match[1];
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  add(...names) {
    names.forEach(name => this.values.add(name));
    this.owner.className = [...this.values].join(' ');
  }

  contains(name) {
    return this.values.has(name) || String(this.owner.className || '').split(/\s+/).includes(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    this.owner.className = [...this.values].join(' ');
    return enabled;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.style = {};
    this.className = '';
    this.classList = new FakeClassList(this);
    this.innerHTML = '';
    this.value = '';
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  matches(selector) {
    const isCombo = this.getAttribute('data-combo') != null;
    return isCombo && (
      (this.tagName === 'INPUT' && selector.includes('input[data-combo]')) ||
      (this.tagName === 'TEXTAREA' && selector.includes('textarea[data-combo]'))
    );
  }

  contains(candidate) {
    return candidate === this || this.children.some(child => child.contains(candidate));
  }

  closest(selector) {
    if (selector === '.fincombo-opt' && this.classList.contains('fincombo-opt')) return this;
    return this.parentNode ? this.parentNode.closest(selector) : null;
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }

  getBoundingClientRect() {
    return { left: 120, top: 180, right: 620, bottom: 220, width: 500, height: 40 };
  }
}

function createDocument() {
  const listeners = new Map();
  const body = new FakeElement('body');
  return {
    body,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    dispatch(type, target) {
      const event = { target, key: '', preventDefault() {} };
      (listeners.get(type) || []).forEach(listener => listener(event));
    }
  };
}

const document = createDocument();
const context = {
  console,
  document,
  innerWidth: 1440,
  innerHeight: 900,
  addEventListener() {},
  Event: class Event {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = Boolean(options.bubbles);
    }
  }
};
context.window = context;
vm.createContext(context);

new vm.Script(block('script', 'fin-combo-v1'), { filename: 'fin-combo-v1.js' }).runInContext(context);

const initialCatalog = context.__finComboData;
assert(initialCatalog && typeof initialCatalog === 'object', 'FinCombo muss seinen initialen Katalog veröffentlichen.');

// Das Wohnen-Modal und seine Eingaben werden erst nach der FinCombo-Initialisierung gerendert.
const modal = new FakeElement('section');
modal.setAttribute('id', 'modal');
const housingModal = new FakeElement('div');
housingModal.className = 'housing-shell-v255';
const houseNumber = new FakeElement('input');
houseNumber.setAttribute('data-combo', 'sd_hausnummer');
housingModal.appendChild(houseNumber);
const housingInstitution = new FakeElement('input');
housingInstitution.setAttribute('data-combo', 'sd_wohneinrichtung');
housingModal.appendChild(housingInstitution);
modal.appendChild(housingModal);
document.body.appendChild(modal);

// Die Registry ersetzt die Anzeigetabelle im laufenden Betrieb. FinCombo darf danach nicht mehr
// aus dem beim Scriptstart geschlossenen DATA-Objekt rendern.
context.__finComboData = {
  sd_hausnummer: [['Hausnummern', ['12', '12 a']]]
};
assert.notStrictEqual(context.__finComboData, initialCatalog, 'Der Test muss einen echten Registry-Austausch abbilden.');

document.dispatch('focusin', houseNumber);

const panel = document.body.children.find(child => child.className === 'fincombo-panel');
assert(panel, 'Ein nachträglich gerendertes input[data-combo] muss über Event-Delegation ein Panel öffnen.');
assert.equal(panel.style.display, 'block', 'Das Vorschlagspanel muss nach Fokus sichtbar sein.');
assert.match(panel.innerHTML, /data-v="12"/, 'Das Panel muss Werte aus dem aktuellen window.__finComboData rendern.');
assert.doesNotMatch(panel.innerHTML, /Kein Treffer/, 'Ein vorhandener Live-Katalog darf nicht als leere Liste erscheinen.');

context.__finComboData.sd_wohneinrichtung = [[
  'Wohnen',
  ['Betreutes Wohnen', 'Pflegeheim / stationäre Pflegeeinrichtung']
]];
document.dispatch('focusin', housingInstitution);
assert.equal(panel.style.display, 'block', 'Das Einrichtungsfeld muss sein Vorschlagspanel unmittelbar beim Fokus öffnen.');
assert.match(panel.innerHTML, /data-v="Betreutes Wohnen"/, 'Das Einrichtungsfeld muss den aktuellen wohnfachlichen Katalog anzeigen.');
assert.match(panel.innerHTML, /stationäre Pflegeeinrichtung/, 'Auch weitere Werte des wohnfachlichen Katalogs müssen sichtbar sein.');

const comboCss = block('style', 'fin-combo-style-v1');
const basePanelZIndex = Number(comboCss.match(/\.fincombo-panel\s*\{[^}]*z-index\s*:\s*(\d+)/i)?.[1]);
const housingZIndex = Number(html.match(/#modal:has\(\.housing-shell-v255\)\s*\{[^}]*z-index\s*:\s*(\d+)/i)?.[1]);
const housingPanelZIndex = Number(html.match(/#modal:has\(\.housing-shell-v255\)\s*~\s*\.fincombo-panel\s*\{[^}]*z-index\s*:\s*(\d+)/i)?.[1]);
assert(Number.isFinite(basePanelZIndex), 'Der Basis-z-index des FinCombo-Panels muss explizit definiert sein.');
assert(Number.isFinite(housingZIndex), 'Der z-index des Wohnen-Vollbildmodals muss explizit definiert sein.');
assert(Number.isFinite(housingPanelZIndex), 'Der Wohnen-spezifische z-index des FinCombo-Panels muss explizit definiert sein.');
assert(
  housingPanelZIndex > housingZIndex && housingPanelZIndex > 50000,
  `Das FinCombo-Panel im Wohnen-Dialog (z-index ${housingPanelZIndex}) muss oberhalb des Wohnen-Modals (z-index ${housingZIndex}) liegen.`
);

console.log('FinCombo-Laufzeit: dynamisches Wohnen-Feld, Live-Katalog und Overlay-Ebene geprüft.');
