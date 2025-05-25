/**
 * Stress Test API
 * 
 * This script makes multiple rapid requests to test rate limiting on the API.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = process.env.API_URL || 'http://192.168.73.124:8083';
const REQUESTS_COUNT = parseInt(process.env.REQUESTS_COUNT || 30, 10);
const REQUEST_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || 50, 10);
const AGGRESSIVE_MODE = process.env.AGGRESSIVE_MODE === 'true';

// API endpoints to test
const ENDPOINTS = [
    '/api/v1/servers', // Regular endpoint
    '/status',         // Status endpoint - might not be rate limited
];

// For aggressive mode, we send many more requests to the first endpoint
if (AGGRESSIVE_MODE) {
    console.log('AGGRESSIVE MODE ENABLED - will attempt to trigger rate limits');
}

/**
 * Make multiple requests to an endpoint rapidly
 */
async function stressTestEndpoint(endpoint, requestCount = REQUESTS_COUNT, delayMs = REQUEST_DELAY_MS) {
    console.log(`\n=== Testing rate limiting on ${endpoint} ===`);
    console.log(`Making ${requestCount} rapid requests with ${delayMs}ms delay...`);
    
    let successCount = 0;
    let failureCount = 0;
    let rateLimitedCount = 0;
    
    const results = [];
    
    for (let i = 0; i < requestCount; i++) {
        try {
            console.log(`Request ${i+1}/${requestCount}...`);
            const startTime = Date.now();
            const response = await axios.get(`${BASE_URL}${endpoint}`);
            const endTime = Date.now();
            
            successCount++;
            results.push({
                success: true,
                status: response.status,
                time: endTime - startTime
            });
            
            console.log(`  ✓ Success (${response.status}) in ${endTime - startTime}ms`);
            
            // Check for rate limit headers
            const rateLimitRemaining = response.headers['x-ratelimit-remaining'] || 
                                      response.headers['ratelimit-remaining'];
            if (rateLimitRemaining) {
                console.log(`  Rate limit remaining: ${rateLimitRemaining}`);
            }
        } catch (error) {
            const status = error.response?.status || 0;
            const message = error.response?.data?.error || error.message;
            
            console.log(`  ✗ Failed (${status}): ${message}`);
            
            if (status === 429) {
                rateLimitedCount++;
                console.log('  Rate limit triggered!');
                
                // Show retry-after information if available
                const retryAfter = error.response?.headers?.['retry-after'];
                if (retryAfter) {
                    console.log(`  Retry after: ${retryAfter} seconds`);
                }
                
                // Show rate limit headers if available
                const rateLimitLimit = error.response?.headers?.['ratelimit-limit'];
                const rateLimitReset = error.response?.headers?.['ratelimit-reset'];
                
                if (rateLimitLimit) {
                    console.log(`  Rate limit: ${rateLimitLimit}`);
                }
                if (rateLimitReset) {
                    console.log(`  Rate limit reset: ${rateLimitReset}`);
                }
                
                // If aggressive mode, continue making requests to see how rate limit behaves
                if (!AGGRESSIVE_MODE) {
                    break; // Stop after hitting rate limit in normal mode
                }
            } else {
                failureCount++;
            }
            
            results.push({
                success: false,
                status: status,
                error: message
            });
        }
        
        // Brief delay between requests
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    // Print summary
    console.log("\nResults:");
    console.log(`Total requests: ${results.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failureCount}`);
    console.log(`Rate limited: ${rateLimitedCount}`);
    
    // Calculate performance metrics if we have successful requests
    if (successCount > 0) {
        const successTimes = results
            .filter(r => r.success)
            .map(r => r.time);
        
        const avgTime = successTimes.reduce((a, b) => a + b, 0) / successTimes.length;
        const minTime = Math.min(...successTimes);
        const maxTime = Math.max(...successTimes);
        
        console.log("\nPerformance:");
        console.log(`Average response time: ${avgTime.toFixed(2)}ms`);
        console.log(`Minimum response time: ${minTime}ms`);
        console.log(`Maximum response time: ${maxTime}ms`);
    }
    
    return { successCount, failureCount, rateLimitedCount, results };
}

/**
 * Run the full test suite
 */
async function runTests() {
    console.log('=== API Rate Limiting Stress Test ===');
    console.log('Server URL:', BASE_URL);
    console.log('Requests per endpoint:', REQUESTS_COUNT);
    console.log('Delay between requests:', REQUEST_DELAY_MS, 'ms');
    console.log('Aggressive mode:', AGGRESSIVE_MODE ? 'ENABLED' : 'DISABLED');
    
    const startTime = Date.now();
    
    // In aggressive mode, send 600 requests to the first endpoint to try to hit rate limit
    if (AGGRESSIVE_MODE && ENDPOINTS.length > 0) {
        await stressTestEndpoint(ENDPOINTS[0], 600, 1); // Aggressive - 600 requests with 1ms delay
        
        // Continue with the rest of the endpoints as normal
        for (let i = 1; i < ENDPOINTS.length; i++) {
            await stressTestEndpoint(ENDPOINTS[i]);
        }
    } else {
        // Normal mode - test all endpoints with the configured parameters
        for (const endpoint of ENDPOINTS) {
            await stressTestEndpoint(endpoint);
        }
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`\n=== All tests completed in ${totalTime}ms ===`);
}

runTests().catch(error => {
    console.error('Test failed with error:', error);
}); 