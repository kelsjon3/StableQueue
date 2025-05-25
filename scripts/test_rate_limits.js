/**
 * Test Rate Limits
 * 
 * This script tests the rate limiting functionality by sending 
 * multiple rapid requests to the API to trigger rate limits.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_DATA_PATH = path.join(__dirname, '..', 'data', 'test_api_key.json');

// Get test key data (or create a test request with no authentication)
let testKey = null;
try {
    if (fs.existsSync(TEST_DATA_PATH)) {
        testKey = JSON.parse(fs.readFileSync(TEST_DATA_PATH, 'utf8'));
        console.log('Using test API key from:', TEST_DATA_PATH);
    } else {
        console.log('No test API key found. Will test rate limiting for unauthenticated requests.');
    }
} catch (error) {
    console.error('Error reading test API key:', error.message);
}

// Create axios instance with authorization headers if test key exists
const api = axios.create({
    baseURL: BASE_URL,
    headers: testKey ? {
        'X-API-Key': testKey.key,
        'X-API-Secret': testKey.secret,
        'Content-Type': 'application/json'
    } : {
        'Content-Type': 'application/json'
    }
});

// Function to make a single API request
async function makeApiRequest(endpoint) {
    try {
        const response = await api.get(endpoint);
        return { success: true, status: response.status, data: response.data };
    } catch (error) {
        // Handle rate limit errors
        return { 
            success: false, 
            status: error.response?.status, 
            data: error.response?.data,
            message: error.message
        };
    }
}

// Test regular API rate limiting
async function testRegularRateLimiting() {
    console.log('\n=== Testing Regular API Rate Limiting ===');
    console.log('Making rapid requests to test rate limiting...');
    
    const endpoint = '/api/v1/servers';
    const requests = 15; // Number of requests to send
    const results = [];
    
    for (let i = 0; i < requests; i++) {
        console.log(`Request ${i+1}/${requests}...`);
        const result = await makeApiRequest(endpoint);
        results.push(result);
        
        // Log result
        if (result.success) {
            console.log(`  ✓ Request succeeded (${result.status})`);
        } else {
            console.log(`  ✗ Request failed (${result.status}): ${result.data?.error || result.message}`);
            
            // If rate limited, show details
            if (result.status === 429) {
                console.log('  Rate limit triggered!');
                console.log('  Message:', result.data?.message);
                
                // Check for rate limit headers
                if (result.headers && result.headers['retry-after']) {
                    console.log('  Retry after:', result.headers['retry-after']);
                }
                
                // No need to continue if we hit the rate limit
                break;
            }
        }
        
        // Small delay to see individual requests
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Summarize results
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const rateLimited = results.filter(r => r.status === 429).length;
    
    console.log('\nResults:');
    console.log(`- Total requests: ${results.length}`);
    console.log(`- Successful: ${succeeded}`);
    console.log(`- Failed: ${failed}`);
    console.log(`- Rate limited: ${rateLimited}`);
}

// Test job submission rate limiting
async function testJobSubmissionRateLimiting() {
    console.log('\n=== Testing Job Submission Rate Limiting ===');
    console.log('Making rapid job submission requests...');
    
    if (!testKey) {
        console.log('Skipping job submission test - requires authentication');
        return;
    }
    
    const endpoint = '/api/v2/generate';
    const requests = 25; // Number of requests to send
    const results = [];
    
    const testJobPayload = {
        target_server_alias: "Laptop", // Adjust to a server that exists in your config
        app_type: "forge",
        generation_params: {
            prompt: "Test rate limiting, landscape with mountains",
            negative_prompt: "ugly, blurry",
            width: 512,
            height: 512,
            steps: 20,
            cfg_scale: 7,
            checkpoint_name: "dreamshaper_8.safetensors"
        }
    };
    
    for (let i = 0; i < requests; i++) {
        console.log(`Request ${i+1}/${requests}...`);
        
        try {
            const response = await api.post(endpoint, testJobPayload);
            results.push({ 
                success: true, 
                status: response.status, 
                data: response.data,
                job_id: response.data.mobilesd_job_id
            });
            console.log(`  ✓ Job submitted: ${response.data.mobilesd_job_id}`);
        } catch (error) {
            results.push({ 
                success: false, 
                status: error.response?.status, 
                data: error.response?.data,
                message: error.message
            });
            
            console.log(`  ✗ Request failed (${error.response?.status}): ${error.response?.data?.error || error.message}`);
            
            // If rate limited, show details
            if (error.response?.status === 429) {
                console.log('  Rate limit triggered!');
                console.log('  Message:', error.response?.data?.message);
                
                // No need to continue if we hit the rate limit
                break;
            }
        }
        
        // Small delay to see individual requests
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Summarize results
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const rateLimited = results.filter(r => r.status === 429).length;
    
    console.log('\nResults:');
    console.log(`- Total requests: ${results.length}`);
    console.log(`- Successful: ${succeeded}`);
    console.log(`- Failed: ${failed}`);
    console.log(`- Rate limited: ${rateLimited}`);
    
    if (succeeded > 0) {
        console.log('\nSubmitted job IDs:');
        results.filter(r => r.success).forEach((r, i) => {
            console.log(`${i+1}. ${r.job_id}`);
        });
    }
}

// Run all tests
async function runTests() {
    console.log('=== Rate Limiting Test ===');
    console.log('API URL:', BASE_URL);
    console.log('Using API key:', testKey ? 'Yes' : 'No');
    
    try {
        await testRegularRateLimiting();
        await testJobSubmissionRateLimiting();
        
        console.log('\n=== All Tests Completed ===');
    } catch (error) {
        console.error('\nTest failed with error:', error);
    }
}

// Run the tests
runTests(); 