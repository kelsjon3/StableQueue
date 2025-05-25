const express = require('express');
const router = express.Router();
const jobQueue = require('../utils/jobQueueHelpers');
const { readServersConfig } = require('../utils/configHelpers');
const { createApiKeyAuthMiddleware } = require('../utils/apiKeyManager');

// Create API key authentication middleware
const apiKeyAuth = createApiKeyAuthMiddleware();

/**
 * @route POST /api/v2/generate
 * @description Submit a new generation job with extended parameters for app type and authentication
 * @access Requires API key
 */
router.post('/generate', apiKeyAuth, async (req, res) => {
    console.log("[API v2] Received POST /api/v2/generate request");
    const { 
        app_type,
        target_server_alias, 
        generation_params,
        priority,
        source_info
    } = req.body;

    // Validation
    if (!target_server_alias) {
        return res.status(400).json({ 
            success: false,
            error: 'target_server_alias is required' 
        });
    }

    if (!generation_params || typeof generation_params !== 'object' || Object.keys(generation_params).length === 0) {
        return res.status(400).json({ 
            success: false,
            error: 'Invalid or empty generation_params object provided' 
        });
    }

    // Default app_type is 'forge' if not specified
    const validAppType = app_type || 'forge';
    
    // More robust checkpoint parameter normalization
    console.log(`[API v2] Checking generation parameters for app_type: ${validAppType}`);

    // Handle app-specific validation
    if (validAppType === 'forge') {
        // Normalize the checkpoint parameter for Forge
        console.log('[API v2] Checking generation parameters for checkpoint:', JSON.stringify({
            checkpoint_name: generation_params.checkpoint_name,
            sd_checkpoint: generation_params.sd_checkpoint
        }));

        if (!generation_params.checkpoint_name && generation_params.sd_checkpoint) {
            console.log(`[API v2] Converting sd_checkpoint parameter to checkpoint_name: ${generation_params.sd_checkpoint}`);
            generation_params.checkpoint_name = generation_params.sd_checkpoint;
            // Keep sd_checkpoint for backward compatibility
        } else if (!generation_params.checkpoint_name && !generation_params.sd_checkpoint) {
            console.error('[API v2] No checkpoint parameter found in request!');
            return res.status(400).json({ 
                success: false,
                error: 'Missing checkpoint parameter. Please provide checkpoint_name in generation parameters.'
            });
        }

        // Verify we have a checkpoint_name now
        console.log(`[API v2] Using checkpoint_name: ${generation_params.checkpoint_name}`);
    }
    // Add validation for other app types when implemented (e.g., 'comfyui')

    try {
        // Validate server alias
        const servers = await readServersConfig();
        if (!servers.find(s => s.alias === target_server_alias)) {
            return res.status(404).json({ 
                success: false,
                error: `Server with alias '${target_server_alias}' not found.` 
            });
        }
    } catch (err) {
        console.error("[API v2] Error reading server config while validating alias:", err);
        return res.status(500).json({ 
            success: false,
            error: 'Failed to validate server alias' 
        });
    }

    try {
        // Add the job to the queue with extended information
        const jobDataForQueue = {
            target_server_alias,
            generation_params,
            app_type: validAppType,
            source_info: source_info || 'extension', // Default source is 'extension'
            api_key_id: req.apiKeyId // From the authentication middleware
        };
        
        console.log(`[API v2] Adding job to queue for app_type ${validAppType}, server ${target_server_alias}`);
        const newJobRecord = jobQueue.addJob(jobDataForQueue);
        
        // Calculate queue position for better user feedback
        const pendingJobs = jobQueue.findPendingJobs();
        const queuePosition = pendingJobs.findIndex(job => job.mobilesd_job_id === newJobRecord.mobilesd_job_id) + 1;
        
        console.log(`[API v2] Job ${newJobRecord.mobilesd_job_id} added successfully. Queue position: ${queuePosition}`);
        
        // Return extended job information
        res.status(202).json({ 
            success: true,
            mobilesd_job_id: newJobRecord.mobilesd_job_id,
            queue_position: queuePosition,
            app_type: newJobRecord.app_type,
            creation_timestamp: newJobRecord.creation_timestamp,
            target_server_alias: newJobRecord.target_server_alias
        });
    } catch (error) {
        console.error(`[API v2] Failed to add job to queue:`, error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to add job to queue',
            message: error.message
        });
    }
});

module.exports = router; 