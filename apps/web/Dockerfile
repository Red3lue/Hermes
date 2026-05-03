# syntax=docker/dockerfile:1.7
#
# Build context = monorepo root (`Hermes/`), NOT this directory.
# From `Hermes/`:
#   docker build \
#     -t hermes-web \
#     -f apps/web/Dockerfile \
#     --build-arg VITE_AGENTS_SERVER_URL=https://your-agents-server.run.app \
#     --build-arg VITE_REOWN_PROJECT_ID=... \
#     --build-arg VITE_INBOX_CONTRACT=0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8 \
#     --build-arg VITE_PARENT_ENS=hermes.eth \
#     --build-arg VITE_QUORUM_BIOME=quorumv2.biomes.hermes.eth \
#     --build-arg VITE_COORDINATOR_ENS=coordinator.hermes.eth \
#     --build-arg VITE_CONCIERGE_ENS=concierge.hermes.eth \
#     --build-arg VITE_SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com \
#     --build-arg VITE_ZEROG_RPC=https://evmrpc-testnet.0g.ai \
#     --build-arg VITE_ZEROG_INDEXER=https://indexer-storage-testnet-turbo.0g.ai \
#     .
#
# All VITE_* values are baked into the bundle at build time (vite
# inlines `import.meta.env.VITE_*`), so they MUST be passed as
# --build-arg. Setting them as runtime ENV on Cloud Run does nothing
# for the FE — they need to be present when `vite build` runs.
#
# Cloud Run notes:
#  - static SPA → can run with min-instances=0, scales to zero, cheap.
#  - the container listens on $PORT (Cloud Run sets it to 8080).
#
# ============================================================================
# Stage 1 — build the static SPA
# ============================================================================
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /repo

# Cache-friendly: copy all workspace manifests first.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/sdk/package.json        ./packages/sdk/
COPY packages/cli/package.json        ./packages/cli/
COPY apps/agents-server/package.json  ./apps/agents-server/
COPY apps/web/package.json            ./apps/web/

RUN pnpm install --frozen-lockfile

# Source for SDK + web (skip the server — not needed to build the FE).
COPY packages/sdk/  ./packages/sdk/
COPY apps/web/      ./apps/web/

# Vite inlines VITE_* at compile time. Re-export build args as ENV so
# the vite invocation sees them.
ARG VITE_AGENTS_SERVER_URL
ARG VITE_REOWN_PROJECT_ID
ARG VITE_INBOX_CONTRACT
ARG VITE_PARENT_ENS
ARG VITE_QUORUM_BIOME
ARG VITE_COORDINATOR_ENS
ARG VITE_CONCIERGE_ENS
ARG VITE_SELECTOR_ENS
ARG VITE_SEPOLIA_RPC
ARG VITE_ZEROG_RPC
ARG VITE_ZEROG_INDEXER
ARG VITE_BIOMES_PARENT
ARG VITE_AGENTS_PARENT

ENV VITE_AGENTS_SERVER_URL=$VITE_AGENTS_SERVER_URL
ENV VITE_REOWN_PROJECT_ID=$VITE_REOWN_PROJECT_ID
ENV VITE_INBOX_CONTRACT=$VITE_INBOX_CONTRACT
ENV VITE_PARENT_ENS=$VITE_PARENT_ENS
ENV VITE_QUORUM_BIOME=$VITE_QUORUM_BIOME
ENV VITE_COORDINATOR_ENS=$VITE_COORDINATOR_ENS
ENV VITE_CONCIERGE_ENS=$VITE_CONCIERGE_ENS
ENV VITE_SELECTOR_ENS=$VITE_SELECTOR_ENS
ENV VITE_SEPOLIA_RPC=$VITE_SEPOLIA_RPC
ENV VITE_ZEROG_RPC=$VITE_ZEROG_RPC
ENV VITE_ZEROG_INDEXER=$VITE_ZEROG_INDEXER
ENV VITE_BIOMES_PARENT=$VITE_BIOMES_PARENT
ENV VITE_AGENTS_PARENT=$VITE_AGENTS_PARENT

# Hard-fail the build if the Reown project ID is empty. Empty produces a
# silent runtime crash (Reown's createAppKit throws synchronously on
# module load → blank page on Cloud Run). Better to fail at `docker build`.
RUN echo "[build-args] VITE_REOWN_PROJECT_ID len=${#VITE_REOWN_PROJECT_ID}" \
 && echo "[build-args] VITE_AGENTS_SERVER_URL=$VITE_AGENTS_SERVER_URL" \
 && if [ -z "$VITE_REOWN_PROJECT_ID" ]; then \
      echo "ERROR: VITE_REOWN_PROJECT_ID build-arg is required and must not be empty." >&2; \
      exit 1; \
    fi \
 && if [ -z "$VITE_AGENTS_SERVER_URL" ]; then \
      echo "ERROR: VITE_AGENTS_SERVER_URL build-arg is required." >&2; \
      exit 1; \
    fi

RUN pnpm --filter hermes-agents-sdk build \
 && pnpm --filter @hermes/web build

# Bake build args into a public diagnostic file so we can verify what
# the deployed image actually saw at compile time. Curl /build-info.txt
# from the live URL to confirm. Single shell command — no Dockerfile
# heredoc (the parser treats heredoc continuation lines as new Dockerfile
# instructions and chokes).
RUN printf '%s\n' \
    "VITE_AGENTS_SERVER_URL=$VITE_AGENTS_SERVER_URL" \
    "VITE_REOWN_PROJECT_ID_LEN=${#VITE_REOWN_PROJECT_ID}" \
    "VITE_REOWN_PROJECT_ID_PREFIX=$(printf '%s' \"$VITE_REOWN_PROJECT_ID\" | cut -c1-6)" \
    "VITE_INBOX_CONTRACT=$VITE_INBOX_CONTRACT" \
    "VITE_QUORUM_BIOME=$VITE_QUORUM_BIOME" \
    "VITE_COORDINATOR_ENS=$VITE_COORDINATOR_ENS" \
    "VITE_CONCIERGE_ENS=$VITE_CONCIERGE_ENS" \
    "VITE_SELECTOR_ENS=$VITE_SELECTOR_ENS" \
    "BUILD_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > /repo/apps/web/dist/build-info.txt

# ============================================================================
# Stage 2 — nginx serves the static bundle on $PORT
# ============================================================================
FROM nginx:alpine AS runner

# Strip the default site so our template is the only one.
RUN rm -f /etc/nginx/conf.d/default.conf

# Static assets.
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

# nginx-on-alpine runs `envsubst` over /etc/nginx/templates/*.template
# at startup and writes the result to /etc/nginx/conf.d/. That's how
# we honour Cloud Run's $PORT.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template

ENV PORT=8080
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
