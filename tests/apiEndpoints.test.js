/**
 * apiEndpoints.test.js
 * Automated tests for MobileSD API endpoints
 */

const axios = require('axios');
const crypto = require('crypto');
const apiKeyManager = require('../utils/apiKeyManager');
const { API_KEY_TIERS } = require('../utils/apiConstants');

// Test configuration
const config = {
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
    testApiKey: null, // Will be created during setup
    testApiKeyId: null,
    testJobId: null,
    verbose: process.env.VERBOSE_TESTS === 'true'
};

// Setup function to create test resources
async function setup() {
    console.log('Setting up test environment...');
    
    // Create a test API key
    try {
        const keyName = `test_key_${Date.now()}`;
        const result = await apiKeyManager.createApiKey(keyName, 'Test API key for automated tests', API_KEY_TIERS.STANDARD);
        config.testApiKey = result.key;
        config.testApiKeyId = result.id;
        console.log(`Created test API key: ${config.testApiKeyId}`);
    } catch (error) {
        console.error('Failed to create test API key:', error);
        process.exit(1);
    }
}

// Teardown function to clean up test resources
async function teardown() {
    console.log('Cleaning up test environment...');
    
    // Delete the test API key
    if (config.testApiKeyId) {
        try {
            await apiKeyManager.deleteApiKey(config.testApiKeyId);
            console.log(`Deleted test API key: ${config.testApiKeyId}`);
        } catch (error) {
            console.error('Failed to delete test API key:', error);
        }
    }
}

// Helper for HTTP requests with API key auth
async function apiRequest(method, endpoint, data = null, params = null) {
    const url = `${config.baseUrl}${endpoint}`;
    const headers = {
        'Authorization': `Bearer ${config.testApiKey}`
    };
    
    try {
        const response = await axios({
            method,
            url,
            data,
            params,
            headers
        });
        
        if (config.verbose) {
            console.log(`${method.toUpperCase()} ${endpoint}`, response.status);
            console.log('Response:', JSON.stringify(response.data, null, 2));
        }
        
        return response;
    } catch (error) {
        if (config.verbose) {
            console.error(`${method.toUpperCase()} ${endpoint} failed:`, error.response?.status);
            console.error('Error response:', error.response?.data);
        }
        throw error;
    }
}

// Test suites
async function testApiKeyAuthentication() {
    console.log('\n=== Testing API Key Authentication ===');
    
    console.log('Testing valid authentication...');
    try {
        const response = await apiRequest('get', '/api/v2/jobs');
        console.log('✅ Valid API key authentication successful');
    } catch (error) {
        console.error('❌ Valid API key authentication failed:', error.message);
        throw error;
    }
    
    console.log('Testing invalid authentication...');
    try {
        const originalKey = config.testApiKey;
        config.testApiKey = 'invalid_key_12345';
        
        try {
            await apiRequest('get', '/api/v2/jobs');
            console.error('❌ Invalid API key authentication should have failed but succeeded');
            throw new Error('Authentication should have failed with invalid key');
        } catch (error) {
            if (error.response && error.response.status === 401) {
                console.log('✅ Invalid API key correctly rejected');
            } else {
                console.error('❌ Unexpected error with invalid API key:', error.message);
                throw error;
            }
        } finally {
            config.testApiKey = originalKey;
        }
    } catch (error) {
        console.error('❌ Invalid authentication test failed:', error.message);
        throw error;
    }
}

async function testJobSubmission() {
    console.log('\n=== Testing Job Submission ===');
    
    // Get first server alias from configured servers
    let serverAlias;
    try {
        const response = await apiRequest('get', '/api/v1/servers');
        if (response.data && response.data.length > 0) {
            serverAlias = response.data[0].alias;
            console.log(`Using server alias: ${serverAlias}`);
        } else {
            console.error('❌ No servers configured for testing');
            throw new Error('No servers configured');
        }
    } catch (error) {
        console.error('❌ Failed to get server list:', error.message);
        throw error;
    }
    
    // Submit a test job
    console.log('Submitting test job...');
    try {
        const jobData = {
            app_type: 'forge',
            target_server_alias: serverAlias,
            generation_params: {
                positive_prompt: 'test image for API endpoint tests',
                negative_prompt: 'low quality, bad',
                checkpoint_name: 'models/v1-5-pruned-emaonly.safetensors', // Use a common model
                width: 512,
                height: 512,
                steps: 3, // Minimal steps for faster testing
                cfg_scale: 7,
                sampler_name: 'Euler'
            },
            source_info: 'api_endpoint_tests'
        };
        
        const response = await apiRequest('post', '/api/v2/generate', jobData);
        if (response.data && response.data.success && response.data.mobilesd_job_id) {
            config.testJobId = response.data.mobilesd_job_id;
            console.log(`✅ Job submission successful. Job ID: ${config.testJobId}`);
        } else {
            console.error('❌ Job submission response missing expected fields:', response.data);
            throw new Error('Invalid job submission response');
        }
    } catch (error) {
        console.error('❌ Job submission failed:', error.message);
        throw error;
    }
    
    // Test job validation error handling
    console.log('Testing job validation errors...');
    try {
        // Missing required field
        try {
            const jobData = {
                app_type: 'forge',
                // Missing target_server_alias
                generation_params: {
                    positive_prompt: 'test validation',
                    negative_prompt: 'bad',
                    checkpoint_name: 'models/v1-5-pruned-emaonly.safetensors'
                }
            };
            
            await apiRequest('post', '/api/v2/generate', jobData);
            console.error('❌ Missing field validation should have failed but succeeded');
            throw new Error('Validation should have failed with missing target_server_alias');
        } catch (error) {
            if (error.response && error.response.status === 400 && 
                error.response.data && error.response.data.error === 'missing_required_field') {
                console.log('✅ Missing field correctly rejected');
            } else {
                console.error('❌ Unexpected error with missing field:', error.message);
                throw error;
            }
        }
        
        // Invalid server alias
        try {
            const jobData = {
                app_type: 'forge',
                target_server_alias: 'non_existent_server',
                generation_params: {
                    positive_prompt: 'test validation',
                    negative_prompt: 'bad',
                    checkpoint_name: 'models/v1-5-pruned-emaonly.safetensors'
                }
            };
            
            await apiRequest('post', '/api/v2/generate', jobData);
            console.error('❌ Invalid server validation should have failed but succeeded');
            throw new Error('Validation should have failed with invalid server alias');
        } catch (error) {
            if (error.response && error.response.status === 404 && 
                error.response.data && error.response.data.error === 'server_not_found') {
                console.log('✅ Invalid server correctly rejected');
            } else {
                console.error('❌ Unexpected error with invalid server:', error.message);
                throw error;
            }
        }
    } catch (error) {
        console.error('❌ Job validation tests failed:', error.message);
        throw error;
    }
}

async function testJobStatus() {
    console.log('\n=== Testing Job Status Endpoint ===');
    
    if (!config.testJobId) {
        console.error('❌ Cannot test job status without a test job ID');
        throw new Error('Test job ID not available');
    }
    
    console.log(`Checking status of job ${config.testJobId}...`);
    try {
        const response = await apiRequest('get', `/api/v2/jobs/${config.testJobId}/status`);
        if (response.data && response.data.success && response.data.job) {
            console.log(`✅ Job status check successful. Status: ${response.data.job.status}`);
            
            // Verify all required fields are present
            const requiredFields = [
                'mobilesd_job_id', 'status', 'creation_timestamp', 'target_server_alias',
                'generation_params', 'app_type', 'source_info'
            ];
            
            const missingFields = requiredFields.filter(field => !response.data.job.hasOwnProperty(field));
            if (missingFields.length > 0) {
                console.error(`❌ Job status response missing required fields: ${missingFields.join(', ')}`);
                throw new Error('Job status response incomplete');
            } else {
                console.log('✅ Job status contains all required fields');
            }
        } else {
            console.error('❌ Job status response missing expected fields:', response.data);
            throw new Error('Invalid job status response');
        }
    } catch (error) {
        console.error('❌ Job status check failed:', error.message);
        throw error;
    }
    
    // Test error handling for non-existent job
    console.log('Testing non-existent job ID...');
    try {
        const nonExistentId = crypto.randomUUID();
        await apiRequest('get', `/api/v2/jobs/${nonExistentId}/status`);
        console.error('❌ Non-existent job check should have failed but succeeded');
        throw new Error('Job status should have failed with non-existent job ID');
    } catch (error) {
        if (error.response && error.response.status === 404 && 
            error.response.data && error.response.data.error === 'job_not_found') {
            console.log('✅ Non-existent job correctly rejected');
        } else {
            console.error('❌ Unexpected error with non-existent job:', error.message);
            throw error;
        }
    }
}

async function testJobListing() {
    console.log('\n=== Testing Job Listing Endpoint ===');
    
    console.log('Fetching all jobs...');
    try {
        const response = await apiRequest('get', '/api/v2/jobs');
        if (response.data && response.data.success && Array.isArray(response.data.jobs)) {
            console.log(`✅ Job listing successful. Found ${response.data.jobs.length} jobs`);
        } else {
            console.error('❌ Job listing response missing expected fields:', response.data);
            throw new Error('Invalid job listing response');
        }
    } catch (error) {
        console.error('❌ Job listing failed:', error.message);
        throw error;
    }
    
    console.log('Testing job filtering by app_type...');
    try {
        const response = await apiRequest('get', '/api/v2/jobs', null, { app_type: 'forge' });
        if (response.data && response.data.success && Array.isArray(response.data.jobs)) {
            console.log(`✅ Filtered job listing successful. Found ${response.data.jobs.length} forge jobs`);
            
            // Verify all returned jobs have app_type = 'forge'
            const nonForgeJobs = response.data.jobs.filter(job => job.app_type !== 'forge');
            if (nonForgeJobs.length > 0) {
                console.error(`❌ Found ${nonForgeJobs.length} jobs with app_type != 'forge'`);
                throw new Error('Job filtering not working correctly');
            } else {
                console.log('✅ All returned jobs have correct app_type');
            }
        } else {
            console.error('❌ Filtered job listing response missing expected fields:', response.data);
            throw new Error('Invalid filtered job listing response');
        }
    } catch (error) {
        console.error('❌ Filtered job listing failed:', error.message);
        throw error;
    }
}

async function testJobCancellation() {
    console.log('\n=== Testing Job Cancellation Endpoint ===');
    
    if (!config.testJobId) {
        console.error('❌ Cannot test job cancellation without a test job ID');
        throw new Error('Test job ID not available');
    }
    
    // Check job status first to see if it's cancellable
    let isCancellable = false;
    try {
        const response = await apiRequest('get', `/api/v2/jobs/${config.testJobId}/status`);
        if (response.data && response.data.job) {
            const status = response.data.job.status;
            isCancellable = (status === 'pending' || status === 'processing');
            console.log(`Current job status: ${status}, cancellable: ${isCancellable}`);
        }
    } catch (error) {
        console.error('❌ Failed to check job status before cancellation:', error.message);
        throw error;
    }
    
    if (isCancellable) {
        console.log(`Cancelling job ${config.testJobId}...`);
        try {
            const response = await apiRequest('post', `/api/v2/jobs/${config.testJobId}/cancel`);
            if (response.data && response.data.success && response.data.job && response.data.job.status === 'cancelled') {
                console.log('✅ Job cancellation successful');
            } else {
                console.error('❌ Job cancellation response missing expected fields:', response.data);
                throw new Error('Invalid job cancellation response');
            }
        } catch (error) {
            console.error('❌ Job cancellation failed:', error.message);
            throw error;
        }
    } else {
        console.log('Skipping cancellation test - job is already in non-cancellable state');
    }
    
    // Test error handling for invalid cancellation
    console.log('Testing invalid job cancellation...');
    try {
        // Try to cancel a non-existent job
        const nonExistentId = crypto.randomUUID();
        await apiRequest('post', `/api/v2/jobs/${nonExistentId}/cancel`);
        console.error('❌ Invalid cancellation should have failed but succeeded');
        throw new Error('Job cancellation should have failed with non-existent job ID');
    } catch (error) {
        if (error.response && error.response.status === 404 && 
            error.response.data && error.response.data.error === 'job_not_found') {
            console.log('✅ Invalid cancellation correctly rejected');
        } else {
            console.error('❌ Unexpected error with invalid cancellation:', error.message);
            throw error;
        }
    }
}

// Main test runner
async function runTests() {
    console.log('Starting API endpoint tests...');
    
    try {
        await setup();
        
        // Run test suites
        await testApiKeyAuthentication();
        await testJobSubmission();
        await testJobStatus();
        await testJobListing();
        await testJobCancellation();
        
        console.log('\n✅ All API endpoint tests passed!');
    } catch (error) {
        console.error('\n❌ API endpoint tests failed:', error.message);
        process.exit(1);
    } finally {
        await teardown();
    }
}

// Run tests if executed directly
if (require.main === module) {
    runTests();
}

module.exports = {
    runTests
}; 