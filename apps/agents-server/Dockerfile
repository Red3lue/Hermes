# syntax=docker/dockerfile:1.7
#
# Build context = monorepo root (`Hermes/`), NOT this directory.
# From `Hermes/`:
#   docker build -t hermes-agents-server -f apps/agents-server/Dockerfile .
#
# Cloud Run notes:
#  - listens on $PORT (Cloud Run sets it to 8080 by default).
#  - REQUIRES min-instances >= 1 + CPU always-allocated. The agent
#    runtimes are long-running polling loops; if Cloud Run scales to
#    zero or throttles idle CPU, the agents stop polling and miss
#    inbound messages.
#
# ============================================================================
# Stage 1 — build (full pnpm workspace, devDeps available, build SDK + server)
# ============================================================================
FROM node:20-alpine AS builder

# pnpm via corepack — version pinned to match the repo's `packageManager`.
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /repo

# Copy lockfile + workspace declaration + every workspace package.json
# manifest first. This is the cache-friendly layer: as long as no
# manifest or lockfile changes, pnpm install is reused on the next
# build.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/sdk/package.json        ./packages/sdk/
COPY packages/cli/package.json        ./packages/cli/
COPY apps/agents-server/package.json  ./apps/agents-server/
COPY apps/web/package.json            ./apps/web/

# Full install including devDeps — needed to compile the SDK + server.
RUN pnpm install --frozen-lockfile

# Now bring in the source for what we actually build. We deliberately
# skip the web app source (huge, not needed) and contracts (Foundry-only),
# but pull in apps/web/agents/ — those agent.json + persona.md + anima.md
# files are read at runtime by the agents-server.
COPY packages/sdk/         ./packages/sdk/
COPY apps/agents-server/   ./apps/agents-server/
COPY apps/web/agents/      ./apps/web/agents/

# Build SDK first (server depends on its dist/), then the server itself.
RUN pnpm --filter @hermes/sdk build \
 && pnpm --filter @hermes/agents-server build

# `pnpm deploy` produces a flat, production-pruned directory tree with
# every dependency resolved (workspace deps inlined into node_modules).
# The result at /export is a self-contained runtime image source.
RUN pnpm --filter @hermes/agents-server deploy --prod /export

# ============================================================================
# Stage 2 — runtime (slim node, just dist + flat node_modules)
# ============================================================================
FROM node:20-alpine AS runner

# Run as a non-root user.
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder --chown=app:app /export/ ./

# Static agent definitions (persona.md / agent.json / anima.md / animus.md)
# live under apps/web/agents/ in the monorepo. Copy them in and point the
# runtime at them via AGENTS_DIR (the source code honours that env var).
COPY --from=builder --chown=app:app /repo/apps/web/agents /app/agents

# Per-agent keystore directory. Cloud Run's filesystem is ephemeral, but
# keystores are deterministically derived from the deployer wallet sig
# every cold-start, so this is safe — just a writable scratchpad.
RUN mkdir -p /app/.hermes-runtime && chown app:app /app/.hermes-runtime

USER app

ENV NODE_ENV=production
ENV PORT=8080
ENV AGENTS_DIR=/app/agents
ENV HERMES_RUNTIME_DIR=/app/.hermes-runtime
EXPOSE 8080

# `pnpm deploy` puts dist/ at the root of /export.
CMD ["node", "dist/index.js"]
