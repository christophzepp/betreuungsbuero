# Debian-basiertes Node-Image, für einen reproduzierbaren Wiederaufbau auf
# Version und Multiarch-Index festgepinnt. Aktualisierungen erfolgen bewusst
# als geprüfte Softwareänderung und nicht still beim nächsten Docker-Build.
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

WORKDIR /app/server

# SQLite ".backup" ist Bestandteil jeder Gesamtsicherung. Restic stellt die
# optionale, clientseitig authentifiziert verschlüsselte Offsite-Zweitkopie
# bereit; ca-certificates wird für TLS-Remoteziele benötigt. openssh-client
# und rclone sind die von den ausdrücklich unterstützten Restic-Backends
# `sftp:` beziehungsweise `rclone:` aufgerufenen Transportprogramme. procps
# liefert `ps`, mit dem das Sicherungsskript verwaiste Sperren unterscheidet.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       bash sqlite3 restic ca-certificates openssh-client rclone procps \
       coreutils findutils tar gzip grep sed gawk \
    && rm -rf /var/lib/apt/lists/*

# Erst nur die Manifeste kopieren, damit Docker den reproduzierbaren npm-ci-Layer
# cachen kann. package-lock.json ist Pflicht; ein stilles Neuberechnen der
# Abhängigkeiten wäre für einen späteren Wiederaufbau ungeeignet.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Die HTML-App liegt eine Ebene hoeher (outputs/), wird zur Laufzeit per Volume/Copy
# bereitgestellt - siehe docker-compose.yml.
RUN mkdir -p /app/outputs /app/state/data /app/state/database \
    /app/state/extension-artifacts /app/backups /app/runtime-secrets \
    /app/server/_restore-rollback

ENV NODE_ENV=production
ENV OUTPUTS_DIR=/app/outputs
ENV RUNTIME_ROOT=/app/state
ENV DATA_DIR=/app/state/data
ENV DOCUMENTS_DATA_ROOT=/app/state/data
ENV DB_PATH=/app/state/database/betreuungsbuero.sqlite3
ENV EXTENSION_ARTIFACTS_DIR=/app/state/extension-artifacts
ENV RUNTIME_SECRETS_DIR=/app/runtime-secrets
ENV TOTAL_BACKUP_DESTINATION=/app/backups

EXPOSE 8935

CMD ["node", "index.js"]
