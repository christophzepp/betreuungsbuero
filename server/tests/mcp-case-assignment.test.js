'use strict';

/*
 * MCP-Vertragstest fuer gleichnamige Faelle. Der Test verwendet eine eigene
 * SQLite-Datei und beruehrt weder Produktivdaten noch den laufenden Server.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-case-assignment-'));
  process.env.DB_PATH = path.join(temp, 'fixture.sqlite3');
  process.env.DOCUMENTS_DATA_ROOT = path.join(temp, 'data');
  fs.mkdirSync(process.env.DOCUMENTS_DATA_ROOT, { recursive: true });

  const originalLog = console.log;
  let db;
  try {
    console.log = (...args) => {
      if (!String(args[0] || '').startsWith('[Fallrechte] Kein Admin-Konto gefunden')) {
        originalLog(...args);
      }
    };
    db = require('../src/database/index');
  } finally {
    console.log = originalLog;
  }

  const insertUser = db.prepare(`
    INSERT INTO users
      (id,username,password_hash,display_name,allow_local,is_admin)
    VALUES (?,?,?,?,1,0)
  `);
  insertUser.run(1, 'owner-a', 'x', 'Owner A');
  insertUser.run(2, 'owner-b', 'x', 'Owner B');

  const insertCase = db.prepare(`
    INSERT INTO cases
      (id,label,stammdaten_json,owner_user_id,archived)
    VALUES (?,?,?,?,0)
  `);
  insertCase.run(
    'case-a',
    'Doppelt, Dana',
    JSON.stringify({ person: { firstName: 'Dana', lastName: 'Doppelt', birthDate: '1970-01-01' } }),
    1
  );
  insertCase.run(
    'case-b',
    'Doppelt, Dana',
    JSON.stringify({ person: { firstName: 'Dana', lastName: 'Doppelt', birthDate: '1980-02-02' } }),
    2
  );
  insertCase.run(
    'case-unique',
    'Eindeutig, Erika',
    JSON.stringify({ person: { firstName: 'Erika', lastName: 'Eindeutig', birthDate: '1990-03-03' } }),
    1
  );

  const datum = (tage) => new Date(Date.now() + tage * 86400000).toISOString().slice(0, 10);
  const heute = datum(0);
  const morgen = datum(1);
  const inZweiWochen = datum(13);

  const insertEvent = db.prepare(`
    INSERT INTO calendar_events
      (id,title,location,start_at,end_at,case_id,case_label)
    VALUES (?,?,?,?,?,?,?)
  `);
  insertEvent.run(
    'event-a', 'Termin A', 'Ort A', heute + 'T10:00:00', heute + 'T11:00:00',
    'case-a', 'Doppelt, Dana'
  );
  insertEvent.run(
    'event-b', 'Termin B', 'Ort B', heute + 'T12:00:00', heute + 'T13:00:00',
    'case-b', 'Doppelt, Dana'
  );
  insertEvent.run(
    'event-ambiguous', 'Termin mehrdeutig', '', heute + 'T14:00:00', heute + 'T15:00:00',
    '', 'Doppelt, Dana'
  );
  insertEvent.run(
    'event-invalid', 'Termin ungueltige ID', '', heute + 'T16:00:00', heute + 'T17:00:00',
    'missing-case', 'Eindeutig, Erika'
  );
  insertEvent.run(
    'event-id-authoritative', 'Termin ID gewinnt', '', morgen + 'T09:00:00', morgen + 'T10:00:00',
    'case-a', 'Eindeutig, Erika'
  );
  const insertPrivateEvent = db.prepare(`
    INSERT INTO calendar_events
      (id,title,location,start_at,end_at,case_id,case_label,visibility,owner_user_id)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  insertPrivateEvent.run(
    'event-private-own', 'Privater Termin A', 'Privat A',
    heute + 'T08:00:00', heute + 'T09:00:00',
    'case-a', 'Doppelt, Dana', 'private', 1
  );
  insertPrivateEvent.run(
    'event-private-other', 'Privater Termin B', 'Privat B',
    heute + 'T18:00:00', heute + 'T19:00:00',
    'case-a', 'Doppelt, Dana', 'private', 2
  );
  assert.equal(
    db.prepare('SELECT case_id FROM calendar_events WHERE id=?').get('event-ambiguous').case_id,
    '',
    'ein mehrdeutiges Legacy-Label darf der DB-Trigger nicht dem ersten Fall zuordnen'
  );

  const insertTodo = db.prepare(`
    INSERT INTO todos
      (id,title,due_at,case_id,case_label)
    VALUES (?,?,?,?,?)
  `);
  insertTodo.run('todo-a', 'Aufgabe A', heute, 'case-a', 'Doppelt, Dana');
  insertTodo.run('todo-b', 'Aufgabe B', heute, 'case-b', 'Doppelt, Dana');
  insertTodo.run('todo-ambiguous', 'Aufgabe mehrdeutig', heute, '', 'Doppelt, Dana');
  insertTodo.run('todo-invalid', 'Aufgabe ungueltige ID', heute, 'missing-case', 'Eindeutig, Erika');
  const insertPrivateTodo = db.prepare(`
    INSERT INTO todos
      (id,title,due_at,case_id,case_label,visibility,owner_user_id)
    VALUES (?,?,?,?,?,?,?)
  `);
  insertPrivateTodo.run(
    'todo-private-own', 'Private Aufgabe A', heute,
    'case-a', 'Doppelt, Dana', 'private', 1
  );
  insertPrivateTodo.run(
    'todo-private-other', 'Private Aufgabe B', heute,
    'case-a', 'Doppelt, Dana', 'private', 2
  );

  const insertInbox = db.prepare(`
    INSERT INTO inbox_documents
      (id,file_name,mime_type,size,case_id,case_label,sender,short_desc,
       inbox_date,received_date,summary,ocr_text)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  insertInbox.run(
    'inbox-a', 'A.pdf', 'application/pdf', 1, 'case-a', 'Doppelt, Dana',
    'Absender A', 'Post A', heute, heute, 'Zusammenfassung A', 'OCR A'
  );
  insertInbox.run(
    'inbox-b', 'B.pdf', 'application/pdf', 1, 'case-b', 'Doppelt, Dana',
    'Absender B', 'Post B', heute, heute, 'Zusammenfassung B', 'OCR B'
  );
  insertInbox.run(
    'inbox-ambiguous', 'Mehrdeutig.pdf', 'application/pdf', 1, '', 'Doppelt, Dana',
    'Absender M', 'Post M', heute, heute, 'Zusammenfassung M', 'OCR geheim M'
  );
  insertInbox.run(
    'inbox-invalid', 'Ungueltig.pdf', 'application/pdf', 1, 'missing-case', 'Eindeutig, Erika',
    'Absender X', 'Post X', heute, heute, 'Zusammenfassung X', 'OCR geheim X'
  );

  const { callTool } = require('../src/integrations/mcp/tools');
  const client = { id: 'mcp-case-test', name: 'MCP-Falltest' };
  const owner = {
    userId: 1,
    username: 'owner-a',
    displayName: 'Owner A',
    isAdmin: false,
    canUseAi: true,
    canViewCases: true,
    canEditCases: true,
    canViewAllCases: false,
    canViewBankData: false
  };
  const admin = {
    ...owner,
    isAdmin: true,
    canViewAllCases: true
  };
  const read = (session, name, args) =>
    callTool(session, client, ['bb.read'], name, args || {});
  const propose = (session, kind, fall, zeile) =>
    callTool(session, client, ['bb.propose'], 'bb_vorschlagen', {
      kind,
      fall,
      zeilen: [zeile]
    });
  const apply = (session, id) =>
    callTool(session, client, ['bb.propose'], 'bb_vorschlag_uebernehmen', {
      vorschlagId: id
    });
  async function proposeAndApply(session, kind, fall, zeile) {
    const proposal = await propose(session, kind, fall, zeile);
    return apply(session, proposal.vorschlagId);
  }

  try {
    // Ein global mehrdeutiger Name bleibt auch dann mehrdeutig, wenn Owner A nur case-a sieht.
    await assert.rejects(
      propose(owner, 'termin', 'Doppelt, Dana', {
        title: 'Darf nicht entstehen',
        start_at: heute + 'T18:00:00',
        end_at: heute + 'T19:00:00'
      }),
      /mehrdeutig.*Fall-ID/i
    );
    await assert.rejects(
      read(owner, 'bb_termine_liste', {
        fall: 'Doppelt',
        von: heute,
        bis: inZweiWochen,
        umfang: 'voll'
      }),
      /mehrdeutig.*Fall-ID/i,
      'auch ein Teilstring mit mehreren Treffern muss die Fall-ID verlangen'
    );

    // Die eindeutige ID durchlaeuft den ganzen MCP-Vorschlagsweg und landet physisch in case_id.
    const created = await proposeAndApply(owner, 'termin', 'case-a', {
      title: 'Per MCP angelegt',
      description: 'ID-Vertragstest',
      start_at: morgen + 'T15:00:00',
      end_at: morgen + 'T16:00:00'
    });
    const createdId = created.uebernommen[0].id;
    const createdRow = db.prepare(
      'SELECT case_id,case_label FROM calendar_events WHERE id=?'
    ).get(createdId);
    assert.deepEqual(createdRow, {
      case_id: 'case-a',
      case_label: 'Doppelt, Dana'
    });

    let result = await read(owner, 'bb_termine_liste', {
      von: heute,
      bis: inZweiWochen,
      umfang: 'voll'
    });
    let ids = new Set(result.termine.map((row) => row.id));
    assert.ok(ids.has('event-a'));
    assert.ok(ids.has('event-id-authoritative'));
    assert.ok(ids.has('event-private-own'));
    assert.ok(ids.has(createdId));
    assert.ok(!ids.has('event-b'));
    assert.ok(!ids.has('event-ambiguous'));
    assert.ok(!ids.has('event-invalid'));
    assert.ok(!ids.has('event-private-other'));
    assert.ok(result.termine.every((row) => row.fallId === 'case-a'));

    result = await read(owner, 'bb_termine_liste', {
      fall: 'case-a',
      von: heute,
      bis: inZweiWochen,
      umfang: 'voll'
    });
    assert.ok(result.termine.every((row) => row.fallId === 'case-a'));
    assert.ok(!result.termine.some((row) => row.title === 'Termin B'));
    assert.ok(!result.termine.some((row) => row.id === 'event-private-other'));
    result = await read(admin, 'bb_termine_liste', {
      von: heute,
      bis: inZweiWochen,
      umfang: 'voll'
    });
    ids = new Set(result.termine.map((row) => row.id));
    assert.ok(ids.has('event-private-own'));
    assert.ok(!ids.has('event-private-other'),
      'auch Admins sehen laut Weblisten keine privaten Termine eines anderen Kontos');

    // Aufgabenfilter und -sicht verwenden ebenfalls die exakte aufgeloeste ID.
    result = await read(owner, 'bb_aufgaben_liste', {
      status: 'alle',
      umfang: 'voll'
    });
    ids = new Set(result.aufgaben.map((row) => row.id));
    assert.deepEqual(ids, new Set(['todo-a', 'todo-private-own']));
    assert.ok(result.aufgaben.every((row) => row.fallId === 'case-a'));
    result = await read(owner, 'bb_aufgaben_liste', {
      fall: 'case-a',
      status: 'alle',
      umfang: 'voll'
    });
    assert.deepEqual(
      new Set(result.aufgaben.map((row) => row.id)),
      new Set(['todo-a', 'todo-private-own'])
    );
    result = await read(admin, 'bb_aufgaben_liste', {
      status: 'alle',
      umfang: 'voll'
    });
    ids = new Set(result.aufgaben.map((row) => row.id));
    assert.ok(ids.has('todo-private-own'));
    assert.ok(!ids.has('todo-private-other'),
      'auch Admins sehen laut Weblisten keine privaten Aufgaben eines anderen Kontos');
    await assert.rejects(
      read(owner, 'bb_aufgaben_liste', {
        fall: 'Doppelt, Dana',
        status: 'alle',
        umfang: 'voll'
      }),
      /mehrdeutig.*Fall-ID/i
    );

    // Posteingangs-Liste und direkter OCR-Leser duerfen keine fremden,
    // mehrdeutigen oder mit ungueltiger ID versehenen Inhalte offenlegen.
    result = await read(owner, 'bb_posteingang_liste', { umfang: 'voll' });
    assert.deepEqual(
      new Set(result.dokumente.map((row) => row.id)),
      new Set(['inbox-a'])
    );
    assert.equal(result.dokumente[0].fallId, 'case-a');
    result = await read(owner, 'bb_posteingang_lesen', {
      id: 'inbox-a',
      umfang: 'voll'
    });
    assert.equal(result.fallId, 'case-a');
    assert.equal(result.ocrText, 'OCR A');
    for (const id of ['inbox-b', 'inbox-ambiguous', 'inbox-invalid']) {
      await assert.rejects(
        read(owner, 'bb_posteingang_lesen', { id, umfang: 'voll' }),
        /nicht zugeordnet|nicht eindeutig/i
      );
    }
    result = await read(admin, 'bb_posteingang_liste', { umfang: 'voll' });
    ids = new Set(result.dokumente.map((row) => row.id));
    assert.ok(ids.has('inbox-ambiguous'));
    assert.ok(ids.has('inbox-invalid'));

    // Dossier und Tagesuebersicht duerfen namensgleiche Faelle nicht vermischen.
    result = await read(owner, 'bb_fall_dossier', { fall: 'case-a' });
    const dossierTitel = new Set(result.naechsteTermine.map((row) => row.title));
    assert.ok(dossierTitel.has('Termin A'));
    assert.ok(dossierTitel.has('Termin ID gewinnt'));
    assert.ok(dossierTitel.has('Privater Termin A'));
    assert.ok(dossierTitel.has('Per MCP angelegt'));
    assert.ok(!dossierTitel.has('Termin B'));
    assert.ok(!dossierTitel.has('Termin mehrdeutig'));
    assert.ok(!dossierTitel.has('Privater Termin B'));
    assert.ok(result.naechsteTermine.every((row) => row.fallId === 'case-a'));

    result = await read(owner, 'bb_uebersicht_heute', {});
    const heuteTermine = new Set(result.termineHeute.map((row) => row.title));
    const heuteAufgaben = new Set(result.faelligeAufgaben.map((row) => row.title));
    assert.deepEqual(heuteTermine, new Set(['Privater Termin A', 'Termin A']));
    assert.deepEqual(heuteAufgaben, new Set(['Aufgabe A', 'Private Aufgabe A']));
    assert.ok(result.termineHeute.every((row) => row.fallId === 'case-a'));
    assert.ok(result.faelligeAufgaben.every((row) => row.fallId === 'case-a'));

    // Die UUID eines privaten Eintrags desselben Falls darf die Eigentümersicht nicht umgehen.
    let proposal = await propose(owner, 'termin_verschieben', 'case-a', {
      id: 'event-private-other',
      location: 'Darf privaten Termin nicht treffen'
    });
    await assert.rejects(
      apply(owner, proposal.vorschlagId),
      /privat.*anderen Konto/i
    );
    assert.equal(
      db.prepare('SELECT location FROM calendar_events WHERE id=?').get('event-private-other').location,
      'Privat B'
    );
    proposal = await propose(owner, 'termin_absagen', 'case-a', {
      id: 'event-private-other'
    });
    await assert.rejects(
      apply(owner, proposal.vorschlagId),
      /privat.*anderen Konto/i
    );
    assert.ok(db.prepare('SELECT 1 FROM calendar_events WHERE id=?').get('event-private-other'));
    await proposeAndApply(owner, 'termin_verschieben', 'case-a', {
      id: 'event-private-own',
      location: 'Privat A neu'
    });
    assert.equal(
      db.prepare('SELECT location FROM calendar_events WHERE id=?').get('event-private-own').location,
      'Privat A neu'
    );

    proposal = await propose(owner, 'aufgabe_aendern', 'case-a', {
      id: 'todo-private-other',
      title: 'Darf private Aufgabe nicht treffen'
    });
    await assert.rejects(
      apply(owner, proposal.vorschlagId),
      /privat.*anderen Konto/i
    );
    assert.equal(
      db.prepare('SELECT title FROM todos WHERE id=?').get('todo-private-other').title,
      'Private Aufgabe B'
    );
    proposal = await propose(owner, 'aufgabe_erledigen', 'case-a', {
      id: 'todo-private-other'
    });
    await assert.rejects(
      apply(owner, proposal.vorschlagId),
      /privat.*anderen Konto/i
    );
    assert.equal(
      db.prepare('SELECT done FROM todos WHERE id=?').get('todo-private-other').done,
      0
    );
    await proposeAndApply(owner, 'aufgabe_aendern', 'case-a', {
      id: 'todo-private-own',
      title: 'Private Aufgabe A neu'
    });
    await proposeAndApply(owner, 'aufgabe_erledigen', 'case-a', {
      id: 'todo-private-own'
    });
    assert.deepEqual(
      db.prepare('SELECT title,done FROM todos WHERE id=?').get('todo-private-own'),
      { title: 'Private Aufgabe A neu', done: 1 }
    );

    // Aendern und Loeschen pruefen ausserdem die ID des Zielobjekts, nicht dessen gleiches Label.
    await proposeAndApply(owner, 'termin_verschieben', 'case-a', {
      id: 'event-a',
      location: 'Ort A neu'
    });
    assert.equal(
      db.prepare('SELECT location FROM calendar_events WHERE id=?').get('event-a').location,
      'Ort A neu'
    );
    assert.equal(
      db.prepare('SELECT location FROM calendar_events WHERE id=?').get('event-b').location,
      'Ort B'
    );

    proposal = await propose(owner, 'termin_verschieben', 'case-a', {
      id: 'event-b',
      location: 'Darf B nicht treffen'
    });
    await assert.rejects(apply(owner, proposal.vorschlagId), /gehört nicht zu diesem Fall/i);
    assert.equal(
      db.prepare('SELECT location FROM calendar_events WHERE id=?').get('event-b').location,
      'Ort B'
    );

    proposal = await propose(owner, 'termin_verschieben', 'case-a', {
      id: 'event-ambiguous',
      location: 'Darf M nicht treffen'
    });
    await assert.rejects(
      apply(owner, proposal.vorschlagId),
      /keinen eindeutigen Fallbezug/i
    );
    proposal = await propose(owner, 'termin_absagen', 'case-a', {
      id: 'event-invalid'
    });
    await assert.rejects(
      apply(owner, proposal.vorschlagId),
      /keinen eindeutigen Fallbezug/i
    );

    proposal = await propose(owner, 'termin_absagen', 'case-a', {
      id: 'event-b'
    });
    await assert.rejects(apply(owner, proposal.vorschlagId), /gehört nicht zu diesem Fall/i);
    assert.ok(db.prepare('SELECT 1 FROM calendar_events WHERE id=?').get('event-b'));

    // Das widersprechende Label darf eine gueltige ID nicht ueberstimmen. Dieser
    // Erfolg beweist zugleich, dass termin_absagen case_id mitliest.
    await proposeAndApply(owner, 'termin_absagen', 'case-a', {
      id: 'event-id-authoritative'
    });
    assert.equal(
      db.prepare('SELECT 1 FROM calendar_events WHERE id=?').get('event-id-authoritative'),
      undefined
    );
    assert.ok(db.prepare('SELECT 1 FROM calendar_events WHERE id=?').get('event-b'));

    console.log('mcp-case-assignment.test.js: OK');
  } finally {
    try { db.close(); } catch (_error) {}
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
