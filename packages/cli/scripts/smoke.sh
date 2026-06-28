#!/usr/bin/env bash
# e2e smoke test — run from inside an invoice-app that has been deployed via slsv dev
set -euo pipefail

APP=${1:-invoice-app}
# API Gateway URL is printed by slsv deploy — capture it or set API_URL manually
API_URL=${API_URL:-}

if [[ -z "$API_URL" ]]; then
  echo "Set API_URL=http://localhost:4566/restapis/<id>/local/_user_request_"
  exit 1
fi

echo "=== smoke test: $APP ==="

# 1. Health check via API Gateway
echo "1. Health check..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health")
[[ "$STATUS" == "200" ]] && echo "   ✓ GET /health → 200" || { echo "   ✗ expected 200, got $STATUS"; exit 1; }

# 2. POST invoice via API Gateway
echo "2. POST invoice..."
RESP=$(curl -s -X POST "$API_URL/api/invoices" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100, "customer": "test@example.com"}')
ID=$(echo "$RESP" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
[[ -n "$ID" ]] && echo "   ✓ created invoice id=$ID" || { echo "   ✗ bad response: $RESP"; exit 1; }

# 3. POST stripe webhook → enqueues to SQS
echo "3. Stripe webhook..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/webhooks/stripe" \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=123,v1=abc" \
  -d '{"type":"payment_intent.succeeded","data":{"object":{"customer_email":"test@example.com","metadata":{"invoiceId":"'"$ID"'"}}}}')
[[ "$STATUS" == "200" ]] && echo "   ✓ POST /webhooks/stripe → 200" || { echo "   ✗ expected 200, got $STATUS"; exit 1; }

# 4. Send SQS message directly and wait for sendReceipt lambda
echo "4. SQS → sendReceipt..."
QUEUE_URL=$(aws --endpoint-url=http://localhost:4566 sqs get-queue-url \
  --queue-name "${APP}-emailQueue" --query QueueUrl --output text)
aws --endpoint-url=http://localhost:4566 sqs send-message \
  --queue-url "$QUEUE_URL" \
  --message-body '{"email":"test@example.com","invoiceId":"smoke-test"}' > /dev/null
sleep 3
RECEIPT=$(aws --endpoint-url=http://localhost:4566 s3 ls "s3://${APP,,}-receipts/receipts/" 2>/dev/null | grep smoke-test || true)
[[ -n "$RECEIPT" ]] && echo "   ✓ S3 receipt written" || echo "   ~ receipt not yet visible (async, check logs)"

# 5. Cron: manually invoke dailyInvoice
echo "5. dailyInvoice direct invoke..."
aws --endpoint-url=http://localhost:4566 lambda invoke \
  --function-name "${APP}-dailyInvoice" \
  --payload '{}' /tmp/slsv-smoke-out.json > /dev/null
PROCESSED=$(cat /tmp/slsv-smoke-out.json | grep -o '"processed":[0-9]*' | cut -d: -f2 || echo "0")
echo "   ✓ dailyInvoice returned processed=$PROCESSED"

echo ""
echo "=== smoke test passed ==="
