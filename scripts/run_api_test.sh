#!/bin/bash

# Run API Test Script
# This script runs the API test script to verify that the API endpoints are working

# Change to the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if axios is installed
if ! node -e "require.resolve('axios')" &> /dev/null; then
    echo "Installing axios..."
    npm install axios
fi

# Run the test script
echo "Running API test script..."
node scripts/test_api.js

# Exit with the exit code of the test script
exit $? 