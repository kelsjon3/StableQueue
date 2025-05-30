/**
 * API Middleware
 * 
 * Centralizes API middleware functions including authentication and rate limiting
 */

const { createApiKeyAuthMiddleware } = require('../utils/apiKeyManager');
const { 
    globalRateLimiter, 
    authRateLimiter, 
    jobSubmissionRateLimiter, 
    dynamicRateLimiter 
} = require('../utils/apiRateLimiter');

// Create the authentication middleware
const apiKeyAuth = createApiKeyAuthMiddleware();

/**
 * CORS middleware to allow requests from Forge extension and other local development tools
 */
const corsMiddleware = (req, res, next) => {
    // Allow requests from any localhost port (common for development)
    const origin = req.headers.origin;
    if (origin && (
        origin.startsWith('http://localhost:') || 
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('https://localhost:') || 
        origin.startsWith('https://127.0.0.1:')
    )) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key, X-API-Secret');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
};

/**
 * Combines CORS, API key authentication and global rate limiting
 * For general API endpoints
 */
const apiAuthWithRateLimit = [
    corsMiddleware,     // Handle CORS first
    globalRateLimiter,  // Apply global rate limiting
    apiKeyAuth,         // Then authenticate the request
    dynamicRateLimiter  // Finally apply specific rate limits based on API key permissions
];

/**
 * Combines CORS, API key authentication and stricter rate limiting
 * For sensitive endpoints like authentication
 */
const apiAuthWithAuthRateLimit = [
    corsMiddleware,   // Handle CORS first
    authRateLimiter,  // Apply strict rate limiting for auth endpoints
    apiKeyAuth
];

/**
 * Combines CORS, API key authentication and job submission rate limiting
 * For endpoints that add jobs to the queue
 */
const apiAuthWithJobRateLimit = [
    corsMiddleware,          // Handle CORS first
    globalRateLimiter,       // Apply global rate limiting
    apiKeyAuth,              // Then authenticate the request
    jobSubmissionRateLimiter // Finally apply job-specific rate limits
];

/**
 * Applies CORS and global rate limiting without authentication
 * For public endpoints that still need abuse protection
 */
const publicWithRateLimit = [
    corsMiddleware,   // Handle CORS first
    globalRateLimiter
];

module.exports = {
    corsMiddleware,
    apiKeyAuth,
    apiAuthWithRateLimit,
    apiAuthWithAuthRateLimit,
    apiAuthWithJobRateLimit,
    publicWithRateLimit
}; 