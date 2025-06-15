const express = require('express');
// const { v4: uuidv4 } = require('uuid'); // No longer needed here, job ID created by helper
const jobQueue = require('../utils/jobQueueHelpers'); // Import the entire module
const { readServersConfig } = require('../utils/configHelpers');
const axios = require('axios');
const path = require('path');
const { checkModelAvailability, extractModelHash } = require('../utils/modelDatabase');

const router = express.Router();

// POST /api/v1/generate - Add job to SQLite queue
router.post('/generate', async (req, res) => {
    console.log("Received POST /api/v1/generate request");
    const { target_server_alias, generation_params } = req.body;

    if (!target_server_alias) {
        return res.status(400).json({ error: 'target_server_alias is required' });
    }

    if (!generation_params || typeof generation_params !== 'object' || Object.keys(generation_params).length === 0) {
         return res.status(400).json({ error: 'Invalid or empty generation_params object provided' });
    }

    // Optional: Log if civitai_version_id is provided for model availability checking
    const { civitaiVersionId, source } = extractCivitaiVersionId(generation_params);
    if (civitaiVersionId) {
        console.log(`[API] Generation request includes Civitai version ID: ${civitaiVersionId} (from ${source})`);
    } else {
        console.log(`[API] Generation request has no Civitai version ID (${source})`);
    }

    try {
        const servers = await readServersConfig();
        if (!servers.find(s => s.alias === target_server_alias)) {
            return res.status(404).json({ error: `Server with alias '${target_server_alias}' not found.` });
        }
    } catch (err) {
        console.error("Error reading server config while validating alias:", err);
        return res.status(500).json({ error: 'Failed to validate server alias' });
    }

    try {
        // Create a structured job object for the queue
        const jobData = {
            target_server_alias: target_server_alias,
            generation_params: generation_params,
            app_type: generation_params.app_type || 'forge' // Default to forge if not specified
        };
        console.log(`Attempting to add job to queue for server ${target_server_alias} with params:`, generation_params);
        const newJobRecord = jobQueue.addJob(jobData);
        
        console.log(`Job ${newJobRecord.mobilesd_job_id} added successfully to SQLite queue.`);
        res.status(202).json({ mobilesd_job_id: newJobRecord.mobilesd_job_id });
    } catch (error) {
        console.error(`Failed to add job to SQLite queue:`, error);
        res.status(500).json({ error: 'Failed to add job to queue' });
    }
});

// GET /api/v1/queue/jobs/:jobId/status - Refactored to get job status from SQLite
router.get('/queue/jobs/:jobId/status', (req, res) => { // Can be synchronous if getJobById is
    const { jobId } = req.params;
    console.log(`[API] Received GET /api/v1/queue/jobs/${jobId}/status request`);

    if (!jobId) {
        return res.status(400).json({ error: 'Job ID is required.' });
    }

    try {
        const job = jobQueue.getJobById(jobId); // Use the new helper

        if (!job) {
            return res.status(404).json({ error: `Job with ID '${jobId}' not found.` });
        }

                // Add model availability information using hash-based matching
        let model_availability = {
            available: null,
            reason: 'No model hash found'
        };
        
        const { hash, source } = extractModelHash(job.generation_params);
        
        if (hash) {
            const availability = checkModelAvailability(hash, 'checkpoint');
                model_availability = {
                    available: availability.available,
                    reason: availability.reason || null,
                    civitai_model_id: availability.civitai_model_id || null,
                hash: availability.hash || hash,
                match_type: availability.match_type || null,
                checked_field: source,
                model_identifier: hash
                    };
                } else {
                    model_availability = {
                        available: false,
                reason: source,
                        civitai_model_id: null,
                hash: null,
                match_type: null,
                checked_field: 'N/A',
                model_identifier: null
                    };
        }

        // The job object from getJobById already has generation_params and result_details parsed
        // Ensure all desired fields are present in the response
        res.status(200).json({
            mobilesd_job_id: job.mobilesd_job_id,
            status: job.status,
            creation_timestamp: job.creation_timestamp,
            last_updated_timestamp: job.last_updated_timestamp, // Added for more info
            completion_timestamp: job.completion_timestamp,
            target_server_alias: job.target_server_alias,
            forge_session_hash: job.forge_session_hash, // Added for more info
            generation_params: job.generation_params, // Already an object
            result_details: job.result_details, // Already an object or null
            retry_count: job.retry_count, // Added for more info
            model_availability: model_availability
        });

    } catch (error) {
        console.error(`[API] Error fetching status for job ${jobId} from SQLite:`, error);
        res.status(500).json({ error: 'Failed to retrieve job status.' });
    }
});

// GET /api/v1/queue/jobs - Get all jobs with optional filtering and pagination
router.get('/queue/jobs', (req, res) => {
    console.log('[API] Received GET /api/v1/queue/jobs request');
    
    try {
        // Parse query parameters
        const options = {
            status: req.query.status,
            limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
            order: req.query.order === 'asc' ? 'ASC' : 'DESC'
        };
        
        const jobs = jobQueue.getAllJobs(options);
        
                // Enhance jobs with model availability information using hash-based matching
        const enhancedJobs = jobs.map(job => {
            const enhancedJob = { ...job };
            
            const { hash, source } = extractModelHash(job.generation_params);
            
            if (hash) {
                const availability = checkModelAvailability(hash, 'checkpoint');
                        enhancedJob.model_availability = {
                            available: availability.available,
                            reason: availability.reason || null,
                            civitai_model_id: availability.civitai_model_id || null,
                    hash: availability.hash || hash,
                    match_type: availability.match_type || null,
                    checked_field: source,
                    model_identifier: hash
                            };
                        } else {
                            enhancedJob.model_availability = {
                                available: false,
                    reason: source,
                                civitai_model_id: null,
                    hash: null,
                    match_type: null,
                    checked_field: 'N/A',
                    model_identifier: null
                };
            }
            
            return enhancedJob;
        });
        
        res.status(200).json({
            total: enhancedJobs.length,
            jobs: enhancedJobs
        });
    } catch (error) {
        console.error('[API] Error fetching jobs from SQLite:', error);
        res.status(500).json({ error: 'Failed to retrieve jobs.' });
    }
});

// POST /api/v1/queue/jobs/:jobId/cancel - Cancel a job
router.post('/queue/jobs/:jobId/cancel', (req, res) => {
    const { jobId } = req.params;
    console.log(`[API] Received POST /api/v1/queue/jobs/${jobId}/cancel request`);
    
    if (!jobId) {
        return res.status(400).json({ error: 'Job ID is required.' });
    }
    
    try {
        // First check if the job exists and get its current status
        const job = jobQueue.getJobById(jobId);
        
        if (!job) {
            return res.status(404).json({ error: `Job with ID '${jobId}' not found.` });
        }
        
        // Only jobs in 'pending' or 'processing' status can be cancelled
        if (job.status !== 'pending' && job.status !== 'processing') {
            return res.status(400).json({ 
                error: `Cannot cancel job with status '${job.status}'. Only 'pending' or 'processing' jobs can be cancelled.`,
                job: job
            });
        }
        
        // If the job is in 'processing' status and has a forge_session_hash,
        // we would ideally also try to cancel it on the Forge server
        // For now, we just mark it as cancelled in our database
        
        // Cancel the job
        const updatedJob = jobQueue.cancelJob(jobId);
        
        if (!updatedJob) {
            return res.status(500).json({ error: 'Failed to cancel job.' });
        }
        
        res.status(200).json({
            message: 'Job cancelled successfully.',
            job: updatedJob
        });
    } catch (error) {
        console.error(`[API] Error cancelling job ${jobId}:`, error);
        res.status(500).json({ error: `Failed to cancel job: ${error.message}` });
    }
});

// DELETE /api/v1/queue/jobs/:jobId - Delete a job from the queue
router.delete('/queue/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    console.log(`[API] Received DELETE /api/v1/queue/jobs/${jobId} request`);
    
    if (!jobId) {
        return res.status(400).json({ error: 'Job ID is required.' });
    }
    
    try {
        // First check if the job exists
        const job = jobQueue.getJobById(jobId);
        
        if (!job) {
            return res.status(404).json({ error: `Job with ID '${jobId}' not found.` });
        }
        
        // Delete the job
        const deleted = jobQueue.deleteJob(jobId);
        
        if (!deleted) {
            return res.status(500).json({ error: 'Failed to delete job.' });
        }
        
        res.status(200).json({
            message: `Job ${jobId} deleted successfully.`
        });
    } catch (error) {
        console.error(`[API] Error deleting job ${jobId}:`, error);
        res.status(500).json({ error: `Failed to delete job: ${error.message}` });
    }
});

// GET /api/v1/debug/monitors - Show active monitors (FOR DEBUGGING ONLY)
router.get('/debug/monitors', (req, res) => {
    console.log(`[API] Received GET /api/v1/debug/monitors request`);
    
    try {
        // Import forgeJobMonitor to access activeMonitors
        const forgeJobMonitor = require('../services/forgeJobMonitor');
        
        // Get active monitors
        const activeMonitors = forgeJobMonitor.getActiveMonitors();
        
        res.status(200).json({
            active_monitors: Object.keys(activeMonitors || {})
        });
    } catch (error) {
        console.error(`[API] Error getting active monitors:`, error);
        res.status(500).json({ error: `Failed to get active monitors: ${error.message}` });
    }
});

// GET /api/v1/progress - Keep existing or remove/comment out?
// This endpoint is now technically obsolete for its original purpose (client-side SSE proxy).
// The client will poll a different endpoint (e.g., GET /api/v1/queue/jobs/:id/status).
// We can comment it out or remove it for now to avoid confusion.
/*
router.get('/progress', async (req, res) => {
    const { session_hash, serverAlias } = req.query;

    if (!session_hash || !serverAlias) {
        return res.status(400).send('session_hash and serverAlias query parameters are required.');
    }

    console.log(`SSE /progress request received for session: ${session_hash}, server: ${serverAlias}`);

    const servers = await readServersConfig();
    const server = servers.find(s => s.alias === serverAlias);

    if (!server) {
        return res.status(404).send('Server alias not found.');
    }

    const forgeUrl = server.url;
    const progressUrl = `${forgeUrl}/queue/data?session_hash=${session_hash}`;
    console.log(`Proxying SSE from ${progressUrl}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE connection

    let keepAliveInterval;
    const ssePassThrough = new PassThrough();

    // Pipe the PassThrough stream to the response
    ssePassThrough.pipe(res);

    // Function to establish connection to Forge SSE
    const connectToForgeSse = () => {
        let forgeReq;
        axios({
            method: 'get',
            url: progressUrl,
            responseType: 'stream'
        })
        .then(response => {
            console.log(`Connected to Forge SSE for ${session_hash}`);
            forgeReq = response.data; // Assign the stream

            response.data.on('data', (chunk) => {
                // Forward chunk to the client via PassThrough
                ssePassThrough.write(chunk);
            });

            response.data.on('end', () => {
                console.log(`Forge SSE stream ended for ${session_hash}`);
                // Don't end the client connection here, let the client decide or keep alive
                ssePassThrough.end(); // End the passthrough when source ends
                clearInterval(keepAliveInterval);
            });

            response.data.on('error', (err) => {
                console.error(`Error in Forge SSE stream for ${session_hash}:`, err.message);
                ssePassThrough.end(); // End the passthrough on source error
                clearInterval(keepAliveInterval);
            });

            // Keep-alive mechanism: Send a comment every 15 seconds
            keepAliveInterval = setInterval(() => {
                if (!ssePassThrough.writableEnded) {
                    ssePassThrough.write(': keep-alive\n\n');
                } else {
                    clearInterval(keepAliveInterval);
                }
            }, 15000);

        })
        .catch(error => {
            console.error(`Failed to connect to Forge SSE (${progressUrl}):`, error.message);
            if (error.response) {
                console.error('Forge SSE Error Status:', error.response.status);
                console.error('Forge SSE Error Data:', error.response.data ? error.response.data.toString() : 'N/A');
            }
             // Signal error downstream
             ssePassThrough.emit('error', new Error(`Failed to connect to Forge SSE: ${error.message}`));
             ssePassThrough.end();
             clearInterval(keepAliveInterval);
        });

        // Return a function to abort the request if needed
        return () => {
             if (forgeReq && typeof forgeReq.destroy === 'function') {
                 forgeReq.destroy(); // Abort the underlying HTTP request to Forge
             }
         };
    };

    const abortForgeRequest = connectToForgeSse();

    // Handle client closing connection
    req.on('close', () => {
        console.log(`Client closed connection for SSE ${session_hash}. Aborting Forge connection.`);
        abortForgeRequest(); // Abort the connection to Forge SSE
        ssePassThrough.end();
        clearInterval(keepAliveInterval);
    });

    // Handle errors on the PassThrough stream itself (e.g., if piping fails)
    ssePassThrough.on('error', (err) => {
        console.error(`Error in SSE PassThrough stream for ${session_hash}:`, err.message);
        res.end(); // Ensure response is closed on error
        clearInterval(keepAliveInterval);
    });
});
*/

// POST /api/v1/checkpoint-verify - Test Civitai version ID matching
router.post('/checkpoint-verify', async (req, res) => {
    const { civitai_version_id } = req.body;
    
    if (!civitai_version_id) {
        return res.status(400).json({ 
            success: false, 
            error: 'civitai_version_id is required' 
        });
    }
    
    try {
        const modelDB = require('../utils/modelDatabase');
        
        // Check if the provided value is a valid Civitai version ID
        // Check if the provided value is a valid hash
        const availability = modelDB.checkModelAvailability(civitai_version_id, 'checkpoint');
        
        // Return simplified verification results
        res.json({
            success: true,
            provided_value: civitai_version_id,
            interpreted_as: 'model_hash',
                available: availability.available,
                reason: availability.reason,
            hash: availability.hash,
            match_type: availability.match_type,
            model_info: availability.model ? {
                id: availability.model.id,
                name: availability.model.name,
                filename: availability.model.filename,
                hash_autov2: availability.model.hash_autov2,
                hash_sha256: availability.model.hash_sha256
            } : null
        });
    } catch (error) {
        console.error('Checkpoint verification error:', error);
        res.status(500).json({ 
            success: false, 
            error: `Checkpoint verification failed: ${error.message}` 
        });
    }
});

// POST /api/v1/queue/jobs/:jobId/dispatch - Manually dispatch a specific job to Forge
router.post('/queue/jobs/:jobId/dispatch', async (req, res) => {
    const { jobId } = req.params;
    console.log(`[API] Received POST /api/v1/queue/jobs/${jobId}/dispatch request (manual dispatch)`);
    
    if (!jobId) {
        return res.status(400).json({ error: 'Job ID is required.' });
    }
    
    try {
        // First check if the job exists and get its current status
        const job = jobQueue.getJobById(jobId);
        
        if (!job) {
            return res.status(404).json({ error: `Job with ID '${jobId}' not found.` });
        }
        
        // Allow pending and failed jobs to be manually dispatched
        if (job.status !== 'pending' && job.status !== 'failed') {
            return res.status(400).json({ 
                error: `Cannot dispatch job with status '${job.status}'. Only 'pending' and 'failed' jobs can be dispatched.`,
                job: job
            });
        }
        
        // Import the dispatcher and process this specific job
        const dispatcher = require('../services/gradioJobDispatcher');
        
        console.log(`[API] Manual dispatch: Processing job ${jobId}`);
        
        // We need to create a job object that matches what the dispatcher expects
        const jobForDispatcher = {
            mobilesd_job_id: job.mobilesd_job_id,
            status: job.status,
            target_server_alias: job.target_server_alias,
            generation_params: job.generation_params,
            app_type: job.app_type || 'forge'
        };
        
        // Call the processJob function directly (this is typically called by the dispatcher)
        await dispatcher.processJob(jobForDispatcher);
        
        // Get the updated job status after processing
        const updatedJob = jobQueue.getJobById(jobId);
        
        res.status(200).json({
            message: 'Job dispatched successfully.',
            job: updatedJob
        });
        
    } catch (error) {
        console.error(`[API] Error manually dispatching job ${jobId}:`, error);
        res.status(500).json({ error: `Failed to dispatch job: ${error.message}` });
    }
});

module.exports = router; 