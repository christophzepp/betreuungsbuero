# Drittanbieter-Bestandteile

Diese Anwendung enthält und verwendet Software Dritter. Deren Lizenzhinweise gelten
unabhängig von der Lizenz dieses Projekts und müssen bei jeder Weitergabe mitgeliefert
werden — auch im Container-Image.

Erhoben am 31.08.2026 aus den tatsächlich installierten Paketen.

## Überblick

| Lizenz | Pakete |
| --- | ---: |
| `MIT` | 170 |
| `ISC` | 29 |
| `BSD-2-Clause` | 6 |
| `BSD-3-Clause` | 4 |
| `Apache-2.0` | 2 |
| `(MIT OR EUPL-1.1+)` | 1 |
| `(MIT OR WTFPL)` | 1 |
| `MIT-0` | 1 |
| `(MIT AND Zlib)` | 1 |
| `(BSD-2-Clause OR MIT OR Apache-2.0)` | 1 |
| `0BSD` | 1 |

Kein Bestandteil steht unter einer Copyleft-Lizenz (GPL/LGPL/AGPL). Die Wahl der
Projektlizenz war dadurch frei.

## Direkte Abhängigkeiten des Servers

| Paket | Fassung | Lizenz |
| --- | --- | --- |
| `@cantoo/pdf-lib` | 2.8.2 | MIT |
| `bcrypt` | 5.1.1 | MIT |
| `better-sqlite3` | 11.10.0 | MIT |
| `dotenv` | 16.6.1 | BSD-2-Clause |
| `express` | 4.22.2 | MIT |
| `express-session` | 1.19.0 | MIT |
| `fast-xml-parser` | 5.9.3 | MIT |
| `imapflow` | 1.4.7 | MIT |
| `mailparser` | 3.9.14 | MIT |
| `nodemailer` | 9.0.3 | MIT-0 |
| `ws` | 8.21.0 | MIT |

## In die Web-App eingebettet

| Bestandteil | Lizenz | Hinweis |
| --- | --- | --- |
| `@cantoo/pdf-lib` | MIT | Fork von `pdf-lib`; enthält TypeScript-Hilfsfunktionen (`tslib`) unter Apache-2.0, Copyright Microsoft Corporation |
| DejaVu-Schriften | frei (Bitstream-Vera-/Arev-Lizenz) | eingebettet für die PDF-Ausgabe |

Die Excel-Ausgabe (ZIP-Hülle, Arbeitsmappen-XML) ist eigener Code, keine Fremdbibliothek.

## Browser-Erweiterung

Ohne Laufzeit-Abhängigkeiten. Für Bau und Signierung wird `web-ext` (Mozilla, MPL-2.0)
als Entwicklungswerkzeug verwendet; es wird nicht mit ausgeliefert.

## Vollständige Liste

<details><summary>217 Pakete</summary>

| Paket | Fassung | Lizenz |
| --- | --- | --- |
| `@cantoo/pdf-lib` | 2.8.2 | MIT |
| `@mapbox/node-pre-gyp` | 1.0.11 | BSD-3-Clause |
| `@nodable/entities` | 2.2.0 | MIT |
| `@pdf-lib/standard-fonts` | 1.0.0 | MIT |
| `@pdf-lib/upng` | 1.0.1 | MIT |
| `@pinojs/redact` | 0.4.0 | MIT |
| `@selderee/plugin-htmlparser2` | 0.12.0 | MIT |
| `@zone-eu/mailsplit` | 5.4.14 | (MIT OR EUPL-1.1+) |
| `abbrev` | 1.1.1 | ISC |
| `accepts` | 1.3.8 | MIT |
| `agent-base` | 6.0.2 | MIT |
| `ansi-regex` | 5.0.1 | MIT |
| `anynum` | 1.0.1 | MIT |
| `aproba` | 2.1.0 | ISC |
| `are-we-there-yet` | 2.0.0 | ISC |
| `array-flatten` | 1.1.1 | MIT |
| `atomic-sleep` | 1.0.0 | MIT |
| `balanced-match` | 1.0.2 | MIT |
| `base64-js` | 1.5.1 | MIT |
| `bcrypt` | 5.1.1 | MIT |
| `better-sqlite3` | 11.10.0 | MIT |
| `bindings` | 1.5.0 | MIT |
| `bl` | 4.1.0 | MIT |
| `body-parser` | 1.20.5 | MIT |
| `brace-expansion` | 1.1.15 | MIT |
| `buffer` | 5.7.1 | MIT |
| `bytes` | 3.1.2 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `call-bound` | 1.0.4 | MIT |
| `chownr` | 2.0.0 | ISC |
| `color` | 4.2.3 | MIT |
| `color-convert` | 2.0.1 | MIT |
| `color-name` | 1.1.4 | MIT |
| `color-string` | 1.9.1 | MIT |
| `color-support` | 1.1.3 | ISC |
| `concat-map` | 0.0.1 | MIT |
| `console-control-strings` | 1.1.0 | ISC |
| `content-disposition` | 0.5.4 | MIT |
| `content-type` | 1.0.5 | MIT |
| `cookie` | 0.7.2 | MIT |
| `cookie-signature` | 1.0.7 | MIT |
| `crypto-js` | 4.2.0 | MIT |
| `debug` | 2.6.9 | MIT |
| `decompress-response` | 6.0.0 | MIT |
| `deep-extend` | 0.6.0 | MIT |
| `deepmerge-ts` | 7.1.5 | BSD-3-Clause |
| `delegates` | 1.0.0 | MIT |
| `depd` | 2.0.0 | MIT |
| `destroy` | 1.2.0 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `dom-serializer` | 2.0.0 | MIT |
| `domelementtype` | 2.3.0 | BSD-2-Clause |
| `domhandler` | 5.0.3 | BSD-2-Clause |
| `domutils` | 3.2.2 | BSD-2-Clause |
| `dotenv` | 16.6.1 | BSD-2-Clause |
| `dunder-proto` | 1.0.1 | MIT |
| `ee-first` | 1.1.1 | MIT |
| `emoji-regex` | 8.0.0 | MIT |
| `encodeurl` | 2.0.0 | MIT |
| `encoding-japanese` | 2.2.0 | MIT |
| `end-of-stream` | 1.4.5 | MIT |
| `entities` | 4.5.0 | BSD-2-Clause |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-object-atoms` | 1.1.2 | MIT |
| `escape-html` | 1.0.3 | MIT |
| `etag` | 1.8.1 | MIT |
| `expand-template` | 2.0.3 | (MIT OR WTFPL) |
| `express` | 4.22.2 | MIT |
| `express-session` | 1.19.0 | MIT |
| `fast-xml-builder` | 1.2.1 | MIT |
| `fast-xml-parser` | 5.9.3 | MIT |
| `file-uri-to-path` | 1.0.0 | MIT |
| `finalhandler` | 1.3.2 | MIT |
| `forwarded` | 0.2.0 | MIT |
| `fresh` | 0.5.2 | MIT |
| `fs-constants` | 1.0.0 | MIT |
| `fs-minipass` | 2.1.0 | ISC |
| `fs.realpath` | 1.0.0 | ISC |
| `function-bind` | 1.1.2 | MIT |
| `gauge` | 3.0.2 | ISC |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `github-from-package` | 0.0.0 | MIT |
| `glob` | 7.2.3 | ISC |
| `gopd` | 1.2.0 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `has-unicode` | 2.0.1 | ISC |
| `hasown` | 2.0.4 | MIT |
| `he` | 1.2.0 | MIT |
| `html-entities` | 2.6.0 | MIT |
| `html-to-text` | 10.0.0 | MIT |
| `htmlparser2` | 10.1.0 | MIT |
| `http-errors` | 2.0.1 | MIT |
| `https-proxy-agent` | 5.0.1 | MIT |
| `iconv-lite` | 0.4.24 | MIT |
| `ieee754` | 1.2.1 | BSD-3-Clause |
| `imapflow` | 1.4.7 | MIT |
| `inflight` | 1.0.6 | ISC |
| `inherits` | 2.0.4 | ISC |
| `ini` | 1.3.8 | ISC |
| `ip-address` | 10.2.0 | MIT |
| `ipaddr.js` | 1.9.1 | MIT |
| `is-arrayish` | 0.3.4 | MIT |
| `is-fullwidth-code-point` | 3.0.0 | MIT |
| `is-unsafe` | 1.0.1 | MIT |
| `leac` | 0.7.0 | MIT |
| `libbase64` | 1.3.0 | MIT |
| `libmime` | 5.4.1 | MIT |
| `libqp` | 2.1.1 | MIT |
| `linkify-it` | 5.0.2 | MIT |
| `mailparser` | 3.9.14 | MIT |
| `make-dir` | 3.1.0 | MIT |
| `math-intrinsics` | 1.1.0 | MIT |
| `media-typer` | 0.3.0 | MIT |
| `merge-descriptors` | 1.0.3 | MIT |
| `methods` | 1.1.2 | MIT |
| `mime` | 1.6.0 | MIT |
| `mime-db` | 1.52.0 | MIT |
| `mime-types` | 2.1.35 | MIT |
| `mimic-response` | 3.1.0 | MIT |
| `minimatch` | 3.1.5 | ISC |
| `minimist` | 1.2.8 | MIT |
| `minipass` | 5.0.0 | ISC |
| `minizlib` | 2.1.2 | MIT |
| `mkdirp` | 1.0.4 | MIT |
| `mkdirp-classic` | 0.5.3 | MIT |
| `ms` | 2.0.0 | MIT |
| `napi-build-utils` | 2.0.0 | MIT |
| `negotiator` | 0.6.3 | MIT |
| `node-abi` | 3.94.0 | MIT |
| `node-addon-api` | 5.1.0 | MIT |
| `node-fetch` | 2.7.0 | MIT |
| `node-html-better-parser` | 1.5.9 | MIT |
| `nodemailer` | 9.0.3 | MIT-0 |
| `nopt` | 5.0.0 | ISC |
| `npmlog` | 5.0.1 | ISC |
| `object-assign` | 4.1.1 | MIT |
| `object-inspect` | 1.13.4 | MIT |
| `on-exit-leak-free` | 2.1.2 | MIT |
| `on-finished` | 2.4.1 | MIT |
| `on-headers` | 1.1.0 | MIT |
| `once` | 1.4.0 | ISC |
| `pako` | 2.2.0 | (MIT AND Zlib) |
| `parseley` | 0.13.1 | MIT |
| `parseurl` | 1.3.3 | MIT |
| `path-expression-matcher` | 1.6.2 | MIT |
| `path-is-absolute` | 1.0.1 | MIT |
| `path-to-regexp` | 0.1.13 | MIT |
| `peberminta` | 0.10.0 | MIT |
| `pino` | 10.3.1 | MIT |
| `pino-abstract-transport` | 3.0.0 | MIT |
| `pino-std-serializers` | 7.1.0 | MIT |
| `prebuild-install` | 7.1.3 | MIT |
| `process-warning` | 5.0.0 | MIT |
| `proxy-addr` | 2.0.7 | MIT |
| `pump` | 3.0.4 | MIT |
| `punycode.js` | 2.3.1 | MIT |
| `qs` | 6.15.3 | BSD-3-Clause |
| `quick-format-unescaped` | 4.0.4 | MIT |
| `random-bytes` | 1.0.0 | MIT |
| `range-parser` | 1.2.1 | MIT |
| `raw-body` | 2.5.3 | MIT |
| `rc` | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) |
| `readable-stream` | 3.6.2 | MIT |
| `real-require` | 0.2.0 | MIT |
| `rimraf` | 3.0.2 | ISC |
| `safe-buffer` | 5.2.1 | MIT |
| `safe-stable-stringify` | 2.5.0 | MIT |
| `safer-buffer` | 2.1.2 | MIT |
| `selderee` | 0.12.0 | MIT |
| `semver` | 7.8.5 | ISC |
| `send` | 0.19.2 | MIT |
| `serve-static` | 1.16.3 | MIT |
| `set-blocking` | 2.0.0 | ISC |
| `setprototypeof` | 1.2.0 | ISC |
| `side-channel` | 1.1.1 | MIT |
| `side-channel-list` | 1.0.1 | MIT |
| `side-channel-map` | 1.0.1 | MIT |
| `side-channel-weakmap` | 1.0.2 | MIT |
| `signal-exit` | 3.0.7 | ISC |
| `simple-concat` | 1.0.1 | MIT |
| `simple-get` | 4.0.1 | MIT |
| `simple-swizzle` | 0.2.4 | MIT |
| `smart-buffer` | 4.2.0 | MIT |
| `socks` | 2.8.9 | MIT |
| `sonic-boom` | 4.2.1 | MIT |
| `split2` | 4.2.0 | ISC |
| `statuses` | 2.0.2 | MIT |
| `string-width` | 4.2.3 | MIT |
| `string_decoder` | 1.3.0 | MIT |
| `strip-ansi` | 6.0.1 | MIT |
| `strip-json-comments` | 2.0.1 | MIT |
| `strnum` | 2.4.1 | MIT |
| `tar` | 6.2.1 | ISC |
| `tar-fs` | 2.1.5 | MIT |
| `tar-stream` | 2.2.0 | MIT |
| `thread-stream` | 4.2.0 | MIT |
| `tlds` | 1.261.0 | MIT |
| `toidentifier` | 1.0.1 | MIT |
| `tr46` | 0.0.3 | MIT |
| `tslib` | 2.8.1 | 0BSD |
| `tunnel-agent` | 0.6.0 | Apache-2.0 |
| `type-is` | 1.6.18 | MIT |
| `uc.micro` | 2.1.0 | MIT |
| `uid-safe` | 2.1.5 | MIT |
| `unpipe` | 1.0.0 | MIT |
| `util-deprecate` | 1.0.2 | MIT |
| `utils-merge` | 1.0.1 | MIT |
| `vary` | 1.1.2 | MIT |
| `webidl-conversions` | 3.0.1 | BSD-2-Clause |
| `whatwg-url` | 5.0.0 | MIT |
| `wide-align` | 1.1.5 | ISC |
| `wrappy` | 1.0.2 | ISC |
| `ws` | 8.21.0 | MIT |
| `xml-naming` | 0.1.0 | MIT |
| `yallist` | 4.0.0 | ISC |

</details>
