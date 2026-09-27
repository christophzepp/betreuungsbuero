#!/usr/bin/env python3
"""AP-00: deterministic source evidence; never imports application code or reads runtime data."""
import argparse
from bisect import bisect_left
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / 'docs/architektur/server-first-2026-09'
OUTPUT = PLAN / 'umsetzung/quellinventar.json'
APP = 'outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html'
JS_TYPES = {'', 'text/javascript', 'application/javascript', 'module'}
ATTR = re.compile(r'''([\w:-]+)\s*=\s*(["'])(.*?)\2''', re.S)
ROUTE = re.compile(r'''\b(\w+)\.(get|post|put|patch|delete|all|use)\s*\(\s*(['"`])([^'"`\n]+)\3''')
SQL = re.compile(r'\b(INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-zA-Z_][\w]*)\b', re.I)
TABLE = re.compile(r'\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w]*)', re.I)
API = re.compile(r'''(['"`])(/api/[^'"`\s?#]*)''')
STORAGE = re.compile(r'\b(localStorage|sessionStorage|indexedDB|caches)\s*\.\s*(\w+)')
FILES = re.compile(r'\b(?:fs|fsp|fsPromises)(?:\.promises)?\.(writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|unlinkSync|unlink|rmSync|rm|createWriteStream|copyFileSync|copyFile)\b')
GLOBALS = re.compile(r'\bwindow\.(__[a-zA-Z_][\w]*)')


def locations(pattern, text, names, start_line=1):
    """Lexical candidates, including comments. These are not reachable-call or rights proofs."""
    newlines = [m.start() for m in re.finditer('\n', text)]
    return [dict(zip(names, match.groups()), line=start_line + bisect_left(newlines, match.start()))
            for match in pattern.finditer(text)]


def signals(text, start_line=1):
    return {
        'routeCandidates': locations(ROUTE, text, ['receiver', 'method', 'quote', 'path'], start_line),
        'sqlWriteCandidates': locations(SQL, text, ['operation', 'table'], start_line),
        'tableCandidates': locations(TABLE, text, ['table'], start_line),
        'apiReferences': locations(API, text, ['quote', 'path'], start_line),
        'browserStorageCandidates': locations(STORAGE, text, ['store', 'method'], start_line),
        'fileWriteCandidates': locations(FILES, text, ['method'], start_line),
        'globalReferences': dict(sorted(Counter(GLOBALS.findall(text)).items())),
    }


def allowed_source(name):
    if name == 'server/index.js':
        return True
    prefixes = ('server/src/', 'server/frontend/', 'server/tools/', 'extension/', 'Super-Productivity-Plugin/')
    extension_allowed = name.endswith(('.js', '.cjs', '.mjs', '.ts')) or (name.startswith('server/tools/') and name.endswith('.sh'))
    return (name.startswith(prefixes) and extension_allowed
            and not any(part in {'tests', 'node_modules', 'dist', 'ZIP'} for part in Path(name).parts))


def inventory(root=ROOT):
    tracked = set(filter(None, subprocess.check_output(
        ['git', 'ls-files', '-z'], cwd=root).decode().split('\0')))
    additional = []
    inputs = root / 'tools/server-first/inventory-inputs.json'
    if inputs.is_symlink():
        raise ValueError('Inventory input configuration must not be a symlink.')
    if inputs.exists():
        additional = json.loads(inputs.read_text())['additionalPaths']
        if not isinstance(additional, list) or any(not isinstance(name, str) for name in additional):
            raise ValueError('additionalPaths must be a list of relative source paths.')
        for name in additional:
            parts = Path(name).parts
            if Path(name).is_absolute() or '..' in parts or name != Path(name).as_posix():
                raise ValueError('Unsafe inventory input path: ' + name)
            draft_source = name.startswith('server/src/') and allowed_source(name)
            draft_support = (name.startswith(('server/tests/', 'tools/server-first/', '.github/workflows/'))
                             and name.endswith(('.cjs', '.js', '.py', '.json', '.yml')))
            draft_support = draft_support or name == 'server/tests/fixtures/server-first/reference-report.pdf'
            if not (draft_source or draft_support):
                raise ValueError('Inventory input outside approved source directories: ' + name)
            if any((root / Path(*parts[:index])).is_symlink() for index in range(1, len(parts) + 1)):
                raise ValueError('Inventory input symlink requires review: ' + name)
            if not (root / name).is_file():
                raise ValueError('Missing inventory input: ' + name)
    plan = json.loads((root / 'docs/architektur/server-first-2026-09/arbeitspakete.json').read_text())
    sources, tests, resources, support = [], [], [], []
    for name in sorted(tracked | set(additional)):
        source = allowed_source(name) or name == APP
        test = ((name.startswith(('server/tests/', 'extension/tests/')) and '.test.' in name)
                or (name.startswith('server/tools/tests/') and name.endswith('.sh')))
        resource = name in {'server/package.json', 'server/package-lock.json', 'Dockerfile', 'compose.yaml'} or name.startswith('.github/workflows/')
        test_support = name in additional and not (source or test or resource)
        if not (source or test or resource or test_support):
            continue
        file = root / name
        if file.is_symlink():
            raise ValueError('Tracked source symlink requires explicit review: ' + name)
        raw = file.read_bytes()
        entry = {'path': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        if test:
            tests.append(entry)
        elif resource:
            resources.append(entry)
        elif test_support:
            support.append(entry)
        elif name == APP:
            newlines = [m.start() for m in re.finditer(b'\n', raw)]
            entry['physicalLines'] = len(newlines)
            entry['scripts'] = []
            for index, block in enumerate(re.finditer(rb'<script\b([^>]*)>(.*?)</script\s*>', raw, re.I | re.S), 1):
                attrs = {m[1].lower(): m[3] for m in ATTR.finditer(block[1].decode('utf-8'))}
                kind = attrs.get('type', '').lower()
                body = block[2]
                script = {'index': index, 'id': attrs.get('id', ''), 'type': kind or 'javascript-default',
                          'line': bisect_left(newlines, block.start()) + 1, 'bytes': len(body),
                          'sha256': hashlib.sha256(body).hexdigest(), 'executable': kind in JS_TYPES}
                if script['executable']:
                    script['signals'] = signals(body.decode('utf-8'), bisect_left(newlines, block.start(2)) + 1)
                entry['scripts'].append(script)
            sources.append(entry)
        else:
            entry['signals'] = signals(raw.decode('utf-8'))
            sources.append(entry)
    counts = Counter()
    for entry in sources:
        blocks = [entry] if 'signals' in entry else entry['scripts']
        for block in blocks:
            for key, values in block.get('signals', {}).items():
                counts[key] += len(values)
    return {'schemaVersion': 2, 'reference': plan['baseline'],
            'scope': 'Tracked working-tree sources plus explicitly listed draft inputs; hashes identify actual content.',
            'additionalPaths': sorted(set(additional)),
            'limits': [
                'Static lexical candidates, not AST analysis, call graph, runtime evidence or security audit.',
                'Comments and strings can produce false positives; dynamic SQL, computed routes and adapters require manual tracing.',
                'CLI JavaScript and shell tools are included; shell redirects and subprocess filesystem writes are not resolved by the JavaScript file-write matcher.',
                'Router paths are local declarations, not automatically resolved public URLs.',
                'Only window.__ symbols are indexed; other globals and inline handlers need separate review.',
                'Executable script detection follows HTML type attributes; embedded data scripts are only hashed.',
                'No runtime files, databases, environment files, secrets, live requests or product imports are opened.',
            ],
            'counts': {'sources': len(sources), 'testFiles': len(tests), **dict(sorted(counts.items()))},
            'sources': sources, 'tests': tests, 'buildInputs': resources, 'supportFiles': support}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if the recorded source evidence is stale; write nothing.')
    parser.add_argument('--write', action='store_true', help='Write only the generated source inventory.')
    args = parser.parse_args()
    if args.check and args.write:
        parser.error('Choose --check or --write.')
    data = inventory()
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered:
            raise SystemExit('Source inventory missing/stale. Review source changes, then run --write.')
    elif args.write:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(rendered)
    print(json.dumps({'mode': 'check' if args.check else 'write' if args.write else 'inspect',
                      'counts': data['counts']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
