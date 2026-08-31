// Chrome-MV3-Service-Worker-Einstieg: laedt die klassischen Scripts (kein Bundler, siehe
// build.js). Firefox braucht diese Datei nicht (dort laedt background.scripts das Array direkt).
importScripts('common/browser-shim.js', 'common/api.js', 'background.js');
