const express = require('express');
const router = express.Router();
const jobQueue = require('../utils/jobQueueHelpers');
const { readServersConfig } = require('../utils/configHelpers');
const apiLogger = require('../utils/apiLogger');
const { apiAuthWithJobRateLimit } = require('../middleware/apiMiddleware');
const { handleApiError } = require('../utils/apiErrorHandler');

/**
 * Helper function to process generation payloads from Forge extensions
 */
function processGenerationPayload(generationParams) {
    console.log(`[API v2] Processing payload type: ${generationParams.type || 'standard'}`);
    
    // Check if this is already a complete /sdapi/v1/ payload
    if (generationParams.prompt !== undefined || generationParams.positive_prompt !== undefined) {
        console.log(`[API v2] ✅ Complete /sdapi/v1/ payload detected - using directly`);
        
        // Ensure prompt field is standardized
        if (generationParams.positive_prompt && !generationParams.prompt) {
            generationParams.prompt = generationParams.positive_prompt;
        }
        
        console.log(`[API v2] Complete payload - prompt: "${(generationParams.prompt || '').substring(0, 50)}...", keys: ${Object.keys(generationParams).length}`);
        return generationParams;
    }
    
    // Legacy handling for raw Gradio payloads (if needed)
    if (generationParams.type === 'gradio_raw') {
        // This is a raw Gradio payload from the extension
        console.log(`[API v2] Converting raw Gradio payload for tab: ${generationParams.tab_id}`);
        
        const rawPayload = generationParams.raw_payload;
        if (!rawPayload || !rawPayload.data || !Array.isArray(rawPayload.data)) {
            throw new Error("Invalid Gradio payload structure - missing data array");
        }
        
        const gradioData = rawPayload.data;
        console.log(`[API v2] Gradio data array length: ${gradioData.length}`);
        
        // Convert Gradio array data to standard SDAPI format
        // Note: Array positions may vary by Forge version, this is a best-effort conversion
        const convertedParams = {
            prompt: "",
            negative_prompt: "",
            styles: [],
            seed: -1,
            subseed: -1,
            subseed_strength: 0,
            steps: 20,
            sampler_name: "Euler a",
            width: 512,
            height: 512,
            cfg_scale: 7.0,
            batch_size: 1,
            n_iter: 1,
            restore_faces: false,
            tiling: false,
            send_images: true,
            save_images: true,
            override_settings: {},
            script_name: null,
            script_args: []
        };
        
        try {
            // Extract parameters from Gradio data array
            // Note: Array positions are based on observed Forge behavior
            
            // Basic text parameters
            if (gradioData[0] && typeof gradioData[0] === 'string') {
                convertedParams.prompt = gradioData[0];
            }
            
            if (gradioData[2] && typeof gradioData[2] === 'string') {
                convertedParams.negative_prompt = gradioData[2];
            }
            
            // Look for seed at position 17 (based on logs showing -1 values)
            if (gradioData[17] && typeof gradioData[17] === 'number') {
                convertedParams.seed = gradioData[17];
            }
            
            // Look for steps, cfg_scale, width, height in other positions
            // Since we don't see clear numeric values in the array, use defaults
            
            // Look for scheduler/quality preset at the end
            if (gradioData[23] && typeof gradioData[23] === 'string') {
                if (gradioData[23] !== 'Balanced') {
                    convertedParams.sampler_name = gradioData[23];
                }
            }
            
            // Look for other settings
            if (gradioData[21] && typeof gradioData[21] === 'number') {
                convertedParams.batch_size = gradioData[21];
            }
            
            // Look for extension data (ControlNet, etc.) in remaining array elements
            for (let i = 8; i < gradioData.length; i++) {
                const item = gradioData[i];
                
                if (item && typeof item === 'object') {
                    // Extension data found - preserve it
                    if (convertedParams.script_args.length === 0) {
                        convertedParams.script_name = "forge_extension_data";
                    }
                    convertedParams.script_args.push(item);
                }
                
                // Check for model/checkpoint references
                if (typeof item === 'string' && (item.includes('.safetensors') || item.includes('.ckpt'))) {
                    convertedParams.override_settings.sd_model_checkpoint = item;
                }
            }
            
            // Set a default checkpoint if none found - this will use the current model on the target server
            if (!convertedParams.checkpoint_name && !convertedParams.override_settings.sd_model_checkpoint) {
                console.log(`[API v2] No checkpoint found in Gradio payload, will use current model on target server`);
                convertedParams.checkpoint_name = null; // Let the target server use its current model
            }
            
            // Store the original Gradio payload for debugging/reference
            convertedParams._original_gradio_payload = {
                tab_id: generationParams.tab_id,
                source_url: generationParams.source_url,
                forge_session_hash: generationParams.forge_session_hash,
                fn_index: generationParams.fn_index,
                data_length: gradioData.length,
                raw_data_sample: gradioData.slice(0, 10) // Store first 10 elements for debugging
            };
            
        } catch (error) {
            console.warn(`[API v2] Error extracting some Gradio parameters:`, error);
            // Continue with partial extraction - better than complete failure
        }
        
        console.log(`[API v2] Converted Gradio payload - prompt: "${convertedParams.prompt.substring(0, 50)}...", steps: ${convertedParams.steps}, size: ${convertedParams.width}x${convertedParams.height}`);
        
        return convertedParams;
    } else if (generationParams.type === 'gradio') {
        // This is already a Gradio payload but not the raw format - handle gracefully
        console.log(`[API v2] Received non-raw Gradio payload, processing as standard parameters`);
        return generationParams.raw_payload || generationParams;
    } else {
        // Standard SDAPI format or already converted
        return generationParams;
    }
}

/**
 * @route POST /api/v2/generate
 * @description Submit a new generation job with extended parameters for app type and authentication
 * @access Requires API key
 */
router.post('/generate', apiAuthWithJobRateLimit, async (req, res) => {
    console.log("[API v2] Received POST /api/v2/generate request");
    const { 
        app_type,
        target_server_alias, 
        generation_params,
        priority,
        source_info
    } = req.body;

    // Get safe request info for logging
    const requestInfo = apiLogger.getSafeRequestInfo(req);

    // Validation
    if (!target_server_alias) {
        return handleApiError(res, 'MISSING_REQUIRED_FIELD', req, {
            field: 'target_server_alias',
            customMessage: 'target_server_alias is required'
        });
    }

    if (!generation_params || typeof generation_params !== 'object' || Object.keys(generation_params).length === 0) {
        return handleApiError(res, 'INVALID_FIELD_VALUE', req, {
            field: 'generation_params',
            customMessage: 'Invalid or empty generation_params object provided'
        });
    }

    // Default app_type is 'forge' if not specified
    const validAppType = app_type || 'forge';
    
    // Process generation payloads from extensions
    let processedParams;
    try {
        processedParams = processGenerationPayload(generation_params);
    } catch (error) {
        console.error(`[API v2] Error processing generation payload:`, error);
        return handleApiError(res, 'INVALID_FIELD_VALUE', req, {
            field: 'generation_params',
            customMessage: `Failed to process generation parameters: ${error.message}`
        });
    }
    
    // More robust checkpoint parameter normalization
    console.log(`[API v2] Checking generation parameters for app_type: ${validAppType}`);
    
    if (processedParams.checkpoint_name && validAppType === 'forge') {
        // Normalize checkpoint paths for Forge
        console.log(`[API v2] Normalizing checkpoint path: ${processedParams.checkpoint_name}`);
        try {
            // Convert both forward and backslashes to system-specific separator
            const normalizedPath = processedParams.checkpoint_name.replace(/[\/\\]+/g, '/');
            processedParams.checkpoint_name = normalizedPath;
            console.log(`[API v2] Normalized checkpoint path: ${normalizedPath}`);
        } catch (error) {
            console.error(`[API v2] Error normalizing checkpoint path:`, error);
            // Continue with original path if normalization fails
        }
    }
    
    // Validate the target server exists in config
    try {
        const servers = await readServersConfig();
        if (!servers.find(s => s.alias === target_server_alias)) {
            return handleApiError(res, 'SERVER_NOT_FOUND', req, {
                alias: target_server_alias,
                customMessage: `Server with alias '${target_server_alias}' not found.`
            });
        }
    } catch (err) {
        console.error(`[API v2] Error reading server config:`, err);
        return handleApiError(res, 'SERVER_CONFIG_ERROR', req, {
            customMessage: 'Failed to validate server alias'
        }, err);
    }
    
    // Prepare for rate limiting - ensure we have a key ID from middleware
    if (!req.apiKeyId) {
        return handleApiError(res, 'AUTHENTICATION_REQUIRED', req, {
            customMessage: 'Authentication error: API key ID not found'
        });
    }

    try {
        // Add the job to the queue with extended information
        const jobDataForQueue = {
            target_server_alias,
            generation_params: processedParams, // Use processed parameters
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
        
        // Log successful job submission
        apiLogger.logApiAccess('Job submitted successfully', {
            request: requestInfo,
            job_id: newJobRecord.mobilesd_job_id,
            app_type: validAppType,
            queue_position: queuePosition,
            target_server_alias
        });
        
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
        return handleApiError(res, 'QUEUE_ERROR', req, {
            customMessage: 'Failed to add job to queue'
        }, error);
    }
});

// Bulk endpoint will be added later - focusing on single job functionality first

/**
 * @route GET /api/v2/jobs/:jobId/status
 * @description Get status of a specific job with additional extension-relevant fields
 * @access Requires API key
 */
router.get('/jobs/:jobId/status', apiAuthWithJobRateLimit, (req, res) => {
    const { jobId } = req.params;
    console.log(`[API v2] Received GET /api/v2/jobs/${jobId}/status request`);

    if (!jobId) {
        return handleApiError(res, 'MISSING_REQUIRED_FIELD', req, {
            field: 'jobId',
            customMessage: 'Job ID is required.'
        });
    }

    try {
        const job = jobQueue.getJobById(jobId);

        if (!job) {
            return handleApiError(res, 'JOB_NOT_FOUND', req, {
                job_id: jobId,
                customMessage: `Job with ID '${jobId}' not found.`
            });
        }

        // Log successful job status request
        apiLogger.logApiAccess('Job status request successful', {
            request: apiLogger.getSafeRequestInfo(req),
            job_id: jobId,
            app_type: job.app_type || 'forge',
            status: job.status
        });

        // Enhanced response with additional fields for extensions
        res.status(200).json({
            success: true,
            job: {
                mobilesd_job_id: job.mobilesd_job_id,
                status: job.status,
                creation_timestamp: job.creation_timestamp,
                last_updated_timestamp: job.last_updated_timestamp,
                completion_timestamp: job.completion_timestamp,
                target_server_alias: job.target_server_alias,
                forge_session_hash: job.forge_session_hash,
                generation_params: job.generation_params,
                result_details: job.result_details,
                retry_count: job.retry_count,
                // Additional fields for extensions
                app_type: job.app_type || 'forge',
                source_info: job.source_info || 'ui',
                api_key_id: job.api_key_id,
                queue_position: job.status === 'pending' ? 
                    jobQueue.findPendingJobs().findIndex(j => j.mobilesd_job_id === job.mobilesd_job_id) + 1 : 
                    null,
                estimated_time_remaining: job.status === 'processing' ? 
                    Math.max(0, (job.generation_params.steps || 20) * 1.5 - 
                    ((Date.now() - new Date(job.last_updated_timestamp).getTime()) / 1000)) : 
                    null
            }
        });
    } catch (error) {
        console.error(`[API v2] Error fetching status for job ${jobId}:`, error);
        return handleApiError(res, 'DATABASE_ERROR', req, {
            job_id: jobId,
            customMessage: 'Failed to retrieve job status.'
        }, error);
    }
});

/**
 * @route GET /api/v2/jobs
 * @description Get all jobs with filtering by app_type and other criteria
 * @access Requires API key
 */
router.get('/jobs', apiAuthWithJobRateLimit, (req, res) => {
    console.log('[API v2] Received GET /api/v2/jobs request');
    
    try {
        // Parse query parameters with app_type support
        const options = {
            status: req.query.status,
            app_type: req.query.app_type, // New filter parameter
            limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
            order: req.query.order === 'asc' ? 'ASC' : 'DESC'
        };
        
        // Get jobs with enhanced filtering
        const jobs = jobQueue.getAllJobs(options);
        
        // Log successful jobs request
        apiLogger.logApiAccess('Jobs list request successful', {
            request: apiLogger.getSafeRequestInfo(req),
            filters: {
                status: options.status,
                app_type: options.app_type,
                limit: options.limit,
                offset: options.offset
            },
            total_jobs: jobs.length
        });
        
        // Enhanced response with additional metadata
        res.status(200).json({
            success: true,
            total: jobs.length,
            filters: {
                status: options.status,
                app_type: options.app_type,
                limit: options.limit,
                offset: options.offset,
                order: options.order
            },
            jobs: jobs
        });
    } catch (error) {
        console.error('[API v2] Error fetching jobs:', error);
        return handleApiError(res, 'DATABASE_ERROR', req, {
            customMessage: 'Failed to retrieve jobs.'
        }, error);
    }
});

/**
 * @route POST /api/v2/jobs/:jobId/cancel
 * @description Cancel a job
 * @access Requires API key
 */
router.post('/jobs/:jobId/cancel', apiAuthWithJobRateLimit, (req, res) => {
    const { jobId } = req.params;
    console.log(`[API v2] Received POST /api/v2/jobs/${jobId}/cancel request`);
    
    if (!jobId) {
        return handleApiError(res, 'MISSING_REQUIRED_FIELD', req, {
            field: 'jobId',
            customMessage: 'Job ID is required.'
        });
    }
    
    try {
        // First check if the job exists and get its current status
        const job = jobQueue.getJobById(jobId);
        
        if (!job) {
            return handleApiError(res, 'JOB_NOT_FOUND', req, {
                job_id: jobId,
                customMessage: `Job with ID '${jobId}' not found.`
            });
        }
        
        // Only jobs in 'pending' or 'processing' status can be cancelled
        if (job.status !== 'pending' && job.status !== 'processing') {
            return handleApiError(res, 'JOB_OPERATION_INVALID', req, {
                job_id: jobId,
                current_status: job.status,
                customMessage: `Cannot cancel job with status '${job.status}'. Only 'pending' or 'processing' jobs can be cancelled.`
            });
        }
        
        // Cancel the job
        const updatedJob = jobQueue.cancelJob(jobId);
        
        if (!updatedJob) {
            return handleApiError(res, 'QUEUE_ERROR', req, {
                job_id: jobId,
                customMessage: 'Failed to cancel job.'
            });
        }
        
        // Log successful cancellation
        apiLogger.logApiAccess('Job cancelled successfully', {
            request: apiLogger.getSafeRequestInfo(req),
            job_id: jobId,
            app_type: updatedJob.app_type || 'forge'
        });
        
        res.status(200).json({
            success: true,
            message: 'Job cancelled successfully.',
            job: updatedJob
        });
    } catch (error) {
        console.error(`[API v2] Error cancelling job ${jobId}:`, error);
        return handleApiError(res, 'DATABASE_ERROR', req, {
            job_id: jobId,
            customMessage: `Failed to cancel job: ${error.message}`
        }, error);
    }
});

module.exports = router; 