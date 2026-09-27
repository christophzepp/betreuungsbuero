'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fixture = require('../fixtures/server-first/pilot-case.json');
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGQAAAABJRU5ErkJggg==', 'base64');
const dataUrl = 'data:image/png;base64,' + bytes.toString('base64');
const pending = name => ({ id: 'local-' + name, filename: name + '.png', mimeType: 'image/png', kind: 'image', size: bytes.length, dataUrl, _pending: true });
const route = entry => `/api/cases/${fixture.caseId}/doku-entries/${entry.id}/photos`;
const setPhotos = (x, photos) => { x.c.testPhotos = clone(photos); vm.runInContext('dokuPendingPhotosV166=testPhotos', x.c); };
const getPhotos = x => clone(vm.runInContext('dokuPendingPhotosV166', x.c));
const isPhoto = url => url.includes('/photos');

module.exports = async function dokuAttachments(t, { client, request, db, setActor }) {
  const links = entry => db.prepare("SELECT * FROM doc_links WHERE module='doku-photo' AND owner_id=?").all(entry.id);
  async function seed(x, number = 1) {
    const entry = await x.seed();
    for (let i = 0; i < number; i++) {
      const response = await request(route(entry), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: `Synthetisch-${i}.png`, mimeType: 'image/png', dataBase64: bytes.toString('base64'), photoPlace: `Ort ${i}` }) });
      assert.equal(response.status, 201); Object.assign(entry, (await response.json()).entry.data);
    }
    return entry;
  }
  const saved = async (x, entry) => (await x.docs()).find(value => value.id === entry.id).data;
  const noSuccess = x => { assert.equal(x.ui.length, 0); assert.ok(x.c.fdState.form); assert.ok(x.notices.some(message => message.includes('Anlagen nicht vollständig bestätigt'))); };
  const noRetry = async x => { const before = x.calls.length; await x.save(); assert.equal(x.calls.length, before, 'Ungeklärten Anlagenstand nicht erneut schreiben'); };

  await t.test('Dokumentationsanlagen: zwei echte Uploads sind nach erneutem Laden bytegleich und eindeutig verknüpft', async () => {
    const x = await client(); x.open(); setPhotos(x, [pending('erste'), pending('zweite')]); await x.save();
    assert.equal(x.ui.length, 1); const entry = x.c.state.caseData.documentationEntries[0], data = await saved(x, entry);
    assert.equal(data.photos.length, 2); assert.equal(links(entry).length, 2);
    assert.deepEqual(x.calls.map(call => call.method), ['POST', 'POST', 'POST']);
    for (const photo of data.photos) {
      assert.ok(photo.id && !photo.id.startsWith('local-')); assert.equal(photo._pending, undefined); assert.equal(photo.dataUrl, undefined);
      const response = await request(route(entry) + '/' + photo.id); assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    assert.deepEqual(clone(entry.photos), data.photos);
  });
  await t.test('Dokumentationsanlagen: bestätigtes Entfernen löst den Dateiverweis und erhält benachbarte Anlagen', async () => {
    const x = await client(), entry = await seed(x, 2), [removed, kept] = clone(entry.photos); x.open(fixture.caseId, 0); setPhotos(x, [kept]); await x.save();
    assert.equal(x.ui.length, 1); assert.deepEqual((await saved(x, entry)).photos.map(p => p.id), [kept.id]);
    assert.deepEqual(links(entry).map(link => link.slot), [kept.id]);
    assert.ok(x.calls[0].body.data.photos.some(photo => photo.id === removed.id), 'Verweis muss bis zur bestätigten Löschroute bestehen');
    assert.equal((await request(route(entry) + '/' + removed.id)).status, 404);
    const response = await request(route(entry) + '/' + kept.id); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  });
  await t.test('Dokumentationsanlagen: Entfernen und Hochladen in einem Formular erhält bestätigte Metadaten und Fremdfelder', async () => {
    const x = await client(), entry = await seed(x, 2), [removed, kept] = clone(entry.photos); x.open(fixture.caseId, 0);
    setPhotos(x, [{ ...kept, photoPlace: 'Geprüfter neuer Ort' }, pending('hinzu')]); await x.save();
    const data = await saved(x, entry); assert.equal(x.ui.length, 1); assert.equal(data.photos.length, 2); assert.deepEqual(data.unknown, { keep: null });
    assert.ok(!data.photos.some(p => p.id === removed.id)); assert.equal(data.photos.find(p => p.id === kept.id).photoPlace, 'Geprüfter neuer Ort');
    assert.equal(links(entry).length, 2); assert.deepEqual(clone(x.c.state.caseData.documentationEntries[0].photos), data.photos);
  });
  await t.test('Dokumentationsanlagen: abgewiesene Löschungen bleiben sichtbar und beginnen keine weiteren Uploads', async () => {
    for (const status of [403, 404, 500]) {
      const x = await client('online', (url, options) => isPhoto(url) && options.method === 'DELETE' ? Response.json({ error: 'Synthetische Ablehnung' }, { status }) : null);
      const entry = await seed(x), before = clone(entry.photos); x.open(fixture.caseId, 0); setPhotos(x, [pending('danach')]); await x.save();
      noSuccess(x); assert.deepEqual((await saved(x, entry)).photos, before); assert.equal(links(entry).length, 1);
      assert.equal(x.calls.filter(call => isPhoto(call.url)).length, 1); await noRetry(x);
    }
  });
  await t.test('Dokumentationsanlagen: unpassende Löschbestätigungen gelten nicht als erfolgreicher Abschluss', async () => {
    for (const kind of ['html', 'empty', 'false', 'wrong-entry', 'photos-object', 'still-present', 'missing-kept']) {
      let answer;
      const x = await client('online', (url, options) => isPhoto(url) && options.method === 'DELETE' ? answer() : null);
      const entry = await seed(x, 2), [removed, kept] = clone(entry.photos); x.open(fixture.caseId, 0); setPhotos(x, [kept]);
      const payload = { ok: true, entry: { id: entry.id, data: { ...clone(entry), photos: [kept] } } };
      if (kind === 'false') payload.ok = false;
      if (kind === 'wrong-entry') payload.entry.id = 'anderer-eintrag';
      if (kind === 'photos-object') payload.entry.data.photos = {};
      if (kind === 'still-present') payload.entry.data.photos.push(removed);
      if (kind === 'missing-kept') payload.entry.data.photos = [];
      answer = () => kind === 'html' ? new Response('<html>Anmeldung</html>') : Response.json(kind === 'empty' ? {} : payload);
      await x.save(); noSuccess(x); assert.equal((await saved(x, entry)).photos.length, 2); await noRetry(x);
    }
  });
  await t.test('Dokumentationsanlagen: unpassende Uploadbestätigungen erzeugen keine lokale Ersatzanlage', async () => {
    for (const kind of ['html', 'empty', 'wrong-entry', 'missing-photo', 'photos-object', 'duplicate', 'pending']) {
      const x = await client('online', (url) => {
        if (!isPhoto(url)) return null;
        const id = url.split('/').at(-2), photo = { id: 'server-photo', filename: 'Synthetisch.png', mimeType: 'image/png' };
        const payload = { photo, entry: { id, data: { photos: [{ ...photo }] } } };
        if (kind === 'wrong-entry') payload.entry.id = 'fremder-eintrag';
        if (kind === 'missing-photo') delete payload.photo;
        if (kind === 'photos-object') payload.entry.data.photos = {};
        if (kind === 'duplicate') payload.entry.data.photos.push({ ...photo });
        if (kind === 'pending') payload.entry.data.photos[0]._pending = true;
        return kind === 'html' ? new Response('<html>Anmeldung</html>') : Response.json(kind === 'empty' ? {} : payload);
      });
      x.open(); setPhotos(x, [pending('ungueltig')]); const before = (await x.docs()).length; await x.save(); noSuccess(x);
      assert.equal(x.c.state.caseData.documentationEntries.length, 0); assert.equal((await x.docs()).length, before + 1); await noRetry(x);
    }
  });
  await t.test('Dokumentationsanlagen: tatsächlicher Rechteentzug vor der Löschroute erhält Anlage und Verweis', async () => {
    const x = await client('online', url => { if (isPhoto(url)) setActor('reader'); });
    const entry = await seed(x); x.open(fixture.caseId, 0); setPhotos(x, []); await x.save(); noSuccess(x); setActor('owner');
    assert.equal((await saved(x, entry)).photos.length, 1); assert.equal(links(entry).length, 1); await noRetry(x);
  });
  await t.test('Dokumentationsanlagen: verlorene Uploadantwort nach Dateiablage verhindert einen ungeprüften zweiten Upload', async () => {
    const x = await client('online', async (url, options) => { if (isPhoto(url)) { const response = await request(url, options); assert.equal(response.status, 201); await response.json(); throw new Error('Antwort verloren'); } });
    const before = (await x.docs()).length; x.open(); setPhotos(x, [pending('verloren')]); await x.save(); noSuccess(x);
    const docs = await x.docs(); assert.equal(docs.length, before + 1); const entry = docs.at(-1); assert.equal(entry.data.photos.length, 1); assert.equal(links(entry).length, 1);
    await noRetry(x); assert.equal((await saved(x, entry)).photos.length, 1);
  });
  await t.test('Dokumentationsanlagen: zweiter Uploadfehler erhält ersten Commit ohne automatische oder manuelle Doppelübertragung', async () => {
    let uploads = 0;
    const x = await client('online', url => isPhoto(url) && ++uploads === 2 ? Response.json({ error: 'Zweiter Upload fehlgeschlagen' }, { status: 500 }) : null);
    x.open(); setPhotos(x, [pending('eins'), pending('zwei')]); await x.save(); noSuccess(x);
    const entry = (await x.docs()).at(-1); assert.equal(entry.data.photos.length, 1); assert.equal(links(entry).length, 1); await noRetry(x); assert.equal(uploads, 2);
  });
  await t.test('Dokumentationsanlagen: geteilte Datei bleibt im anderen Eintrag bytegleich erreichbar', async () => {
    const x = await client(), entry = await seed(x), photo = clone(entry.photos[0]);
    const response = await request(`/api/cases/${fixture.caseId}/doku-entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { freeDetail: 'Geteilte synthetische Anlage', photos: [photo] } }) });
    const other = { id: (await response.json()).id }; x.open(fixture.caseId, 0); setPhotos(x, []); await x.save();
    assert.equal(x.ui.length, 1); assert.equal(links(entry).length, 0); assert.equal(links(other).length, 1);
    const downloaded = await request(route(other) + '/' + photo.id); assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  });
  await t.test('Dokumentationsanlagen: verlorene Löschantwort nach Commit wird als ungeklärter Teilstand behandelt', async () => {
    const x = await client('online', async (url, options) => { if (isPhoto(url) && options.method === 'DELETE') { const response = await request(url, options); assert.equal(response.status, 200); await response.json(); throw new Error('Löschantwort verloren'); } });
    const entry = await seed(x); x.open(fixture.caseId, 0); setPhotos(x, []); await x.save(); noSuccess(x);
    assert.equal((await saved(x, entry)).photos.length, 0); assert.equal(links(entry).length, 0); await noRetry(x);
  });
  await t.test('Dokumentationsanlagen: während des Uploads geänderte Metadaten bleiben im Formular erhalten', async () => {
    let x;
    x = await client('online', async (url, options) => { if (!isPhoto(url)) return null; const response = await request(url, options); vm.runInContext("dokuPendingPhotosV166[0].photoPlace='Später ergänzt'", x.c); return response; });
    x.open(); setPhotos(x, [pending('metadaten')]); const form = x.c.fdState.form; await x.save();
    assert.equal(x.c.fdState.form, form); assert.equal(x.ui.length, 0); assert.equal(getPhotos(x)[0].photoPlace, 'Später ergänzt'); await noRetry(x);
  });
  await t.test('Dokumentationsanlagen: Uploadbestätigung ohne beizubehaltende Anlage wird abgewiesen', async () => {
    const x = await client('online', url => {
      if (!isPhoto(url)) return null;
      const photo = { id: 'synthetische-bestaetigung', filename: 'hinzu.png' };
      return Response.json({ photo, entry: { id: url.split('/').at(-2), data: { photos: [photo] } } });
    });
    const entry = await seed(x), before = clone(entry.photos); x.open(fixture.caseId, 0); setPhotos(x, [...before, pending('hinzu')]); await x.save();
    noSuccess(x); assert.deepEqual((await saved(x, entry)).photos, before); assert.equal(links(entry).length, 1); await noRetry(x);
  });
  await t.test('Dokumentationsanlagen: neueres Formular ändert weder laufende Uploadziele noch eigene Anlagen', async () => {
    let x, newer;
    const foreign = 'sf-doku-ziel', ownPhotos = [pending('neueres-formular')];
    x = await client('online', async (url, options) => {
      if (!isPhoto(url)) return null;
      if (!newer) { x.open(foreign); setPhotos(x, ownPhotos); newer = x.c.fdState.form; }
      return request(url, options);
    });
    x.open(); setPhotos(x, [pending('erste'), pending('zweite')]); const before = (await x.docs(foreign)).length; await x.save();
    assert.equal(x.c.fdState.form, newer); assert.equal(x.ui.length, 0); assert.deepEqual(getPhotos(x), ownPhotos);
    assert.ok(x.calls.every(call => call.url.startsWith(`/api/cases/${fixture.caseId}/`)));
    assert.equal((await x.docs(foreign)).length, before); assert.equal((await x.docs()).at(-1).data.photos.length, 2);
  });
};
