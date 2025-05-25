const express = require('express');
const router = express.Router();
const apiKeyManager = require('../utils/apiKeyManager');
const apiLogger = require('../utils/apiLogger');
const { apiAuthWithAuthRateLimit } = require('../middleware/apiMiddleware');

// Apply authentication to protected routes only
// We'll apply it individually to routes that need protection

/**
 * @route GET /api/v1/api-keys
 * @description Get all API keys (without secrets)
 * @access Admin only
 */
router.get('/', apiAuthWithAuthRateLimit, (req, res) => {
    try {
        const apiKeys = apiKeyManager.getAllApiKeys();
        
        // Add self-links for API
        const keysWithLinks = apiKeys.map(key => ({
            ...key,
            _links: {
                self: `/api/v1/api-keys/${key.id}`
            }
        }));
        
        // Log the API key listing operation
        apiLogger.logApiAccess('API keys listing', {
            request: apiLogger.getSafeRequestInfo(req),
            count: keysWithLinks.length
        });
        
        res.status(200).json({ 
            success: true,
            count: keysWithLinks.length,
            api_keys: keysWithLinks
        });
    } catch (error) {
        console.error('[API Keys] Error fetching API keys:', error);
        
        // Log the error
        apiLogger.logApiError('Failed to fetch API keys', {
            request: apiLogger.getSafeRequestInfo(req),
            error: 'fetch_error',
            errorMessage: error.message
        });
        
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch API keys',
            message: error.message
        });
    }
});

/**
 * @route POST /api/v1/api-keys
 * @description Create a new API key
 * @access Public (for initial setup), then Admin only
 */
router.post('/', (req, res) => {
    try {
        const { name, permissions, rate_limit_tier, custom_rate_limits } = req.body;
        const requestInfo = apiLogger.getSafeRequestInfo(req);
        
        // Check if this is the first API key - if not, require authentication
        const existingKeys = apiKeyManager.getAllApiKeys();
        if (existingKeys.length > 0) {
            // Not the first key, check for authentication
            const apiKey = req.headers['x-api-key'];
            const apiSecret = req.headers['x-api-secret'];
            
            if (!apiKey || !apiSecret) {
                // Authentication required for subsequent keys
                apiLogger.logApiError('Authentication required for API key creation', {
                    request: requestInfo,
                    error: 'auth_required'
                });
                
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required',
                    message: 'API keys already exist. Authentication required to create additional keys.'
                });
            }
            
            // Validate the provided credentials
            const keyRecord = apiKeyManager.validateApiKey(apiKey, apiSecret);
            if (!keyRecord) {
                apiLogger.logApiError('Invalid credentials for API key creation', {
                    request: requestInfo,
                    error: 'invalid_credentials'
                });
                
                return res.status(401).json({
                    success: false,
                    error: 'Invalid credentials',
                    message: 'The provided API key and secret are invalid.'
                });
            }
        }
        
        if (!name) {
            // Log validation error
            apiLogger.logApiError('Missing API key name', {
                request: requestInfo,
                error: 'missing_name'
            });
            
            return res.status(400).json({ 
                success: false, 
                error: 'API key name is required'
            });
        }
        
        // Validate rate limit tier if provided
        const validTiers = ['default', 'extended', 'unlimited'];
        const selectedTier = validTiers.includes(rate_limit_tier) ? rate_limit_tier : 'default';
        
        // Create the API key
        const apiKey = apiKeyManager.createApiKey(
            name, 
            permissions ? JSON.stringify(permissions) : '{}',
            selectedTier,
            custom_rate_limits ? JSON.stringify(custom_rate_limits) : null
        );
        
        // Log the API key creation
        apiLogger.logApiAccess('API key created', {
            request: requestInfo,
            key_id: apiKey.id,
            key_name: apiKey.name,
            rate_limit_tier: apiKey.rate_limit_tier
        });
        
        // IMPORTANT: This is the only time the secret will be returned
        res.status(201).json({
            success: true,
            message: 'API key created successfully. Save the secret now - it will never be shown again.',
            api_key: {
                id: apiKey.id,
                name: apiKey.name,
                key: apiKey.key,
                secret: apiKey.secret, // Only returned on creation
                created_at: apiKey.created_at,
                is_active: apiKey.is_active,
                permissions: apiKey.permissions,
                rate_limit_tier: apiKey.rate_limit_tier,
                custom_rate_limits: apiKey.custom_rate_limits,
                _links: {
                    self: `/api/v1/api-keys/${apiKey.id}`
                }
            }
        });
    } catch (error) {
        console.error('[API Keys] Error creating API key:', error);
        
        // Log the error
        apiLogger.logApiError('Failed to create API key', {
            request: apiLogger.getSafeRequestInfo(req),
            error: 'creation_error',
            errorMessage: error.message
        });
        
        res.status(500).json({ 
            success: false, 
            error: 'Failed to create API key',
            message: error.message
        });
    }
});

/**
 * @route GET /api/v1/api-keys/:id
 * @description Get a specific API key by ID (without secret)
 * @access Admin only
 */
router.get('/:id', apiAuthWithAuthRateLimit, (req, res) => {
    try {
        const { id } = req.params;
        const requestInfo = apiLogger.getSafeRequestInfo(req);
        
        if (!id) {
            // Log validation error
            apiLogger.logApiError('Missing API key ID', {
                request: requestInfo,
                error: 'missing_id'
            });
            
            return res.status(400).json({ 
                success: false, 
                error: 'API key ID is required'
            });
        }
        
        const apiKey = apiKeyManager.getApiKeyById(id);
        
        if (!apiKey) {
            // Log not found error
            apiLogger.logApiError(`API key with ID ${id} not found`, {
                request: requestInfo,
                error: 'key_not_found',
                key_id: id
            });
            
            return res.status(404).json({ 
                success: false, 
                error: `API key with ID ${id} not found`
            });
        }
        
        // Log the API key retrieval
        apiLogger.logApiAccess('API key retrieved', {
            request: requestInfo,
            key_id: apiKey.id,
            key_name: apiKey.name
        });
        
        // Never return the secret
        const { secret, ...apiKeyWithoutSecret } = apiKey;
        
        res.status(200).json({
            success: true,
            api_key: {
                ...apiKeyWithoutSecret,
                _links: {
                    self: `/api/v1/api-keys/${apiKey.id}`
                }
            }
        });
    } catch (error) {
        console.error(`[API Keys] Error fetching API key ${req.params.id}:`, error);
        
        // Log the error
        apiLogger.logApiError('Failed to fetch API key', {
            request: apiLogger.getSafeRequestInfo(req),
            error: 'fetch_error',
            key_id: req.params.id,
            errorMessage: error.message
        });
        
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch API key',
            message: error.message
        });
    }
});

/**
 * @route PUT /api/v1/api-keys/:id
 * @description Update an API key (name, active status, permissions, or rate limits)
 * @access Admin only
 */
router.put('/:id', apiAuthWithAuthRateLimit, (req, res) => {
    try {
        const { id } = req.params;
        const { name, is_active, permissions, rate_limit_tier, custom_rate_limits } = req.body;
        const requestInfo = apiLogger.getSafeRequestInfo(req);
        
        if (!id) {
            // Log validation error
            apiLogger.logApiError('Missing API key ID', {
                request: requestInfo,
                error: 'missing_id'
            });
            
            return res.status(400).json({ 
                success: false, 
                error: 'API key ID is required'
            });
        }
        
        // Check if API key exists
        const existingKey = apiKeyManager.getApiKeyById(id);
        
        if (!existingKey) {
            // Log not found error
            apiLogger.logApiError(`API key with ID ${id} not found`, {
                request: requestInfo,
                error: 'key_not_found',
                key_id: id
            });
            
            return res.status(404).json({ 
                success: false, 
                error: `API key with ID ${id} not found`
            });
        }
        
        // Update the API key
        const updates = {};
        
        if (name !== undefined) updates.name = name;
        if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;
        if (permissions !== undefined) updates.permissions = JSON.stringify(permissions);
        if (rate_limit_tier !== undefined) updates.rate_limit_tier = rate_limit_tier;
        if (custom_rate_limits !== undefined) {
            updates.custom_rate_limits = custom_rate_limits ? JSON.stringify(custom_rate_limits) : null;
        }
        
        const updatedKey = apiKeyManager.updateApiKey(id, updates);
        
        if (!updatedKey) {
            // Log update error
            apiLogger.logApiError(`Failed to update API key ${id}`, {
                request: requestInfo,
                error: 'update_failed',
                key_id: id
            });
            
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to update API key'
            });
        }
        
        // Log the API key update
        apiLogger.logApiAccess('API key updated', {
            request: requestInfo,
            key_id: updatedKey.id,
            key_name: updatedKey.name,
            updates: Object.keys(updates).join(', ')
        });
        
        // Never return the secret
        const { secret, ...apiKeyWithoutSecret } = updatedKey;
        
        res.status(200).json({
            success: true,
            message: 'API key updated successfully',
            api_key: {
                ...apiKeyWithoutSecret,
                _links: {
                    self: `/api/v1/api-keys/${updatedKey.id}`
                }
            }
        });
    } catch (error) {
        console.error(`[API Keys] Error updating API key ${req.params.id}:`, error);
        
        // Log the error
        apiLogger.logApiError('Failed to update API key', {
            request: apiLogger.getSafeRequestInfo(req),
            error: 'update_error',
            key_id: req.params.id,
            errorMessage: error.message
        });
        
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update API key',
            message: error.message
        });
    }
});

/**
 * @route DELETE /api/v1/api-keys/:id
 * @description Delete an API key
 * @access Admin only
 */
router.delete('/:id', apiAuthWithAuthRateLimit, (req, res) => {
    try {
        const { id } = req.params;
        const requestInfo = apiLogger.getSafeRequestInfo(req);
        
        if (!id) {
            // Log validation error
            apiLogger.logApiError('Missing API key ID', {
                request: requestInfo,
                error: 'missing_id'
            });
            
            return res.status(400).json({ 
                success: false, 
                error: 'API key ID is required'
            });
        }
        
        // Check if API key exists
        const existingKey = apiKeyManager.getApiKeyById(id);
        
        if (!existingKey) {
            // Log not found error
            apiLogger.logApiError(`API key with ID ${id} not found`, {
                request: requestInfo,
                error: 'key_not_found',
                key_id: id
            });
            
            return res.status(404).json({ 
                success: false, 
                error: `API key with ID ${id} not found`
            });
        }
        
        // Delete the API key
        const deleted = apiKeyManager.deleteApiKey(id);
        
        if (!deleted) {
            // Log deletion error
            apiLogger.logApiError('Failed to delete API key', {
                request: requestInfo,
                error: 'deletion_failed',
                key_id: id
            });
            
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to delete API key'
            });
        }
        
        // Log the API key deletion
        apiLogger.logApiAccess('API key deleted', {
            request: requestInfo,
            key_id: id,
            key_name: existingKey.name
        });
        
        res.status(200).json({
            success: true,
            message: `API key "${existingKey.name}" (${id}) deleted successfully`
        });
    } catch (error) {
        console.error(`[API Keys] Error deleting API key ${req.params.id}:`, error);
        
        // Log the error
        apiLogger.logApiError('Failed to delete API key', {
            request: apiLogger.getSafeRequestInfo(req),
            error: 'deletion_error',
            key_id: req.params.id,
            errorMessage: error.message
        });
        
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete API key',
            message: error.message
        });
    }
});

module.exports = router; 