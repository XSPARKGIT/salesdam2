#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# send-webhook.sh  — Send a signed inbound webhook to Salesdam (for UAT demos)
#
# Usage:
#   ./scripts/send-webhook.sh <channel> <accountId> <secret> <payload.json>
#
# Examples:
#   ./scripts/send-webhook.sh telephony 6650abc123 tel-secret payload-call.json
#   ./scripts/send-webhook.sh facebook  6650def456 fb-secret  payload-lead.json
#
# The script computes HMAC-SHA256(secret, body) and sends it as the
# x-salesdam-signature header — matching the server's verifyWebhookSignature().
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CHANNEL="${1:-}"
ACCOUNT_ID="${2:-}"
SECRET="${3:-}"
PAYLOAD_FILE="${4:-}"

if [[ -z "$CHANNEL" || -z "$ACCOUNT_ID" || -z "$SECRET" || -z "$PAYLOAD_FILE" ]]; then
  echo "Usage: $0 <channel> <accountId> <webhookSecret> <payload.json>"
  exit 1
fi

if [[ ! -f "$PAYLOAD_FILE" ]]; then
  echo "ERROR: Payload file '$PAYLOAD_FILE' not found."
  exit 1
fi

BASE_URL="${SALESDAM_API:-http://localhost:5002}/api/v1"
BODY=$(cat "$PAYLOAD_FILE")
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

echo "→ POST $BASE_URL/channels/webhook/$CHANNEL/$ACCOUNT_ID"
echo "→ Signature: sha256=$SIG"
echo ""

curl -sf -X POST \
  "$BASE_URL/channels/webhook/$CHANNEL/$ACCOUNT_ID" \
  -H "Content-Type: application/json" \
  -H "x-salesdam-signature: sha256=$SIG" \
  -d "$BODY" | python3 -m json.tool || true
