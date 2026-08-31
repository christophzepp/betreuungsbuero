'use strict';

/*
 * Isolierter Vertragstest für ID-basierte Dokumentrouten und die unveränderlichen
 * Register 00–12. Eigene SQLite-Datei, eigener Dokumentenbaum, listen(0).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'documents-route-scope-'));
  const dbPath = path.join(temp, 'fixture.sqlite3');
  const dataRoot = path.join(temp, 'data');
  const storageRoot = path.join(temp, 'Dokumentenspeicher');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(storageRoot, { recursive: true });
  process.env.DB_PATH = dbPath;
  process.env.DOCUMENTS_DATA_ROOT = dataRoot;

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

  db.prepare(`
    INSERT INTO users
      (id,username,password_hash,display_name,allow_local,allow_online,is_admin)
    VALUES (1,'scope-a','x','Scope A',1,1,0),(2,'scope-b','x','Scope B',1,1,0)
  `).run();
  db.prepare('UPDATE users SET permissions_json=? WHERE id=1').run(JSON.stringify({
    online: {
      viewDocuments: true,
      editDocuments: true,
      docsAllCases: false,
      viewAllCases: false,
      manageOfficeProfile: true
    }
  }));
  const insertCase = db.prepare(`
    INSERT INTO cases
      (id,label,stammdaten_json,owner_user_id,archived)
    VALUES (?,?,?,?,0)
  `);
  insertCase.run(
    'case-a',
    'Eigen, Erika',
    JSON.stringify({ person: { lastName: 'Eigen', firstName: 'Erika', birthDate: '1970-01-01' } }),
    1
  );
  insertCase.run(
    'case-b',
    'Fremd, Frieda',
    JSON.stringify({ person: { lastName: 'Fremd', firstName: 'Frieda', birthDate: '1980-02-02' } }),
    2
  );
  db.prepare(`
    INSERT INTO office_json (key,data_json,updated_by)
    VALUES ('documents_config',?,1)
  `).run(JSON.stringify({ storageLayout: 'real-folders-v1', storageRoot }));

  db.prepare(`
    INSERT INTO doc_folders
      (id,area,case_id,parent_id,name,name_key,storage_relpath,created_by)
    VALUES
      ('foreign-folder','case','case-b','','01 - Stammdaten','01 - stammdaten','',2)
  `).run();
  db.prepare(`
    INSERT INTO doc_files
      (id,area,case_id,folder_id,name,name_key,mime_type,size,sha256,created_by)
    VALUES
      ('foreign-file','case','case-b','foreign-folder','Fremd.pdf','fremd.pdf',
       'application/pdf',0,'',2)
  `).run();
  db.prepare(`
    INSERT INTO doc_annotations
      (id,file_id,page,art,text,geo_json,author,created_by)
    VALUES ('foreign-annotation','foreign-file',1,'Kommentar','geheim','{}','Scope B',2)
  `).run();

  const documents = require('../src/modules/documents/routes');
  const app = express();
  let admin = false;
  let sessionUserId = 1;
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    req.session = {
      userId: sessionUserId,
      username: 'scope-a',
      displayName: 'Scope A',
      mode: 'online',
      isAdmin: admin,
      canViewDocuments: true,
      canEditDocuments: true,
      canManageOfficeProfile: true,
      canDocsAllCases: false,
      canViewAllCases: false
    };
    next();
  });
  app.use('/api/documents', documents);

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}/api/documents`;
  async function request(route, options) {
    const response = await fetch(base + route, options);
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_error) { body = text; }
    return { response, body };
  }
  const json = (method, body) => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  try {
    let result = await request('/backup-jobs');
    assert.equal(result.response.status, 403);
    assert.match(String(result.body && result.body.error), /ausschließlich.*Administratoren/);
    result = await request('/backup-jobs/nicht-vorhanden/download-latest');
    assert.equal(result.response.status, 403);
    result = await request('/backup-preflight', json('POST', {
      ziel: { art: 'gesamt', ordner: path.join(temp, 'backup-ziel') },
      options: {}
    }));
    assert.equal(result.response.status, 403);
    result = await request('/backup-target/initialize', json('POST', {
      ordner: path.join(temp, 'backup-ziel'),
      confirm: true
    }));
    assert.equal(result.response.status, 403);

    result = await request('/folders/foreign-folder', json('PATCH', { name: 'Übergriff' }));
    assert.equal(result.response.status, 403);
    assert.equal(db.prepare('SELECT name FROM doc_folders WHERE id=?').get('foreign-folder').name, '01 - Stammdaten');

    result = await request('/folders/foreign-folder?force=1', { method: 'DELETE' });
    assert.equal(result.response.status, 403);
    assert.ok(db.prepare('SELECT 1 FROM doc_folders WHERE id=?').get('foreign-folder'));

    result = await request('/annotations?fileId=foreign-file');
    assert.equal(result.response.status, 403);
    result = await request('/annotations', json('POST', {
      fileId: 'foreign-file', page: 1, art: 'Kommentar', text: 'Übergriff'
    }));
    assert.equal(result.response.status, 403);
    result = await request('/annotations/foreign-annotation', json('PATCH', { text: 'Übergriff' }));
    assert.equal(result.response.status, 403);
    assert.equal(
      db.prepare('SELECT text FROM doc_annotations WHERE id=?').get('foreign-annotation').text,
      'geheim'
    );
    result = await request('/annotations/foreign-annotation', { method: 'DELETE' });
    assert.equal(result.response.status, 403);
    assert.ok(db.prepare('SELECT 1 FROM doc_annotations WHERE id=?').get('foreign-annotation'));

    result = await request('/folders/standard?area=case&caseId=case-a', { method: 'POST' });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.registers.length, 13);
    const register = db.prepare(`
      SELECT id,name FROM doc_folders
       WHERE area='case' AND case_id='case-a' AND parent_id='' AND name='01 - Stammdaten'
    `).get();
    assert.ok(register);

    result = await request('/folders?area=case&caseId=case-a', json('POST', {
      name: 'Sonstiges', parentId: ''
    }));
    assert.equal(result.response.status, 409);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM doc_folders WHERE case_id='case-a' AND parent_id=''").get().n,
      13
    );
    result = await request('/folders/bulk?area=case&caseId=case-a', json('POST', {
      paths: ['Sonstiges/Unterordner']
    }));
    assert.equal(result.response.status, 409);
    result = await request(`/folders/${register.id}`, json('PATCH', { name: '01 - Andere Stammdaten' }));
    assert.equal(result.response.status, 409);
    result = await request(`/folders/${register.id}?force=1`, { method: 'DELETE' });
    assert.equal(result.response.status, 409);

    result = await request('/folders?area=case&caseId=case-a', json('POST', {
      name: 'Ausweise & Urkunden', parentId: register.id
    }));
    assert.equal(result.response.status, 201);

    admin = true;
    const adminPassword = 'Backup-Testkennwort-2026!';
    db.prepare(`
      UPDATE users
         SET is_admin=1,allow_online=1,password_hash=?
       WHERE id=1
    `).run(await require('../src/middleware/authentication').hashPassword(adminPassword));
    const backupTarget = path.join(temp, 'backup-ziel');
    fs.mkdirSync(backupTarget);
    result = await request('/backup-preflight', json('POST', {
      ziel: { art: 'gesamt', ordner: backupTarget },
      options: {}
    }));
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.target.markerPresent, false);
    assert.equal(result.body.technicalReady, false);

    result = await request('/backup-target/initialize', json('POST', {
      ordner: backupTarget
    }));
    assert.equal(result.response.status, 400);
    assert.equal(fs.existsSync(path.join(backupTarget, '.betreuungsbuero-backup-ziel')), false);

    result = await request('/backup-target/initialize', json('POST', {
      ordner: backupTarget,
      confirm: true
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.created, true);
    assert.match(result.body.target.targetId, /^[0-9a-f-]{36}$/);
    assert.equal(
      fs.statSync(path.join(backupTarget, '.betreuungsbuero-backup-ziel')).mode & 0o777,
      0o600
    );

    result = await request('/backup-preflight', json('POST', {
      ziel: { art: 'gesamt', ordner: backupTarget },
      options: {}
    }));
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.target.markerValid, true);
    assert.equal(result.body.technicalReady, false);
    assert.equal(result.body.local.ready, true);
    assert.equal(result.body.readiness.recoveryReady, false);
    assert.equal(result.body.readiness.remoteReady, false);
    assert.equal(result.body.protectionComplete, false);

    const resticPassword = path.join(temp, 'restic-password');
    fs.writeFileSync(resticPassword, 'nur-test\n', { mode: 0o644 });
    const protectedOptions = {
      backupTargetId: result.body.target.targetId,
      localTargetEncryptedAttested: true,
      retention: { enabled: true, daily: 14, monthly: 12, yearly: 10 },
      offsite: {
        enabled: true,
        repository: 'sftp:backup.example.invalid:/betreuungsbuero',
        passwordFile: resticPassword,
        immutableAttested: true,
        lifecycleAttested: true
      }
    };
    result = await request('/backup-preflight', json('POST', {
      ziel: { art: 'gesamt', ordner: backupTarget },
      options: protectedOptions
    }));
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.files.offsitePassword.valid, false);
    assert.equal(result.body.technicalReady, false);
    if (process.platform !== 'win32') {
      fs.chmodSync(resticPassword, 0o400);
      result = await request('/backup-preflight', json('POST', {
        ziel: { art: 'gesamt', ordner: backupTarget },
        options: protectedOptions
      }));
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.files.offsitePassword.valid, false);
      assert.match(
        result.body.files.offsitePassword.error,
        /exakt mit Dateimodus 0600/
      );
    }
    fs.chmodSync(resticPassword, 0o600);
    result = await request('/backup-preflight', json('POST', {
      ziel: { art: 'gesamt', ordner: backupTarget },
      options: protectedOptions
    }));
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.files.offsitePassword.valid, true);
    assert.equal(result.body.technicalReady, false);
    assert.equal(result.body.readiness.recoveryReady, false);
    assert.equal(result.body.readiness.remoteReady, false);
    assert.equal(result.body.protectionComplete, false);
    assert.equal(result.body.notification.valid, false);

    result = await request('/backup-jobs', json('POST', {
      label: 'Geschützter Nachtlauf',
      interval: 'taeglich',
      weekdays: '',
      timeHhmm: '02:30',
      quelle: { bereich: 'alles', caseId: '' },
      ziel: { art: 'gesamt', ordner: backupTarget },
      options: protectedOptions
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    const protectedJob = result.body;
    const snapshotName = 'Gesamtsicherung_20260728_023000_scope';
    fs.mkdirSync(path.join(backupTarget, snapshotName));
    const profile = require('../src/modules/backup/runner')._test.offsiteProfileIdentity(
      protectedOptions.offsite,
      protectedJob.id
    );
    fs.writeFileSync(
      path.join(backupTarget, `${snapshotName}.offsite-pending`),
      [
        'FORMAT=Betreuungsbuero-Offsite-Pending/1',
        `SNAPSHOT=${snapshotName}`,
        `MANIFEST_SHA=${'ab'.repeat(32)}`,
        `PROFILE_SHA=${profile.profileSha}`,
        `JOB_ID=${protectedJob.id}`,
        `TARGET_ID=${protectedOptions.backupTargetId}`,
        ''
      ].join('\n')
    );
    result = await request(`/backup-jobs/${protectedJob.id}`, json('PATCH', {
      options: {
        ...protectedOptions,
        offsite: {
          ...protectedOptions.offsite,
          repository: 'sftp:anderes.example.invalid:/betreuungsbuero'
        }
      }
    }));
    assert.equal(result.response.status, 409);
    assert.equal(result.body.code, 'BACKUP_OFFSITE_BACKLOG_BLOCKS_CHANGE');
    result = await request(`/backup-jobs/${protectedJob.id}`, { method: 'DELETE' });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.code, 'BACKUP_OFFSITE_BACKLOG_BLOCKS_DELETE');
    assert.equal(result.body.abandonmentAvailable, true);
    const confirmation = `BACKLOG VERLASSEN ${protectedJob.id}`;
    result = await request(`/backup-jobs/${protectedJob.id}/abandon-backlog`, json('POST', {
      confirmation,
      snapshotsRemainAcknowledged: true,
      reason: 'Das frühere Offsite-Ziel ist dauerhaft und nachweislich verloren.',
      adminPassword: 'falsch'
    }));
    assert.equal(result.response.status, 403);
    assert.ok(db.prepare('SELECT 1 FROM doc_backup_jobs WHERE id=?').get(protectedJob.id));
    result = await request(`/backup-jobs/${protectedJob.id}/abandon-backlog`, json('POST', {
      confirmation,
      snapshotsRemainAcknowledged: true,
      reason: 'Das frühere Offsite-Ziel ist dauerhaft und nachweislich verloren.',
      adminPassword
    }));
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.filesDeleted, 0);
    assert.equal(result.body.snapshotsPreserved, true);
    assert.equal(result.body.pendingSidecarsReclassified, 1);
    assert.equal(result.body.futureRetentionEligible, true);
    const retainedLineage = db.prepare(
      'SELECT enabled, run_started_at, last_result FROM doc_backup_jobs WHERE id=?'
    ).get(protectedJob.id);
    assert.ok(retainedLineage, 'die Sicherungslinie muss für Retention und Remote-Restore adressierbar bleiben');
    assert.equal(retainedLineage.enabled, 0);
    assert.equal(retainedLineage.run_started_at, '');
    assert.match(String(retainedLineage.last_result || ''), /Sicherungslinie administrativ verlassen/i);
    result = await request(`/backup-jobs/${protectedJob.id}/run`, json('POST', {}));
    assert.equal(result.response.status, 409);
    assert.match(String(result.body.error || ''), /pausiert/i);
    assert.equal(fs.existsSync(path.join(backupTarget, snapshotName)), true);
    assert.equal(fs.existsSync(path.join(backupTarget, `${snapshotName}.offsite-pending`)), false);
    assert.equal(fs.existsSync(path.join(backupTarget, `${snapshotName}.offsite-abandoned`)), true);
    const snapshotRoot = path.join(backupTarget, snapshotName);
    fs.mkdirSync(path.join(snapshotRoot, 'verwaltung'), { recursive: true });
    fs.mkdirSync(path.join(snapshotRoot, 'daten'), { recursive: true });
    const downloadable = {
      'STATUS.txt': Buffer.from('VOLLSTAENDIG\n'),
      'verwaltung/JOB-ID.txt': Buffer.from(`${protectedJob.id}\n`),
      'verwaltung/TARGET-ID.txt': Buffer.from(`${protectedOptions.backupTargetId}\n`),
      'daten/database.sqlite': Buffer.from('isolierte-testdatenbank')
    };
    for (const [relative, bytes] of Object.entries(downloadable)) {
      fs.writeFileSync(path.join(snapshotRoot, ...relative.split('/')), bytes);
    }
    const manifest = Object.entries(downloadable).map(([relative, bytes]) => (
      `${crypto.createHash('sha256').update(bytes).digest('hex')}\t${bytes.length}\t`
        + Buffer.from(relative, 'utf8').toString('base64')
    )).join('\n') + '\n';
    fs.writeFileSync(path.join(snapshotRoot, 'MANIFEST.tsv'), manifest);
    fs.writeFileSync(
      path.join(snapshotRoot, 'MANIFEST.tsv.sha256'),
      crypto.createHash('sha256').update(manifest).digest('hex') + '\n'
    );
    const downloadResponse = await fetch(
      `${base}/backup-jobs/${encodeURIComponent(protectedJob.id)}/download-latest`
    );
    const downloadBytes = Buffer.from(await downloadResponse.arrayBuffer());
    assert.equal(downloadResponse.status, 200);
    assert.match(String(downloadResponse.headers.get('content-type') || ''), /zip/i);
    assert.match(String(downloadResponse.headers.get('cache-control') || ''), /no-store/i);
    assert.equal(downloadBytes.subarray(0, 2).toString('hex'), '504b');
    const abandonmentAudit = db.prepare(`
      SELECT details_json
        FROM audit_log
       WHERE action='backup-job.abandon-backlog' AND target_id=?
       ORDER BY id DESC LIMIT 1
    `).get(protectedJob.id);
    assert.ok(abandonmentAudit);
    assert.equal(JSON.parse(abandonmentAudit.details_json).filesDeleted, 0);
    assert.equal(
      JSON.parse(abandonmentAudit.details_json).pendingSidecarsReclassified,
      1
    );
    assert.doesNotMatch(abandonmentAudit.details_json, new RegExp(adminPassword));
    assert.doesNotMatch(abandonmentAudit.details_json, new RegExp(backupTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const lineageTarget = path.join(temp, 'backup-ziel-linie');
    const lineageTargetId = '77777777-7777-4777-8777-777777777777';
    fs.mkdirSync(lineageTarget);
    fs.writeFileSync(
      path.join(lineageTarget, '.betreuungsbuero-backup-ziel'),
      `Betreuungsbuero-Backupziel/1\nTARGET_ID=${lineageTargetId}\nCREATED_AT=2026-07-28T00:00:00Z\n`
    );
    result = await request('/backup-jobs', json('POST', {
      label: 'Dauerhafte Sicherungslinie',
      interval: 'taeglich',
      timeHhmm: '02:30',
      quelle: { bereich: 'alles', caseId: '' },
      ziel: { art: 'gesamt', ordner: lineageTarget },
      options: {
        ...protectedOptions,
        backupTargetId: lineageTargetId,
        offsite: { enabled: false }
      }
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    const lineageJob = result.body;
    db.prepare("UPDATE doc_backup_jobs SET last_success_at='2026-07-28 02:30:00' WHERE id=?")
      .run(lineageJob.id);
    result = await request(`/backup-jobs/${lineageJob.id}`, { method: 'DELETE' });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.code, 'BACKUP_LINEAGE_MUST_BE_RETAINED');
    result = await request(`/backup-jobs/${lineageJob.id}`, json('PATCH', { enabled: false }));
    assert.equal(result.response.status, 200);
    result = await request('/backup-jobs', json('POST', {
      label: 'Unzulässige zweite Linie',
      interval: 'taeglich',
      timeHhmm: '03:30',
      quelle: { bereich: 'alles', caseId: '' },
      ziel: { art: 'gesamt', ordner: lineageTarget },
      options: {
        ...protectedOptions,
        backupTargetId: lineageTargetId,
        offsite: { enabled: false }
      }
    }));
    assert.equal(result.response.status, 409);

    const damagedTarget = path.join(temp, 'backup-ziel-beschaedigt');
    fs.mkdirSync(damagedTarget);
    fs.writeFileSync(path.join(damagedTarget, '.betreuungsbuero-backup-ziel'), 'kaputt\n');
    result = await request('/backup-target/initialize', json('POST', {
      ordner: damagedTarget,
      confirm: true
    }));
    assert.equal(result.response.status, 409);
    assert.equal(
      fs.readFileSync(path.join(damagedTarget, '.betreuungsbuero-backup-ziel'), 'utf8'),
      'kaputt\n',
      'eine ungültige vorhandene Zielmarke darf niemals überschrieben werden'
    );

    db.prepare(`
      INSERT INTO users
        (id,username,password_hash,display_name,active,allow_local,allow_online,is_admin)
      VALUES (4,'stale-backup-admin','x','Stale Backup Admin',1,1,1,1)
    `).run();
    sessionUserId = 4;
    result = await request('/backup-health');
    assert.equal(result.response.status, 200);
    assert.match(String(result.response.headers.get('cache-control') || ''), /no-store/i);
    result = await request('/backup-jobs');
    assert.equal(result.response.status, 200);
    assert.match(String(result.response.headers.get('cache-control') || ''), /no-store/i);

    const staleAdminRequests = async (label) => {
      const attempts = [
        ['/backup-jobs', undefined],
        ['/backup-jobs', json('POST', {
          label: `Unzulässig ${label}`,
          interval: 'taeglich',
          timeHhmm: '02:30',
          quelle: { bereich: 'alles' },
          ziel: { art: 'gesamt', ordner: backupTarget },
          options: {}
        })],
        ['/backup-target/initialize', json('POST', {
          ordner: backupTarget,
          confirm: true
        })],
        [`/backup-jobs/${lineageJob.id}/download-latest`, undefined],
        ['/list?area=management', undefined],
        ['/files/stale-management-file?download=1', undefined],
        ['/materializations/status', undefined],
        ['/materializations/run', json('POST', {})],
        ['/maintenance-plans', undefined],
        ['/maintenance-plans/finder-nightly', json('PUT', { enabled: false })]
      ];
      for (const [route, options] of attempts) {
        const denied = await request(route, options);
        assert.equal(denied.response.status, 403, `${label}: ${route}`);
        assert.match(
          String(denied.response.headers.get('cache-control') || ''),
          /no-store/i,
          `${label}: ${route} muss auch bei Ablehnung uncachebar sein`
        );
      }
    };

    const managementRelative = path.join(
      'Büroorganisation',
      '_Verwaltung & Sicherungen',
      'Sicherheit.json.enc'
    );
    const managementAbsolute = path.join(storageRoot, managementRelative);
    fs.mkdirSync(path.dirname(managementAbsolute), { recursive: true });
    fs.writeFileSync(managementAbsolute, 'DARF-NACH-ENTZUG-NICHT-GELESEN-WERDEN\n');
    db.prepare(`
      INSERT INTO doc_files
        (id,area,case_id,folder_id,name,name_key,mime_type,size,sha256,
         storage_relpath,visibility,created_by)
      VALUES
        ('stale-management-file','management','','','Sicherheit.json.enc',
         'sicherheit.json.enc','application/octet-stream',?,?,'${managementRelative.replace(/'/g, "''")}',
         'admin',1)
    `).run(
      fs.statSync(managementAbsolute).size,
      crypto.createHash('sha256').update(fs.readFileSync(managementAbsolute)).digest('hex')
    );
    result = await request('/list?area=management');
    assert.equal(result.response.status, 200);
    assert.ok(result.body.files.some((file) => file.id === 'stale-management-file'));
    result = await request('/files/stale-management-file?download=1');
    assert.equal(result.response.status, 200);
    assert.equal(
      result.body,
      'DARF-NACH-ENTZUG-NICHT-GELESEN-WERDEN\n'
    );

    db.prepare('UPDATE users SET is_admin=0 WHERE id=4').run();
    await staleAdminRequests('Adminrecht entzogen');
    db.prepare('UPDATE users SET is_admin=1,active=0 WHERE id=4').run();
    await staleAdminRequests('Nutzer deaktiviert');
    db.prepare('UPDATE users SET active=1,allow_online=0 WHERE id=4').run();
    await staleAdminRequests('Onlinezugriff entzogen');
    db.prepare('DELETE FROM users WHERE id=4').run();
    await staleAdminRequests('Nutzer gelöscht');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + suffix); } catch (_error) { /* bereits entfernt */ }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main()
  .then(() => console.log('documents-route-scope: Fallrechte und Registerinvariante ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
