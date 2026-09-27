"""Fail-closed evidence parsing and credential isolation for local/CI test runs."""
import os
import unittest
from unittest.mock import patch

from run_baseline import clean_environment, missing_write_detected, tap_totals, platform_selection, GOLDEN_TESTS


def report(tests=6, passed=6, failed=0, cancelled=0, skipped=0, todo=0):
    return (f'# tests {tests}\n# pass {passed}\n# fail {failed}\n'
            f'# cancelled {cancelled}\n# skipped {skipped}\n# todo {todo}\n')


class BaselineRunnerTests(unittest.TestCase):
    def test_platform_partitions_cover_every_file_once_and_reject_missing_golden_tests(self):
        files = ['tests/domain.test.cjs', *GOLDEN_TESTS]
        portable = platform_selection(files, portable=True)
        golden = platform_selection(files, golden_only=True)
        self.assertEqual(portable, ['tests/domain.test.cjs'])
        self.assertEqual(golden, GOLDEN_TESTS)
        self.assertEqual(sorted(portable + golden), sorted(files))
        with self.assertRaises(ValueError):
            platform_selection(files, portable=True, golden_only=True)
        with self.assertRaises(ValueError):
            platform_selection(files[:-1], portable=True)

    def test_accepts_complete_success_and_explicit_fault_counts(self):
        self.assertEqual(tap_totals(report())['pass'], 6)
        self.assertEqual(tap_totals(report(passed=3, failed=3))['fail'], 3)

    def test_truncated_conflicting_and_empty_reports_cannot_pass(self):
        invalid = [report().replace('# todo 0\n', ''), report() + '# tests 6\n',
                   report(tests=0, passed=0), report(passed=5), 'TAP version 13\n',
                   report().replace('# fail 0', '# fail -1')]
        for content in invalid:
            with self.subTest(content=content), self.assertRaises(ValueError):
                tap_totals(content)

    def test_nested_diagnostics_cannot_replace_top_level_totals(self):
        self.assertEqual(tap_totals('    # pass 999\n' + report())['pass'], 6)
        with self.assertRaises(ValueError):
            tap_totals('    ' + report().replace('\n', '\n    '))

    def test_fault_probe_requires_the_expected_data_failure(self):
        content = 'not ok 1 - Gesundheit und Lebensunterhalt: Datenvergleich\nSynthetische bestätigte Änderung\n'
        totals = tap_totals(report(passed=3, failed=3))
        self.assertTrue(missing_write_detected(1, totals, content))
        self.assertFalse(missing_write_detected(0, totals, content))
        self.assertFalse(missing_write_detected(1, totals, 'not ok 1 - unrelated failure'))
        self.assertFalse(missing_write_detected(1, {}, content))
        for key in ('cancelled', 'skipped', 'todo'):
            with self.subTest(key=key):
                self.assertFalse(missing_write_detected(1, {**totals, key: 1, 'pass': 2}, content))

    def test_only_runtime_basics_reach_child_processes(self):
        env = {'PATH': '/test/bin', 'HOME': '/test/home', 'LANG': 'C',
               'DB_PATH': '/production/db', 'DOCUMENTS_DATA_ROOT': '/production/files',
               'ENCRYPTION_KEY': 'synthetic-secret', 'SESSION_SECRET': 'synthetic-session',
               'NODE_OPTIONS': '--require unwanted.cjs', 'NPM_TOKEN': 'synthetic-token',
               'NPM_CONFIG_USERCONFIG': '/personal/npmrc', 'GITHUB_TOKEN': 'synthetic-ci-token'}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(clean_environment(), {key: env[key] for key in ('PATH', 'HOME', 'LANG')})


if __name__ == '__main__':
    unittest.main()
