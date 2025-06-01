const express = require('express');
const router = express.Router();
const apiKeyManager = require('../utils/apiKeyManager');
const apiLogger = require('../utils/apiLogger');
const { corsMiddleware } = require('../middleware/apiMiddleware');

/**
 * @route GET /api/v1/api-keys
 * @description Get all API keys (without secrets)
 * @access Admin (Web UI) - No authentication required since this is the management interface
 */
router.get('/', corsMiddleware, (req, res) => {
    try {
        const apiKeys = apiKeyManager.getAllApiKeys();
        
        // The web UI has administrative access to view API keys without authentication
        // API keys are FOR external applications, not for the web UI itself
        
        // Add self-links for API
        const keysWithLinks = apiKeys.map(key => ({
            ...key,
            _links: {
                self: `/api/v1/api-keys/${key.id}`,
                update: `/api/v1/api-keys/${key.id}`,
                delete: `/api/v1/api-keys/${key.id}`
            }
        }));
        
        res.status(200).json({
            success: true,
            api_keys: keysWithLinks,
            count: keysWithLinks.length
        });
    } catch (error) {
        console.error('[API Keys] Error getting API keys:', error);
        
        // Log the error
        apiLogger.logApiError('Failed to get API keys', {
            request: apiLogger.getSafeRequestInfo(req),
            error: 'get_keys_error',
            errorMessage: error.message
        });
        
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get API keys',
            message: error.message
        });
    }
});

/**
 * @route POST /api/v1/api-keys
 * @description Create a new API key
 * @access Admin (Web UI) - No authentication required since this is the management interface
 */
router.post('/', corsMiddleware, (req, res) => {
    try {
        const { name, permissions, custom_rate_limits } = req.body;
        const requestInfo = apiLogger.getSafeRequestInfo(req);
        
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid name provided',
                message: 'Name is required and must be a non-empty string'
            });
        }
        
        // Create the API key
        const newApiKey = apiKeyManager.createApiKey(name.trim(), permissions, 'default', custom_rate_limits);
        
        // Log the creation
        apiLogger.logApiKeyCreation(newApiKey, requestInfo);
        
        res.status(201).json({
            success: true,
            message: 'API key created successfully',
            api_key: newApiKey
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
 * @access Admin (Web UI)
 */
router.get('/:id', corsMiddleware, (req, res) => {
    try {
        const keyId = req.params.id;
        const apiKey = apiKeyManager.getApiKeyById(keyId);
        
        if (!apiKey) {
            return res.status(404).json({
                success: false,
                error: 'API key not found',
                message: `No API key found with ID: ${keyId}`
            });
        }
        
        res.status(200).json({
            success: true,
            api_key: {
                ...apiKey,
                _links: {
                    self: `/api/v1/api-keys/${apiKey.id}`,
                    update: `/api/v1/api-keys/${apiKey.id}`,
                    delete: `/api/v1/api-keys/${apiKey.id}`
                }
            }
        });
    } catch (error) {
        console.error(`[API Keys] Error getting API key ${req.params.id}:`, error);
        
        // Log the error
        apiLogger.logApiError('Failed to get API key', {
            request: apiLogger.getSafeRequestInfo(req),
            error: 'get_key_error',
            key_id: req.params.id,
            errorMessage: error.message
        });
        
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get API key',
            message: error.message
        });
    }
});

/**
 * @route PUT /api/v1/api-keys/:id
 * @description Update an API key (name, active status, permissions, or rate limits)
 * @access Admin (Web UI)
 */
router.put('/:id', corsMiddleware, (req, res) => {
    try {
        const keyId = req.params.id;
        const updateData = req.body;
        
        // Get existing key to ensure it exists
        const existingKey = apiKeyManager.getApiKeyById(keyId);
        if (!existingKey) {
            return res.status(404).json({
                success: false,
                error: 'API key not found',
                message: `No API key found with ID: ${keyId}`
            });
        }
        
        // Update the API key
        const updatedKey = apiKeyManager.updateApiKey(keyId, updateData);
        
        // Log the update
        apiLogger.logApiKeyUpdate(updatedKey, apiLogger.getSafeRequestInfo(req));
        
        res.status(200).json({
            success: true,
            message: 'API key updated successfully',
            api_key: updatedKey
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
 * @access Admin (Web UI)
 */
router.delete('/:id', corsMiddleware, (req, res) => {
    try {
        const keyId = req.params.id;
        
        // Get existing key to ensure it exists and for logging
        const existingKey = apiKeyManager.getApiKeyById(keyId);
        if (!existingKey) {
            return res.status(404).json({
                success: false,
                error: 'API key not found',
                message: `No API key found with ID: ${keyId}`
            });
        }
        
        // Delete the API key
        apiKeyManager.deleteApiKey(keyId);
        
        // Log the deletion
        apiLogger.logApiKeyDeletion(existingKey, apiLogger.getSafeRequestInfo(req));
        
        res.status(200).json({
            success: true,
            message: `API key "${existingKey.name}" (${keyId}) deleted successfully`
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