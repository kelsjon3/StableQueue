const express = require('express');
// const { v4: uuidv4 } = require('uuid'); // No longer needed here, job ID created by helper
const jobQueue = require('../utils/jobQueueHelpers'); // Import the entire module
const { readServersConfig } = require('../utils/configHelpers');
// Remove axios and SSE related imports if they are no longer needed in this file
// const axios = require('axios');
// const { PassThrough } = require('stream'); 

const router = express.Router();

// POST /api/v1/generate - Refactored to add job to SQLite queue
router.post('/generate', async (req, res) => {
    console.log("Received POST /api/v1/generate request");
    const { target_server_alias, generation_params } = req.body;

    if (!target_server_alias) {
        return res.status(400).json({ error: 'target_server_alias is required' });
    }

    if (!generation_params || typeof generation_params !== 'object' || Object.keys(generation_params).length === 0) {
         return res.status(400).json({ error: 'Invalid or empty generation_params object provided' });
    }

    try {
        const servers = await readServersConfig(); // Keep server validation
        if (!servers.find(s => s.alias === target_server_alias)) {
            return res.status(404).json({ error: `Server with alias '${target_server_alias}' not found.` });
        }
    } catch (err) {
        console.error("Error reading server config while validating alias:", err);
        return res.status(500).json({ error: 'Failed to validate server alias' });
    }

    try {
        // jobQueue.addJob now handles ID, timestamps, and initial status
        const jobDataForQueue = {
            target_server_alias,
            generation_params 
        };
        console.log(`Attempting to add job to queue for server ${target_server_alias} with params:`, generation_params);
        const newJobRecord = jobQueue.addJob(jobDataForQueue); // This is now a synchronous call if using better-sqlite3 directly
        
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
            retry_count: job.retry_count // Added for more info
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
        
        res.status(200).json({
            total: jobs.length,
            jobs: jobs
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

module.exports = router; 