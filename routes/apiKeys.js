const express = require('express');
const router = express.Router();
const apiKeyManager = require('../utils/apiKeyManager');

/**
 * @route GET /api/v1/api-keys
 * @description Get all API keys (without secrets)
 * @access Admin only
 */
router.get('/', (req, res) => {
    try {
        const apiKeys = apiKeyManager.getAllApiKeys();
        
        // Add self-links for API
        const keysWithLinks = apiKeys.map(key => ({
            ...key,
            _links: {
                self: `/api/v1/api-keys/${key.id}`
            }
        }));
        
        res.status(200).json({ 
            success: true,
            count: keysWithLinks.length,
            api_keys: keysWithLinks
        });
    } catch (error) {
        console.error('[API Keys] Error fetching API keys:', error);
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
 * @access Admin only
 */
router.post('/', (req, res) => {
    try {
        const { name, permissions } = req.body;
        
        if (!name) {
            return res.status(400).json({ 
                success: false, 
                error: 'API key name is required'
            });
        }
        
        // Create the API key
        const apiKey = apiKeyManager.createApiKey(
            name, 
            permissions ? JSON.stringify(permissions) : '{}'
        );
        
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
                _links: {
                    self: `/api/v1/api-keys/${apiKey.id}`
                }
            }
        });
    } catch (error) {
        console.error('[API Keys] Error creating API key:', error);
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
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: 'API key ID is required'
            });
        }
        
        const apiKey = apiKeyManager.getApiKeyById(id);
        
        if (!apiKey) {
            return res.status(404).json({ 
                success: false, 
                error: `API key with ID ${id} not found`
            });
        }
        
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
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch API key',
            message: error.message
        });
    }
});

/**
 * @route PUT /api/v1/api-keys/:id
 * @description Update an API key (name, active status, or permissions)
 * @access Admin only
 */
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, is_active, permissions } = req.body;
        
        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: 'API key ID is required'
            });
        }
        
        // Check if API key exists
        const existingKey = apiKeyManager.getApiKeyById(id);
        
        if (!existingKey) {
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
        
        const updatedKey = apiKeyManager.updateApiKey(id, updates);
        
        if (!updatedKey) {
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to update API key'
            });
        }
        
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
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: 'API key ID is required'
            });
        }
        
        // Check if API key exists
        const existingKey = apiKeyManager.getApiKeyById(id);
        
        if (!existingKey) {
            return res.status(404).json({ 
                success: false, 
                error: `API key with ID ${id} not found`
            });
        }
        
        // Delete the API key
        const deleted = apiKeyManager.deleteApiKey(id);
        
        if (!deleted) {
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to delete API key'
            });
        }
        
        res.status(200).json({
            success: true,
            message: `API key "${existingKey.name}" (${id}) deleted successfully`
        });
    } catch (error) {
        console.error(`[API Keys] Error deleting API key ${req.params.id}:`, error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete API key',
            message: error.message
        });
    }
});

module.exports = router; 