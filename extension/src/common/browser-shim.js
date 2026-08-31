// Browser-Shim: Firefox liefert das Promise-basierte `browser`-Objekt, Chrome (MV3) unterstuetzt
// Promises inzwischen direkt auf `chrome.*`. Ein gemeinsames Alias `BX` genuegt daher - alle
// Dateien dieser Extension sind KLASSISCHE Scripts (kein import/export, siehe build.js-Kommentar)
// und teilen sich den globalen Namensraum.
// eslint-disable-next-line no-unused-vars
const BX = (typeof browser !== 'undefined' && browser?.runtime) ? browser : chrome;
