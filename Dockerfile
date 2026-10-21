# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS build
# node-pty compiles on Linux; better-sqlite3 can also need a native build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts/fix-pty-helper.mjs ./scripts/fix-pty-helper.mjs
RUN npm ci
COPY . .
RUN npm run build
# Fail the image build if standalone tracing misses node-pty's native assets.
RUN cd .next/standalone \
    && node -e "const p=require('node-pty').spawn('/bin/sh',['-c','test -t 0 && test -t 1']); p.onExit(({exitCode})=>process.exit(exitCode)); setTimeout(()=>process.exit(1),5000).unref()"

FROM base AS runtime
ARG CLAUDE_CODE_VERSION=2.1.303
ARG CODEX_VERSION=0.162.1
ARG TARGETARCH
ARG GH_VERSION=2.90.0
ARG GH_SHA256_AMD64=b2aef7b23ec6899bf27f37a32c57a7935d0a178568ac33dc9bb03842f724195a
ARG GH_SHA256_ARM64=1139e1ad912fcddb5ef4b957530184c2c30d9937ff65ff4e641fbf6ca5f28c7c
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/* \
    && case "$TARGETARCH" in amd64) GH_SHA256="$GH_SHA256_AMD64" ;; arm64) GH_SHA256="$GH_SHA256_ARM64" ;; *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; esac \
    && GH_TARBALL="gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" \
    && curl -fsSL -o "/tmp/${GH_TARBALL}" "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${GH_TARBALL}" \
    && echo "${GH_SHA256}  /tmp/${GH_TARBALL}" | sha256sum -c - \
    && tar -xzf "/tmp/${GH_TARBALL}" -C /usr/local/bin --strip-components=2 "gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" \
    && rm -f "/tmp/${GH_TARBALL}" \
    && gh --version \
    && npm install --global @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION} \
    && npm cache clean --force \
    && mkdir -p /app/data/codex-home /app/data/claude-home /app/data/gh-home /app/data/repos /app/data/pr-worktrees \
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
