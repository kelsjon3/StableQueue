/**
 * manualApiTests.js
 * Manual tests for the StableQueue API
 * 
 * This script provides interactive manual testing for the StableQueue API endpoints.
 * Unlike the automated tests, it displays detailed results and allows for user interaction.
 */

const axios = require('axios');
const readline = require('readline');
const crypto = require('crypto');
const apiKeyManager = require('../utils/apiKeyManager');
const { API_KEY_TIERS } = require('../utils/apiConstants');
const { readServersConfig } = require('../utils/configHelpers');

// Create readline interface for user interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Test configuration
const config = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
  testApiKey: null,
  testApiKeyId: null,
  testJobId: null,
  serverAlias: null
};

// Helper function to make API requests
async function apiRequest(method, endpoint, data = null, params = null, authHeader = true) {
  const url = `${config.baseUrl}${endpoint}`;
  const headers = authHeader && config.testApiKey ? 
    { 'Authorization': `Bearer ${config.testApiKey}` } : {};
  
  if (data) {
    headers['Content-Type'] = 'application/json';
  }
  
  try {
    const response = await axios({
      method,
      url,
      data,
      params,
      headers
    });
    
    return response.data;
  } catch (error) {
    console.error(`\n❌ API Error (${method.toUpperCase()} ${endpoint}):`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response:', error.response.data);
      return { error: true, status: error.response.status, data: error.response.data };
    } else {
      console.error('Error:', error.message);
      return { error: true, message: error.message };
    }
  }
}

// Test functions

// 1. Test API key creation and management
async function testApiKeyManagement() {
  console.log('\n=== Testing API Key Creation and Management ===\n');
  
  // Create API key
  const keyName = `test_key_${Date.now()}`;
  console.log(`Creating API key "${keyName}"...`);
  
  try {
    const result = await apiKeyManager.createApiKey(
      keyName, 
      'API key for manual testing', 
      API_KEY_TIERS.STANDARD
    );
    
    config.testApiKey = result.key;
    config.testApiKeyId = result.id;
    
    console.log('✅ API key created successfully:');
    console.log(`ID: ${result.id}`);
    console.log(`Key: ${result.key}`);
    console.log(`Created at: ${result.created_at}`);
    
    // Test listing keys
    console.log('\nListing all API keys...');
    const keys = await apiKeyManager.listApiKeys();
    console.log(`✅ Found ${keys.length} API keys`);
    
    // Test getting a specific key
    console.log(`\nGetting API key details for ${config.testApiKeyId}...`);
    const keyDetails = await apiKeyManager.getApiKey(config.testApiKeyId);
    console.log('✅ API key details retrieved:');
    console.log(`Name: ${keyDetails.name}`);
    console.log(`Description: ${keyDetails.description}`);
    console.log(`Tier: ${keyDetails.tier}`);
    console.log(`Active: ${keyDetails.is_active}`);
    
    // Test updating a key
    console.log('\nUpdating API key...');
    const updatedKey = await apiKeyManager.updateApiKey(
      config.testApiKeyId, 
      { 
        name: `${keyName}_updated`,
        description: 'Updated description'
      }
    );
    console.log('✅ API key updated successfully:');
    console.log(`Name: ${updatedKey.name}`);
    console.log(`Description: ${updatedKey.description}`);
    
    return true;
  } catch (error) {
    console.error('❌ API key management test failed:', error.message);
    return false;
  }
}

// 2. Test API authentication
async function testApiAuthentication() {
  console.log('\n=== Testing API Authentication ===\n');
  
  if (!config.testApiKey) {
    console.error('❌ No test API key available. Cannot test authentication.');
    return false;
  }
  
  // Test valid authentication
  console.log('Testing with valid API key...');
  const validResult = await apiRequest('get', '/api/v2/jobs');
  
  if (!validResult.error) {
    console.log('✅ Valid API key authentication successful');
  } else {
    console.error('❌ Valid API key authentication failed');
    return false;
  }
  
  // Test invalid authentication
  console.log('\nTesting with invalid API key...');
  const originalKey = config.testApiKey;
  config.testApiKey = 'invalid_key_12345';
  
  const invalidResult = await apiRequest('get', '/api/v2/jobs');
  
  if (invalidResult.error && invalidResult.status === 401) {
    console.log('✅ Invalid API key correctly rejected with 401 Unauthorized');
  } else {
    console.error('❌ Invalid API key test failed - unexpected response');
    config.testApiKey = originalKey;
    return false;
  }
  
  // Test missing authentication
  console.log('\nTesting with missing API key...');
  const missingResult = await apiRequest('get', '/api/v2/jobs', null, null, false);
  
  if (missingResult.error && missingResult.status === 401) {
    console.log('✅ Missing API key correctly rejected with 401 Unauthorized');
  } else {
    console.error('❌ Missing API key test failed - unexpected response');
    config.testApiKey = originalKey;
    return false;
  }
  
  // Restore original key
  config.testApiKey = originalKey;
  return true;
}

// 3. Test job submission via v2 endpoint
async function testJobSubmission() {
  console.log('\n=== Testing Job Submission via v2 Endpoint ===\n');
  
  if (!config.testApiKey) {
    console.error('❌ No test API key available. Cannot test job submission.');
    return false;
  }
  
  // Get server alias if not already set
  if (!config.serverAlias) {
    try {
      const servers = await readServersConfig();
      if (servers && servers.length > 0) {
        config.serverAlias = servers[0].alias;
        console.log(`Using server alias: ${config.serverAlias}`);
      } else {
        console.error('❌ No servers configured. Cannot test job submission.');
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to read server config:', error.message);
      return false;
    }
  }
  
  // Test job submission
  console.log('Submitting test job...');
  const jobData = {
    app_type: 'forge',
    target_server_alias: config.serverAlias,
    generation_params: {
      positive_prompt: 'test image for manual API testing',
      negative_prompt: 'low quality, bad',
      checkpoint_name: 'models/v1-5-pruned-emaonly.safetensors', // Use a common model
      width: 512,
      height: 512,
      steps: 3, // Minimal steps for faster testing
      cfg_scale: 7,
      sampler_name: 'Euler'
    },
    source_info: 'manual_api_testing_v1.0.0'
  };
  
  const submissionResult = await apiRequest('post', '/api/v2/generate', jobData);
  
  if (!submissionResult.error && submissionResult.success && submissionResult.stablequeue_job_id) {
    config.testJobId = submissionResult.stablequeue_job_id;
    console.log('✅ Job submission successful:');
    console.log(`Job ID: ${submissionResult.stablequeue_job_id}`);
    console.log(`Queue Position: ${submissionResult.queue_position}`);
    console.log(`App Type: ${submissionResult.app_type}`);
    console.log(`Creation Time: ${submissionResult.creation_timestamp}`);
    return true;
  } else {
    console.error('❌ Job submission failed');
    return false;
  }
}

// 4. Test job status and app_type handling
async function testJobStatusAndAppType() {
  console.log('\n=== Testing Job Status and app_type/source_info handling ===\n');
  
  if (!config.testJobId) {
    console.error('❌ No test job ID available. Cannot test job status.');
    return false;
  }
  
  // Test job status
  console.log(`Getting status for job ${config.testJobId}...`);
  const statusResult = await apiRequest('get', `/api/v2/jobs/${config.testJobId}/status`);
  
  if (!statusResult.error && statusResult.success && statusResult.job) {
    console.log('✅ Job status retrieved successfully:');
    console.log(`Status: ${statusResult.job.status}`);
    console.log(`App Type: ${statusResult.job.app_type}`);
    console.log(`Source Info: ${statusResult.job.source_info}`);
    
    // Verify app_type and source_info are correctly handled
    if (statusResult.job.app_type === 'forge' && 
        statusResult.job.source_info === 'manual_api_testing_v1.0.0') {
      console.log('✅ app_type and source_info fields correctly persisted and returned');
    } else {
      console.error('❌ app_type or source_info fields not handled correctly');
      console.log('Expected: app_type=forge, source_info=manual_api_testing_v1.0.0');
      console.log(`Actual: app_type=${statusResult.job.app_type}, source_info=${statusResult.job.source_info}`);
    }
    
    // Test job filtering by app_type
    console.log('\nTesting job filtering by app_type...');
    const filteredResult = await apiRequest('get', '/api/v2/jobs', null, { app_type: 'forge' });
    
    if (!filteredResult.error && filteredResult.success && Array.isArray(filteredResult.jobs)) {
      console.log(`✅ Found ${filteredResult.jobs.length} jobs with app_type=forge`);
      
      // Verify all jobs have correct app_type
      const nonForgeJobs = filteredResult.jobs.filter(job => job.app_type !== 'forge');
      if (nonForgeJobs.length === 0) {
        console.log('✅ All returned jobs have correct app_type');
      } else {
        console.error(`❌ Found ${nonForgeJobs.length} jobs with incorrect app_type`);
      }
    } else {
      console.error('❌ Job filtering test failed');
    }
    
    return true;
  } else {
    console.error('❌ Job status check failed');
    return false;
  }
}

// 5. Clean up test resources
async function cleanupTestResources() {
  console.log('\n=== Cleaning Up Test Resources ===\n');
  
  // Delete test API key
  if (config.testApiKeyId) {
    console.log(`Deleting test API key ${config.testApiKeyId}...`);
    try {
      await apiKeyManager.deleteApiKey(config.testApiKeyId);
      console.log('✅ Test API key deleted successfully');
    } catch (error) {
      console.error('❌ Failed to delete test API key:', error.message);
    }
  }
  
  return true;
}

// Main function to run tests sequentially
async function runTests() {
  console.log('\n============================================');
  console.log('        StableQueue API Manual Testing         ');
  console.log('============================================\n');
  
  console.log('This script will test the following:');
  console.log('1. API key creation and management');
  console.log('2. API authentication with various scenarios');
  console.log('3. Job submission via new v2 endpoint');
  console.log('4. Handling of app_type and source_info fields');
  
  // Ask user to continue
  await new Promise(resolve => {
    rl.question('\nPress Enter to begin testing...', () => {
      resolve();
    });
  });
  
  // Run tests
  try {
    // Test API key management
    const apiKeyResult = await testApiKeyManagement();
    if (!apiKeyResult) {
      throw new Error('API key management tests failed');
    }
    
    // Test API authentication
    const authResult = await testApiAuthentication();
    if (!authResult) {
      throw new Error('API authentication tests failed');
    }
    
    // Test job submission
    const submissionResult = await testJobSubmission();
    if (!submissionResult) {
      throw new Error('Job submission tests failed');
    }
    
    // Test job status and app_type handling
    const statusResult = await testJobStatusAndAppType();
    if (!statusResult) {
      throw new Error('Job status and app_type handling tests failed');
    }
    
    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error(`\n❌ Tests failed: ${error.message}`);
  } finally {
    // Clean up test resources
    await cleanupTestResources();
    
    // Ask user if they want to see job results
    if (config.testJobId) {
      await new Promise(resolve => {
        rl.question('\nDo you want to check the final status of the test job? (y/n) ', async (answer) => {
          if (answer.toLowerCase() === 'y') {
            const finalStatus = await apiRequest('get', `/api/v2/jobs/${config.testJobId}/status`);
            if (!finalStatus.error) {
              console.log('\nFinal job status:');
              console.log(JSON.stringify(finalStatus, null, 2));
            }
          }
          resolve();
        });
      });
    }
    
    console.log('\nClosing test script...');
    rl.close();
  }
}

// Run the tests if this file is executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = {
  runTests
}; 