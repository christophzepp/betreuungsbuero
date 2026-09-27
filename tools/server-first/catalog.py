#!/usr/bin/env python3
"""Seed AP-00 traceability from the agreed plan, without claiming functional acceptance."""
from bisect import bisect_left
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / 'docs/architektur/server-first-2026-09'
OUTPUT = PLAN / 'umsetzung'


def packages(text):
    expanded = re.sub(r'AP-(\d+) bis AP-(\d+)',
                      lambda m: ', '.join(f'AP-{n:02}' for n in range(int(m[1]), int(m[2]) + 1)), text)
    return sorted(set(re.findall(r'AP-\d{2}', expanded)))


def build():
    historical = json.loads((ROOT / 'docs/analysen/mobile-umsetzungsstand-2026-09-08.json').read_text())
    acceptance = (PLAN / '05-abnahme-betrieb-migration.md').read_text()
    requirements = json.loads((PLAN / 'anforderungsabgleich.json').read_text())
    html = (ROOT / 'outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html').read_text()
    newlines = [m.start() for m in re.finditer('\n', html)]
    rows = re.findall(r'^\| (\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$', acceptance, re.M)
    if [int(row[0]) for row in rows] != list(range(1, 33)) or len(historical['modules']) != 32:
        raise ValueError('The 32-module contract changed; manually review the catalog mapping.')
    modules = []
    for row, old in zip(rows, historical['modules']):
        symbol = old['opener']
        matches = list(re.finditer(r'\b' + re.escape(symbol) + r'\b', html))
        modules.append({
            'id': 'SF-M' + row[0].zfill(2), 'legacyId': old['id'], 'name': row[1].strip(),
            'inventoryTicket': 'AP-00-M' + row[0].zfill(2), 'targetPackages': packages(row[2]),
            'requiredReferenceFlow': row[3].strip(),
            'entryPoint': {'historicalSymbol': symbol, 'occurrences': len(matches),
                           'source': 'outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html',
                           'firstCandidateLines': [bisect_left(newlines, m.start()) + 1 for m in matches[:5]]},
            'status': 'initial_inventory', 'fieldInventoryComplete': False,
            'writeChannelsComplete': False, 'technicalReviewer': None, 'businessReviewer': None,
            'evidence': [],
        })
    links = []
    for req in requirements['developerFeedback'] + requirements['userRequirements']:
        links.append({'id': req['id'], 'inventoryTicket': 'AP-00-' + req['id'],
                      'requirement': req['original'], 'targetPackages': req['packages'],
                      'decisionIds': req['decisions'], 'planStatus': req['status'],
                      'productAcceptance': 'not_proven', 'reviewer': None, 'evidence': []})
    cross = acceptance.split('Zusätzlich verpflichtend:', 1)[1].split('## 2.', 1)[0]
    cross_sections = [{'id': f'SF-X{i:02}', 'name': name.strip(), 'requiredReferenceFlow': flow.strip(),
                       'inventoryTicket': f'AP-00-X{i:02}', 'status': 'initial_inventory',
                       'reviewer': None, 'evidence': []}
                      for i, (name, flow) in enumerate(re.findall(r'^\| ([^|]+) \| ([^|]+) \|$', cross, re.M)[1:], 1)]
    return {'schemaVersion': 1, 'baselineVersion': requirements['baselineVersion'],
            'status': 'initial_inventory_not_gate_G0',
            'limits': ['Module names and minimum reference flows originate in the agreed acceptance matrix.',
                       'Entry-point occurrences are search candidates, not proven UI or write paths.',
                       'Detailed fields, rights, side effects, all write channels and named reviewers remain to be completed.',
                       'Evidence is recorded separately in pilot-speicherwege.md and pruefungen/README.md.'],
            'modules': modules, 'crossSections': cross_sections, 'requirements': links}


def main():
    data = build()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT / 'funktionskatalog.json'
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    lines = ['# AP-00 – Funktions- und Anforderungsregister', '',
             'Generierter Einstieg aus dem Bauplan; keine abgeschlossene Feldinventur oder Funktionsabnahme.', '',
             '32 Hauptbereiche, zusätzliche Querschnitte und alle 55 Anforderungen erhalten stabile Inventurtickets.',
             'Prüfer sind noch nicht namentlich besetzt. Suchfundstellen stehen in `funktionskatalog.json`.', '',
             '| Ticket | Bereich | Zielpakete | Erforderlicher Referenzablauf |',
             '|---|---|---|---|']
    for item in data['modules']:
        lines.append(f"| {item['inventoryTicket']} | {item['name']} | {', '.join(item['targetPackages'])} | {item['requiredReferenceFlow']} |")
    lines += ['', '## Querschnitte', '', '| Ticket | Bereich | Referenz |', '|---|---|---|']
    for item in data['crossSections']:
        lines.append(f"| {item['inventoryTicket']} | {item['name']} | {item['requiredReferenceFlow']} |")
    lines += ['', '## Anforderungen', '', '| Ticket | Anforderung | Zielpakete | Entscheidungen |', '|---|---|---|---|']
    for item in data['requirements']:
        lines.append(f"| {item['inventoryTicket']} | {item['requirement']} | {', '.join(item['targetPackages'])} | {', '.join(item['decisionIds']) or '–'} |")
    (OUTPUT / 'funktionskatalog.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({'modules': len(data['modules']), 'crossSections': len(data['crossSections']),
                      'requirements': len(data['requirements'])}))


if __name__ == '__main__':
    main()
