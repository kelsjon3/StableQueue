/**
 * Create Test API Key
 * 
 * Creates a test API key and saves it to a file for use in tests.
 */

const fs = require('fs');
const path = require('path');
const apiKeyManager = require('../utils/apiKeyManager');

// Path to save the test key
const dataDir = path.join(__dirname, '..', 'data');
const testKeyPath = path.join(dataDir, 'test_api_key.json');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Define permissions for test key
const testKeyPermissions = {
    description: "Test API key with extended rate limits",
    allowed_endpoints: ["*"],
    rate_limit_tier: "extended"
};

// Create the API key
try {
    console.log('Creating test API key...');
    const apiKey = apiKeyManager.createApiKey(
        "Test API Key", 
        JSON.stringify(testKeyPermissions),
        "extended"
    );
    
    // Save the key info for tests
    fs.writeFileSync(testKeyPath, JSON.stringify({
        id: apiKey.id,
        name: apiKey.name,
        key: apiKey.key,
        secret: apiKey.secret
    }, null, 2));
    
    console.log('Test API key created and saved successfully!');
    console.log('Key ID:', apiKey.id);
    console.log('Key:', apiKey.key);
    console.log('Secret:', apiKey.secret);
    console.log('Saved to:', testKeyPath);
    
    // Clean up
    apiKeyManager.closeDb();
} catch (error) {
    console.error('Error creating test API key:', error);
} 