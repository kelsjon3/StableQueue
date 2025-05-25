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
 * Combines API key authentication and global rate limiting
 * For general API endpoints
 */
const apiAuthWithRateLimit = [
    globalRateLimiter,  // Apply global rate limiting first
    apiKeyAuth,         // Then authenticate the request
    dynamicRateLimiter  // Finally apply specific rate limits based on API key permissions
];

/**
 * Combines API key authentication and stricter rate limiting
 * For sensitive endpoints like authentication
 */
const apiAuthWithAuthRateLimit = [
    authRateLimiter,  // Apply strict rate limiting for auth endpoints
    apiKeyAuth
];

/**
 * Combines API key authentication and job submission rate limiting
 * For endpoints that add jobs to the queue
 */
const apiAuthWithJobRateLimit = [
    globalRateLimiter,       // Apply global rate limiting first
    apiKeyAuth,              // Then authenticate the request
    jobSubmissionRateLimiter // Finally apply job-specific rate limits
];

/**
 * Applies only global rate limiting without authentication
 * For public endpoints that still need abuse protection
 */
const publicWithRateLimit = [
    globalRateLimiter
];

module.exports = {
    apiKeyAuth,
    apiAuthWithRateLimit,
    apiAuthWithAuthRateLimit,
    apiAuthWithJobRateLimit,
    publicWithRateLimit
}; 