# Maths Collège — Gabriel Pizzo
#
# Construction en deux temps : better-sqlite3 est un module natif. Il existe
# des binaires précompilés, mais ils manquent pour certaines plateformes (ARM,
# Alpine…). On compile donc dans une image qui a les outils, et on ne garde
# dans l'image finale que le résultat — sans compilateur ni fichiers d'en-tête.

FROM node:22-slim AS build
WORKDIR /app
# Outils nécessaires si better-sqlite3 doit être compilé plutôt que téléchargé.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY server ./server
COPY scripts ./scripts
COPY public ./public
COPY content ./content

# La base de données et les documents déposés vivent dans un volume, pour
# survivre aux mises à jour de l'image.
RUN mkdir -p /app/data/documents && chown -R node:node /app/data
VOLUME ["/app/data"]

EXPOSE 3000
USER node

# L'orchestrateur sait ainsi si l'application répond vraiment, et pas
# seulement si le processus existe.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
