# PAS Platform — container images for AWS ECS (Fargate).
#   docker build --target api  -t pas-api  .
#   docker build --target web  -t pas-web  .
#   docker build --target site -t pas-site .
# Build context = repo root (npm workspaces). See infra/DEPLOY-AWS.md.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- dependencies (shared) ----------
FROM ${NODE_IMAGE} AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma/schema.prisma packages/db/prisma/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run generate --workspace @pas/db

# ---------- builds ----------
FROM deps AS build-api
RUN npm run build --workspace @pas/api

FROM deps AS build-web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @pas/web

FROM deps AS build-site
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @pas/site

# ---------- runtime base ----------
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Bangkok
ENTRYPOINT ["/usr/bin/tini", "--"]

# ---------- API (NestJS) ----------
# Applies pending Prisma migrations, then starts the API. Listens on 127.0.0.1:4000 inside the ECS task;
# only the web container (same task) talks to it.
FROM runtime AS api
COPY --from=build-api --chown=node:node /app /app
USER node
EXPOSE 4000
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma && exec node apps/api/dist/main.js"]

# ---------- Portal (Next.js) ----------
FROM runtime AS web
COPY --from=build-web --chown=node:node /app /app
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]

# ---------- Public website (Next.js) ----------
FROM runtime AS site
COPY --from=build-site --chown=node:node /app /app
USER node
WORKDIR /app/apps/site
EXPOSE 3001
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "-p", "3001", "-H", "0.0.0.0"]
