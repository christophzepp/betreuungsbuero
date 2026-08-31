# -*- coding: utf-8 -*-
"""Messblatt fuer gescannte Vordrucke ohne Textebene.

Findet auf jeder Seite die waagerechten Ausfuelllinien und die Ankreuzkaestchen und rechnet die
Pixelpositionen in PDF-Punkte um (Ursprung unten links, wie OFFICIAL_COORDINATE_MAPS es erwartet).
Grundlage der Koordinatenkarten fuer die beiden Stassmann-Vordrucke.

Aufruf: python3 scan-vermessen.py <ordner-mit-tif> <praefix> <pdf-breite> <pdf-hoehe>
"""
import sys
import glob
import re
import numpy as np
from PIL import Image

ordner, praefix, pdf_breite, pdf_hoehe = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])

dateien = sorted(glob.glob('%s/%s_s*.tif' % (ordner, praefix)),
                 key=lambda p: int(re.search(r'_s(\d+)', p).group(1)))
if not dateien:
    raise SystemExit('Keine Seitenbilder zu %s gefunden.' % praefix)

for pfad in dateien:
    seite = int(re.search(r'_s(\d+)', pfad).group(1))
    bild = Image.open(pfad).convert('L')
    a = np.array(bild)
    hoehe_px, breite_px = a.shape
    sx, sy = pdf_breite / breite_px, pdf_hoehe / hoehe_px
    dunkel = a < 128

    print('\n--- Seite %d (Index %d)  %dx%d px  ->  %gx%g pt' % (seite, seite - 1, breite_px, hoehe_px, pdf_breite, pdf_hoehe))

    # 1) Ausfuelllinien: Zeilen mit langen ununterbrochenen Dunkelstrecken.
    mindest = int(breite_px * 0.04)          # ab ca. 4 % Seitenbreite gilt es als Linie
    gefunden = []
    for y in range(hoehe_px):
        zeile = dunkel[y]
        if zeile.sum() < mindest:
            continue
        # zusammenhaengende Strecken bestimmen
        rand = np.flatnonzero(np.diff(np.concatenate(([0], zeile.view(np.int8), [0]))))
        for start, ende in zip(rand[0::2], rand[1::2]):
            if ende - start >= mindest:
                gefunden.append((y, start, ende))

    # senkrecht benachbarte Treffer derselben Linie zusammenfassen
    linien = []
    for y, x0, x1 in gefunden:
        passend = None
        for l in linien:
            if abs(l['y'] - y) <= 4 and not (x1 < l['x0'] - 12 or x0 > l['x1'] + 12):
                passend = l
                break
        if passend:
            passend['y'] = max(passend['y'], y)
            passend['x0'] = min(passend['x0'], x0)
            passend['x1'] = max(passend['x1'], x1)
        else:
            linien.append({'y': y, 'x0': x0, 'x1': x1})

    # 2) Kaestchen: kleine Quadrate mit dunklem Rahmen und hellem Inneren.
    kaestchen = []
    kante_min, kante_max = int(breite_px * 0.008), int(breite_px * 0.020)
    y = 0
    while y < hoehe_px:
        zeile = dunkel[y]
        if not zeile.any():
            y += 1
            continue
        rand = np.flatnonzero(np.diff(np.concatenate(([0], zeile.view(np.int8), [0]))))
        for start, ende in zip(rand[0::2], rand[1::2]):
            b = ende - start
            if not (kante_min <= b <= kante_max):
                continue
            unten = y + b
            if unten + 2 >= hoehe_px:
                continue
            # untere Kante, beide Seitenkanten, und ein weitgehend leeres Inneres
            if dunkel[unten, start:ende].sum() < b * 0.75:
                continue
            if dunkel[y:unten, start].sum() < b * 0.7 or dunkel[y:unten, ende - 1].sum() < b * 0.7:
                continue
            inneres = dunkel[y + 2:unten - 1, start + 2:ende - 2]
            if inneres.size and inneres.mean() > 0.18:
                continue
            if not any(abs(k[0] - y) < b and abs(k[1] - start) < b for k in kaestchen):
                kaestchen.append((y, start, ende, unten))
        y += 1
    zusammen = kaestchen

    for l in sorted(linien, key=lambda d: d['y']):
        print('LINIE   y=%7.1f  x=%6.1f .. %6.1f   breite=%6.1f' % (
            pdf_hoehe - l['y'] * sy, l['x0'] * sx, l['x1'] * sx, (l['x1'] - l['x0']) * sx))
    for y, x0, x1, u in sorted(zusammen, key=lambda k: k[0]):
        print('KREUZ   y=%7.1f  x=%6.1f   kante=%4.1f' % (pdf_hoehe - u * sy, x0 * sx, (x1 - x0) * sx))
