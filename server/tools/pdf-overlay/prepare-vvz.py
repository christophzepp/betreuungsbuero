"""Normalize the user-supplied, empty-password encrypted VVZ without changing artwork.
Usage: python prepare-vvz.py INPUT.pdf OUTPUT.pdf
The source stays untouched. The application rebuilds the malformed widgets at export.
"""
import sys
from pypdf import PdfReader, PdfWriter

reader = PdfReader(sys.argv[1])
if reader.is_encrypted and not reader.decrypt(""):
    raise ValueError("Die Vorlage benötigt ein Passwort.")
if len(reader.pages) != 6:
    raise ValueError("Es werden sechs Seiten der VVZ-Vorlage erwartet.")
writer = PdfWriter()
writer.clone_document_from_reader(reader)
writer.write(sys.argv[2])
