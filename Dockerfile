# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS build
# better-sqlite3 can compile when a platform has no prebuilt binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runtime
ARG CLAUDE_CODE_VERSION=2.1.303
ARG CODEX_VERSION=0.162.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION} \
    && npm cache clean --force \
    && mkdir -p /app/data/codex-home /app/data/claude-home \
    && chown -R node:node /app/data
ENV NODE_ENV=production \
    DISABLE_AUTOUPDATER=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    HOME=/home/node \
    SDDMAKER_DATA_DIR=/app/data \
    CLAUDE_CONFIG_DIR=/app/data/claude-home \
    CODEX_HOME=/app/data/codex-home
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Prompts and zip exports read this file at runtime.
COPY --from=build --chown=node:node /app/docs/AGENTS.md ./docs/AGENTS.md
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/projects').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
