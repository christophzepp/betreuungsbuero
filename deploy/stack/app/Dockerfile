# Betreuungsbüro-Dokumentenassistent – Container-Bau (25.08.2026).
# Zweistufig: Stufe 1 baut die nativen Module (better-sqlite3, bcrypt) mit Werkzeugkette,
# Stufe 2 ist das schlanke Laufbild ohne Compiler. Gebaut wird AUF dem Zielserver
# (Dockge: "build"), damit die Architektur automatisch stimmt.
FROM node:22-bookworm-slim AS bau
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=bau /app/server/node_modules /app/server/node_modules
COPY server/ /app/server/
COPY outputs/ /app/outputs/
# Die Laufzeitwurzel ist ein Volume (siehe compose.yaml) - hier nur der Ankerpunkt.
RUN mkdir -p /app/runtime
EXPOSE 8935
# Kein curl/wget im Slim-Bild: der Gesundheitscheck fragt per HEAD an (kein 14-MB-Download).
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8935)+'/',{method:'HEAD'}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
