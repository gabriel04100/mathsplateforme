# Maths Collège — Gabriel Pizzo
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY public ./public
COPY content ./content
# La base de données vit dans un volume pour survivre aux mises à jour.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
