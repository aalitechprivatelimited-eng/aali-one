# Aali One on its own server (Hostinger VPS + Coolify, decided 8 Oct 2026): one container serves the app and its API on port 3000.
# Coolify: Build Pack = Dockerfile, port 3000, health check /api/health. The settings it needs are listed in VPS-SETUP.md.
# The base image is pinned by its digest (security review 10 Oct 2026): the build uses exactly this Node, not whatever the tag
# points at that day. To update: look up the current node:22-alpine digest on Docker Hub and change both lines.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json vercel.json ./
COPY server ./server
COPY shared ./shared
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server/dev.js"]
