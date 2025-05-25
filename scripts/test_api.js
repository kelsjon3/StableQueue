/**
 * API Test Script
 * 
 * This script tests the new API endpoints for API key management
 * and job submission with the v2 API.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY_FILE = path.join(__dirname, '..', 'data', 'test_api_key.json');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

/**
 * Logs a step in the test process
 */
function logStep(step, message) {
  console.log(`${colors.bright}${colors.blue}[Step ${step}]${colors.reset} ${message}`);
}

/**
 * Logs the result of a test
 */
function logResult(success, message, data = null) {
  if (success) {
    console.log(`${colors.green}✓ SUCCESS${colors.reset}: ${message}`);
  } else {
    console.log(`${colors.red}✗ FAILED${colors.reset}: ${message}`);
  }
  
  if (data) {
    console.log(`${colors.dim}${JSON.stringify(data, null, 2)}${colors.reset}`);
  }
  
  console.log(); // Add blank line
}

/**
 * Saves API key to file
 */
function saveApiKey(keyData) {
  fs.writeFileSync(API_KEY_FILE, JSON.stringify(keyData, null, 2));
  console.log(`${colors.yellow}API key saved to ${API_KEY_FILE}${colors.reset}`);
}

/**
 * Loads API key from file
 */
function loadApiKey() {
  try {
    if (fs.existsSync(API_KEY_FILE)) {
      return JSON.parse(fs.readFileSync(API_KEY_FILE, 'utf8'));
    }
  } catch (error) {
    console.log(`${colors.red}Error loading API key: ${error.message}${colors.reset}`);
  }
  return null;
}

/**
 * Creates a new API key
 */
async function createApiKey() {
  logStep(1, 'Creating a new API key');
  
  try {
    const response = await axios.post(`${BASE_URL}/api/v1/api-keys`, {
      name: 'Test API Key',
      permissions: { generate: true, status: true }
    });
    
    if (response.status === 201 && response.data.success) {
      logResult(true, 'API key created successfully', response.data.api_key);
      return response.data.api_key;
    } else {
      logResult(false, 'Unexpected response when creating API key', response.data);
      return null;
    }
  } catch (error) {
    logResult(false, `Error creating API key: ${error.message}`, error.response?.data);
    return null;
  }
}

/**
 * Gets all API keys
 */
async function getAllApiKeys() {
  logStep(2, 'Listing all API keys');
  
  try {
    const response = await axios.get(`${BASE_URL}/api/v1/api-keys`);
    
    if (response.status === 200 && response.data.success) {
      logResult(true, `Found ${response.data.count} API keys`, response.data.api_keys);
      return response.data.api_keys;
    } else {
      logResult(false, 'Unexpected response when listing API keys', response.data);
      return null;
    }
  } catch (error) {
    logResult(false, `Error listing API keys: ${error.message}`, error.response?.data);
    return null;
  }
}

/**
 * Submits a test job using the v2 API
 */
async function submitTestJob(apiKey) {
  logStep(3, 'Submitting a test job with the v2 API');
  
  if (!apiKey) {
    logResult(false, 'No API key available for testing');
    return null;
  }
  
  try {
    const response = await axios.post(
      `${BASE_URL}/api/v2/generate`,
      {
        app_type: 'forge',
        target_server_alias: 'local', // Adjust based on your server config
        source_info: 'api_test_script',
        generation_params: {
          positive_prompt: 'A test prompt from the API test script',
          negative_prompt: 'bad quality',
          checkpoint_name: 'Realistic_Vision_V5.1.safetensors', // Adjust based on your model availability
          width: 512,
          height: 512,
          steps: 20,
          cfg_scale: 7,
          sampler_name: 'Euler',
          restore_faces: false
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey.key,
          'X-API-Secret': apiKey.secret
        }
      }
    );
    
    if (response.status === 202 && response.data.success) {
      logResult(true, 'Job submitted successfully', response.data);
      return response.data;
    } else {
      logResult(false, 'Unexpected response when submitting job', response.data);
      return null;
    }
  } catch (error) {
    logResult(false, `Error submitting job: ${error.message}`, error.response?.data);
    return null;
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log(`${colors.bright}${colors.magenta}=== MobileSD API Test Script ===${colors.reset}\n`);
  
  let apiKey = loadApiKey();
  
  if (!apiKey) {
    // Create a new API key if none exists
    apiKey = await createApiKey();
    
    if (apiKey) {
      saveApiKey(apiKey);
    }
  } else {
    console.log(`${colors.yellow}Using existing API key: ${apiKey.name} (${apiKey.id})${colors.reset}\n`);
  }
  
  // List all API keys
  await getAllApiKeys();
  
  // Submit a test job
  await submitTestJob(apiKey);
  
  console.log(`${colors.bright}${colors.magenta}=== Tests Complete ===${colors.reset}`);
}

// Run the tests
runTests().catch(error => {
  console.error(`${colors.red}Unhandled error in test script:${colors.reset}`, error);
}); 