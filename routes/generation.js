const express = require('express');
const { v4: uuidv4 } = require('uuid'); // Import UUID
const { addJobToQueue } = require('../utils/jobQueueHelpers'); // Import job queue helper
const { readServersConfig } = require('../utils/configHelpers');
// Remove axios and SSE related imports if they are no longer needed in this file
// const axios = require('axios');
// const { PassThrough } = require('stream'); 

const router = express.Router();

// POST /api/v1/generate - Refactored to add job to queue
router.post('/generate', async (req, res) => {
    console.log("Received POST /api/v1/generate request");
    const { target_server_alias, generation_params } = req.body; // New way: extract generation_params object directly

    if (!target_server_alias) {
        return res.status(400).json({ error: 'target_server_alias is required' });
    }

    // Validate the extracted generation_params
    if (!generation_params || typeof generation_params !== 'object' || Object.keys(generation_params).length === 0) {
         return res.status(400).json({ error: 'Invalid or empty generation_params object provided' });
    }

    // Verify the server alias exists (optional but good practice)
    try {
        const servers = await readServersConfig();
        if (!servers.find(s => s.alias === target_server_alias)) {
            return res.status(404).json({ error: `Server with alias '${target_server_alias}' not found.` });
        }
    } catch (err) {
        console.error("Error reading server config while validating alias:", err);
        // Decide if we should proceed or return an error
        // For now, let's return an error as we can't be sure the target server is valid
        return res.status(500).json({ error: 'Failed to validate server alias' });
    }


    const newJob = {
        mobilesd_job_id: uuidv4(),
        status: 'pending', // Initial status
        creation_timestamp: new Date().toISOString(),
        completion_timestamp: null,
        target_server_alias: target_server_alias,
        forge_session_hash: null, // Will be set by dispatcher
        generation_params: generation_params, // Store the actual params object
        result_details: null // Will be set by monitor
    };

    try {
        console.log(`Adding job ${newJob.mobilesd_job_id} to queue for server ${target_server_alias}`);
        await addJobToQueue(newJob);
        console.log(`Job ${newJob.mobilesd_job_id} added successfully.`);
        // Respond immediately with the job ID
        res.status(202).json({ mobilesd_job_id: newJob.mobilesd_job_id });
    } catch (error) {
        console.error(`Failed to add job ${newJob.mobilesd_job_id} to queue:`, error);
        res.status(500).json({ error: 'Failed to add job to queue' });
    }
});

// GET /api/v1/queue/jobs/:jobId/status - New endpoint to get job status
router.get('/queue/jobs/:jobId/status', async (req, res) => {
    const { jobId } = req.params;
    console.log(`[API] Received GET /api/v1/queue/jobs/${jobId}/status request`);

    if (!jobId) {
        return res.status(400).json({ error: 'Job ID is required.' });
    }

    try {
        const queue = await readJobQueue(); // Re-use from jobQueueHelpers
        const job = queue.find(j => j.mobilesd_job_id === jobId);

        if (!job) {
            return res.status(404).json({ error: `Job with ID '${jobId}' not found.` });
        }

        // Return relevant information for the frontend
        res.status(200).json({
            mobilesd_job_id: job.mobilesd_job_id,
            status: job.status,
            creation_timestamp: job.creation_timestamp,
            completion_timestamp: job.completion_timestamp,
            target_server_alias: job.target_server_alias,
            // Include progress_details if they exist (from monitor)
            progress_details: job.progress_details || null, 
            // Include result_details if they exist (from monitor on completion/failure)
            result_details: job.result_details || null 
        });

    } catch (error) {
        console.error(`[API] Error fetching status for job ${jobId}:`, error);
        res.status(500).json({ error: 'Failed to retrieve job status.' });
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