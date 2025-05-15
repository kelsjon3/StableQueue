// Service to periodically check for pending jobs and dispatch them to Forge

const axios = require('axios');
const { v4: uuidv4 } = require('uuid'); // Needed for session_hash
const { readJobQueue, updateJobInQueue, addJobToQueue, getJobById } = require('../utils/jobQueueHelpers');
const { readServersConfig } = require('../utils/configHelpers');
const fs = require('fs').promises; // Needed for image saving
const path = require('path'); // Needed for image saving
const modelDB = require('../utils/modelDatabase'); // Import our model database module

// Simple in-memory set to track servers currently processing a job
const busyServers = new Set();

// Cache of server model mappings to reduce API calls
const serverModelCaches = new Map(); // Format: { serverAlias: { lastUpdated: timestamp, models: [...] } }

const DISPATCH_INTERVAL_MS = 5000; // Check queue every 5 seconds (adjust as needed)
const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes timeout for txt2img request
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes TTL for model cache
let dispatchIntervalId = null;

// Helper to get server config and handle auth
async function getServerConfig(alias) {
    try {
        const servers = await readServersConfig();
        const server = servers.find(s => s.alias === alias);
        if (!server) {
            throw new Error(`Server config for alias '${alias}' not found.`);
        }
        // Basic Auth setup
        const axiosConfig = {};
        if (server.auth && server.auth.username && server.auth.password) {
            axiosConfig.auth = {
                username: server.auth.username,
                password: server.auth.password
            };
            console.log(`[Dispatcher] Using Basic Auth for ${alias}`);
        }
         // Add default timeout
         axiosConfig.timeout = 300000; // 5 minutes, adjust as needed

        return { url: server.apiUrl, config: axiosConfig };
    } catch (error) {
        console.error(`[Dispatcher] Error getting server config for ${alias}:`, error);
        throw error;
    }
}

/**
 * Enhanced function to verify if a checkpoint exists on a Forge server
 * Uses multiple matching strategies including model database lookups
 * 
 * @param {string} serverAlias - The alias of the Forge server
 * @param {string} serverApiUrl - The API URL of the Forge server
 * @param {Object} axiosBaseConfig - Configuration for axios requests
 * @param {string} checkpointName - The name of the checkpoint to verify
 * @returns {Promise<string|null>} The exact title string if found, null otherwise
 */
async function verifyCheckpointExists(serverAlias, serverApiUrl, axiosBaseConfig, checkpointName) {
    console.log(`[Dispatcher] Verifying checkpoint '${checkpointName}' on server '${serverAlias}'`);
    
    if (!checkpointName) {
        console.error('[Dispatcher] No checkpoint name provided');
        return null;
    }
    
    try {
        // STEP 1: Try to find the model in our local database with fast lookup
        const cachedModel = modelDB.findModelFast(checkpointName);
        if (cachedModel) {
            console.log(`[Dispatcher] Found checkpoint in local cache: ${cachedModel.forgeTitle}`);
            return cachedModel.forgeTitle;
        }
        
        // STEP 2: Check if we need to fetch models from Forge
        const modelsUrl = `${serverApiUrl}/sdapi/v1/sd-models`;
        let forgeModels = [];
        const now = Date.now();
        
        // Check if we have a recent cache for this server
        const serverCache = serverModelCaches.get(serverAlias);
        if (serverCache && (now - serverCache.lastUpdated < MODEL_CACHE_TTL_MS)) {
            console.log(`[Dispatcher] Using cached model list for server '${serverAlias}'`);
            forgeModels = serverCache.models;
        } else {
            // Fetch models from Forge
            console.log(`[Dispatcher] Fetching models from Forge server '${serverAlias}'`);
            const modelsConfig = { ...axiosBaseConfig, timeout: 15000 }; // 15 second timeout
            const response = await axios.get(modelsUrl, modelsConfig);
            
            if (response.status === 200 && Array.isArray(response.data)) {
                forgeModels = response.data;
                
                // Update cache
                serverModelCaches.set(serverAlias, {
                    lastUpdated: now,
                    models: forgeModels
                });
                
                // Import models into our database
                modelDB.importModelsFromForge(forgeModels, 'checkpoint');
            } else {
                console.error(`[Dispatcher] Unexpected response status ${response.status} or invalid data format`);
                return null;
            }
        }
        
        // STEP 3: Try multiple path format variations
        // Normalize checkpoint name for comparison
        const normalizedForward = checkpointName.replace(/\\/g, '/');
        const normalizedBackslash = checkpointName.replace(/\//g, '\\');
        const filename = path.basename(checkpointName);
        
        // Try all matching strategies
        let foundModel = null;
        
        // 3.1 Exact title match
        foundModel = forgeModels.find(model => model.title === checkpointName);
        if (foundModel) {
            console.log(`[Dispatcher] Found exact match: ${foundModel.title}`);
            return foundModel.title;
        }
        
        // 3.2 Forward slash match
        foundModel = forgeModels.find(model => {
            if (!model.title) return false;
            const titleParts = model.title.split(' [');
            const namePart = titleParts[0];
            return namePart === normalizedForward;
        });
        if (foundModel) {
            console.log(`[Dispatcher] Found forward slash match: ${foundModel.title}`);
            return foundModel.title;
        }
        
        // 3.3 Backslash match
        foundModel = forgeModels.find(model => {
            if (!model.title) return false;
            const titleParts = model.title.split(' [');
            const namePart = titleParts[0];
            return namePart === normalizedBackslash;
        });
        if (foundModel) {
            console.log(`[Dispatcher] Found backslash match: ${foundModel.title}`);
            return foundModel.title;
        }
        
        // 3.4 Filename match (fallback)
        foundModel = forgeModels.find(model => {
            if (!model.title) return false;
            const titleParts = model.title.split(' [');
            const namePart = titleParts[0];
            return path.basename(namePart) === filename;
        });
        if (foundModel) {
            console.log(`[Dispatcher] Found filename match: ${foundModel.title}`);
            return foundModel.title;
        }
        
        // STEP 4: Enhanced debugging and detailed error message
        console.warn(`[Dispatcher] Checkpoint '${checkpointName}' not found. Attempted matches:
        - Exact: '${checkpointName}'
        - Forward slash: '${normalizedForward}'
        - Backslash: '${normalizedBackslash}'
        - Filename: '${filename}'`);
        
        console.log(`[Dispatcher] Available models: ${forgeModels.map(m => m.title).slice(0, 5).join(', ')}${forgeModels.length > 5 ? '...' : ''}`);
        
        return null; // Not found with any strategy
    } catch (error) {
        let errorMsg = error.message;
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            errorMsg = `Timeout while verifying checkpoint`;
        } else if (error.response) {
            errorMsg = `Forge API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`;
        }
        console.error(`[Dispatcher] Failed to verify checkpoint '${checkpointName}': ${errorMsg}`);
        return null;
    }
}

// Re-usable helper to save images (adapted from monitor)
async function saveImageData(base64Data, jobId, index = 0) {
    try {
        // Ensure the save directory exists
        const saveDir = process.env.STABLE_DIFFUSION_SAVE_PATH;
        if (!saveDir) {
            throw new Error('STABLE_DIFFUSION_SAVE_PATH environment variable is not set.');
        }
        await fs.mkdir(saveDir, { recursive: true });

        // Log the start and length of the received data
        const preview = typeof base64Data === 'string' ? base64Data.substring(0, 50) + '...' : '[Not a string]';
        const dataLength = typeof base64Data === 'string' ? base64Data.length : 0;
        console.log(`[Dispatcher] Job ${jobId}: Received base64 data (length: ${dataLength}) starting with:`, preview);

        // Decode Base64
        let buffer;
        if (typeof base64Data === 'string' && base64Data.includes(',')) {
             buffer = Buffer.from(base64Data.split(',')[1], 'base64');
        } else if (typeof base64Data === 'string') {
            buffer = Buffer.from(base64Data, 'base64');
        } else {
             throw new Error('Invalid base64 data format received.');
        }

        // Determine filename
        const timestamp = Date.now();
        const filename = `${jobId}_${timestamp}_${index}.png`;
        const savePath = path.join(saveDir, filename);

        // Save image
        await fs.writeFile(savePath, buffer);
        console.log(`[Dispatcher] Job ${jobId}: Saved image from base64 to ${savePath}`);
        return filename;

    } catch (error) {
        console.error(`[Dispatcher] Job ${jobId}: Failed to decode/save image from base64:`, error);
        throw error;
    }
}

// Main job dispatch function
async function dispatchPendingJobs() {
    console.log('[Dispatcher] Checking for pending jobs...');
    
    // Get available servers - servers that are not in busyServers
    let serversConfig = [];
    try {
        serversConfig = await readServersConfig();
    } catch (error) {
        console.error('[Dispatcher] Error loading server configs:', error);
        return; // Don't kill the interval, maybe it'll work next time
    }

    const availableServerAliases = serversConfig
        .map(server => server.alias)
        .filter(alias => !busyServers.has(alias));

    if (availableServerAliases.length === 0) {
        // All known servers are busy, nothing to do
        console.log('[Dispatcher] All servers are busy, skipping this run.');
        return;
    }

    // Find pending jobs
    const pendingJobs = await readJobQueue({ status: 'pending' });

    if (pendingJobs.length === 0) {
        // No pending jobs, nothing to do
        console.log('[Dispatcher] No pending jobs found.');
        return;
    }

    console.log(`[Dispatcher] Found ${pendingJobs.length} pending jobs.`);

    for (const job of pendingJobs) {
        const serverAlias = job.target_server_alias;

        // Check if server is already busy
        if (busyServers.has(serverAlias)) {
            console.log(`[Dispatcher] Server ${serverAlias} is busy, skipping job ${job.mobilesd_job_id}`);
            continue;
        }

        // Find server configuration from the already read config
        const server = serversConfig.find(s => s.alias === serverAlias);
        if (!server || !server.apiUrl) {
            console.error(`[Dispatcher] Cannot find server config or apiUrl for alias ${serverAlias} (Job ID: ${job.mobilesd_job_id}). Marking job as failed.`);
            await updateJobInQueue(job.mobilesd_job_id, { status: 'failed', result_details: { error: `Server config not found for ${serverAlias}` } });
            continue;
        }

        // *** FIX: Immediately update job status to processing to make it visible in queue ***
        try {
            console.log(`[Dispatcher] Updating job ${job.mobilesd_job_id} status to 'processing' immediately`);
            await updateJobInQueue(job.mobilesd_job_id, {
                status: 'processing',
                processing_start_timestamp: new Date().toISOString(),
                result_details: {
                    info: 'Job is being processed by Forge dispatcher.',
                    progress_percentage: 0
                }
            });
        } catch (statusUpdateError) {
            console.error(`[Dispatcher] Failed to update job ${job.mobilesd_job_id} status:`, statusUpdateError);
            // Continue anyway, we'll try again in the main try block
        }

        // Mark server as busy *before* starting the async operation
        busyServers.add(serverAlias);
        console.log(`[Dispatcher] Processing job ${job.mobilesd_job_id} synchronously on server ${serverAlias}`);
        
        try {
            // --- Setup Axios Config (Auth + Base Timeout - used for helper calls too) ---
            const baseAxiosConfig = { timeout: JOB_TIMEOUT_MS }; // Base config with long timeout for txt2img
            if (server.auth && server.auth.username && server.auth.password) {
                const credentials = Buffer.from(`${server.auth.username}:${server.auth.password}`).toString('base64');
                baseAxiosConfig.headers = { 'Authorization': `Basic ${credentials}` };
            }
            
            // --- Verify Checkpoint Exists (if specified) ---
            let checkpointVerified = true; // Assume verified if no checkpoint is specified
            const requestedCheckpoint = job.generation_params?.checkpoint_name;
            let exactForgeModelTitle = null;

            if (requestedCheckpoint) {
                 // Use the enhanced function that includes server alias
                 exactForgeModelTitle = await verifyCheckpointExists(
                    serverAlias,
                    server.apiUrl, 
                    baseAxiosConfig, 
                    requestedCheckpoint
                 );
                 
                 if (!exactForgeModelTitle) {
                     // Job failed validation
                     const errorMsg = `Selected checkpoint '${requestedCheckpoint}' not found or accessible on Forge server.`;
                     console.error(`[Dispatcher] Job ${job.mobilesd_job_id}: ${errorMsg}`);
                     await updateJobInQueue(job.mobilesd_job_id, { 
                         status: 'failed', 
                         completion_timestamp: new Date().toISOString(),
                         result_details: { error: errorMsg }
                     });
                     // Skip the rest of the try block, go to finally to free server
                     throw new Error(errorMsg); // Use error to jump to finally
                 }
            }
            // --- End Checkpoint Verification ---

            // --- Synchronous txt2img Request ---
            console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: Sending synchronous txt2img request to ${serverAlias} (Timeout: ${JOB_TIMEOUT_MS / 1000}s)...`);
            const txt2imgUrl = `${server.apiUrl}/sdapi/v1/txt2img`;
            
            // --- Construct the final payload for the Forge API --- 
            const finalPayload = { ...job.generation_params };

            // Check for checkpoint within the job's parameters and add override_settings
            // Use the exact title returned by the verification step if available
            if (exactForgeModelTitle) { 
                console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: Overriding model using exact title: ${exactForgeModelTitle}`);
                finalPayload.override_settings = {
                    sd_model_checkpoint: exactForgeModelTitle // Use the exact title from Forge API
                };
                // Remove checkpoint_name from the top level as it's not needed anymore
                delete finalPayload.checkpoint_name; 
            } else if (finalPayload.checkpoint_name) {
                // This case should theoretically not happen if verification is mandatory,
                // but keep as a fallback or if verification logic changes.
                // It means verification failed or wasn't performed, but a name exists.
                // We might log a warning here.
                console.warn(`[Dispatcher] Job ${job.mobilesd_job_id}: Checkpoint name '${finalPayload.checkpoint_name}' exists but verification failed or exact title not found. Attempting override with original name (might fail).`);
                finalPayload.override_settings = {
                     sd_model_checkpoint: finalPayload.checkpoint_name
                 };
                delete finalPayload.checkpoint_name;
            } else {
                 console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: No checkpoint_name provided in job params. Forge will use its current model.`);
                 if (finalPayload.hasOwnProperty('checkpoint_name')) {
                     delete finalPayload.checkpoint_name;
                 }
            }

            // --- Ensure seed and subseed are integers (-1 for random) ---
            if (typeof finalPayload.seed !== 'number' || !Number.isInteger(finalPayload.seed)) {
                const seedAsInt = parseInt(finalPayload.seed, 10);
                finalPayload.seed = !isNaN(seedAsInt) ? seedAsInt : -1;
                console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: Converted seed to ${finalPayload.seed}`);
            }
            if (typeof finalPayload.subseed !== 'number' || !Number.isInteger(finalPayload.subseed)) {
                const subseedAsInt = parseInt(finalPayload.subseed, 10);
                finalPayload.subseed = !isNaN(subseedAsInt) ? subseedAsInt : -1;
                 console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: Converted subseed to ${finalPayload.subseed}`);
            }
            // --- End Seed/Subseed Conversion ---

            // Add explicit save/send settings required by the Forge API call
            finalPayload.send_images = false;   // Explicitly tell Forge NOT to send image data in the response
            finalPayload.save_images = true;    // Explicitly tell Forge to save locally
            
            // // DEBUG: Log the payload right before sending
            // console.log(`[Dispatcher DEBUG] Job ${job.mobilesd_job_id}: Final payload just before API call:`, JSON.stringify(finalPayload));
            // Remove the potentially confusing regular log for now
            console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: Using final payload for txt2img:`, JSON.stringify(finalPayload)); // Log the actual payload being sent
            
            const txt2imgConfig = { ...baseAxiosConfig }; // Use base config with long timeout and auth

            // *** AWAIT THE ACTUAL GENERATION RESPONSE ***
            const response = await axios.post(txt2imgUrl, finalPayload, txt2imgConfig);
            // *** CODE EXECUTION PAUSES HERE UNTIL RESPONSE OR TIMEOUT ***

            // --- Process Successful Response (Only runs AFTER await completes) ---
            console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: Received successful response from ${serverAlias}.`);
            const responseData = response.data;

            // Log the structure of the response
            console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: Response data keys:`, Object.keys(responseData));
            // console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: Response info field (raw string):`, responseData.info); // Log raw string if needed
            // console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: Response parameters field:`, responseData.parameters); // Optional: log parameters too

            let resultInfo = null;
            let errorDetails = null;
            let parsedInfo = {};

            try {
                 if (responseData.info) {
                     parsedInfo = JSON.parse(responseData.info);
                     console.log(`[Dispatcher] Job ${job.mobilesd_job_id}: Parsed response info field:`, JSON.stringify(parsedInfo, null, 2)); // Pretty print parsed JSON
                     // Store the parsed info for the job result (potentially contains file paths)
                     resultInfo = parsedInfo;
                 } else {
                     console.warn(`[Dispatcher] Job ${job.mobilesd_job_id}: Response info field was empty.`);
                     resultInfo = { warning: 'Response info field was empty from Forge.' };
                 }

                 // Check if images array is unexpectedly populated (it shouldn't be with send_images: false)
                 if (responseData.images && responseData.images.length > 0) {
                      console.warn(`[Dispatcher] Job ${job.mobilesd_job_id}: 'images' array received ${responseData.images.length} entries despite send_images=false.`);
                      // Optionally add this warning to resultInfo or errorDetails
                 }

            } catch (parseError) {
                 console.error(`[Dispatcher] Job ${job.mobilesd_job_id}: Failed to parse responseData.info JSON:`, parseError);
                 console.error(`[Dispatcher] Raw info string was:`, responseData.info);
                 errorDetails = `Failed to parse Forge response info: ${parseError.message}`;
                 resultInfo = { error: `Failed to parse Forge response info. Raw: ${responseData.info}` }; // Store raw info on error
            }

            // Update job status to completed (or failed if info parsing failed)
            await updateJobInQueue(job.mobilesd_job_id, {
                status: errorDetails ? 'failed' : 'completed',
                completion_timestamp: new Date().toISOString(),
                result_details: resultInfo ? resultInfo : (errorDetails ? { error: errorDetails } : {}),
                progress_details: null
            });
            console.log(`[Dispatcher] Job ${job.mobilesd_job_id} marked as ${errorDetails ? 'failed' : 'completed'}. Result info logged.`);

        } catch (error) {
            // --- Handle Errors During Options/txt2img Request ---
            // Check if error was already handled (e.g., checkpoint error) and job status updated
             const jobState = await getJobById(job.mobilesd_job_id); // Re-read job state
             // Only update if job is not already marked failed by a preceding step (like options error)
             if (jobState && jobState.status !== 'failed') {
                 let errorMessage = error.message;
                 if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                     errorMessage = `Request timed out after ${JOB_TIMEOUT_MS / 1000} seconds.`;
                 } else if (error.response) {
                     errorMessage = `Forge API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`;
                 } else if (error.message.includes('Options API Error')) {
                     // Error was re-thrown from options block, message already formatted
                      errorMessage = error.message;
                 } else {
                      errorMessage = `Error during dispatch: ${errorMessage}`;
                 }
                 console.error(`[Dispatcher] Error processing job ${job.mobilesd_job_id} on ${serverAlias}:`, errorMessage);

                 // Update job status to failed
                 await updateJobInQueue(job.mobilesd_job_id, {
                     status: 'failed',
                     completion_timestamp: new Date().toISOString(),
                     result_details: { error: errorMessage },
                     progress_details: null
                 });
                 console.log(`[Dispatcher] Job ${job.mobilesd_job_id} marked as failed.`);
             } else if (!jobState) {
                  console.error(`[Dispatcher] CRITICAL: Could not re-read job state for ${job.mobilesd_job_id} after error.`);
             } else {
                 // Job was already marked failed (likely by options error handler)
                 console.log(`[Dispatcher] Job ${job.mobilesd_job_id} was already marked as failed. Error during txt2img or later step: ${error.message}`);
             }

        } finally {
            // --- IMPORTANT: Free Server ---
            busyServers.delete(serverAlias);
            console.log(`[Dispatcher] Server ${serverAlias} marked as free.`);
        }
        // Break after attempting one job dispatch per cycle to be less aggressive
        break;
    } // End of job loop
}

// Main dispatcher loop function
async function dispatchJobs() {
    // console.log('[Dispatcher] Checking for pending jobs...');
    let queue;
    try {
        queue = await readJobQueue();
    } catch (error) {
        console.error('[Dispatcher] Error reading job queue:', error);
        return; // Skip this interval if queue read fails
    }

    const pendingJobs = queue.filter(job => job.status === 'pending');

    if (pendingJobs.length === 0) {
        // console.log('[Dispatcher] No pending jobs found.');
        return;
    }

    console.log(`[Dispatcher] Found ${pendingJobs.length} pending jobs. Busy servers: ${[...busyServers]}`);

    // Simple FIFO processing for now
    for (const job of pendingJobs) {
        if (!busyServers.has(job.target_server_alias)) {
            // Server is not busy, process this job (async, don't await here)
            processJob(job).catch(err => {
                // Catch unexpected errors in processJob itself
                console.error(`[Dispatcher] Uncaught error during processJob for ${job.mobilesd_job_id}:`, err);
                // Ensure server is freed if processJob crashes unexpectedly
                 if (busyServers.has(job.target_server_alias)) {
                      console.warn(`[Dispatcher] Freeing server ${job.target_server_alias} due to unexpected error in processJob.`);
                      busyServers.delete(job.target_server_alias);
                 }
                 // Optionally try to mark job as failed here too?
            });
            // Move to next check interval after starting one job, 
            // or continue loop to potentially start jobs on *other* free servers?
            // Let's process all available slots in this tick:
            // break; // Uncomment to process only one job per interval
        } else {
            // console.log(`[Dispatcher] Server ${job.target_server_alias} is busy, skipping job ${job.mobilesd_job_id}`);
        }
    }
}

// Function to start the dispatcher
function startDispatcher() {
    if (dispatchIntervalId) {
        console.warn('[Dispatcher] Dispatcher already running.');
        return;
    }
    console.log(`[Dispatcher] Starting dispatcher service (interval: ${DISPATCH_INTERVAL_MS}ms)...`);
    // Ensure busyServers is clear on start?
    busyServers.clear(); // Clear potentially stuck servers from previous runs
    dispatchIntervalId = setInterval(dispatchPendingJobs, DISPATCH_INTERVAL_MS); // Ensure the correct function is called
    // Run check once immediately
    dispatchPendingJobs();
}

// Function to stop the dispatcher
function stopDispatcher() {
    if (dispatchIntervalId) {
        console.log('[Dispatcher] Stopping dispatcher service...');
        clearInterval(dispatchIntervalId);
        dispatchIntervalId = null;
    } else {
        console.warn('[Dispatcher] Dispatcher not running.');
    }
}

// Export the module functions
module.exports = {
    startDispatcher,
    stopDispatcher,
    dispatchPendingJobs,
    verifyCheckpointExists,
    // Expose busyServers for potential use by the monitor to free up servers
    busyServers
}; 