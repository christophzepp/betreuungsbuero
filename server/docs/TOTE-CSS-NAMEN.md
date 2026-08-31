# Tote CSS-Namen im Monolithen (Stand 31.08.2026)

Diese Liste ist ein **Befund, keine To-do-Liste**. Entschieden wurde am 31.08.2026: nichts
löschen, Liste ablegen. Der Gewinn (16 KB in einer 72-MB-Datei) rechtfertigt das Risiko nicht,
einen Namen falsch als tot einzustufen — ein Fehlgriff zeigt sich als kaputte Optik in einer
selten geöffneten Ansicht, und keine Testsuite fängt das ab.

**Sinnvoll zu nutzen:** Wenn du eines der unten genannten Module ohnehin anfasst, kannst du die
dort aufgeführten Regeln mitnehmen — dann prüfst du im selben Zug, ob die Ansicht noch stimmt.

## Wie die Liste entstanden ist

1. Alle Klassennamen aus den 175 echten `<style>`-Blöcken gesammelt (3590 Stück).
2. Den Rest der Datei (67,9 MB Markup + JavaScript) in Bezeichner zerlegt und geprüft, welche
   Klassennamen dort **überhaupt nicht** vorkommen → 264 Kandidaten.
3. Zwei Gegenproben, die 110 Kandidaten wieder aussortiert haben:
   - **101** haben einen Namensstamm, der im JavaScript auftaucht (z. B. `ad-ledger-applied`,
     wo der Code `ad-ledger-` + Zustand zusammensetzt). Solche Namen findet eine Textsuche nie.
   - **9** werden anderswo im Projekt genannt (Server, Erweiterung, Plugin).
4. Übrig: **154 Namen** in **176 Regeln** (~16 KB), verteilt auf **40 Stilblöcke**.

Dazu genau **eine** tote ID: `#fpHubKartenV255`.

> Achtung bei der Weiterverwendung: Auch unter den 154 Namen kann eine dynamisch gebaute Klasse
> stecken, deren Stamm zufällig nirgends sonst steht. Vor dem Löschen einer Regel den
> erzeugenden Code lesen, nicht nur die Suche befragen.

## Nach Stilblock

### `(ohne id, Position 196)` — 33 Regeln, 2719 Byte

- `.doku-entry-v161`
- `.doku-entry-v161.doku-entry-collapsible-v162`
- `.doku-entry-v161>summary`
- `.doku-entry-v161>summary::-webkit-details-marker`
- `.doku-entry-v161>summary .doku-entry-title-v162:before`
- `.doku-entry-v161[open]>summary .doku-entry-title-v162:before`
- `.doku-entry-v161:not([open])>.doku-entry-body-v162`
- `.doku-entry-v161[open]>.doku-entry-body-v162`
- `.doku-entry-v161[open]>.doku-entry-body-v162`
- `.doku-entry-card-v163:not(.is-open) .doku-entry-note-v161`
- `.doku-entry-head-v161`
- `.template-ref`
- `.report-actions`
- `.report-actions button`
- `.report-actions button:hover`
- `.report-actions .accent`
- `.template-ref`
- `.signature-caption`
- `.case-chat-intro`
- `.case-chat-listcol`
- `.ccl-head`
- `.case-chat-listcol`
- `.case-chat-side-actions`
- `.case-chat-side-actions button`
- `.case-chat-send-btn`
- `.case-chat-utility-row`
- `.case-chat-utility-row button`
- `.btn.light.case-chat-danger-btn`
- `.btn.light.case-chat-danger-btn:hover`
- `.case-chat-final-row`
- `.case-chat-actions-secondary`
- `.case-chat-actions-primary`
- `.kg-table-note`

### `initial-data-domains-style-v255` — 21 Regeln, 1985 Byte

- `.housing-entry-head-v257`
- `.housing-entry-head-v257 h3`
- `.housing-entry-head-actions-v257`
- `.housing-entry-count-v257`
- `.housing-entry-list-v257`
- `.housing-entry-empty-v257`
- `.housing-entry-row-v257`
- `.housing-entry-content-v257`
- `.housing-entry-summary-v257`
- `.housing-entry-badge-v257`
- `.housing-entry-details-v257`
- `.housing-entry-meta-v257`
- `.housing-entry-actions-v257`
- `.housing-entry-actions-v257 .btn`
- `.housing-entry-actions-v257 .btn.danger`
- `html[data-theme="dark"] .housing-entry-details-v257`
- `.housing-entry-head-v257`
- `.housing-entry-head-actions-v257`
- `.housing-entry-row-v257`
- `.housing-entry-actions-v257`
- `.housing-entry-actions-v257 .btn`

### `v15753-accounting-filter-controls` — 12 Regeln, 1666 Byte

- `#modalBody[data-accounting-unified="1"] .accu-filter-details`
- `#modalBody[data-accounting-unified="1"] .accu-filter-details summary`
- `#modalBody[data-accounting-unified="1"] .accu-filter-details summary::-webkit-details-marker`
- `#modalBody[data-accounting-unified="1"] .accu-filter-details summary:before`
- `#modalBody[data-accounting-unified="1"] .accu-filter-details[open] summary:before`
- `#modalBody[data-accounting-unified="1"] .accu-filter-details summary span`
- `#modalBody[data-accounting-unified="1"] .accu-filter-grid`
- `#modalBody[data-accounting-unified="1"] .accu-filter-grid label`
- `#modalBody[data-accounting-unified="1"] .accu-filter-grid select`
- `#modalBody[data-accounting-unified="1"] .accu-filter-reset`
- `#modalBody[data-accounting-unified="1"] .accu-filter-reset button`
- `#modalBody[data-accounting-unified="1"] .accu-filter-grid`

### `v15737-accounting-export-fixes` — 10 Regeln, 1047 Byte

- `#modalBody .accstd-bulk-side`
- `#modalBody .accstd-bulk-side select`
- `#modalBody .accstd-bulk-note`
- `#modalBody .accstd-contact-actions`
- `#modalBody .accstd-contact-actions .btn`
- `#modalBody .accstd-recipient-modes`
- `#modalBody .accstd-recipient-modes label`
- `#modalBody .accstd-bulk-side`
- `#modalBody .accstd-contact-actions`
- `#modalBody .accstd-recipient-modes`

### `(ohne id, Position 66127155)` — 11 Regeln, 995 Byte

- `.bank-conn-card`
- `.bank-conn-head`
- `.bank-conn-title`
- `.bank-conn-sub`
- `.bank-acc-row`
- `.bank-acc-row .iban`
- `.bank-tan-overlay`
- `.bank-tan-box`
- `.bank-tan-box h3`
- `.bank-tan-challenge`
- `.bank-tan-spinner`

### `mobile-online-shell-v1-css` — 5 Regeln, 861 Byte

- `html.mobile-online-active #functionalProfileHubOverlayV255 .fp-hub-card-head-v255`
- `html.mobile-online-active #functionalProfileHubOverlayV255 .fp-hub-card-actions-v255`
- `html.mobile-online-active #functionalProfileHubOverlayV255 .fp-hub-card-head-v255`
- `html.mobile-online-active #functionalProfileHubOverlayV255 .fp-hub-card-actions-v255`
- `html.mobile-online-active #functionalProfileHubOverlayV255 .fp-hub-card-actions-v255 .btn:only-child`

### `(ohne id, Position 78567)` — 8 Regeln, 729 Byte

- `.office-box .box.office-brand-card`
- `.office-brand-logo`
- `.office-brand-logo img`
- `.office-brand-data`
- `.office-box .box.office-brand-card`
- `.office-brand-logo img`
- `.office-box .box.office-brand-card`
- `.office-brand-logo img`

### `(ohne id, Position 80358)` — 7 Regeln, 622 Byte

- `.office-box .box.office-brand-card`
- `.office-brand-logo`
- `.office-brand-logo img`
- `.office-box .box.office-brand-card`
- `.office-brand-logo img`
- `.office-brand-logo`
- `.office-box .box.office-brand-card`

### `inbox-style-v1` — 5 Regeln, 573 Byte

- `.inbox-ret-badges`
- `.inbox-ret-badge`
- `.inbox-sug-addrow`
- `.inbox-sug-addrow button`
- `.inbox-sug-addrow button:hover`

### `v15715-fixes` — 4 Regeln, 549 Byte

- `.phase3-signature-options .phase3-check-row`
- `.phase3-signature-options .phase3-check-row input[type="checkbox"]`
- `.phase3-signature-options .phase3-check-row`
- `.phase3-signature-options .phase3-check-row`

### `einstellungen-online-style-v1` — 7 Regeln, 469 Byte

- `.set-vz-stufe`
- `.set-vz-ziel`
- `.set-vz-wert`
- `.set-vwert>select,.set-vwert>input[type="text"]`
- `.set-hk-zug`
- `.set-hk-zug h4`
- `.set-bruecken`

### `approvals-style-v1` — 7 Regeln, 400 Byte

- `.ap-st`
- `.ap-st-erwogen`
- `.ap-st-beantragt`
- `.ap-st-genehmigt`
- `.ap-st-abgelehnt`
- `.ap-st-erledigt`
- `.ap-st-nicht_erforderlich`

### `(ohne id, Position 64221)` — 4 Regeln, 373 Byte

- `.ai-attach-btn`
- `.ai-attach-btn:hover`
- `.ai-attach-btn:disabled`
- `.ai-upload-processing`

### `bulk-export-v115-style` — 3 Regeln, 310 Byte

- `.bulk-export-mode`
- `.bulk-export-mode label`
- `.bulk-result-list`

### `mobile-phone-curation-v2` — 2 Regeln, 292 Byte

- `html.mobile-online-active .case-chat-side-actions`
- `html.mobile-online-active .case-chat-actions-primary`

### `phase6-styles-v116` — 2 Regeln, 270 Byte

- `.phase6-menu-badge`
- `.phase6-menu-badge.has-errors`

### `goal-decision-planning-styles-v1` — 4 Regeln, 252 Byte

- `.gdp-panel-body`
- `.gdp-quick-grid`
- `.gdp-footer-note`
- `.gdp-footer-note`

### `addressbook-dark-mode-v1` — 2 Regeln, 247 Byte

- `html[data-theme="dark"] .addressbook-source-note.ab-foreign-note`
- `html[data-theme="dark"] .addressbook-source-note.ab-foreign-note strong`

### `dark-operational-surfaces-v2` — 1 Regeln, 198 Byte

- `html[data-theme="dark"] .inline-mail-ed .ime-subtitle, html[data-theme="dark"] .inline-mail-ed .ime-meta, html[data-theme="dark"] .inline-mail-ed .…`

### `vermoegen-style-v1` — 2 Regeln, 187 Byte

- `.modal-actions .modal-footer-extras`
- `#modal:has(.modal-footer-extras) .modal-actions`

### `calendar-todo-style-v1` — 3 Regeln, 185 Byte

- `.caltime-case-prefix`
- `.calagenda-actions`
- `.cal-search-btn.active`

### `phase5-addressbook-style` — 2 Regeln, 158 Byte

- `.addressbook-source-note.ab-foreign-note`
- `.addressbook-source-note.ab-foreign-note strong`

### `v15900-document-library-style` — 1 Regeln, 149 Byte

- `.original-field-note`

### `einstellungen-dark-mode-v2` — 1 Regeln, 144 Byte

- `html[data-theme="dark"] #modal:has(.set-app) .modal-footer`

### `(ohne id, Position 68223803)` — 2 Regeln, 137 Byte

- `.inline-mail-ed .ime-hint`
- `.inline-mail-ed .ime-subtitle`

### `mailx-style` — 2 Regeln, 103 Byte

- `.mx-selrow`
- `.mx-selrow .dotsep`

### `(ohne id, Position 68353)` — 1 Regeln, 95 Byte

- `.nav-search-help`

### `v15775-history-preview-style` — 1 Regeln, 92 Byte

- `.v15775-history-preview-intro`

### `case-overview-style-v1` — 1 Regeln, 86 Byte

- `.cov-note-actions`

### `(ohne id, Position 81112)` — 1 Regeln, 75 Byte

- `.office-brand-card, .office-brand-logo, .office-brand-data`

### `dark-mode-style-v1` — 1 Regeln, 69 Byte

- `html[data-theme="dark"] .modal-overlay`

### `v15776-send-dialog-layout-style` — 1 Regeln, 68 Byte

- `.v15775-history-preview-intro`

### `v15714-gui-fixes` — 1 Regeln, 67 Byte

- `#modalBody .v15714-hidden-duplicate-action`

### `phase3-v88-css` — 1 Regeln, 62 Byte

- `.phase3-file-list`

### `kontaktmonitor-style-v1` — 2 Regeln, 61 Byte

- `.km-del`
- `.km-warn`

### `(ohne id, Position 77428)` — 1 Regeln, 51 Byte

- `.ai-direct-menu .ai-status-dot`

### `(ohne id, Position 71040)` — 1 Regeln, 47 Byte

- `.nav-search-help`

### `online-realtime-sync-style-v1` — 1 Regeln, 46 Byte

- `.uchat-convo-ava`

### `v15716-export-simplification` — 1 Regeln, 42 Byte

- `.bulk-export-mode`

### `goal-decision-planning-layout-v2` — 1 Regeln, 33 Byte

- `.gdp-footer-note`

## Alle 154 Namen alphabetisch

`__apInjectSheetLegacy`, `ab-foreign-note`, `acc-action-primary`, `acc-source-card`, `accordion`, `accordion-header`
`accstd-bulk-note`, `accstd-bulk-side`, `accstd-contact-actions`, `accstd-recipient-modes`, `accu-filter-details`, `accu-filter-grid`
`accu-filter-reset`, `admin-box`, `admin-card`, `admin-section`, `ai-attach-btn`, `ai-status-dot`
`ai-upload-processing`, `ap-st`, `ap-st-abgelehnt`, `ap-st-beantragt`, `ap-st-erledigt`, `ap-st-erwogen`
`ap-st-genehmigt`, `ap-st-nicht_erforderlich`, `bank-acc-row`, `bank-conn-card`, `bank-conn-head`, `bank-conn-sub`
`bank-conn-title`, `bank-tan-box`, `bank-tan-challenge`, `bank-tan-overlay`, `bank-tan-spinner`, `bu-view`
`bulk-export-mode`, `bulk-result-list`, `cal-search-btn`, `cal-toolbar-right`, `calagenda-actions`, `callout`
`caltime-case-prefix`, `case-chat-actions-primary`, `case-chat-actions-secondary`, `case-chat-danger-btn`, `case-chat-final-row`, `case-chat-intro`
`case-chat-listcol`, `case-chat-send-btn`, `case-chat-side-actions`, `case-chat-utility-row`, `cc2-foot`, `cc2-top`
`cc2-welcome`, `ccl-head`, `ci-nav-hint`, `ci-nav-title`, `cov-note-actions`, `details-panel`
`doku-entry-collapsible-v162`, `doku-entry-head-v161`, `doku-entry-note-v161`, `doku-entry-v161`, `form-card`, `fp-hub-card-actions-v255`
`fp-hub-card-head-v255`, `gdp-footer-note`, `gdp-panel-body`, `gdp-quick-grid`, `has-errors`, `housing-entry-actions-v257`
`housing-entry-badge-v257`, `housing-entry-content-v257`, `housing-entry-count-v257`, `housing-entry-details-v257`, `housing-entry-empty-v257`, `housing-entry-head-actions-v257`
`housing-entry-head-v257`, `housing-entry-list-v257`, `housing-entry-meta-v257`, `housing-entry-row-v257`, `housing-entry-summary-v257`, `ime-attachment`
`ime-attachment-size`, `ime-attachments`, `ime-hint`, `ime-meta`, `ime-sub`, `inbox-ret-badge`
`inbox-ret-badges`, `inbox-sug-addrow`, `kg-table-note`, `km-del`, `km-warn`, `local-mode-card`
`lu-del`, `master-link-summary`, `mcp-card`, `modal-footer`, `modal-header`, `modal-overlay`
`mx-ai-note`, `mx-panel`, `mx-row`, `mx-selrow`, `nav-search-help`, `of-delete`
`office-brand-card`, `office-brand-data`, `office-brand-logo`, `original-field-note`, `panel-header`, `phase3-check-row`
`phase3-file-list`, `phase3-preview-intro`, `phase6-menu-badge`, `prompt-category`, `prompt-entry`, `prompt-group`
`prompt-header`, `prompt-item`, `prompt-list`, `prompt-row`, `prompt-section`, `qm-del`
`qm-view`, `report-actions`, `review-note`, `section-header`, `set-bruecken`, `set-hk-zug`
`set-vwert`, `set-vz-stufe`, `set-vz-wert`, `set-vz-ziel`, `settings-card`, `settings-section`
`signature-caption`, `signature-card`, `sr-del`, `table-scroll`, `template-item`, `template-list`
`template-ref`, `toolbar-actions`, `uchat-convo-ava`, `user-card`, `user-row`, `v15714-hidden-duplicate-action`
`v15775-history-preview-intro`, `va-del`, `w-3-bold`, `w-3-w`

## Nachrechnen

Die Prüfung ist ein kurzes Skript: Klassennamen aus den `<style>`-Blöcken sammeln, den Rest der
Datei mit `re.finditer(r"[A-Za-z_][\w-]*")` in Bezeichner zerlegen, Differenz bilden, dann die
beiden Gegenproben aus Schritt 3 anwenden. Wichtig dabei: sechs Regex-Treffer auf `<style>` sind
keine Stilblöcke, sondern JavaScript, das `<style>`-Markup als Zeichenkette enthält — sie lassen
sich an `document.getElementById` im „Blockinhalt" erkennen und müssen raus, sonst zählt die
Auswertung Code als CSS.
