#!/usr/bin/env bash
# Send a signed Facebook Lead Ads webhook to Salesdam
# Usage: ./scripts/send-facebook-lead.sh <accountId> <secret> <payload.json>

set -euo pipefail
ACCOUNT_ID="${1:-}"; SECRET="${2:-}"; PAYLOAD_FILE="${3:-}"
if [[ -z "$ACCOUNT_ID" || -z "$SECRET" || -z "$PAYLOAD_FILE" ]]; then
  echo "Usage: $0 <accountId> <webhookSecret> <payload.json>"; exit 1
fi
BASE_URL="${SALESDAM_API:-http://localhost:5002}/api/v1"
BODY=$(cat "$PAYLOAD_FILE")
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
echo "→ POST $BASE_URL/facebook/leadgen/$ACCOUNT_ID"
curl -sf -X POST \
  "$BASE_URL/facebook/leadgen/$ACCOUNT_ID" \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=$SIG" \
  -d "$BODY" | python3 -m json.tool || true
