#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_NUMBER="662653350528"
SERVICE="remix-m-j-ai-asistent"
REGION="europe-west2"
MODEL="gemini-3.1-flash-lite"
FALLBACK_MODEL="gemini-2.5-flash-lite"

echo "==> Resolving Google Cloud project"
PROJECT_ID="$(gcloud projects describe "$PROJECT_NUMBER" --format='value(projectId)')"
PROJECT_NUMBER_RESOLVED="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BUILD_ACCOUNT="${PROJECT_NUMBER_RESOLVED}-compute@developer.gserviceaccount.com"
gcloud config set project "$PROJECT_ID" --quiet

echo "==> Enabling required APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com aiplatform.googleapis.com --project "$PROJECT_ID"

echo "==> Reading current Cloud Run service identity"
SERVICE_ACCOUNT="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
if [[ -z "$SERVICE_ACCOUNT" ]]; then
  SERVICE_ACCOUNT="$BUILD_ACCOUNT"
fi

echo "Service account: $SERVICE_ACCOUNT"
echo "Build account:   $BUILD_ACCOUNT"

echo "==> Granting Cloud Run Builder to the source-build identity"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_ACCOUNT}" \
  --role="roles/run.builder" \
  --condition=None \
  --quiet >/dev/null

echo "==> Granting Vertex AI user role to the Cloud Run service identity"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/aiplatform.user" \
  --condition=None \
  --quiet >/dev/null

echo "==> Deploying Nucleus 2.0 to the existing Cloud Run service"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --service-account "$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --update-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,NUCLEUS_MODEL=${MODEL},NUCLEUS_FALLBACK_MODEL=${FALLBACK_MODEL}" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"

echo "==> Health check: $URL/health"
curl --fail --silent --show-error "$URL/health"
echo

echo "==> AI status: $URL/api/status"
STATUS_JSON="$(curl --fail --silent --show-error "$URL/api/status")"
echo "$STATUS_JSON"
echo

echo "==> End-to-end AI smoke test"
if echo "$STATUS_JSON" | grep -q '"pinProtected":true'; then
  echo "AI smoke test skipped because Nucleus is PIN protected."
else
  CHAT_JSON="$(curl --fail --silent --show-error \
    -H 'Content-Type: application/json' \
    --data '{"message":"Odpovez pouze NUCLEUS_OK","history":[]}' \
    "$URL/api/chat")"
  echo "$CHAT_JSON"
  echo "$CHAT_JSON" | grep -q 'NUCLEUS_OK' || { echo "AI smoke test failed." >&2; exit 1; }
fi

echo "============================================================"
echo "MUJ NUCLEUS JE ONLINE A KONTROLY PROSLY"
echo "$URL"
echo "============================================================"
