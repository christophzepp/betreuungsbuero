#!/usr/bin/env bash
# Packt den Dockge-Stack (Blanko-Start) als ein Archiv. Aufruf: bash deploy/stack-packen.sh
set -euo pipefail
HIER=$(cd "$(dirname "$0")/.." && pwd)
STAMP=$(date +%y%m%d-%H%M)
ZIEL="$HIER/deploy/betreuungsbuero-stack-$STAMP.tar.gz"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/app"
cp "$HIER/deploy/stack/compose.yaml" "$HIER/deploy/stack/.env" "$HIER/deploy/stack/README-DEPLOY.md" "$STAGE/"
cp "$HIER/deploy/stack/app/Dockerfile" "$HIER/deploy/stack/app/.dockerignore" "$STAGE/app/"
# Bau-Kontext: Quellcode + App-Datei, OHNE Laufzeitdaten/Geheimnisse/Bauabfall/Kurationsmaterial.
rsync -a \
  --exclude 'node_modules' --exclude '.env' --exclude 'backups' \
  --exclude 'tests' --exclude 'docs' \
  --exclude 'tools/pdf-overlay/vorlagen' --exclude 'tools/pdf-overlay/node_modules' \
  --exclude 'tools/v159-kuratierung/vorlagen-2026-08' \
  --exclude '.DS_Store' \
  "$HIER/server/" "$STAGE/app/server/"
mkdir -p "$STAGE/app/outputs"
cp "$HIER/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html" "$STAGE/app/outputs/"
tar -czf "$ZIEL" -C "$STAGE" .
echo "Gepackt: $ZIEL ($(du -h "$ZIEL" | cut -f1))"
