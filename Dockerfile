# syntax=docker/dockerfile:1

# Native Abhängigkeiten wie better-sqlite3 werden in einer eigenen Baustufe
# für die jeweilige Zielarchitektur kompiliert. Node 22 entspricht der bereits
# im Projekt eingesetzten Container-Laufzeit und wird von better-sqlite3 11.x
# unterstützt.
FROM node:22-bookworm-slim AS dependencies

WORKDIR /app/server

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Betreuungsbüro"
LABEL org.opencontainers.image.description="Server und Web-App für rechtliche Betreuungen"
LABEL org.opencontainers.image.source="https://github.com/derzerpoo/betreuungsbuero"

WORKDIR /app/server

# Werkzeuge für SQLite-Sicherungen und die optional verschlüsselte
# Restic-Zweitkopie. Die Paketlisten werden nicht im fertigen Image behalten.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       bash sqlite3 restic ca-certificates openssh-client rclone procps \
       coreutils findutils tar gzip grep sed gawk \
    && rm -rf /var/lib/apt/lists/*

# Nur die fertigen Produktionsabhängigkeiten werden in das Laufzeit-Image
# übernommen; Python und Compiler bleiben in der Baustufe zurück.
COPY --from=dependencies /app/server/node_modules ./node_modules

# Das Registry-Image enthält alles, was zum Start erforderlich ist. Der
# Zielserver braucht daher weder den Quellcode noch einen outputs-Ordner.
COPY server/ ./
COPY outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html /app/outputs/Betreuungsbuero_Dokumentenassistent_v0_7.html
COPY Super-Productivity-Plugin/ /app/sp-plugin/

RUN mkdir -p \
      /app/state/data \
      /app/state/database \
      /app/state/extension-artifacts \
      /app/backups \
      /app/runtime-secrets \
      /app/server/_restore-rollback \
    && chown -R node:node \
      /app/server \
      /app/outputs \
      /app/sp-plugin \
      /app/state \
      /app/backups \
      /app/runtime-secrets

ENV NODE_ENV=production \
    PORT=8935 \
    OUTPUTS_DIR=/app/outputs \
    APP_FILE=Betreuungsbuero_Dokumentenassistent_v0_7.html \
    SP_PLUGIN_DIR=/app/sp-plugin \
    RUNTIME_ROOT=/app/state \
    DATA_DIR=/app/state/data \
    DOCUMENTS_DATA_ROOT=/app/state/data \
    DB_PATH=/app/state/database/betreuungsbuero.sqlite3 \
    EXTENSION_ARTIFACTS_DIR=/app/state/extension-artifacts \
    RUNTIME_SECRETS_DIR=/app/runtime-secrets \
    DOCUMENT_RECOVERY_KEY_FILE=/app/runtime-secrets/document-recovery-key \
    TOTAL_BACKUP_DESTINATION=/app/backups \
    RUNTIME_ARTIFACT_RESTORE_STATE_DIR=/app/server/_restore-rollback

USER node

EXPOSE 8935

# Der Endpunkt liefert nur den Einrichtungsstatus und lädt nicht die große
# HTML-App. Dadurch bleibt die regelmäßige Prüfung sehr leichtgewichtig.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8935/api/setup/state',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "index.js"]
