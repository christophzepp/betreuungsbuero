#!/usr/bin/env python3
"""Run the Node suite in a disposable source archive with copied or freshly installed dependencies."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'docs/architektur/server-first-2026-09/umsetzung/pruefungen'
PILOT = ['server/tests/server-first-pilot-persistence.test.cjs',
         'server/tests/fixtures/server-first/reference-cases.cjs',
         'server/tests/fixtures/server-first/reference-report.pdf',
         'server/tests/fixtures/server-first/pilot-case.json']
RESTORE = ['server/tests/server-first-restore-rehearsal.test.cjs',
           'server/tests/server-first-backup-platform.test.cjs',
           'server/tools/gesamt-backup.sh',
           'server/tests/helpers/server-first-app-harness.cjs',
           'server/tests/helpers/server-first-browser.cjs',
           'server/tests/helpers/server-first-recovery-startup.cjs',
           'server/tests/helpers/server-first-app-process.cjs']
COMPATIBILITY = ['server/tests/html-mobile-tasks.test.cjs',
                 'server/tests/handover-endpoint.test.js',
                 'server/tests/handover-package.test.js',
                 'server/tests/planning-regressions.test.cjs',
                 'server/tests/followup-workspace.test.cjs',
                 'server/tests/doc-backup-scheduler.test.js',
                 'server/tests/gesamtexport-online.test.cjs',
                 'server/tests/html-load-bundles-backup-ui.test.cjs',
                 'server/tests/briefkopf.test.cjs',
                 'server/tests/html-buero-json-sicherung.test.cjs',
                 'server/tests/html-lokalmodus-restluecken.test.cjs',
                 'server/tests/html-doku-report-targets.test.cjs',
                 'server/tests/sicherung-vollstaendigkeit.test.cjs']
OFFLINE = ['server/tests/server-first-offline-return.test.cjs',
           'server/tests/helpers/server-first-field-client.cjs',
           'server/tests/helpers/server-first-ledger-regression.cjs',
           'server/tests/helpers/server-first-attachment-scope.cjs',
           'server/tests/helpers/server-first-offline-values.cjs',
           'server/tests/helpers/server-first-offline-lists.cjs',
           'server/tests/helpers/server-first-kontaktmonitor.cjs',
           'server/tests/helpers/server-first-kontaktmonitor-ui.cjs',
           'server/tests/helpers/server-first-kontaktmonitor-local.cjs',
           'server/tests/helpers/server-first-kontaktmonitor-read.cjs',
           'server/tests/helpers/server-first-kontaktmonitor-consumers.cjs',
           'server/tests/helpers/server-first-kontaktmonitor-reports.cjs',
           'server/tests/helpers/server-first-report-sync.cjs',
           'server/tests/helpers/server-first-contact-profile.cjs',
           'server/tests/helpers/server-first-doku-editor.cjs',
           'server/tests/helpers/server-first-doku-attachments.cjs',
           'server/tests/helpers/server-first-doku-quick.cjs',
           'server/tests/helpers/server-first-doku-delete.cjs',
           'server/tests/helpers/server-first-doku-callers.cjs',
           'server/tests/helpers/server-first-doku-navigation.cjs',
           'server/tests/helpers/server-first-inbox-read.cjs',
           'server/tests/helpers/server-first-inbox-change.cjs',
           'server/tests/helpers/server-first-inbox-create.cjs',
           'server/tests/helpers/server-first-doku-retry.cjs',
           'server/tests/helpers/server-first-auto-target.cjs',
           'server/tests/helpers/server-first-auto-store.cjs',
           'server/tests/helpers/server-first-auto-identity.cjs',
           'server/tests/helpers/server-first-auto-mail.cjs',
           'server/tests/helpers/server-first-plan-attachments.cjs',
           'server/tests/helpers/server-first-plan-local.cjs',
           'server/tests/helpers/server-first-plan-online.cjs',
           'server/tests/helpers/server-first-plan-ui.cjs',
           'server/tests/helpers/server-first-plan-records.cjs',
           'server/tests/helpers/server-first-plan-record-local.cjs',
           'server/tests/helpers/server-first-plan-record-online.cjs',
           'server/tests/helpers/server-first-plan-record-followup.cjs',
           'server/tests/helpers/server-first-plan-form-calendar.cjs',
           'server/tests/helpers/server-first-plan-form-todo.cjs',
           'server/tests/helpers/server-first-plan-form-legacy.cjs',
           'server/tests/helpers/server-first-plan-form-refresh.cjs',
           'server/src/modules/office/json-routes.js',
           'server/src/modules/office/kontaktmonitor-store.js',
           'server/src/integrations/mcp/tools.js',
           'server/src/modules/cases/routes.js',
           'outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html']


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


GOLDEN_TESTS = ['tests/html-overlay-golden.test.cjs', 'tests/html-v230-print-golden.test.cjs']


def platform_selection(files, portable=False, golden_only=False):
    if portable and golden_only:
        raise ValueError('Portable and golden-only selections are mutually exclusive.')
    if portable or golden_only:
        if not set(GOLDEN_TESTS).issubset(files):
            raise ValueError('A required macOS golden test is missing from the source archive.')
        return [name for name in files if (name in GOLDEN_TESTS) == golden_only]
    return files


def clean_environment():
    return {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT') if key in os.environ}


def tap_totals(content):
    keys = ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo')
    totals = {}
    for key in keys:
        matches = re.findall(r'^# ' + key + r' (\d+)$', content, re.M)
        if len(matches) != 1:
            raise ValueError('Missing or ambiguous TAP total: ' + key)
        totals[key] = int(matches[0])
    if totals['tests'] <= 0 or totals['tests'] != sum(totals[key] for key in keys[1:]):
        raise ValueError('Empty or inconsistent TAP totals.')
    return totals


def missing_write_detected(returncode, totals, content):
    return bool(returncode != 0 and totals.get('fail', 0)
                and not any(totals.get(key, 1) for key in ('cancelled', 'skipped', 'todo'))
                and 'not ok 1 - Gesundheit und Lebensunterhalt:' in content
                and 'Synthetische bestätigte Änderung' in content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include-pilot', action='store_true', help='Also copy the explicitly listed new AP-01 pilot files.')
    parser.add_argument('--include-restore', action='store_true', help='Include AP-01 and the new AP-02 backup/restore rehearsal in the full suite.')
    parser.add_argument('--restore-only', action='store_true', help='Run only the AP-02 rehearsal, with the same archive isolation.')
    parser.add_argument('--offline-only', action='store_true', help='Run only the AP-01 offline return integration with the same archive isolation.')
    parser.add_argument('--probe-missing-write', action='store_true', help='Drop one write only in the disposable copy; require the pilot test to detect it.')
    parser.add_argument('--evidence-label', help='Optional new evidence filename stem; existing historical runs can be preserved.')
    parser.add_argument('--evidence-dir', type=Path, default=EVIDENCE, help='Directory for test evidence; CI uses a temporary artifact directory.')
    parser.add_argument('--install-dependencies', action='store_true', help='Run npm ci in the disposable archive instead of copying installed dependencies.')
    parser.add_argument('--browser', action='store_true', help='Require real Chromium login, reload and regenerated PDFs before and after restore.')
    parser.add_argument('--browser-path', type=Path, help='Explicit Playwright browser installation directory (no inherited application environment).')
    parser.add_argument('--portable', action='store_true', help='Run all except the two sips golden tests, which CI requires in its separate macOS job.')
    parser.add_argument('--golden-only', action='store_true', help='Run the two unchanged sips golden tests; missing prerequisites still fail strict TAP validation.')
    args = parser.parse_args()
    if sum([args.restore_only, args.offline_only, args.probe_missing_write, args.golden_only]) > 1:
        parser.error('Choose only one focused test mode.')
    if args.portable and (args.restore_only or args.offline_only or args.probe_missing_write or args.golden_only):
        parser.error('--portable is only valid for the full regression selection.')
    if args.golden_only and args.browser:
        parser.error('--golden-only does not execute the browser restore.')
    if args.probe_missing_write and args.include_restore:
        parser.error('The persistence fault probe and restore rehearsal are separate runs.')
    if args.restore_only or args.offline_only or args.golden_only:
        args.include_restore = True
    if args.include_restore:
        args.include_pilot = True
    if args.browser and not args.include_restore:
        parser.error('--browser requires --include-restore or --restore-only.')
    browser_module = ROOT / 'tools/server-first/browser/node_modules/@playwright/test'
    if args.browser and not (browser_module / 'package.json').is_file():
        parser.error('Install locked tools/server-first/browser dependencies before --browser.')
    if args.probe_missing_write:
        args.include_pilot = True
    node = shutil.which('node')
    dependencies = ROOT / 'server/node_modules'
    if not node or (not args.install_dependencies and not dependencies.is_dir()):
        raise SystemExit('Node and locally installed server/node_modules are required. No automatic installation.')
    npm = shutil.which('npm') if args.install_dependencies else None
    if args.install_dependencies and not npm:
        raise SystemExit('npm is required for --install-dependencies.')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    label = 'fehlerprobe-schreibverlust' if args.probe_missing_write else 'baseline-mit-pilot' if args.include_pilot else 'baseline'
    if args.include_restore:
        label = 'restore-probe' if args.restore_only else 'baseline-mit-restore'
    if args.offline_only:
        label = 'offline-rueckgabe'
    if args.evidence_label:
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,79}', args.evidence_label):
            parser.error('Evidence labels must use lowercase letters, digits and hyphens, starting with a letter.')
        label = args.evidence_label
    evidence = args.evidence_dir.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='server-first-suite-') as directory:
        checkout = Path(directory)
        archive = subprocess.Popen(['git', 'archive', revision], cwd=ROOT, stdout=subprocess.PIPE)
        try:
            subprocess.run(['tar', '-x', '-C', directory], stdin=archive.stdout, check=True)
        finally:
            archive.stdout.close()
            archive_code = archive.wait()
        if archive_code:
            raise SystemExit('Source archive failed.')
        # Recovery tools deliberately reject dependencies resolving outside SERVER_ROOT.
        # A real copy also keeps test writes away from the developer dependency tree.
        dependency_source = 'Physical copy of local server/node_modules; no clean-install claim.'
        if args.install_dependencies:
            install_env = clean_environment()
            install_home = checkout / '.install-home'
            install_home.mkdir()
            install_env['HOME'] = str(install_home)
            for config in ['user.npmrc', 'global.npmrc']:
                (install_home / config).touch()
            install_env.update({'NPM_CONFIG_USERCONFIG': str(install_home / 'user.npmrc'),
                                'NPM_CONFIG_GLOBALCONFIG': str(install_home / 'global.npmrc'),
                                'NPM_CONFIG_CACHE': str(install_home / 'cache')})
            print('Installing locked dependencies with npm ci in the disposable checkout.', flush=True)
            install_log = evidence / (label + '-install.log')
            with install_log.open('w') as stream:
                installed = subprocess.run([npm, 'ci', '--no-audit', '--no-fund'],
                    cwd=checkout / 'server', env=install_env, stdout=stream, stderr=subprocess.STDOUT, timeout=600)
            install_log.write_text(install_log.read_text().replace(directory, '<isolated-checkout>')
                                   .replace(str(checkout.resolve()), '<isolated-checkout>'))
            if installed.returncode:
                raise SystemExit('npm ci failed; see ' + str(install_log))
            dependency_source = 'Fresh npm ci from the archived package-lock.json; isolated npm configuration and cache.'
        else:
            shutil.copytree(dependencies, checkout / 'server/node_modules')
        overlay = {}
        if args.include_pilot:
            for name in PILOT + (RESTORE + COMPATIBILITY + OFFLINE if args.include_restore else []):
                target = checkout / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, target)
                overlay[name] = digest(target)
        mutation = None
        if args.probe_missing_write:
            target = checkout / 'server/src/modules/cases/routes.js'
            original = target.read_text()
            statement = 'updateStammdatenStmt.run(JSON.stringify(data), req.session.userId, id);'
            if original.count(statement) != 1:
                raise SystemExit('Write site changed; review the fault probe before proceeding.')
            before = digest(target)
            target.write_text(original.replace(statement, '/* AP-01 fault probe: deliberately omitted database write. */'))
            mutation = {'file': 'server/src/modules/cases/routes.js', 'beforeSha256': before,
                        'afterSha256': digest(target), 'fault': 'Successful HTTP response without the case database write.'}
        files = sorted(p.relative_to(checkout / 'server').as_posix()
                       for p in (checkout / 'server/tests').iterdir()
                       if p.name.endswith(('.test.js', '.test.cjs')))
        files = platform_selection(files, args.portable, args.golden_only)
        if args.probe_missing_write:
            files = ['tests/server-first-pilot-persistence.test.cjs']
        elif args.restore_only:
            files = ['tests/server-first-restore-rehearsal.test.cjs']
        elif args.offline_only:
            files = ['tests/server-first-offline-return.test.cjs']
        command = [node, '--test', '--test-concurrency=2', '--test-reporter=tap', *files]
        # No inherited application paths, provider credentials or Node preload hooks.
        env = clean_environment()
        env['RUNTIME_ROOT'] = str(checkout / 'runtime')
        if args.browser:
            env['SF_BROWSER_MODULE'] = str(browser_module)
            env['SF_BROWSER_EVIDENCE'] = str(evidence / (label + '-browser'))
            if args.browser_path:
                env['PLAYWRIGHT_BROWSERS_PATH'] = str(args.browser_path.resolve())
        log = evidence / (label + '.tap')
        started = time.monotonic()
        print(f'Running {len(files)} test files in a disposable checkout of {revision[:12]}', flush=True)
        with log.open('w') as stream:
            result = subprocess.run(command, cwd=checkout / 'server', env=env, stdout=stream, stderr=subprocess.STDOUT)
        content = log.read_text().replace(directory, '<isolated-checkout>')
        # macOS resolves /var to /private/var in Node stack traces.
        content = content.replace(str(checkout.resolve()), '<isolated-checkout>')
        log.write_text(content)
        totals_error = None
        try:
            totals = tap_totals(content)
        except ValueError as error:
            totals, totals_error = {}, str(error)
        detected = args.probe_missing_write and missing_write_detected(result.returncode, totals, content)
        summary = {'referenceCommit': revision, 'overlay': overlay, 'runnerSha256': digest(Path(__file__)),
                   'node': subprocess.check_output([node, '--version'], text=True).strip(),
                   'platform': os.uname().sysname, 'architecture': os.uname().machine,
                   'lockfileSha256': digest(checkout / 'server/package-lock.json'),
                   'browser': {'required': args.browser,
                               'lockfileSha256': digest(ROOT / 'tools/server-first/browser/package-lock.json') if args.browser else None},
                   'dependencySource': dependency_source, 'totalsError': totals_error,
                   'testFiles': len(files), 'exitCode': result.returncode,
                   'selection': 'macos-golden' if args.golden_only else 'portable-with-separate-macos-golden-job' if args.portable else 'default',
                   'separateMacosFiles': GOLDEN_TESTS if args.portable else [],
                   'durationSeconds': round(time.monotonic() - started, 2), 'totals': totals,
                   'mutation': mutation, 'expectedFaultDetected': detected if mutation else None,
                   'limits': ['Synthetic isolated tests; not a production restore, device test or load test.',
                              'Application environment overrides are not inherited.'],
                   'log': log.name}
        (evidence / (label + '.json')).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(summary, ensure_ascii=False), flush=True)
        if args.probe_missing_write:
            raise SystemExit(0 if detected else 1)
        if not totals or any(totals.get(key, 1) for key in ('fail', 'cancelled', 'skipped', 'todo')):
            raise SystemExit(result.returncode or 1)
        raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
