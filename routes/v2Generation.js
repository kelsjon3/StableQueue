const express = require('express');
const router = express.Router();
const jobQueue = require('../utils/jobQueueHelpers');
const { readServersConfig } = require('../utils/configHelpers');
const apiLogger = require('../utils/apiLogger');
const { apiAuthWithJobRateLimit } = require('../middleware/apiMiddleware');
const { handleApiError } = require('../utils/apiErrorHandler');

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
    
    // More robust checkpoint parameter normalization
    console.log(`[API v2] Checking generation parameters for app_type: ${validAppType}`);
    
    if (generation_params.checkpoint_name && validAppType === 'forge') {
        // Normalize checkpoint paths for Forge
        console.log(`[API v2] Normalizing checkpoint path: ${generation_params.checkpoint_name}`);
        try {
            // Convert both forward and backslashes to system-specific separator
            const normalizedPath = generation_params.checkpoint_name.replace(/[\/\\]+/g, '/');
            generation_params.checkpoint_name = normalizedPath;
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