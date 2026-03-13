#!/bin/bash
# gd ferry — Deploy scraper API to Cloud Run
#
# Usage:
#   ./packages/cloud/scraper-api/deploy.sh
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated
#   2. gcloud config set project <your-project-id>
#   3. APIs enabled: run, artifactregistry, cloudbuild

set -euo pipefail

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
REGION="us-central1"
REPO_NAME="ferry"
SERVICE_NAME="fairy-scraper"
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/scraper-api"

echo "═══════════════════════════════════════════"
echo "  gd ferry — deploying scraper API"
echo "  Project: ${PROJECT_ID}"
echo "  Region:  ${REGION}"
echo "═══════════════════════════════════════════"
echo ""

# Step 1: Create Artifact Registry repo (idempotent)
echo "→ Ensuring Artifact Registry repo exists..."
gcloud artifacts repositories create "${REPO_NAME}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="gd ferry container images" \
  2>/dev/null || true

# Step 2: Build & deploy via Cloud Build
echo "→ Submitting build..."
cd "$(git rev-parse --show-toplevel)"

gcloud builds submit \
  --config packages/cloud/scraper-api/cloudbuild.yaml \
  --substitutions=SHORT_SHA=$(git rev-parse --short HEAD) \
  .

echo ""
echo "═══════════════════════════════════════════"
echo "  Deploy complete!"
echo ""

# Show the service URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --format="value(status.url)" 2>/dev/null)

if [ -n "${SERVICE_URL}" ]; then
  echo "  Service URL: ${SERVICE_URL}"
  echo ""
  echo "  Test it:"
  echo "    curl -X POST ${SERVICE_URL}/scan/recon \\"
  echo "      -H 'Content-Type: application/json' \\"
  echo "      -d '{\"url\": \"https://www.lendingtree.com\"}'"
fi
echo "═══════════════════════════════════════════"
