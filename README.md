# Betreuungsbüro

Software für rechtliche Betreuungen. Dieses Repository enthält den Server,
die Web-App, die kuratierten Vorlagen und die Dateien für eine Installation
über Docker Compose.

Das Repository ist derzeit privat. Laufzeitdaten wie Datenbanken,
Dokumentenspeicher, Exporte, Sitzungen, Zugangsdaten, Recovery-Dateien und
echte `.env`-Dateien gehören ausdrücklich **nicht** in GitHub oder in das
Container-Image.

## Veröffentlichungskanäle

| Kanal | Container-Image | Zweck |
| --- | --- | --- |
| Beta | `ghcr.io/derzerpoo/betreuungsbuero-beta:beta` | Privater Testserver |
| Stable | `ghcr.io/derzerpoo/betreuungsbuero:stable` | Freigegebene Versionen |

Änderungen am Branch `develop` erzeugen automatisch ein neues Beta-Image.
Ein Versions-Tag wie `v0.8.0` erzeugt ein Stable-Image mit den Tags `stable`,
`0.8.0` und `0.8`.

## Installation auf einem Testserver

1. `compose.yaml` und `.env.example` in einen eigenen Stack-Ordner kopieren.
2. `.env.example` in `.env` umbenennen.
3. Für `SESSION_SECRET`, `ENCRYPTION_KEY` und `SETUP_TOKEN` jeweils einen
   eigenen Wert mit `openssl rand -hex 32` erzeugen.
4. Einmalig bei der privaten GitHub Container Registry anmelden.
5. Container herunterladen und starten:

```bash
docker compose pull
docker compose up -d
```

Danach ist die lokale Testinstallation standardmäßig unter
`http://localhost:8935` erreichbar.

## Aktualisierung

```bash
docker compose pull
docker compose up -d
```

`pull_policy: always` sorgt dabei dafür, dass Compose beim Start das aktuelle
Image des gewählten Kanals prüft. Ein bereits laufender Container wird nicht
ohne einen erneuten `docker compose up -d` heimlich ausgetauscht.

## Persistente Daten

Docker verwaltet getrennte Volumes für:

- Datenbank und Dokumentenspeicher,
- Recovery-Schlüssel,
- lokale Sicherungen,
- Wiederherstellungsstatus.

Das Volume `betreuungsbuero-backups` ist auf dem Mac-Testserver nur eine
dauerhafte lokale Kopie. Vor dem produktiven Serverbetrieb wird es durch ein
explizites externes Sicherungsziel ergänzt.

## Ältere Deployment-Dateien

Der Ordner `deploy/stack` beschreibt noch den früheren lokalen Build-Ablauf.
Für neue Installationen ist die Compose-Datei im Repository-Stamm maßgeblich.
