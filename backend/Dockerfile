FROM node:22-alpine

WORKDIR /app
COPY --chown=node:node package.json package-lock.json /app/
RUN npm ci --omit=dev
COPY --chown=node:node server.mjs /app/server.mjs
COPY --chown=node:node auth /app/auth
COPY --chown=node:node cosmetics /app/cosmetics
COPY --chown=node:node sharing /app/sharing
COPY --chown=node:node social /app/social
USER node
EXPOSE 8110

HEALTHCHECK --interval=20s --timeout=4s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8110/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "/app/server.mjs"]
