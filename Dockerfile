# CATÁLOGO VIRTUAL — imagem de produção
FROM node:22-slim
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js db.js db-sqlite.js db-pg.js storage.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
VOLUME /data

EXPOSE 3000
CMD ["node", "server.js"]