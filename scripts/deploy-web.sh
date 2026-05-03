#!/usr/bin/env bash
# scripts/deploy-web.sh — one-shot Cloud Run rebuild + deploy for the web FE.
#
# Run from the monorepo root:
#   bash scripts/deploy-web.sh
#
# Reads its config from `.env.deploy` (gitignored) at the repo root. Create it
# once with your real values; subsequent runs are a single command. See the
# `.env.deploy.example` file in the same directory for the schema.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---- load config ----------------------------------------------------------
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.deploy}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  echo "       Copy scripts/.env.deploy.example to .env.deploy and edit." >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

required=(
  REGISTRY
  GCP_REGION
  VITE_AGENTS_SERVER_URL
  VITE_REOWN_PROJECT_ID
  VITE_INBOX_CONTRACT
  VITE_PARENT_ENS
  VITE_QUORUM_BIOME
  VITE_COORDINATOR_ENS
  VITE_CONCIERGE_ENS
  VITE_SEPOLIA_RPC
  VITE_ZEROG_RPC
  VITE_ZEROG_INDEXER
)
missing=()
for v in "${required[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    missing+=("$v")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "ERROR: missing env vars in $ENV_FILE:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

IMAGE_NAME="${IMAGE_NAME:-${REGISTRY}/web:latest}"
SERVICE_NAME="${SERVICE_NAME:-hermes-web}"

echo "==> building & pushing $IMAGE_NAME"
docker buildx build \
  --platform linux/amd64 \
  --no-cache \
  --pull \
  -t "$IMAGE_NAME" \
  -f apps/web/Dockerfile \
  --build-arg "VITE_AGENTS_SERVER_URL=$VITE_AGENTS_SERVER_URL" \
  --build-arg "VITE_REOWN_PROJECT_ID=$VITE_REOWN_PROJECT_ID" \
  --build-arg "VITE_INBOX_CONTRACT=$VITE_INBOX_CONTRACT" \
  --build-arg "VITE_PARENT_ENS=$VITE_PARENT_ENS" \
  --build-arg "VITE_QUORUM_BIOME=$VITE_QUORUM_BIOME" \
  --build-arg "VITE_COORDINATOR_ENS=$VITE_COORDINATOR_ENS" \
  --build-arg "VITE_CONCIERGE_ENS=$VITE_CONCIERGE_ENS" \
  --build-arg "VITE_SEPOLIA_RPC=$VITE_SEPOLIA_RPC" \
  --build-arg "VITE_ZEROG_RPC=$VITE_ZEROG_RPC" \
  --build-arg "VITE_ZEROG_INDEXER=$VITE_ZEROG_INDEXER" \
  --push \
  .

echo
echo "==> deploying $SERVICE_NAME → $GCP_REGION"
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_NAME" \
  --region="$GCP_REGION"

echo
echo "==> done. Verifying live deploy:"
URL="$(gcloud run services describe "$SERVICE_NAME" --region="$GCP_REGION" --format='value(status.url)')"
echo "    URL: $URL"
echo "    /build-info.txt:"
curl -sS "$URL/build-info.txt" | sed 's/^/      /'
