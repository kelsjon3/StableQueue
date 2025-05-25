/**
 * API Rate Limiter
 * 
 * Provides rate limiting functionality for API endpoints based on API keys.
 * Uses express-rate-limit library with a custom store to track limits per API key.
 */

const rateLimit = require('express-rate-limit');
const apiLogger = require('./apiLogger');

// In-memory store for rate limits
// For production, consider using redis or another shared store
const limitTracker = new Map();

/**
 * Custom keyGenerator function that uses API key ID as the rate limit key
 * Falls back to IP address if no API key is present
 * @param {object} req - Express request object
 * @returns {string} The key to use for rate limiting
 */
const apiKeyBasedKeyGenerator = (req) => {
    // If authenticated with an API key, use the API key ID
    if (req.apiKeyId) {
        return `api-key:${req.apiKeyId}`;
    }
    
    // Fall back to IP address
    return req.ip || 
        req.connection.remoteAddress || 
        req.socket.remoteAddress || 
        req.connection.socket.remoteAddress || 
        'unknown';
};

/**
 * Creates rate limiting middleware with customizable limits
 * @param {Object} options - Rate limiting options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum number of requests in the time window
 * @param {string} options.message - Error message when rate limit is exceeded
 * @returns {Function} Express middleware
 */
function createRateLimiter(options = {}) {
    const defaultOptions = {
        windowMs: 15 * 60 * 1000, // 15 minutes by default
        max: 100, // 100 requests per windowMs by default
        message: {
            success: false,
            error: 'Too many requests, please try again later',
            message: 'API rate limit exceeded'
        },
        standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
        legacyHeaders: false, // Disable the `X-RateLimit-*` headers
        keyGenerator: apiKeyBasedKeyGenerator,
        // Log rate limit hits
        handler: (req, res, next, options) => {
            const apiKeyId = req.apiKeyId || 'anonymous';
            
            apiLogger.logApiError('Rate limit exceeded', {
                request: apiLogger.getSafeRequestInfo(req),
                rate_limit: {
                    apiKeyId,
                    windowMs: options.windowMs,
                    max: options.max,
                    remaining: 0 // 0 remaining when hitting the limit
                }
            });
            
            res.status(options.statusCode).json(options.message);
        },
        // Called when a request is received
        onLimitReached: (req, res, options) => {
            const apiKeyId = req.apiKeyId || 'anonymous';
            
            apiLogger.logApiError('Rate limit reached', {
                request: apiLogger.getSafeRequestInfo(req),
                rate_limit: {
                    apiKeyId,
                    windowMs: options.windowMs,
                    max: options.max
                }
            });
        }
    };
    
    const limiterOptions = { ...defaultOptions, ...options };
    return rateLimit(limiterOptions);
}

/**
 * Creates dynamic rate limiter that adjusts limits based on API key permissions
 * @returns {Function} Express middleware
 */
function createDynamicRateLimiter() {
    // Default rate limits
    const defaultLimits = {
        anonymous: { windowMs: 5 * 60 * 1000, max: 10 }, // 10 requests per 5 minutes for anonymous
        default: { windowMs: 15 * 60 * 1000, max: 100 },  // 100 requests per 15 minutes by default
        extended: { windowMs: 15 * 60 * 1000, max: 300 }, // 300 requests per 15 minutes for extended
        unlimited: { windowMs: 15 * 60 * 1000, max: 1000 } // 1000 requests per 15 minutes for unlimited
    };
    
    // Store the limiters for different permission levels
    const limiters = {
        anonymous: createRateLimiter(defaultLimits.anonymous),
        default: createRateLimiter(defaultLimits.default),
        extended: createRateLimiter(defaultLimits.extended),
        unlimited: createRateLimiter(defaultLimits.unlimited)
    };
    
    // Middleware that selects the appropriate limiter based on API key permissions
    return (req, res, next) => {
        // If no API key, use anonymous limiter
        if (!req.apiKeyId) {
            return limiters.anonymous(req, res, next);
        }
        
        // Get the rate limit tier from API key permissions
        let tierName = 'default';
        
        try {
            // Try to parse permissions if available
            if (req.apiKeyPermissions && req.apiKeyPermissions.rate_limit_tier) {
                tierName = req.apiKeyPermissions.rate_limit_tier;
            }
        } catch (error) {
            console.error('Error parsing API key permissions:', error);
        }
        
        // Use the appropriate limiter or fall back to default
        const limiter = limiters[tierName] || limiters.default;
        return limiter(req, res, next);
    };
}

/**
 * Global rate limiter for all API endpoints
 * Provides basic protection against abuse
 */
const globalRateLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 500, // 500 requests per 5 minutes
    message: {
        success: false,
        error: 'Too many requests from this IP, please try again later',
        message: 'Global API rate limit exceeded'
    }
});

/**
 * More strict rate limiter for authentication endpoints
 * Prevents brute force attacks
 */
const authRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per 15 minutes
    message: {
        success: false,
        error: 'Too many authentication attempts, please try again later',
        message: 'Authentication rate limit exceeded'
    }
});

/**
 * Rate limiter for job submission endpoints
 * Prevents abuse of job queue
 */
const jobSubmissionRateLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 20, // 20 job submissions per 10 minutes
    message: {
        success: false,
        error: 'Too many job submissions, please try again later',
        message: 'Job submission rate limit exceeded'
    }
});

/**
 * Dynamic rate limiter that adjusts based on API key permissions
 */
const dynamicRateLimiter = createDynamicRateLimiter();

module.exports = {
    globalRateLimiter,
    authRateLimiter,
    jobSubmissionRateLimiter,
    dynamicRateLimiter,
    createRateLimiter // Export for custom rate limiters
}; 