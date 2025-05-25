#!/bin/bash

# Set the target API URL to the Unraid server
export API_URL="${API_URL:-http://localhost:8083}"
echo "Testing API rate limiting against $API_URL"

# Create a test API key via the API endpoint
echo "Creating test API key via API..."
RESPONSE=$(curl -s -X POST \
   -H "Content-Type: application/json" \
   -d '{"name":"Rate Limit Test Key", "permissions":{"description":"Test key for rate limiting", "allowed_endpoints":["*"]}, "rate_limit_tier":"extended"}' \
  "${API_URL}/api/v1/api-keys" || { echo "Failed to connect to API"; exit 1; })

# Extract key and secret from response
KEY=$(echo $RESPONSE | jq -r '.key // empty')
SECRET=$(echo $RESPONSE | jq -r '.secret // empty')

if [ -z "$KEY" ] || [ -z "$SECRET" ]; then
    echo "Failed to create API key! Response:"
    echo "$RESPONSE"
    exit 1
fi

echo "API key created successfully:"
echo "Key: $KEY"
echo "Secret: $SECRET"

# Save the key and secret to a file for the test script
mkdir -p data
cat > data/test_api_key.json << EOF
{
  "name": "Rate Limit Test Key",
  "key": "$KEY",
  "secret": "$SECRET"
}
EOF

echo "Saved key to data/test_api_key.json"

# Wait a moment for the key to be properly registered
sleep 2

# Run the rate limiting test
echo "Running rate limit tests against $API_URL..."
node scripts/test_rate_limits.js

echo "Test completed!" 