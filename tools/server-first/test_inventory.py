"""Evidence scanner checks on synthetic tracked files, without loading the application."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from inventory import APP, inventory


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='server-first-inventory-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.write('docs/architektur/server-first-2026-09/arbeitspakete.json',
                   json.dumps({'baseline': {'version': 'synthetic', 'commit': 'fixture'}}))

    def write(self, name, content, tracked=True):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)
        if tracked:
            subprocess.run(['git', 'add', '--', name], cwd=self.root, check=True)

    def test_embedded_data_and_runtime_are_not_source_signals(self):
        self.write(APP, '<script type="application/json">{"v":"UPDATE secrets SET x=1"}</script>\n'
                   '<script id="pilot">\nfetch(`/api/cases/${id}/stammdaten`);\n</script>')
        self.write('runtime/private.js', "localStorage.setItem('sensitive', 'never-output');")
        self.write('server/src/untracked.js', 'throw Error("must not execute")', tracked=False)
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        data = inventory(self.root)
        after = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.assertEqual(data['counts']['sources'], 1)
        scripts = data['sources'][0]['scripts']
        self.assertNotIn('signals', scripts[0])
        self.assertEqual(scripts[1]['signals']['apiReferences'][0]['line'], 3)
        self.assertEqual(scripts[1]['signals']['apiReferences'][0]['path'], '/api/cases/${id}/stammdaten')
        self.assertNotIn('never-output', json.dumps(data))

    def test_deterministic_hashes_and_nonexecuting_inventory(self):
        self.write('server/src/pilot.js', 'throw Error("must not execute");\n'
                   'router.patch("/:id", handler);\ndb.prepare("UPDATE cases SET x=?");')
        self.write('server/tests/pilot.test.cjs', 'throw Error("must not execute either");')
        first = inventory(self.root)
        self.assertEqual(first, inventory(self.root))
        hit = first['sources'][0]['signals']['sqlWriteCandidates'][0]
        self.assertEqual((hit['table'], hit['line']), ('cases', 3))
        self.assertEqual(first['counts']['testFiles'], 1)
        self.write('server/src/pilot.js', '// changed source')
        self.assertNotEqual(first['sources'][0]['sha256'], inventory(self.root)['sources'][0]['sha256'])

    def test_symlinks_require_review_instead_of_following_into_runtime(self):
        self.write('runtime/private.js', 'sensitive', tracked=False)
        link = self.root / 'server/src/link.js'
        link.parent.mkdir(parents=True)
        link.symlink_to('../../runtime/private.js')
        subprocess.run(['git', 'add', 'server/src/link.js'], cwd=self.root, check=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            inventory(self.root)

    def test_frontend_cli_and_shell_sources_are_included_without_running_them(self):
        self.write('server/frontend/view.js', "throw Error('must not run'); fetch('/api/cases');")
        self.write('server/tools/restore.sh', '#!/bin/sh\nexit 99\n# UPDATE cases SET x=1\n')
        self.write('server/tools/admin/create-admin.js', 'throw Error("must not run");')
        self.write('server/tools/tests/test-restore.sh', '#!/bin/sh\nexit 99\n')
        self.write('server/tools/.env', 'secret=never-output')
        data = inventory(self.root)
        self.assertEqual([entry['path'] for entry in data['sources']],
                         ['server/frontend/view.js', 'server/tools/admin/create-admin.js', 'server/tools/restore.sh'])
        self.assertEqual(data['counts']['testFiles'], 1)
        self.assertEqual(data['sources'][0]['signals']['apiReferences'][0]['path'], '/api/cases')
        self.assertEqual(data['sources'][2]['signals']['sqlWriteCandidates'][0]['line'], 3)
        self.assertNotIn('never-output', json.dumps(data))

    def test_explicit_draft_inputs_match_the_same_files_after_git_add(self):
        name = 'server/tests/pilot.test.cjs'
        self.write(name, 'throw Error("never execute")', tracked=False)
        self.write('tools/server-first/inventory-inputs.json', json.dumps({'additionalPaths': [name]}), tracked=False)
        draft = inventory(self.root)
        subprocess.run(['git', 'add', name], cwd=self.root, check=True)
        self.assertEqual(draft, inventory(self.root))
        self.assertEqual(draft['counts']['testFiles'], 1)

    def test_explicit_draft_module_is_scanned_before_staging(self):
        name = 'server/src/modules/office/pilot.js'
        self.write(name, 'throw Error("never execute"); db.prepare("UPDATE office_json SET data_json=?");', tracked=False)
        self.write('tools/server-first/inventory-inputs.json', json.dumps({'additionalPaths': [name]}), tracked=False)
        draft = inventory(self.root)
        self.assertEqual(draft['counts']['sources'], 1)
        self.assertEqual(draft['sources'][0]['signals']['sqlWriteCandidates'][0]['table'], 'office_json')
        subprocess.run(['git', 'add', name], cwd=self.root, check=True)
        self.assertEqual(draft, inventory(self.root))

    def test_draft_input_rejects_secrets_missing_files_and_symlink_parents(self):
        config = 'tools/server-first/inventory-inputs.json'
        for name in ['runtime/private.json', '../server/tests/private.json', 'server/tests/missing.cjs',
                     'server/src/.env', 'server/src/private.json', 'server/src/node_modules/private.js',
                     'server/src/dist/generated.js']:
            self.write(config, json.dumps({'additionalPaths': [name]}), tracked=False)
            with self.subTest(name=name), self.assertRaises(ValueError):
                inventory(self.root)
        self.write('runtime/private.json', 'synthetic-secret', tracked=False)
        link = self.root / 'server/tests/linked'
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(self.root / 'runtime', target_is_directory=True)
        self.write(config, json.dumps({'additionalPaths': ['server/tests/linked/private.json']}), tracked=False)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            inventory(self.root)


if __name__ == '__main__':
    unittest.main()
