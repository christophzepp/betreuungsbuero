'use strict';
// Executes the shipped HTML, with synthetic case data and a fully intercepted chat backend.
// Run: PLAYWRIGHT_MODULE=/absolute/path/to/playwright node server/scripts/qa-mobile-foundation.cjs
const chromium = require(process.env.PLAYWRIGHT_MODULE || 'playwright')[process.env.MOBILE_QA_BROWSER || 'chromium'];
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const app = path.resolve(__dirname, '../../outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html');
const output = process.env.MOBILE_QA_OUTPUT || '/tmp/mobile-foundation-qa';
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.route('http://**/*', route => route.abort());
    await page.route('http://foundation.invalid/api/**', route => route.fulfill({contentType:'application/json',body:'{}'}));
    await page.route('http://foundation.invalid/', route => route.fulfill({contentType:'text/html',body:fs.readFileSync(app)}));
    await page.goto('http://foundation.invalid/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.evaluate(() => {
      // No network request leaves this fixture. Real chat functions call the normal REST contract.
      window.__qaRequests = [];
      const people = [{ id: 1, displayName: 'Mara Muster', status: 'online' }, { id: 2, displayName: 'Anna Beispiel', status: 'online' }, { id: 3, displayName: 'Paul Beispiel', status: 'away' }];
      const conversations = [
        { id: 'team', type: 'group', title: 'Büroorganisation', unread: 1, participants: people, updatedAt: '2026-09-07T08:00:00Z', lastMessage: { body: 'Terminübersicht ist aktualisiert.', senderUserId: 2, createdAt: '2026-09-07T08:00:00Z' } },
        { id: 'direct', type: 'direct', unread: 2, participants: people.slice(0, 2), updatedAt: '2026-09-07T07:45:00Z', lastMessage: { body: 'Kannst du den Rückruf übernehmen?', senderUserId: 2, createdAt: '2026-09-07T07:45:00Z' } }
      ];
      const messages = { team: [{ id: 't1', senderUserId: 2, senderName: 'Anna Beispiel', kind: 'user', body: 'Terminübersicht ist aktualisiert.', createdAt: '2026-09-07T08:00:00Z' }], direct: [{ id: 'd1', senderUserId: 2, senderName: 'Anna Beispiel', kind: 'user', body: 'Kannst du den Rückruf übernehmen?', createdAt: '2026-09-07T07:45:00Z' }] };
      window.fetch = async (url, options = {}) => {
        const u = String(url), method = options.method || 'GET';
        window.__qaRequests.push({ url: u, method, body: options.body });
        let result = {};
        if (u === '/api/chat/users') result = { users: people };
        else if (u === '/api/chat/conversations') result = { conversations };
        else if (u.includes('/api/chat/conversations/') && u.includes('/messages')) {
          const id = u.split('/')[4];
          if (method === 'POST') {
            if (window.__qaFailSend) return new Response(JSON.stringify({ error: 'Testverbindung unterbrochen' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
            const payload = JSON.parse(options.body); const message = { id: 'sent-' + Date.now(), body: payload.body, senderUserId: 1, senderName: 'Mara Muster', kind: 'user', createdAt: new Date().toISOString() };
            messages[id].push(message); result = { message };
          } else result = { messages: messages[id] || [] };
        } else if (u.endsWith('/read')) { const c = conversations.find(c => c.id === u.split('/')[4]); if (c) c.unread = 0; }
        return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      window.__currentUser = people[0];
      // Initialize only the chat, avoiding the app's real login / realtime initialization.
      const source = [...document.scripts].find(s => s.textContent.includes('   NUTZERCHAT (Nutzerwunsch 2026-08-12)')).textContent;
      const marker = source.indexOf('   NUTZERCHAT (Nutzerwunsch 2026-08-12)');
      const chat = source.slice(source.indexOf('(function(){', marker));
      window.__appMode = 'online';
      (0, eval)(chat);
      const gate = document.getElementById('loginGateOverlay'); if (gate) gate.classList.add('hidden');
      const start = document.getElementById('startPage'); start.hidden = false; start.classList.remove('hidden');
      window.dispatchEvent(new Event('resize'));
      state.caseData.person.firstName = 'Mara'; state.caseData.person.lastName = 'Hoffmann';
      state.caseData.documentationEntries = [{ id: 'qa-entry', date: '2026-09-07', year: '2026', actor: 'Wohnberatung', actorGroup: 'Beratungsstelle', type: 'Wohnen', detail: 'Telefonat', note: 'Rückruf vereinbart.', contactType: 'telefonisch', source: 'manual' }];
    });
    await page.waitForSelector('#mobileOnlineShell');
    await page.locator('#modeIntroNext').click();
    await page.evaluate(() => window.openDocumentationView());
    await page.waitForSelector('.fd-shell');
    await page.waitForTimeout(300);
    const check = async (name, test) => { await test(); console.log('PASS ' + name); };
    await check('Sechs Standardzugänge einschließlich Start und echter Unread-Badge', async () => {
      assert.equal(await page.locator('#mobileOnlineShell .mobile-nav-action').count(), 6);
      assert.match(await page.locator('[data-mobile-chats]').getAttribute('aria-label'), /3 ungelesene/);
    });
    await page.locator('[data-mobile-chats]').click();
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(output, 'chats-auswahl.png') });
    await check('Auswahlblatt schließt mit Escape ohne Dokumentation zu schließen', async () => {
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.fd-shell').isVisible(), true);
    });
    await check('Dokumentation: drei Exporte und alle fünf spezifischen Filter bleiben erreichbar', async () => {
      await page.locator('.fd-m-export').click();
      for (const label of ['Übersicht der Auswahl als PDF', 'Auswahl mit Inhalten als PDF', 'Jetzt in Excel übertragen']) assert.equal(await page.getByRole('menuitem', { name: label }).isVisible(), true);
      await page.keyboard.press('Escape');
      await page.locator('.fd-m-top button[aria-label^="Filter"]').click();
      for (const id of ['dokuFilterYear', 'dokuFilterActorGroup', 'dokuFilterType', 'dokuFilterContactType', 'dokuFilterSource']) assert.equal(await page.locator('#' + id).count(), 1, id);
      await page.screenshot({ path: path.join(output, 'dokumentation-filter.png') });
      await page.locator('.fd-sheet-act button').click();
    });
    await page.locator('.fd-fab').click();
    await page.locator('#dokuNote').fill('Entwurf bleibt einschließlich Original-DOM erhalten.');
    await page.evaluate(() => { window.__qaOriginalNote = document.getElementById('dokuNote'); window.__qaFormNodes = [...document.querySelectorAll('.fd-form input,.fd-form textarea,.fd-form select')]; window.__qaInputEvents = 0; window.__qaOriginalNote.addEventListener('input', () => window.__qaInputEvents++); });
    await page.locator('[data-mobile-chats]').click();
    await page.locator('[data-mobile-team-chat]').click();
    await page.screenshot({ path: path.join(output, 'mitarbeiterchat-liste.png') });
    await check('Chat-Liste liest keine verborgene Unterhaltung', async () => {
      assert.equal(await page.evaluate(() => __userChat.getState().unread), 3);
      assert.equal(await page.locator('#uchatPill').isVisible(), false);
      assert.equal(await page.locator('#mobileOnlineShell').isVisible(), true);
    });
    await page.locator('.uchat-conv-item').filter({ hasText: 'Anna Beispiel' }).click();
    await check('Öffnen einer Unterhaltung aktualisiert Badge', async () => {
      assert.equal(await page.evaluate(() => __userChat.getState().unread), 1);
    });
    await page.locator('#uchatInput').fill('Ungesendeter Chatentwurf');
    await page.locator('#uchatBackV262').click();
    await page.locator('.uchat-conv-item').filter({ hasText: 'Büroorganisation' }).click();
    await page.locator('#uchatInput').fill('Anderer Gruppenentwurf');
    await page.locator('#uchatBackV262').click();
    await page.locator('.uchat-conv-item').filter({ hasText: 'Anna Beispiel' }).click();
    await check('Entwürfe bleiben je Unterhaltung getrennt', async () => assert.equal(await page.locator('#uchatInput').inputValue(), 'Ungesendeter Chatentwurf'));
    await check('Erwähnen, Verknüpfen, KI und Anlagen bleiben bedienbar', async () => {
      await page.getByRole('button', { name: '@ Erwähnen', exact: true }).click(); assert.equal(await page.locator('#uchat-pop-mention').isVisible(), true);
      await page.getByRole('button', { name: '# Verknüpfen', exact: true }).click(); assert.equal(await page.locator('#uchat-pop-objekt').isVisible(), true);
      await page.getByRole('button', { name: '✦ KI einbeziehen', exact: true }).click(); assert.match(await page.locator('#uchatInput').inputValue(), /@KI/);
      await page.locator('#uchatFileBtn').click(); assert.equal(await page.locator('#uchat-pop-attach').isVisible(), true);
      await page.locator('#uchatInput').click();
    });
    await page.locator('#uchatInput').fill('Lokale Prüfnachricht');
    await check('Fehlgeschlagenes Senden bewahrt Eingabe', async () => {
      await page.evaluate(() => { window.__qaFailSend = true; });
      await page.locator('#uchatSendBtn').click();
      assert.equal(await page.locator('#uchatInput').inputValue(), 'Lokale Prüfnachricht');
      await page.evaluate(() => { window.__qaFailSend = false; });
    });
    await page.locator('#uchatSendBtn').click();
    await check('Senden nutzt bestehenden REST-Payload', async () => {
      assert.equal(await page.locator('#uchatInput').inputValue(), '');
      assert.match(await page.locator('#uchatLog').innerText(), /Lokale Prüfnachricht/);
    });
    await page.screenshot({ path: path.join(output, 'mitarbeiterchat-unterhaltung.png') });
    await page.locator('.uchat-mobile-return').click();
    await check('Mitarbeiterchat kehrt zum unveränderten Formular zurück', async () => {
      assert.equal(await page.locator('#dokuNote').inputValue(), 'Entwurf bleibt einschließlich Original-DOM erhalten.');
      assert.equal(await page.evaluate(() => __qaOriginalNote === document.getElementById('dokuNote')), true);
    });
    await check('Auch ein Chat-Aufruf aus einem Hinweis kehrt über den Doku-Tab zum Entwurf zurück', async () => {
      await page.evaluate(() => __userChat.open());
      await page.locator('#mobileOnlineShell [data-mobile-action="documentation"]').click();
      assert.equal(await page.evaluate(() => __qaOriginalNote === document.getElementById('dokuNote')), true);
    });
    await page.evaluate(() => {
      // Configure only the UI; no AI request is sent and no key leaves this isolated browser.
      const c = ensureAIConfig(); c.provider = 'openai'; c.apiKey = 'fixture-no-network';
      window.__qaOldKeyCheck = aiProviderKeyConfigured;
      aiProviderKeyConfigured = () => true;
    });
    await page.locator('[data-mobile-chats]').click();
    await page.locator('[data-mobile-case-chat]').click();
    await page.waitForSelector('#caseChatInput');
    await page.locator('#caseChatInput').fill('Unversandte Frage zum Fall');
    await check('KI-Chat erhält unabhängigen Dialog ohne doppelte IDs', async () => {
      assert.equal(await page.locator('#modal').count(), 1);
      assert.equal(await page.locator('#dokuNote').count(), 0);
    });
    await page.evaluate(() => window.closeCaseChat());
    await check('KI-Rückweg erhält Formular, Listener und Formularzustand', async () => {
      assert.equal(await page.evaluate(() => __qaOriginalNote === document.getElementById('dokuNote')), true);
      await page.locator('#dokuNote').fill('Entwurf nach Chat weiterbearbeitet');
      assert.ok(await page.evaluate(() => __qaInputEvents > 0));
      assert.equal(await page.locator('.fd-form').isVisible(), true);
      assert.equal(await page.evaluate(() => __qaFormNodes.every(node => node.isConnected)), true);
      await page.evaluate(() => window.fdFormAbbrechen());
      assert.equal(await page.getByRole('alertdialog', { name: 'Ungespeicherte Änderungen' }).isVisible(), true);
      await page.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
    });
    await page.screenshot({ path: path.join(output, 'formular-nach-chat.png') });
    await page.locator('[data-mobile-chats]').click(); await page.locator('[data-mobile-case-chat]').click();
    assert.equal(await page.locator('#caseChatInput').inputValue(), 'Unversandte Frage zum Fall');
    await page.evaluate(() => window.closeCaseChat());
    for (const width of [320, 360, 390, 430]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        await page.locator('[data-mobile-chats]').click();
        await check(`Auswahl ${width}px ${theme}: keine Überbreite, Navigation erreichbar`, async () => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          assert.equal(await page.locator('[data-mobile-team-chat]').isVisible(), true);
          assert.equal(await page.locator('[data-mobile-chats]').isVisible(), true);
        });
        if (width === 360 && theme === 'dark') { await page.waitForTimeout(220); await page.screenshot({ path: path.join(output, 'chats-dunkel-360.png') }); }
        await page.keyboard.press('Escape');
      }
    }
    await check('Neue gemeinsame Formularansicht behält echte Feldknoten und ihre Listener', async () => {
      assert.equal(await page.evaluate(() => {
        const field = document.createElement('input'); field.value = 'Beispiel'; let changed = false;
        field.addEventListener('input', () => { changed = true; });
        const form = window.__mobileUI.createView({ kind: 'form', title: 'Prüfformular', body: field, footer: [{ label: 'Speichern', onClick() {} }] });
        field.dispatchEvent(new Event('input'));
        return form.content.firstChild === field && changed && field.value === 'Beispiel' && form.actionBar.querySelector('button').textContent === 'Speichern';
      }), true);
    });
    await check('Gemeinsames Filterblatt führt Apply aus und lässt sich bei Validierungsfehler weiter bearbeiten', async () => {
      await page.evaluate(() => {
        window.__qaApplied = 0;
        __mobileUI.openFilter({ content(body) { body.textContent = 'Modulspezifische Auswahl'; }, onApply() { window.__qaApplied++; return window.__qaApplied > 1; } });
      });
      await page.getByRole('button', { name: 'Anwenden', exact: true }).click();
      assert.equal(await page.locator('#mobileOnlineSheet').getAttribute('aria-hidden'), 'false');
      await page.getByRole('button', { name: 'Anwenden', exact: true }).click();
      assert.equal(await page.locator('#mobileOnlineSheet').getAttribute('aria-hidden'), 'true');
    });
    await check('Acht Favoriten bleiben neben Start, Chats und Mehr erreichbar und werden kompatibel gespeichert', async () => {
      await page.locator('[data-mobile-more]').click();
      assert.equal(await page.locator('.mobile-more-item').count(), 31);
      await page.locator('[data-mobile-edit-navigation]').click();
      for (const id of ['master-data', 'calendar', 'tasks', 'contacts', 'deadlines']) await page.locator(`[data-editor-id="${id}"] .mobile-pin-toggle`).click();
      await page.locator('[data-mobile-editor-save]').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.mobile-nav-favorites [data-mobile-action]').count(), 8);
      assert.equal(await page.locator('#mobileOnlineShell .mobile-nav-action').count(), 11);
      for (const button of await page.locator('.mobile-nav-favorites [data-mobile-action]').all()) {
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox(); assert.ok(box.width >= 44);
      }
      assert.equal(await page.locator('[data-mobile-chats]').isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      const prefs = await page.evaluate(() => JSON.parse(__qaRequests.findLast(r => r.url === '/api/user-prefs/mobile-navigation' && r.method === 'PUT').body));
      assert.equal(prefs.prefs.pinned.length, 8);
    });
    await check('Kleine Bildschirmhöhe: Eingabe, Senden und Navigation überdecken sich nicht', async () => {
      await page.setViewportSize({ width: 390, height: 480 });
      await page.locator('[data-mobile-chats]').click(); await page.locator('[data-mobile-team-chat]').click();
      await page.locator('.uchat-conv-item').filter({ hasText: 'Anna Beispiel' }).click();
      const send = await page.locator('#uchatSendBtn').boundingBox(), nav = await page.locator('#mobileOnlineShell').boundingBox();
      assert.ok(send.y >= 0 && send.y + send.height <= nav.y);
      assert.equal(await page.locator('#uchatInput').isVisible(), true);
      await page.locator('.uchat-mobile-return').click();
    });
    await check('Ohne Mitarbeiterkonto ist der Teamchat klar als nicht verfügbar gekennzeichnet', async () => {
      await page.evaluate(() => { window.__qaChat = window.__userChat; window.__userChat = null; window.dispatchEvent(new Event('userChatStateChanged')); });
      await page.locator('[data-mobile-chats]').click();
      assert.equal(await page.locator('[data-mobile-team-chat]').isDisabled(), true);
      assert.match(await page.locator('[data-mobile-chat-summary]').innerText(), /Online-Modus mit Mitarbeiterkonto/);
      assert.equal(await page.locator('[data-mobile-case-chat]').isEnabled(), true);
      await page.keyboard.press('Escape');
      await page.evaluate(() => { window.__userChat = window.__qaChat; });
    });
    await check('Desktop behält verschiebbaren Chat-Knopf und beide Chatspalten', async () => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#mobileOnlineShell').isVisible(), false);
      assert.equal(await page.locator('#uchatPill').isVisible(), true);
      await page.evaluate(() => __userChat.open());
      assert.equal(await page.locator('.uchat-side').isVisible(), true);
      assert.equal(await page.locator('.uchat-main').isVisible(), true);
      assert.equal(await page.locator('#uchatAtBtn').isVisible(), true);
      assert.equal(await page.locator('.uchat-mobile-tools').isVisible(), false);
    });
    assert.deepEqual(errors, [], 'Browser errors');
    requests.push(...await page.evaluate(() => __qaRequests));
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ errors, requests, output }, null, 2));
    console.log('PASS Browserprüfung abgeschlossen: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
