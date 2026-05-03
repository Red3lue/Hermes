#!/usr/bin/env bash
# scripts/deploy-agents-server.sh — one-shot Cloud Run rebuild + deploy
# for the agents-server.
#
# Run from the monorepo root:
#   bash scripts/deploy-agents-server.sh
#
# Reads its config from `.env.deploy` (gitignored) at the repo root —
# same file the web deploy script uses. See scripts/.env.deploy.example
# for the full schema.

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
  VITE_INBOX_CONTRACT
  VITE_QUORUM_BIOME
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

IMAGE_NAME="${AGENTS_SERVER_IMAGE_NAME:-${REGISTRY}/agents-server:latest}"
SERVICE_NAME="${AGENTS_SERVER_SERVICE_NAME:-hermes-agents-server}"

echo "==> building & pushing $IMAGE_NAME"
docker buildx build \
  --platform linux/amd64 \
  --no-cache \
  --pull \
  -t "$IMAGE_NAME" \
  -f apps/agents-server/Dockerfile \
  --push \
  .

echo
echo "==> deploying $SERVICE_NAME → $GCP_REGION"
echo "    NOTE: this script ONLY pushes the image + updates the service to"
echo "    use it. It does NOT touch env vars or secrets — those were set"
echo "    when you first created the Cloud Run service. If you need to add"
echo "    or change them, see DEPLOY.md section 1."
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_NAME" \
  --region="$GCP_REGION"

echo
URL="$(gcloud run services describe "$SERVICE_NAME" --region="$GCP_REGION" --format='value(status.url)')"
echo "    URL:     $URL"
echo "    Health:  $(curl -sS "$URL/health" || echo '(unreachable)')"
