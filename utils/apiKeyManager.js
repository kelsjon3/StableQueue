/**
 * API Key Manager
 * 
 * Handles the generation, validation, and management of API keys
 * for secure communication with the MobileSD API.
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const { columnExists } = require('./jobQueueHelpers');
const apiLogger = require('./apiLogger');

// --- Database Setup ---
const projectRootDir = path.join(__dirname, '..');
const dataDir = path.join(projectRootDir, 'data');
const dbPath = path.join(dataDir, 'mobilesd_jobs.sqlite');
const db = new Database(dbPath);

// Ensure api_keys table exists
function ensureApiKeysTable() {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'`).get();
    
    if (!tableExists) {
        console.log('Creating api_keys table...');
        db.exec(`
            CREATE TABLE api_keys (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                key TEXT NOT NULL,
                secret TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_used TEXT,
                is_active BOOLEAN DEFAULT 1,
                permissions TEXT,
                rate_limit_tier TEXT DEFAULT 'default',
                custom_rate_limits TEXT
            );
            
            CREATE INDEX idx_api_keys_key ON api_keys (key);
        `);
        console.log('api_keys table created successfully');
    }
}

// Call this at module initialization
ensureApiKeysTable();

/**
 * Generates a random string of specified length
 * @param {number} length - Length of the string to generate
 * @returns {string} Random string
 */
function generateRandomString(length = 32) {
    return crypto.randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length);
}

/**
 * Creates a new API key
 * @param {string} name - Name/description for the API key
 * @param {string} permissions - JSON string of permissions (optional)
 * @param {string} rateLimitTier - Rate limit tier (default, extended, unlimited)
 * @param {string} customRateLimits - JSON string of custom rate limits (optional)
 * @returns {object} The created API key record
 */
function createApiKey(name, permissions = '{}', rateLimitTier = 'default', customRateLimits = null) {
    if (!name) {
        throw new Error('API key name is required');
    }
    
    const id = uuidv4();
    const key = `mk_${generateRandomString(24)}`;  // prefix for easy identification
    const secret = generateRandomString(32);
    const now = new Date().toISOString();
    
    // Validate rate limit tier
    const validTiers = ['default', 'extended', 'unlimited'];
    const tier = validTiers.includes(rateLimitTier) ? rateLimitTier : 'default';
    
    // Insert the new API key
    const stmt = db.prepare(`
        INSERT INTO api_keys (id, name, key, secret, created_at, is_active, permissions, rate_limit_tier, custom_rate_limits)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);
    
    stmt.run(id, name, key, secret, now, permissions, tier, customRateLimits);
    
    return {
        id,
        name,
        key,
        secret,
        created_at: now,
        is_active: true,
        permissions,
        rate_limit_tier: tier,
        custom_rate_limits: customRateLimits
    };
}

/**
 * Gets all API keys (secrets are excluded from results)
 * @returns {Array<object>} Array of API key objects
 */
function getAllApiKeys() {
    const stmt = db.prepare(`
        SELECT id, name, key, created_at, last_used, is_active, permissions, rate_limit_tier, custom_rate_limits
        FROM api_keys
        ORDER BY created_at DESC
    `);
    
    return stmt.all();
}

/**
 * Gets an API key by its ID (including secret)
 * @param {string} id - API key ID
 * @returns {object|null} API key object or null if not found
 */
function getApiKeyById(id) {
    const stmt = db.prepare(`
        SELECT id, name, key, secret, created_at, last_used, is_active, permissions, rate_limit_tier, custom_rate_limits
        FROM api_keys
        WHERE id = ?
    `);
    
    return stmt.get(id);
}

/**
 * Validates an API key and secret
 * @param {string} key - API key
 * @param {string} secret - API secret
 * @returns {object|null} API key record if valid, null otherwise
 */
function validateApiKey(key, secret) {
    if (!key || !secret) {
        return null;
    }
    
    const stmt = db.prepare(`
        SELECT id, name, key, created_at, last_used, is_active, permissions, rate_limit_tier, custom_rate_limits
        FROM api_keys
        WHERE key = ? AND secret = ? AND is_active = 1
    `);
    
    return stmt.get(key, secret);
}

/**
 * Updates the last_used timestamp for an API key
 * @param {string} id - API key ID
 * @returns {boolean} True if successful, false otherwise
 */
function updateApiKeyLastUsed(id) {
    if (!id) return false;
    
    const now = new Date().toISOString();
    const stmt = db.prepare(`
        UPDATE api_keys
        SET last_used = ?
        WHERE id = ?
    `);
    
    const result = stmt.run(now, id);
    return result.changes > 0;
}

/**
 * Updates an API key's status or permissions
 * @param {string} id - API key ID
 * @param {object} updates - Object containing fields to update
 * @returns {object|null} Updated API key object or null if not found
 */
function updateApiKey(id, updates) {
    const allowedFields = ['is_active', 'permissions', 'name', 'rate_limit_tier', 'custom_rate_limits'];
    const validUpdates = {};
    
    // Filter only allowed fields
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            validUpdates[field] = updates[field];
        }
    }
    
    if (Object.keys(validUpdates).length === 0) {
        return null;
    }
    
    // Validate rate limit tier if provided
    if (validUpdates.rate_limit_tier !== undefined) {
        const validTiers = ['default', 'extended', 'unlimited'];
        if (!validTiers.includes(validUpdates.rate_limit_tier)) {
            validUpdates.rate_limit_tier = 'default';
        }
    }
    
    // Build the update SQL
    const setClauses = Object.keys(validUpdates).map(field => `${field} = ?`).join(', ');
    const values = Object.values(validUpdates);
    values.push(id); // Add ID for WHERE clause
    
    const sql = `
        UPDATE api_keys
        SET ${setClauses}
        WHERE id = ?
    `;
    
    const stmt = db.prepare(sql);
    const result = stmt.run(...values);
    
    if (result.changes > 0) {
        return getApiKeyById(id);
    }
    
    return null;
}

/**
 * Deletes an API key
 * @param {string} id - API key ID
 * @returns {boolean} True if successful, false otherwise
 */
function deleteApiKey(id) {
    const stmt = db.prepare(`
        DELETE FROM api_keys
        WHERE id = ?
    `);
    
    const result = stmt.run(id);
    return result.changes > 0;
}

/**
 * Creates a middleware function for API key authentication
 * @returns {Function} Express middleware function
 */
function createApiKeyAuthMiddleware() {
    return function apiKeyAuth(req, res, next) {
        const apiKey = req.headers['x-api-key'];
        const apiSecret = req.headers['x-api-secret'];
        
        // Log the authentication attempt with safe request information
        const requestInfo = apiLogger.getSafeRequestInfo(req);
        
        if (!apiKey || !apiSecret) {
            // Log failed authentication due to missing credentials
            apiLogger.logApiAuth('Authentication failed: Missing API key or secret', {
                reason: 'missing_credentials',
                request: requestInfo
            });
            
            return res.status(401).json({ 
                error: 'API key and secret are required',
                message: 'Authentication failed: API key and secret must be provided in the X-API-Key and X-API-Secret headers'
            });
        }
        
        // Validate against database
        const keyRecord = validateApiKey(apiKey, apiSecret);
        if (!keyRecord) {
            // Log failed authentication due to invalid credentials
            apiLogger.logApiAuth('Authentication failed: Invalid API credentials', {
                reason: 'invalid_credentials',
                request: requestInfo,
                provided_key: apiKey
            });
            
            return res.status(401).json({ 
                error: 'Invalid API credentials',
                message: 'Authentication failed: The provided API key and secret are invalid or inactive'
            });
        }
        
        // Authentication successful
        // Update last_used timestamp
        updateApiKeyLastUsed(keyRecord.id);
        
        // Log successful authentication
        apiLogger.logApiAuth('Authentication successful', {
            key_id: keyRecord.id,
            key_name: keyRecord.name,
            request: requestInfo
        });
        
        // Add API key information to the request for use in route handlers
        req.apiKeyId = keyRecord.id;
        
        // Parse permissions if available
        try {
            req.apiKeyPermissions = JSON.parse(keyRecord.permissions || '{}');
        } catch (error) {
            console.error('Error parsing API key permissions:', error);
            req.apiKeyPermissions = {};
        }
        
        // Add rate limiting information
        req.apiKeyRateLimitTier = keyRecord.rate_limit_tier || 'default';
        
        // Parse custom rate limits if available
        if (keyRecord.custom_rate_limits) {
            try {
                req.apiKeyCustomRateLimits = JSON.parse(keyRecord.custom_rate_limits);
            } catch (error) {
                console.error('Error parsing custom rate limits:', error);
                req.apiKeyCustomRateLimits = null;
            }
        }
        
        next();
    };
}

// For testing purposes
function closeDb() {
    db.close();
}

module.exports = {
    createApiKey,
    getAllApiKeys,
    getApiKeyById,
    validateApiKey,
    updateApiKey,
    deleteApiKey,
    createApiKeyAuthMiddleware,
    closeDb
}; 