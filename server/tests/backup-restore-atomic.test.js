'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const backupData = require('../src/modules/backup/portable-data');

test('strikter Restore rollt bereits geschriebene Tabellen bei einer fehlerhaften Zeile zurück', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE first_table (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE second_table (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO first_table VALUES ('bestand','bleibt');
  `);
  const definitions = [
    { key: 'first', table: 'first_table', mode: 'replace' },
    { key: 'second', table: 'second_table', mode: 'replace' }
  ];
  let failure;
  try {
    backupData.restorePayload(db, {
      first: [{ id: 'neu', value: 'wird-zurueckgerollt' }],
      second: [{ id: 'kaputt', value: 'geheim', unbekannt: 'darf-nicht-im-fehler-stehen' }]
    }, definitions);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.equal(failure.code, 'RESTORE_UNKNOWN_COLUMN');
  assert.equal(failure.detail.table, 'second_table');
  assert.equal(failure.detail.rowIndex, 0);
  assert.ok(!failure.message.includes('darf-nicht-im-fehler-stehen'));
  assert.deepEqual(db.prepare('SELECT * FROM first_table ORDER BY id').all(), [
    { id: 'bestand', value: 'bleibt' }
  ]);
  assert.equal(failure.restoreReport.rolledBack, true);
  assert.deepEqual(failure.restoreReport.totals, {
    expected: 2, accepted: 0, restored: 0, wouldRestore: 0,
    skipped: 0, rejected: 1, deleted: 0, wouldDelete: 0,
    neutralized: 0, wouldNeutralize: 0
  });
  db.close();
});

test('jede Restore-Zeile wird mit ihrer eigenen Spaltenmenge validiert und übernommen', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE records (id TEXT PRIMARY KEY, a TEXT NOT NULL DEFAULT '', b TEXT NOT NULL DEFAULT '')");
  const report = backupData.restorePayload(db, {
    records: [{ id: 'a', a: 'nur-a' }, { id: 'b', b: 'nur-b' }]
  }, [{ key: 'records', table: 'records', mode: 'replace' }]);
  assert.equal(report.totals.expected, 2);
  assert.equal(report.totals.restored, 2);
  assert.equal(report.totals.rejected, 0);
  assert.deepEqual(db.prepare('SELECT * FROM records ORDER BY id').all(), [
    { id: 'a', a: 'nur-a', b: '' },
    { id: 'b', a: '', b: 'nur-b' }
  ]);
  db.close();
});

test('echtes UPSERT erhält abhängige Zeilen und unterstützt zusammengesetzte Primärschlüssel', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`
    CREATE TABLE parents (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      local_only TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (scope,id)
    );
    CREATE TABLE children (
      id TEXT PRIMARY KEY,
      parent_scope TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      FOREIGN KEY (parent_scope,parent_id) REFERENCES parents(scope,id) ON DELETE CASCADE
    );
    INSERT INTO parents VALUES ('office','one','bestand','lokal-erhalten');
    INSERT INTO children VALUES ('child-1','office','one');
  `);
  const result = backupData.restorePayload(db, {
    parents: [{ scope: 'office', id: 'one', value: 'wiederhergestellt' }]
  }, [{ key: 'parents', table: 'parents', mode: 'replace' }]);
  assert.equal(result.totals.restored, 1);
  assert.deepEqual(db.prepare('SELECT * FROM parents').get(), {
    scope: 'office',
    id: 'one',
    value: 'wiederhergestellt',
    local_only: 'lokal-erhalten'
  });
  assert.deepEqual(db.prepare('SELECT * FROM children').all(), [{
    id: 'child-1',
    parent_scope: 'office',
    parent_id: 'one'
  }]);
  db.close();
});

test('Security-/Credentials-Replace entfernt Altzugriffe und neutralisiert referenzierte Principals FK-sicher', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, is_admin INTEGER NOT NULL DEFAULT 0,
      allow_local INTEGER NOT NULL DEFAULT 1, allow_online INTEGER NOT NULL DEFAULT 1,
      allow_case_management INTEGER NOT NULL DEFAULT 1, permissions_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE cases (
      id TEXT PRIMARY KEY,
      created_by INTEGER NOT NULL REFERENCES users(id)
    );
    CREATE TABLE api_tokens (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL
    );
    CREATE TABLE calendar_connections (
      id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
      password_encrypted TEXT NOT NULL DEFAULT '', client_secret_encrypted TEXT NOT NULL DEFAULT '',
      access_token_encrypted TEXT NOT NULL DEFAULT '', refresh_token_encrypted TEXT NOT NULL DEFAULT '',
      token_expires_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE calendar_events (
      id TEXT PRIMARY KEY,
      connection_id TEXT REFERENCES calendar_connections(id)
    );
    CREATE TABLE mail_accounts (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'imap',
      imap_host TEXT NOT NULL DEFAULT '', imap_user TEXT NOT NULL DEFAULT '',
      imap_pass_encrypted TEXT NOT NULL DEFAULT '', smtp_host TEXT NOT NULL DEFAULT '',
      smtp_user TEXT NOT NULL DEFAULT '', smtp_pass_encrypted TEXT NOT NULL DEFAULT '',
      graph_connection_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE mail_drafts (
      id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES mail_accounts(id)
    );
    CREATE TABLE bank_connections (
      id TEXT PRIMARY KEY, username TEXT NOT NULL DEFAULT '', pin_encrypted TEXT NOT NULL DEFAULT '',
      tan_mechanism TEXT NOT NULL DEFAULT '', tan_medium TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '', status_detail TEXT NOT NULL DEFAULT '',
      sca_valid_until TEXT NOT NULL DEFAULT '', last_sync_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE bank_transactions (
      id TEXT PRIMARY KEY,
      connection_id TEXT REFERENCES bank_connections(id)
    );
    CREATE TABLE smtp_config (id INTEGER PRIMARY KEY, password_encrypted TEXT NOT NULL DEFAULT '');

    INSERT INTO users VALUES (1,'alt','hash',1,1,1,1,1,'{"online":{"viewCases":true}}');
    INSERT INTO cases VALUES ('fall-alt',1);
    INSERT INTO api_tokens VALUES ('token-alt',1,'hash-alt');
    INSERT INTO calendar_connections VALUES ('cal-alt',1,'pw','secret','access','refresh','morgen');
    INSERT INTO calendar_events VALUES ('termin-alt','cal-alt');
    INSERT INTO mail_accounts VALUES ('mail-alt','microsoft','imap','user','pw','smtp','user','pw','graph');
    INSERT INTO mail_drafts VALUES ('entwurf-alt','mail-alt');
    INSERT INTO bank_connections VALUES ('bank-alt','user','pin','tan','medium','ok','aktiv','morgen','heute');
    INSERT INTO bank_transactions VALUES ('umsatz-alt','bank-alt');
    INSERT INTO smtp_config VALUES (1,'smtp-pw');
  `);

  const securityDefinitions = [
    {
      key: 'users', table: 'users', mode: 'replace',
      restoreGroup: 'security', replacePolicy: 'neutralize'
    },
    {
      key: 'apiTokens', table: 'api_tokens', mode: 'replace',
      restoreGroup: 'security', restorePolicy: 'explicit-token'
    }
  ];
  const securityPayload = { users: [], apiTokens: [] };
  const preview = backupData.restorePayload(db, securityPayload, securityDefinitions, { dryRun: true });
  assert.equal(preview.tables.users.wouldNeutralize, 1);
  assert.equal(preview.tables.api_tokens.wouldDelete, 1);
  assert.equal(db.prepare('SELECT active FROM users WHERE id=1').get().active, 1);

  const security = backupData.restorePayload(db, securityPayload, securityDefinitions);
  assert.equal(security.tables.users.neutralized, 1);
  assert.equal(security.tables.api_tokens.deleted, 1);
  assert.deepEqual(
    db.prepare('SELECT active,is_admin,allow_local,allow_online,allow_case_management,permissions_json FROM users WHERE id=1').get(),
    {
      active: 0, is_admin: 0, allow_local: 0, allow_online: 0,
      allow_case_management: 0, permissions_json: '{}'
    }
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM api_tokens').get().n, 0);
  assert.equal(db.prepare("SELECT created_by FROM cases WHERE id='fall-alt'").get().created_by, 1);

  const credentialsDefinitions = [
    {
      key: 'calendarConnections', table: 'calendar_connections', mode: 'replace',
      restoreGroup: 'credentials', replacePolicy: 'neutralize'
    },
    {
      key: 'mailAccounts', table: 'mail_accounts', mode: 'replace',
      restoreGroup: 'credentials', replacePolicy: 'neutralize'
    },
    {
      key: 'bankConnections', table: 'bank_connections', mode: 'replace',
      restoreGroup: 'credentials', replacePolicy: 'neutralize'
    },
    { key: 'smtpConfig', table: 'smtp_config', mode: 'replace', restoreGroup: 'credentials' }
  ];
  const credentials = backupData.restorePayload(db, {
    calendarConnections: [],
    mailAccounts: [],
    bankConnections: [],
    smtpConfig: []
  }, credentialsDefinitions);
  assert.equal(credentials.tables.smtp_config.deleted, 1);
  assert.equal(db.prepare("SELECT enabled,password_encrypted,access_token_encrypted,refresh_token_encrypted FROM calendar_connections WHERE id='cal-alt'").get().enabled, 0);
  assert.deepEqual(
    db.prepare("SELECT kind,imap_host,imap_pass_encrypted,smtp_host,smtp_pass_encrypted,graph_connection_id FROM mail_accounts WHERE id='mail-alt'").get(),
    {
      kind: 'disabled', imap_host: '', imap_pass_encrypted: '',
      smtp_host: '', smtp_pass_encrypted: '', graph_connection_id: ''
    }
  );
  assert.deepEqual(
    db.prepare("SELECT username,pin_encrypted,status FROM bank_connections WHERE id='bank-alt'").get(),
    { username: '', pin_encrypted: '', status: 'disabled' }
  );
  assert.equal(db.prepare("SELECT connection_id FROM calendar_events WHERE id='termin-alt'").get().connection_id, 'cal-alt');
  assert.equal(db.prepare("SELECT account_id FROM mail_drafts WHERE id='entwurf-alt'").get().account_id, 'mail-alt');
  assert.equal(db.prepare("SELECT connection_id FROM bank_transactions WHERE id='umsatz-alt'").get().connection_id, 'bank-alt');
  db.close();
});

test('Restore lehnt fehlende Tabellen und falsche Schemas vor dem ersten Schreiben ab', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE first_table (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE second_table (id TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const definitions = [
    { key: 'first', table: 'first_table', mode: 'replace' },
    { key: 'second', table: 'second_table', mode: 'replace' }
  ];
  assert.throws(
    () => backupData.restorePayload(db, {
      type: 'expected',
      version: 2,
      first: [{ id: 'must-not-land', value: 'x' }]
    }, definitions, { expectedType: 'expected', expectedVersions: [2] }),
    (error) => {
      assert.equal(error.code, 'RESTORE_PAYLOAD_KEY_MISSING');
      assert.equal(error.detail.table, 'second_table');
      assert.equal(error.restoreReport.rolledBack, true);
      return true;
    }
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM first_table').get().n, 0);

  assert.throws(
    () => backupData.restorePayload(db, {
      type: 'wrong',
      version: 2,
      first: [],
      second: []
    }, definitions, { expectedType: 'expected', expectedVersions: [2] }),
    (error) => error.code === 'RESTORE_PAYLOAD_TYPE_MISMATCH'
      && error.restoreReport.rolledBack === true
  );
  assert.throws(
    () => backupData.restorePayload(db, {
      type: 'expected',
      version: 1,
      first: [],
      second: []
    }, definitions, { expectedType: 'expected', expectedVersions: [2] }),
    (error) => error.code === 'RESTORE_PAYLOAD_VERSION_UNSUPPORTED'
      && error.restoreReport.rolledBack === true
  );
  db.close();
});

test('laufende Sitzung und nicht auflösbare Fallzuständigkeiten sind sichtbar gezählte Skips', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE cases (id TEXT PRIMARY KEY, owner_user_id INTEGER REFERENCES users(id));
    INSERT INTO sessions VALUES ('aktuell','neu',999);
    INSERT INTO users VALUES (1);
    INSERT INTO cases VALUES ('fall-1',NULL);
  `);
  const payload = {
    sessions: [
      { sid: 'aktuell', data: 'alter-stand', expires_at: 1 },
      { sid: 'andere', data: 'wiederhergestellt', expires_at: 2 }
    ],
    caseOwners: [
      { case_id: 'fall-1', owner_user_id: 1 },
      { case_id: 'nicht-da', owner_user_id: 1 },
      { case_id: 'fall-1', owner_user_id: 999 }
    ]
  };
  const definitions = [{ key: 'sessions', table: 'sessions', mode: 'replace' }];
  const preview = backupData.restorePayload(db, payload, definitions, {
    currentSid: 'aktuell', includeCaseOwners: true, dryRun: true
  });
  assert.deepEqual(preview.tables.sessions.skipReasons, { current_session: 1 });
  assert.equal(preview.tables.sessions.wouldRestore, 1);
  assert.deepEqual(preview.tables.case_owners.skipReasons, {
    case_not_found: 1,
    owner_not_found: 1
  });
  assert.equal(preview.tables.case_owners.wouldRestore, 1);

  const result = backupData.restorePayload(db, payload, definitions, {
    currentSid: 'aktuell', includeCaseOwners: true
  });
  assert.equal(result.totals.expected, 5);
  assert.equal(result.totals.restored, 2);
  assert.equal(result.totals.skipped, 3);
  assert.equal(db.prepare("SELECT data FROM sessions WHERE sid='aktuell'").get().data, 'neu');
  assert.equal(db.prepare("SELECT data FROM sessions WHERE sid='andere'").get().data, 'wiederhergestellt');
  assert.equal(db.prepare("SELECT owner_user_id FROM cases WHERE id='fall-1'").get().owner_user_id, 1);
  db.close();
});

test('INSERT OR IGNORE weist bestehende Zeilen als bewussten Skip aus', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE audit_log (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO audit_log VALUES (1,'bestand')");
  const report = backupData.restorePayload(db, {
    audit: [{ id: 1, value: 'alt' }, { id: 2, value: 'neu' }]
  }, [{ key: 'audit', table: 'audit_log', mode: 'ignore' }]);
  assert.equal(report.tables.audit_log.restored, 1);
  assert.equal(report.tables.audit_log.skipped, 1);
  assert.deepEqual(report.tables.audit_log.skipReasons, { existing_row: 1 });
  assert.equal(db.prepare('SELECT value FROM audit_log WHERE id=1').get().value, 'bestand');
  db.close();
});

test('safeAll macht unerwartete Tabellenfehler sichtbar statt eine leere Liste vorzutäuschen', () => {
  const db = {
    prepare() {
      return { all() { throw new Error('no such column: defekt'); } };
    }
  };
  assert.throws(
    () => backupData.safeAll(db, 'office_json'),
    (error) => error.code === 'BACKUP_TABLE_READ_FAILED' && error.table === 'office_json'
  );
});

test('Restore-Vorschau führt echte Constraints aus und rollt sämtliche Testschreibvorgänge zurück', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE
    );
    INSERT INTO accounts VALUES ('bestand','bestand@example.invalid');
  `);
  assert.throws(
    () => backupData.restorePayload(db, {
      accounts: [
        { id: 'a', email: 'doppelt@example.invalid' },
        { id: 'b', email: 'doppelt@example.invalid' }
      ]
    }, [{ key: 'accounts', table: 'accounts', mode: 'replace', restoreGroup: 'security' }], {
      dryRun: true
    }),
    (error) => error.code === 'RESTORE_ROW_CONSTRAINT_FAILED'
      && error.restoreReport.rolledBack === true
  );
  assert.deepEqual(db.prepare('SELECT * FROM accounts').all(), [{
    id: 'bestand',
    email: 'bestand@example.invalid'
  }]);

  const preview = backupData.restorePayload(db, {
    accounts: [{ id: 'neu', email: 'neu@example.invalid' }]
  }, [{ key: 'accounts', table: 'accounts', mode: 'replace', restoreGroup: 'security' }], {
    dryRun: true
  });
  assert.equal(preview.tables.accounts.wouldDelete, 1);
  assert.equal(preview.tables.accounts.wouldRestore, 1);
  assert.deepEqual(db.prepare('SELECT * FROM accounts').all(), [{
    id: 'bestand',
    email: 'bestand@example.invalid'
  }]);
  db.close();
});
