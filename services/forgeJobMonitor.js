const EventSource = require('eventsource');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // For downloading images
const jobQueue = require('../utils/jobQueueHelpers');
const { getServerByAlias } = require('../utils/configHelpers'); // Changed from getServerConfig to getServerByAlias
const jobStatusManager = require('./jobStatusManager'); // Add the job status manager

// Store active monitoring connections, keyed by mobilesd_job_id
const activeMonitors = {};

// Add these constants near the top with other constants
const POLLING_ENABLED = true; // Set to false to disable polling
const POLLING_INTERVAL_MS = 1000; // Poll once per second
const POLLING_MAX_ATTEMPTS = 60; // Maximum polling attempts per job

// Store active polling intervals, keyed by mobilesd_job_id
const activePolls = {};

const STABLE_DIFFUSION_SAVE_PATH = process.env.STABLE_DIFFUSION_SAVE_PATH || './outputs'; // Ensure this aligns with your Docker setup

// Add this right after the activeMonitors declaration
const IGNORE_LOG_EVENT_TYPES = ['heartbeat', 'send_hash'];

// Add this variable near the top with other constants
const MINIMUM_PROCESSING_TIME_MS = 5000; // Minimum of 5 seconds before accepting completion

// Debug logging settings
const DETAILED_FORGE_LOGGING = true; // Set to false to reduce log verbosity

// Function to save a base64 image as a preview
async function savePreviewImage(base64Data, job, isPreview = true) {
    try {
        if (!base64Data || !base64Data.startsWith('data:image')) {
            return null;
        }

        // Extract the base64 data part (remove the data:image/png;base64, prefix)
        const base64Content = base64Data.split(',')[1];
        if (!base64Content) {
            return null;
        }

        const imageBuffer = Buffer.from(base64Content, 'base64');
        const saveDir = path.resolve(STABLE_DIFFUSION_SAVE_PATH);
        
        // Ensure directory exists using synchronous checks and creation
        if (!fs.existsSync(saveDir)) {
            fs.mkdirSync(saveDir, { recursive: true });
        }

        // Create a filename based on job ID and time
        const prefix = isPreview ? 'preview_' : '';
        const filename = `${prefix}${job.mobilesd_job_id.substring(0,8)}_${Date.now()}.png`;
        const savePath = path.join(saveDir, filename);

        // Use synchronous write to ensure file is written before function returns
        fs.writeFileSync(savePath, imageBuffer);
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: ${isPreview ? 'Preview' : 'Image'} saved to ${savePath}`);
        return filename;
    } catch (error) {
        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error saving ${isPreview ? 'preview' : 'image'} from base64:`, error.message);
        return null;
    }
}

async function downloadImage(imageUrl, job, filename) {
    try {
        const serverConfig = await getServerByAlias(job.target_server_alias);
        if (!serverConfig) {
            console.error(`[Monitor] Job ${job.mobilesd_job_id}: Server config not found for ${job.target_server_alias} during download.`);
            return null;
        }

        // imageUrl is now the absolute path from Forge, e.g., "C:\\path\\to\\image.png"
        // Construct the URL using Forge's /file= endpoint
        const fullImageUrl = `${serverConfig.apiUrl}/file=${encodeURIComponent(imageUrl)}`;
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Downloading image from ${fullImageUrl}`);

        const axiosConfig = {};
        if (serverConfig.username && serverConfig.password) {
            axiosConfig.auth = {
                username: serverConfig.username,
                password: serverConfig.password,
            };
        }
        axiosConfig.responseType = 'arraybuffer';

        const response = await axios.get(fullImageUrl, axiosConfig);

        // Ensure directory exists using synchronous operation
        const saveDir = path.resolve(STABLE_DIFFUSION_SAVE_PATH);
        if (!fs.existsSync(saveDir)) {
            fs.mkdirSync(saveDir, { recursive: true });
        }
        
        const savePath = path.join(saveDir, filename);

        // Use synchronous write to ensure file is written before function returns
        fs.writeFileSync(savePath, response.data);
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Image saved to ${savePath}`);
        return filename; // Return the simple filename for storage in DB
    } catch (error) {
        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error downloading image ${imageUrl}:`, error.message);
        if (error.response) {
            console.error(`[Monitor] Download Error Status: ${error.response.status}`);
            console.error(`[Monitor] Download Error Data:`, error.response.data ? error.response.data.toString().substring(0, 200) : 'N/A');
        }
        return null;
    }
}

/**
 * Handles the completion of the generation process
 * @param {Object} job - The job object
 * @param {Object} eventData - The process_completed event data
 * @returns {Promise<string[]>} - List of saved image filenames
 */
async function handleProcessCompleted(job, eventData) {
    console.log(`[FORGE→SERVER] Job ${job.mobilesd_job_id}: Process completed event received`);
    console.log(`[FORGE→SERVER] Job ${job.mobilesd_job_id}: Completion event data: ${JSON.stringify(eventData).substring(0, 300)}...`);
    
    // CRITICAL: Check if this job has already been marked as completed to prevent duplicate processing
    // This can happen if we receive multiple process_completed events or process the same event multiple times
    const currentJob = await jobQueue.getJobById(job.mobilesd_job_id);
    if (currentJob && currentJob.status === 'completed') {
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Job is already marked as completed, skipping duplicate processing`);
        return [];
    }
    
    // Check if enough time has passed since the job started processing
    const processingStarted = new Date(job.processing_started_at || new Date().toISOString());
    const now = new Date();
    const processingTime = now - processingStarted;
    
    // Log the processing time regardless
    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Process took ${processingTime}ms to complete`);
    
    // Set a shorter minimum time for this server (could be cached and configurable)
    const MIN_PROCESSING_TIME = 1000; // 1 second minimum
    
    if (processingTime < MIN_PROCESSING_TIME) {
        console.warn(`[Monitor] Job ${job.mobilesd_job_id}: Received completion very quickly (${processingTime}ms), but will process it anyway`);
        // We're no longer ignoring quick completions since Forge can be very fast
    }
    
    // Ensure progress is at 100%
    await updateAndBroadcastProgress(job, 100, null);
    
    try {
        // IMPORTANT: We won't use 'processing_completed' status as it's not allowed in the database
        // Instead we'll track the job state using result_details
        await jobQueue.updateJob(job.mobilesd_job_id, {
            result_details: {
                ...job.result_details,
                completion_started_at: new Date().toISOString(),
                is_processing_completion: true
            }
        });
        
        // Extract result data from the event
        if (!eventData.output || !eventData.output.data) {
            console.error(`[Monitor] Job ${job.mobilesd_job_id}: No output data in process_completed event`);
            return [];
        }
        
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Checking output.data array for images`);
        
        // Extract images from output.data, which might be nested
        let images = [];
        let generationInfo = null;
        
        // Handle different data structures that Forge might return
        if (Array.isArray(eventData.output.data) && eventData.output.data.length > 0) {
            if (Array.isArray(eventData.output.data[0])) {
                // First structure: data[0] is an array of image objects
                const outputImages = eventData.output.data[0];
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Found ${outputImages.length} image(s) to download from nested array.`);
                
                // Extract each image in the array
                for (const imgObj of outputImages) {
                    if (imgObj && imgObj.image) {
                        if (imgObj.image.path) {
                            images.push({
                                path: imgObj.image.path,
                                url: imgObj.image.url || `${job.base_url}/file=${encodeURIComponent(imgObj.image.path)}`
                            });
                        } else if (imgObj.image.url) {
                            images.push({ url: imgObj.image.url });
                        }
                    }
                }
                
                // Parse generation info from data[1] if it exists
                if (eventData.output.data[1] && typeof eventData.output.data[1] === 'string') {
                    try {
                        generationInfo = JSON.parse(eventData.output.data[1]);
                        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Parsed generation info from data[1]`);
                    } catch (e) {
                        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error parsing generation info:`, e.message);
                        // Try storing the string directly
                        generationInfo = eventData.output.data[1];
                    }
                }
            } else if (typeof eventData.output.data[0] === 'object' && eventData.output.data[0].image) {
                // Handle single image directly in data[0]
                const imgObj = eventData.output.data[0];
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Found single image object in data[0]`);
                
                if (imgObj.image.path) {
                    images.push({
                        path: imgObj.image.path,
                        url: imgObj.image.url || `${job.base_url}/file=${encodeURIComponent(imgObj.image.path)}`
                    });
                } else if (imgObj.image.url) {
                    images.push({ url: imgObj.image.url });
                }
            }
        }
        
        // Fallback: If we didn't find any images in the expected locations, try deeply searching the structure
        if (images.length === 0) {
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: No images found in standard locations. Trying deep search.`);
            
            // Deeply search for image paths in the response data
            const searchForImagePaths = (obj, paths = []) => {
                if (!obj || typeof obj !== 'object') return;
                
                // Check if this is an image object
                if (obj.image && (obj.image.path || obj.image.url)) {
                    if (obj.image.path) {
                        images.push({
                            path: obj.image.path,
                            url: obj.image.url || `${job.base_url}/file=${encodeURIComponent(obj.image.path)}`
                        });
                    } else if (obj.image.url) {
                        images.push({ url: obj.image.url });
                    }
                    return;
                }
                
                // Recursively search each property
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        searchForImagePaths(obj[key], [...paths, key]);
                    }
                }
            };
            
            searchForImagePaths(eventData);
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: Deep search found ${images.length} image references`);
        }
        
        // De-duplicate images before downloading to prevent multiple copies
        // This handles cases where the same image path appears multiple times in the event data
        const uniqueImages = [];
        const imagePaths = new Set();
        
        for (const img of images) {
            const pathKey = img.path || img.url;
            if (!imagePaths.has(pathKey)) {
                imagePaths.add(pathKey);
                uniqueImages.push(img);
            }
        }
        
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Found ${images.length} images, ${uniqueImages.length} are unique`);
        images = uniqueImages;
        
        // Attempt to download or save the images
        const savedImages = [];
        let downloadError = null;
        
        // Use Promise.all to download images in parallel
        try {
            const downloadPromises = images.map(async (img, i) => {
                try {
                    let filename;
                    if (img.path) {
                        // For paths from Forge
                        const baseFilename = path.basename(img.path);
                        filename = makeImageFilename(job.mobilesd_job_id, baseFilename);
                        
                        // Check if this file already exists
                        const filePath = path.join(STABLE_DIFFUSION_SAVE_PATH, filename);
                        if (fs.existsSync(filePath)) {
                            console.log(`[Monitor] Job ${job.mobilesd_job_id}: Image ${filename} already exists, skipping download`);
                            return filename;
                        }
                        
                        // Download the image
                        const savedFilename = await downloadImage(img.path, job, filename);
                        if (savedFilename) {
                            return savedFilename;
                        }
                    } else if (img.url) {
                        // For URLs
                        try {
                            const url = new URL(img.url);
                            const baseFilename = path.basename(url.pathname);
                            filename = makeImageFilename(job.mobilesd_job_id, baseFilename);
                        } catch (e) {
                            filename = makeImageFilename(job.mobilesd_job_id, `image_${i}`);
                        }
                        
                        // Check if this file already exists
                        const filePath = path.join(STABLE_DIFFUSION_SAVE_PATH, filename);
                        if (fs.existsSync(filePath)) {
                            console.log(`[Monitor] Job ${job.mobilesd_job_id}: Image ${filename} already exists, skipping download`);
                            return filename;
                        }
                        
                        // Download the image
                        const response = await axios.get(img.url, { responseType: 'arraybuffer' });
                        const buffer = Buffer.from(response.data, 'binary');
                        
                        // Ensure directory exists
                        if (!fs.existsSync(STABLE_DIFFUSION_SAVE_PATH)) {
                            fs.mkdirSync(STABLE_DIFFUSION_SAVE_PATH, { recursive: true });
                        }
                        
                        // Save the image using synchronous writeFile
                        fs.writeFileSync(filePath, buffer);
                        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Image saved to ${filePath}`);
                        return filename;
                    }
                    return null;
                } catch (err) {
                    console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error saving image ${i}:`, err.message);
                    downloadError = err;
                    return null;
                }
            });
            
            const results = await Promise.all(downloadPromises);
            savedImages.push(...results.filter(Boolean));
        } catch (err) {
            console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error processing image downloads:`, err.message);
            downloadError = err;
        }
        
        // Log warning if no images were saved
        if (savedImages.length === 0) {
            console.warn(`[Monitor] Job ${job.mobilesd_job_id}: No images were saved. ${downloadError ? 'Error: ' + downloadError.message : 'No valid image data found.'}`);
        }
        
        // IMPORTANT: Mark job as completed FIRST, before attempting any other operations
        // This ensures the job gets marked as completed even if subsequent steps fail
        await jobQueue.updateJob(job.mobilesd_job_id, {
            status: 'completed',
            completion_timestamp: new Date().toISOString()
        });
        
        // Now update the job details
        await jobQueue.updateJob(job.mobilesd_job_id, {
            result_details: {
                ...job.result_details,
                saved_filenames: savedImages,
                images: savedImages, // Include under both keys for backward compatibility
                generation_info: generationInfo,
                progress_percentage: 100,
                completed_at: new Date().toISOString()
            }
        });
        
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Marked as 'completed'. Saved images: ${savedImages.join(', ')}`);
        
        // Broadcast final job update
        const updatedJob = await jobQueue.getJobById(job.mobilesd_job_id);
        console.log(`[SERVER→CLIENT] Job ${job.mobilesd_job_id}: Broadcasting final job update with status: ${updatedJob.status}`);
        jobStatusManager.broadcastJobUpdate(updatedJob);
        
        // Close the monitor for this job
        closeMonitor(job.mobilesd_job_id, "job_completed");
        
        return savedImages;
    } catch (error) {
        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error processing completed job: ${error.message}`);
        
        // Handle completion error by marking job as failed
        await jobQueue.updateJob(job.mobilesd_job_id, {
            status: 'failed',
            result_details: {
                ...job.result_details,
                error_message: `Error processing completed job: ${error.message}`,
                progress_percentage: 0
            }
        });
        
        // Broadcast final job update with error
        const updatedJob = await jobQueue.getJobById(job.mobilesd_job_id);
        jobStatusManager.broadcastJobUpdate(updatedJob);
        
        // Close the monitor for this job
        closeMonitor(job.mobilesd_job_id, "completion_error");
        
        return [];
    }
}

/**
 * Extract progress percentage from event data
 * @param {Object} eventData - The event data from Forge
 * @returns {number|null} - Progress percentage or null if not found
 */
function getProgressFromEventData(eventData) {
    // Handle different event types that might contain progress information
    if (eventData.msg === 'process_generating') {
        // Extract progress from process_generating events if available
        if (eventData.progress !== undefined) {
            return Math.round(eventData.progress * 100);
        }
    } else if (eventData.msg === 'process_starts') {
        // Process is starting - set to at least 1%
        return 1;
    } else if (eventData.msg === 'process_completed') {
        // Process is completed - set to 100%
        return 100;
    } else if (eventData.msg === 'estimation') {
        // Job is in queue, set to a small non-zero value for better UI
        return 0;
    }
    
    // No progress information found
    return null;
}

async function handleProcessGenerating(job, eventData) {
    // Get current percentage
    const percentageMatch = eventData.msg.match(/([0-9.]+)%/);
    let percentage = percentageMatch ? parseFloat(percentageMatch[1]) : null;
    
    // Fallback on looking at step info
    if (!percentage && eventData.step !== undefined && eventData.total_steps !== undefined) {
        percentage = (eventData.step / eventData.total_steps) * 100;
    }
    
    // URGENT FIX: Make sure percentage is properly parsed from different message formats
    if (!percentage && typeof eventData.msg === 'string') {
        // Try to extract from various message formats
        const stepMatch = eventData.msg.match(/Step (\d+)\/(\d+)/i);
        if (stepMatch && stepMatch[1] && stepMatch[2]) {
            const step = parseInt(stepMatch[1], 10);
            const totalSteps = parseInt(stepMatch[2], 10);
            if (!isNaN(step) && !isNaN(totalSteps) && totalSteps > 0) {
                percentage = (step / totalSteps) * 100;
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Extracted progress from step info: ${percentage.toFixed(1)}%`);
            }
        }
    }
    
    // Convert NaN to 0 if we had calculation issues
    if (isNaN(percentage)) {
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Progress calculation resulted in NaN, setting to 0%`);
        percentage = 0;
    }
    
    // Ensure percentage is at least 1 for better UI display
    if (!percentage || percentage < 1) {
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Progress was less than 1%, setting to 1% for better UI display`);
        percentage = 1;
    }
    
    // Force percentage to be between 0 and 100
    percentage = Math.max(0, Math.min(100, percentage));

    // Build a combined info object
    const progressInfo = {
        ...job.result_details,
        progress_update: eventData,
        progress_percentage: percentage || 1, // Ensure at least 1% for UI display
        step: eventData.step,
        total_steps: eventData.total_steps
    };

    // URGENT FIX: Always log progress updates for easier debugging
    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Progress update - ${percentage ? percentage.toFixed(1) + '%' : 'Unknown'} (Step ${eventData.step || '?'}/${eventData.total_steps || '?'})`);

    // IMPORTANT: Always search for preview images in any event
        let previewImage = null;
    
    // First try using the dedicated image extraction function which checks multiple locations
    try {
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Attempting to extract preview image from event data`);
        previewImage = await extractAndSavePreviewImage(eventData, job);
        
        if (previewImage) {
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: Successfully extracted and saved preview image: ${previewImage}`);
            progressInfo.preview_image = previewImage;
        } else {
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: No preview image found in event data`);
        }
    } catch (previewError) {
        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error extracting preview image: ${previewError.message}`);
    }
    
    // As a fallback, check common locations if the extraction function didn't find anything
    if (!previewImage && eventData.output && typeof eventData.output === 'object') {
        if (eventData.output.image && typeof eventData.output.image === 'string' && eventData.output.image.startsWith('data:image')) {
            previewImage = await savePreviewImage(eventData.output.image, job);
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: Fallback found preview in output.image`);
            progressInfo.preview_image = previewImage;
        } else if (eventData.output.preview && typeof eventData.output.preview === 'string' && eventData.output.preview.startsWith('data:image')) {
            previewImage = await savePreviewImage(eventData.output.preview, job);
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: Fallback found preview in output.preview`);
            progressInfo.preview_image = previewImage;
        }
    }

    // URGENT FIX: Split the update calls to make progress update more reliable
    try {
        // First update just the progress percentage for quick UI updates
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Updating progress to ${percentage}%`);
        await jobQueue.updateJob(job.mobilesd_job_id, {
            result_details: { 
                progress_percentage: percentage,
            }
        });
        
        // Then update the full progress info
        const updatedJob = await jobQueue.updateJob(job.mobilesd_job_id, {
            result_details: progressInfo
        });
        
        // Update our in-memory job object to match
        if (updatedJob) {
            job.result_details = updatedJob.result_details;
        }
        
        // IMPORTANT: Always broadcast progress updates to clients
        if (jobStatusManager) {
            console.log(`[SERVER→CLIENT] Job ${job.mobilesd_job_id}: Broadcasting progress from process_generating event: ${percentage}%`);
            jobStatusManager.broadcastJobProgress(job.mobilesd_job_id, percentage, previewImage);
        }
        
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Successfully updated progress information`);
    } catch (error) {
        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error updating progress:`, error.message);
    }
    
    return false; // Continue monitoring
}

async function startMonitoringJob(mobilesdJobId) {
    if (activeMonitors[mobilesdJobId]) {
        console.warn(`[Monitor] Job ${mobilesdJobId}: Monitoring is already active.`);
        return;
    }

    const job = jobQueue.getJobById(mobilesdJobId);
    if (!job) {
        console.error(`[Monitor] Job ${mobilesdJobId}: Not found in queue. Cannot start monitoring.`);
        return;
    }
    if (job.status !== 'processing' || !job.forge_session_hash) {
        console.error(`[Monitor] Job ${mobilesdJobId}: Not in 'processing' state or missing forge_session_hash. Status: ${job.status}`);
        return;
    }

    const serverConfig = await getServerByAlias(job.target_server_alias);
    if (!serverConfig) {
        console.error(`[Monitor] Job ${mobilesdJobId}: Server config not found for ${job.target_server_alias}`);
        jobQueue.updateJob(mobilesdJobId, { status: 'failed', result_details: { error: `Server config ${job.target_server_alias} not found for monitoring.` }, completion_timestamp: new Date().toISOString() });
        return;
    }

    const sseUrl = new URL(`${serverConfig.apiUrl}/queue/data?session_hash=${job.forge_session_hash}`).href;
    console.log(`[Monitor] Job ${mobilesdJobId}: Starting to monitor Forge SSE stream at ${sseUrl}`);

    const eventSourceInitDict = {};
    if (serverConfig.username && serverConfig.password) {
        const  authHeader = 'Basic ' + Buffer.from(serverConfig.username + ":" + serverConfig.password).toString('base64');
        eventSourceInitDict.headers = { 'Authorization': authHeader };
    }

    // Store extra job monitoring state
    const monitorState = {
        lastImageEvent: null,
        processingImage: false,
        hasCompletedProcessing: false,
        lastProgressValue: 0,
        lastProgressUpdate: Date.now(),
        // New fields to track completion events
        lastCompletedEventTime: null,
        completionEventCount: 0,
        processedEvents: new Set(), // Track processed event IDs to avoid duplicates
        uniqueImageHashes: new Set(), // Track unique image hashes to avoid duplicates
        // Add polling state tracking
        pollingStarted: false,
        pollingAttempts: 0,
        lastPollingTime: null,
        hasReceivedPreview: false
    };

    const es = new EventSource(sseUrl, eventSourceInitDict);
    activeMonitors[mobilesdJobId] = es;

    // IMPORTANT: Broadcast initial progress update to ensure UI shows progress bar
    console.log(`[SERVER→CLIENT] Job ${job.mobilesd_job_id}: Broadcasting initial progress update (0%)`);
    if (jobStatusManager) {
        // First broadcast a job update to ensure clients know this job is processing
        jobStatusManager.broadcastJobUpdate(job);
        
        // Then broadcast a progress update to initialize progress bar
        jobStatusManager.broadcastJobProgress(job.mobilesd_job_id, 0, null);
    }

    // Store the current timestamp as the monitoring start time
    if (!job.processing_started_at) {
        await jobQueue.updateJob(mobilesdJobId, {
            processing_started_at: new Date().toISOString()
        });
    }

    // Start polling for Forge if enabled
    if (POLLING_ENABLED) {
        startPollingForgeStatus(job, serverConfig, monitorState);
    }

    es.onopen = function() {
        console.log(`[FORGE→SERVER] Job ${job.mobilesd_job_id}: SSE connection opened to Forge at ${sseUrl}`);
    };

    es.onmessage = async function(event) {
        try {
            const eventData = JSON.parse(event.data);
            
            // ENHANCED LOGGING: Always log the raw event from Forge for debugging
            if (DETAILED_FORGE_LOGGING && !IGNORE_LOG_EVENT_TYPES.includes(eventData.msg)) {
                console.log(`[FORGE→SERVER] Job ${job.mobilesd_job_id}: Received event type: ${eventData.msg}`);
                console.log(`[FORGE→SERVER] Job ${job.mobilesd_job_id}: Event data: ${JSON.stringify(eventData).substring(0, 300)}...`);
            }
            
            // For process_completed events, ensure we don't process the same one multiple times
            if (eventData.msg === 'process_completed') {
                // Check if job is already marked as completed
                const currentJobState = await jobQueue.getJobById(job.mobilesd_job_id);
                if (currentJobState && currentJobState.status === 'completed') {
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Ignoring duplicate process_completed event, job already completed`);
                    return;
                }
                
                if (currentJobState && currentJobState.result_details && currentJobState.result_details.is_processing_completion) {
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Ignoring duplicate process_completed event, job already being processed`);
                    return;
                }
                
                // Store the event data for potential processing after connection closure
                monitorState.lastImageEvent = eventData;
                monitorState.lastCompletedEventTime = Date.now();
                monitorState.hasCompletedProcessing = true; // Mark as completed for polling
                
                // Update job to flag we're processing this completion event
                await jobQueue.updateJob(job.mobilesd_job_id, {
                    result_details: { 
                        ...job.result_details,
                        last_event_msg: eventData.msg,
                        last_event_time: new Date().toISOString(),
                        last_event_type: eventData.msg || "unknown",
                        completion_event_received: true
                    }
                });
                
                // Set progress to 100% immediately for better UI response
                await updateAndBroadcastProgress(job, 100, null);
                
                // Process the completion event (will handle its own job status check)
                await handleProcessCompleted(job, eventData);
                return; // Return early to avoid processing this event in the switch statement below
            } else {
                // Always record the event type and timestamp for debugging (for non-completion events)
                await jobQueue.updateJob(job.mobilesd_job_id, {
                    result_details: { 
                        ...job.result_details,
                        last_event_msg: eventData.msg,
                        last_event_time: new Date().toISOString(),
                        last_event_type: eventData.msg || "unknown"
                    }
                });
            }
            
            // Check for preview images in ANY event
            const previewImage = await extractAndSavePreviewImage(eventData, job);
            if (previewImage) {
                console.log(`[FORGE→SERVER] Job ${job.mobilesd_job_id}: Found and saved preview image: ${previewImage}`);
                // Update state to indicate we've received a preview image
                monitorState.hasReceivedPreview = true;
                await jobQueue.updateJob(job.mobilesd_job_id, {
                    result_details: { 
                        ...job.result_details,
                        preview_image: previewImage,
                        preview_source: 'sse'
                    }
                });
                
                // Broadcast the preview image to clients
                const currentProgress = job.result_details?.progress_percentage || monitorState.lastProgressValue || 1;
                console.log(`[SERVER→CLIENT] Job ${job.mobilesd_job_id}: Broadcasting progress update with SSE preview: ${currentProgress}%`);
                jobStatusManager.broadcastJobProgress(job.mobilesd_job_id, currentProgress, previewImage);
            }
            
            // Extract progress percentage from any event type with detailed logging
            const progressPercentage = getProgressFromEventData(eventData);
            
            if (progressPercentage !== null) {
                // Ensure progress is at least 1% for better UI display
                const adjustedProgress = Math.max(1, progressPercentage);
                console.log(`[Monitor][PROGRESS] Job ${job.mobilesd_job_id}: Extracted progress: ${adjustedProgress}% (originally ${progressPercentage}%) from ${eventData.msg} event`);
                
                // Important: Update just the progress percentage immediately
                await jobQueue.updateJob(job.mobilesd_job_id, {
                    result_details: { 
                        ...job.result_details,
                        progress_percentage: adjustedProgress
                    }
                });
                
                // If this isn't a process_generating event, we need to update the status to processing
                // This ensures jobs don't get stuck in pending even if process_generating events aren't received
                if (job.status !== 'processing') {
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Updating status to processing due to progress info`);
                    const updatedJob = await jobQueue.updateJob(job.mobilesd_job_id, {
                        status: 'processing'
                    });
                    
                    // Broadcast job status update via WebSocket
                    if (updatedJob && jobStatusManager) {
                        jobStatusManager.broadcastJobUpdate(updatedJob);
                    }
                }
                
                // Get the latest preview image after updating
                const currentPreviewImage = job.result_details?.preview_image || previewImage || null;
                
                // Broadcast progress update via WebSocket
                console.log(`[SERVER→CLIENT] Job ${job.mobilesd_job_id}: Broadcasting progress from progress event: ${adjustedProgress}%`);
                jobStatusManager.broadcastJobProgress(job.mobilesd_job_id, adjustedProgress, currentPreviewImage);
                
                // Update state for artificial progress
                monitorState.lastProgressValue = adjustedProgress;
                monitorState.lastProgressUpdate = Date.now();
            }
            
            // Add artificial progress updates if we're stuck at a low percentage for too long
            // Only do this if polling is not active to avoid conflicts
            if (monitorState.lastProgressUpdate && (Date.now() - monitorState.lastProgressUpdate > 3000) && !monitorState.pollingStarted) {
                // We haven't received a progress update in 3 seconds
                if (monitorState.lastProgressValue < 90) {
                    // Only increment if below 90%
                    const newProgress = Math.min(90, monitorState.lastProgressValue + 5); // Increment by 5%
                    console.log(`[ARTIFICIAL] Job ${job.mobilesd_job_id}: No progress updates in 3s, artificially incrementing to ${newProgress}%`);
                    
                    // Update progress in the system
                    await jobQueue.updateJob(job.mobilesd_job_id, {
                    result_details: { 
                        ...job.result_details,
                            progress_percentage: newProgress,
                            is_artificial_progress: true
                        }
                    });
                    
                    // Broadcast to clients
                    const currentPreviewImage = job.result_details?.preview_image || null;
                    console.log(`[SERVER→CLIENT] Job ${job.mobilesd_job_id}: Broadcasting artificial progress update: ${newProgress}%`);
                    jobStatusManager.broadcastJobProgress(job.mobilesd_job_id, newProgress, currentPreviewImage);
                    
                    // Update state
                    monitorState.lastProgressValue = newProgress;
                    monitorState.lastProgressUpdate = Date.now();
                }
            }
            
            // Handle other specific event types
            switch (eventData.msg) {
                case 'estimation':
                    await jobQueue.updateJob(job.mobilesd_job_id, {
                        result_details: { ...job.result_details, progress_estimation: eventData }
                    });
                    break;
                case 'progress':
                    // Extract progress percentage from the event data with detailed logging
                    let progressValue = 0;
                    
                    if (eventData.value && typeof eventData.value.progress === 'number') {
                        progressValue = Math.round(eventData.value.progress * 100);
                        console.log(`[Monitor][PROGRESS] Job ${job.mobilesd_job_id}: Got progress from eventData.value.progress: ${progressValue}%`);
                    } else if (eventData.progress && typeof eventData.progress === 'number') {
                        progressValue = Math.round(eventData.progress * 100);
                        console.log(`[Monitor][PROGRESS] Job ${job.mobilesd_job_id}: Got progress from eventData.progress: ${progressValue}%`);
                    } else {
                        // Try to extract progress from more places
                        console.log(`[Monitor][PROGRESS] Job ${job.mobilesd_job_id}: Progress event without standard progress value. Looking deeper in:`, JSON.stringify(eventData).substring(0, 200));
                        
                        // Check for step info
                        if (eventData.step !== undefined && eventData.total_steps !== undefined) {
                            progressValue = Math.round((eventData.step / eventData.total_steps) * 100);
                            console.log(`[Monitor][PROGRESS] Job ${job.mobilesd_job_id}: Calculated progress from step/total_steps: ${progressValue}%`);
                        }
                    }
                    
                    // Store progress in the job's result_details
                    await jobQueue.updateJob(job.mobilesd_job_id, {
                        result_details: { 
                            ...job.result_details, 
                            progress_update: eventData,
                            progress_percentage: progressValue
                        }
                    });
                    
                    // Save progress percentage for potential use with preview images
                    monitorState.lastProgressValue = progressValue;
                    monitorState.lastProgressUpdate = Date.now();
                    
                    // Broadcast progress update to connected clients
                    console.log(`[SERVER→CLIENT] Job ${job.mobilesd_job_id}: Broadcasting progress from progress event: ${progressValue}%`);
                    jobStatusManager.broadcastJobProgress(job.mobilesd_job_id, progressValue, null);
                    
                    // Check if this progress event contains a preview image
                    if (eventData.value && eventData.value.preview && typeof eventData.value.preview === 'string' && 
                        eventData.value.preview.startsWith('data:image')) {
                        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Progress event contains a preview image`);
                        
                        // Save the preview image
                        const previewFilename = await savePreviewImage(eventData.value.preview, job);
                        if (previewFilename) {
                            // Update the job with the preview image filename
                            const updatedJob = await jobQueue.updateJob(job.mobilesd_job_id, {
                                result_details: { 
                                    ...job.result_details, 
                                    preview_image: previewFilename,
                                    progress_percentage: progressValue
                                }
                            });
                            
                            // Broadcast the preview image to connected clients
                            jobStatusManager.broadcastJobProgress(job.mobilesd_job_id, progressValue, previewFilename);
                        }
                    }
                    break;
                case 'process_starts':
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Forge process starting.`);
                    await jobQueue.updateJob(job.mobilesd_job_id, {
                        result_details: { ...job.result_details, info: 'Forge image generation process started.' }
                    });
                    
                    // Initialize progress tracking state
                    monitorState.lastProgressValue = 1;
                    monitorState.lastProgressUpdate = Date.now();
                    
                    // Start artificial progress updates with a 1% value if we haven't got any yet
                    await updateAndBroadcastProgress(job, 1, null);
                    break;
                case 'process_generating':
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Process generating event received`);
                    console.log(`[Monitor][PROGRESS] Job ${job.mobilesd_job_id}: process_generating event data: ${JSON.stringify(eventData).substring(0, 300)}`);
                    
                    try {
                        // Extract progress percentage from event data
                        let percentage = null;
                        
                        // First try to extract from progress field if available
                        if (eventData.progress !== undefined) {
                            percentage = Math.round(eventData.progress * 100);
                            console.log(`[Monitor][PROGRESS] Job ${job.mobilesd_job_id}: Got progress from eventData.progress: ${percentage}%`);
                        }
                        
                        // Then try step info which is common in process_generating events
                        if (percentage === null && eventData.step !== undefined && eventData.total_steps !== undefined) {
                            percentage = Math.round((eventData.step / eventData.total_steps) * 100);
                            console.log(`[Monitor][PROGRESS] Job ${job.mobilesd_job_id}: Calculated progress from step/total_steps: ${percentage}%`);
                        }
                        
                        // Try direct function call as fallback
                        if (percentage === null) {
                            percentage = getProgressFromEventData(eventData);
                            if (percentage !== null) {
                                console.log(`[Monitor][PROGRESS] Job ${job.mobilesd_job_id}: Got progress from getProgressFromEventData: ${percentage}%`);
                            }
                        }
                        
                        if (percentage !== null) {
                            // Extract and save preview image if available
                            const previewImage = await extractAndSavePreviewImage(eventData, job);
                            
                            // Update job progress and broadcast to clients
                            await updateAndBroadcastProgress(job, percentage, previewImage);
                            
                            // Update job status to processing if not already
                            if (job.status !== 'processing') {
                                await jobQueue.updateJob(job.mobilesd_job_id, {
                                    status: 'processing'
                                });
                                
                                // Broadcast full job update for status change
                                const updatedJob = await jobQueue.getJobById(job.mobilesd_job_id);
                                jobStatusManager.broadcastJobUpdate(updatedJob);
                            }
                            
                            // Update progress tracking state
                            monitorState.lastProgressValue = percentage;
                            monitorState.lastProgressUpdate = Date.now();
                        } else {
                            console.log(`[Monitor][PROGRESS] Job ${job.mobilesd_job_id}: Could not extract progress from process_generating event`);
                        }
                    } catch (error) {
                        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error handling progress update: ${error.message}`);
                    }
                    break;
                case 'close_stream':
                    // When the stream is closed by Forge, check if we have a completion event
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Forge is closing the stream`);
                    
                    // Only process the saved completion event if the job isn't already completed
                    const currentStatus = await jobQueue.getJobById(job.mobilesd_job_id);
                    if (monitorState.lastImageEvent && 
                        !(currentStatus && (currentStatus.status === 'completed' || 
                          (currentStatus.result_details && currentStatus.result_details.is_processing_completion)))) {
                        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Processing completion from saved event after stream close`);
                        await handleProcessCompleted(job, monitorState.lastImageEvent);
                    }
                    break;
                case 'heartbeat':
                    // Don't log heartbeats
                    break;
                case 'send_hash':
                    // Don't log send_hash events
                    break;
                case 'queue_full':
                     console.warn(`[Monitor] Job ${job.mobilesd_job_id}: Forge queue is full. Rank: ${eventData.rank}, Size: ${eventData.queue_size}`);
                     await jobQueue.updateJob(job.mobilesd_job_id, {
                        status: 'queued_on_forge', // Custom status
                        result_details: { info: `Forge queue is full. Current rank ${eventData.rank}.` }
                    });
                    break;
                case 'process_completed':
                    // We already handled this above to prevent duplicate processing
                    break;
                default:
                    if (!IGNORE_LOG_EVENT_TYPES.includes(eventData.msg)) {
                        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Unhandled SSE message type: ${eventData.msg}`);
                    }
            }
        } catch (parseError) {
            console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error parsing SSE event data: ${parseError.message}. Data:`, event.data.substring(0, 200));
        }
    };

    es.onerror = async function(err) {
        console.error(`[FORGE→SERVER] Job ${job.mobilesd_job_id}: SSE connection error: ${err}`);
        
        try {
            // Get the current status from the database before doing anything
            const currentJob = await jobQueue.getJobById(job.mobilesd_job_id);
            
            // If job is already completed or in processing_completed state, just close the monitor
            if (currentJob && (currentJob.status === 'completed' || currentJob.status === 'processing_completed')) {
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Job already in ${currentJob.status} state during error handling, just cleaning up`);
                delete activeMonitors[job.mobilesd_job_id];
                return;
            }
            
            // If we have an image event that hasn't been processed yet, process it now
            if (monitorState.lastImageEvent && !monitorState.processingImage && !monitorState.hasCompletedProcessing) {
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: SSE connection closed but we have an unprocessed image event. Processing now.`);
                
                monitorState.processingImage = true;
                try {
                    await handleProcessCompleted(job, monitorState.lastImageEvent);
                    monitorState.hasCompletedProcessing = true;
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Images successfully processed after connection closed.`);
                    
                    // No need to continue with other error handling since we successfully processed the job
                    delete activeMonitors[job.mobilesd_job_id];
                    return;
                } catch (processingError) {
                    console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error processing image event after connection closed:`, processingError);
                }
                monitorState.processingImage = false;
            }
            
            // Handle cases where no completion event was received but the job was running for a while
            if (currentJob && currentJob.status === 'processing') {
                // The job is still processing but we don't have a saved completion event
                // Check if it's been running for a reasonable amount of time
                const processingStarted = new Date(currentJob.processing_started_at || new Date().toISOString());
                const processingTime = new Date() - processingStarted;
                
                if (processingTime > 10000) {  // If it's been processing for more than 10 seconds
                    // It's probably completed and the image is already downloaded
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Job was processing for ${processingTime}ms, assuming completed`);
                    await jobQueue.updateJob(job.mobilesd_job_id, {
                        status: 'completed',
                        completion_timestamp: new Date().toISOString(),
                        result_details: {
                            ...currentJob.result_details,
                            auto_completed: true,
                            error_details: "Connection to Forge lost after processing > 10s, job assumed completed"
                        }
                    });
                    
                    // Final job update broadcast
                    const finalJob = await jobQueue.getJobById(job.mobilesd_job_id);
                    if (finalJob) {
                        jobStatusManager.broadcastJobUpdate(finalJob);
                    }
                    
                    // Clean up
                    delete activeMonitors[job.mobilesd_job_id];
                    return;
                }
            }
            
            // If we get here, we need to mark the job as failed
            if (currentJob && currentJob.status !== 'completed' && currentJob.status !== 'failed') {
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Marking job as failed due to SSE error with no recovery`);
                await jobQueue.updateJob(job.mobilesd_job_id, {
                    status: 'failed',
                    result_details: { 
                        ...currentJob.result_details,
                        error: `Connection to Forge lost: ${err.message || 'Unknown error'}`,
                        error_time: new Date().toISOString()
                    },
                    completion_timestamp: new Date().toISOString()
                });
                
                // Final job update broadcast
                const failedJob = await jobQueue.getJobById(job.mobilesd_job_id);
                if (failedJob) {
                    jobStatusManager.broadcastJobUpdate(failedJob);
                }
            }
            
            // Always clean up the monitor
            delete activeMonitors[job.mobilesd_job_id];
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: SSE connection closed. Reason: onerror.`);
            
        } catch (handlerError) {
            // Last resort error handling
            console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error in SSE error handler:`, handlerError);
            delete activeMonitors[job.mobilesd_job_id];
        }
    };
}

// Add this new polling function
/**
 * Periodically poll Forge for job status, progress, and preview images
 * @param {Object} job - The job object
 * @param {Object} serverConfig - The server configuration
 * @param {Object} monitorState - The monitor state object
 */
async function startPollingForgeStatus(job, serverConfig, monitorState) {
    if (activePolls[job.mobilesd_job_id]) {
        console.log(`[POLL] Job ${job.mobilesd_job_id}: Polling already started`);
        return;
    }

    console.log(`[POLL] Job ${job.mobilesd_job_id}: Starting to poll Forge server at ${serverConfig.apiUrl}`);
    monitorState.pollingStarted = true;
    monitorState.lastPollingTime = Date.now();
    
    // Set up polling interval
    const pollInterval = setInterval(async () => {
        try {
            // Check if we should stop polling
            if (monitorState.pollingAttempts >= POLLING_MAX_ATTEMPTS || 
                !activeMonitors[job.mobilesd_job_id] || 
                monitorState.hasCompletedProcessing) {
                clearInterval(pollInterval);
                delete activePolls[job.mobilesd_job_id];
                console.log(`[POLL] Job ${job.mobilesd_job_id}: Stopping polling - ${
                    monitorState.pollingAttempts >= POLLING_MAX_ATTEMPTS ? 'max attempts reached' : 
                    !activeMonitors[job.mobilesd_job_id] ? 'monitor closed' : 
                    'job completed'}`);
                return;
            }

            // Increment polling attempts
            monitorState.pollingAttempts++;
            monitorState.lastPollingTime = Date.now();
            
            console.log(`[POLL] Job ${job.mobilesd_job_id}: Polling attempt ${monitorState.pollingAttempts}/${POLLING_MAX_ATTEMPTS}`);

            // Get current job status from Forge
            const progressResponse = await pollForProgress(job, serverConfig);
            
            if (progressResponse) {
                console.log(`[POLL→SERVER] Job ${job.mobilesd_job_id}: Received progress update from polling:`, 
                    JSON.stringify(progressResponse).substring(0, 200));

                // Handle progress update
                if (progressResponse.progress !== undefined && !isNaN(progressResponse.progress)) {
                    const percentage = Math.round(progressResponse.progress * 100);
                    console.log(`[POLL→SERVER] Job ${job.mobilesd_job_id}: Progress: ${percentage}%`);
                    
                    // Update job progress
                    await updateAndBroadcastProgress(job, percentage, null);
                    
                    // Update monitor state
                    monitorState.lastProgressValue = percentage;
                    monitorState.lastProgressUpdate = Date.now();
                }
                
                // Handle preview image
                if (progressResponse.current_image && !monitorState.hasReceivedPreview) {
                    console.log(`[POLL→SERVER] Job ${job.mobilesd_job_id}: Received preview image from polling`);
                    
                    // Save preview image
                    const previewFilename = await saveBase64Image(progressResponse.current_image, 
                        `preview_${job.mobilesd_job_id.substring(0,8)}_${Date.now()}.png`);
                    
                    if (previewFilename) {
                        monitorState.hasReceivedPreview = true;
                        console.log(`[POLL→SERVER] Job ${job.mobilesd_job_id}: Saved preview image: ${previewFilename}`);
                        
                        // Update job with preview image
                        await jobQueue.updateJob(job.mobilesd_job_id, {
                            result_details: { 
                                ...job.result_details, 
                                preview_image: previewFilename,
                                preview_source: 'polling'
                            }
                        });
                        
                        // Broadcast progress update with preview image
                        console.log(`[SERVER→CLIENT] Job ${job.mobilesd_job_id}: Broadcasting progress update with polled preview: ${monitorState.lastProgressValue}%`);
                        jobStatusManager.broadcastJobProgress(job.mobilesd_job_id, monitorState.lastProgressValue, previewFilename);
                    }
                }
                
                // Handle job completion
                if (progressResponse.completed && !monitorState.hasCompletedProcessing) {
                    console.log(`[POLL→SERVER] Job ${job.mobilesd_job_id}: Job completed according to polling`);
                    clearInterval(pollInterval);
                    delete activePolls[job.mobilesd_job_id];
                    
                    // The handleProcessCompleted function will be called by the SSE event handler
                    // We'll just make sure the progress is at 100%
                    await updateAndBroadcastProgress(job, 100, null);
                }
            }
        } catch (error) {
            console.error(`[POLL] Job ${job.mobilesd_job_id}: Error polling Forge: ${error.message}`);
        }
    }, POLLING_INTERVAL_MS);
    
    // Store the interval ID
    activePolls[job.mobilesd_job_id] = pollInterval;
}

/**
 * Poll Forge for progress on a specific job
 * @param {Object} job - The job object
 * @param {Object} serverConfig - The server configuration
 * @returns {Promise<Object|null>} - Progress data or null on error
 */
async function pollForProgress(job, serverConfig) {
    try {
        // Construct the progress endpoint URL
        const progressUrl = `${serverConfig.apiUrl}/internal/progress?id_task=${job.forge_internal_task_id}`;
        console.log(`[POLL] Job ${job.mobilesd_job_id}: Polling progress from ${progressUrl}`);
        
        // Set up authentication if needed
        const axiosConfig = {};
        if (serverConfig.username && serverConfig.password) {
            axiosConfig.auth = {
                username: serverConfig.username,
                password: serverConfig.password,
            };
        }
        
        // Make the request
        const response = await axios.get(progressUrl, axiosConfig);
        
        // Check if response contains valid data
        if (response.data && typeof response.data === 'object') {
            return response.data;
        } else {
            console.warn(`[POLL] Job ${job.mobilesd_job_id}: Empty or invalid response from Forge:`, 
                typeof response.data);
            return null;
        }
    } catch (error) {
        console.error(`[POLL] Job ${job.mobilesd_job_id}: Error polling Forge progress: ${error.message}`);
        if (error.response) {
            console.error(`[POLL] Error Status: ${error.response.status}`);
            console.error(`[POLL] Error Data:`, error.response.data ? error.response.data.toString().substring(0, 200) : 'N/A');
        }
        return null;
    }
}

function closeMonitor(mobilesdJobId, reason = "unknown") {
    // Stop polling if active
    if (activePolls[mobilesdJobId]) {
        clearInterval(activePolls[mobilesdJobId]);
        delete activePolls[mobilesdJobId];
        console.log(`[POLL] Job ${mobilesdJobId}: Polling stopped. Reason: ${reason}.`);
    }
    
    if (activeMonitors[mobilesdJobId]) {
        activeMonitors[mobilesdJobId].close();
        delete activeMonitors[mobilesdJobId];
        console.log(`[FORGE→SERVER] Job ${mobilesdJobId}: SSE connection closed. Reason: ${reason}.`);
        
        // Get the latest job data after closing the monitor
        setTimeout(async () => {
            try {
                const finalJob = await jobQueue.getJobById(mobilesdJobId);
                if (finalJob) {
                    // Broadcast the final job status
                    console.log(`[SERVER→CLIENT] Job ${mobilesdJobId}: Broadcasting final status update: ${finalJob.status}`);
                    jobStatusManager.broadcastJobUpdate(finalJob);
                }
            } catch (err) {
                console.error(`[Monitor] Error broadcasting final job status for ${mobilesdJobId}:`, err);
            }
        }, 100);
    }
}

// Function to potentially restart monitoring for jobs that were 'processing' when MobileSD restarted.
// This would be called from app.js on startup.
async function reinitializeMonitoring() {
    console.log('[Monitor] Re-initializing monitoring for any processing jobs...');
    const processingJobs = jobQueue.getJobsByStatus('processing');
    if (processingJobs.length > 0) {
        console.log(`[Monitor] Found ${processingJobs.length} job(s) in 'processing' state. Attempting to restart monitoring.`);
        for (const job of processingJobs) {
            // Small delay or check to ensure Forge session might still be valid.
            // If too much time has passed, the session_hash on Forge might be gone.
            // For now, we'll just try to reconnect.
            console.log(`[Monitor] Re-initiating monitoring for job ${job.mobilesd_job_id} with forge_session_hash ${job.forge_session_hash}`);
            await startMonitoringJob(job.mobilesd_job_id);
        }
    } else {
        console.log("[Monitor] No 'processing' jobs found to re-initialize monitoring for.");
    }
}

/**
 * Update job progress and broadcast to clients
 * @param {Object} job - MobileSD job object
 * @param {number} percentage - Progress percentage (0-100)
 * @param {string|null} previewImage - Preview image filename
 */
async function updateAndBroadcastProgress(job, percentage, previewImage = null) {
  try {
    // Normalize percentage to be between 1-100 for better UI display
    percentage = Math.max(1, Math.min(100, percentage || 1));
    
    // First update the progress percentage immediately
    await jobQueue.updateJobResult(job.mobilesd_job_id, {
      progress_percentage: percentage
    });
    
    // If we have a new preview image, update that too
    if (previewImage) {
      await jobQueue.updateJobResult(job.mobilesd_job_id, {
        preview_image: previewImage
      });
    }
    
    // Get the current preview image if we don't have a new one
    if (!previewImage) {
      const currentJob = await jobQueue.getJobById(job.mobilesd_job_id);
      previewImage = currentJob.result_details?.preview_image || null;
    }
    
    // ENHANCED LOGGING: Log the data being sent to clients
    console.log(`[SERVER→CLIENT] Job ${job.mobilesd_job_id}: Broadcasting progress update: ${percentage}% ${previewImage ? 'with preview' : 'no preview'}`);
    
    // Broadcast progress update via WebSocket
    jobStatusManager.broadcastJobProgress(job.mobilesd_job_id, percentage, previewImage);
  } catch (error) {
    console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error updating and broadcasting progress:`, error.message);
  }
}

// Add or update this helper function to create more predictable filenames
function makeImageFilename(jobId, baseFilename = null) {
  const timestamp = Date.now();
  const randomId = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  
  // If a base filename is provided, use parts of it, otherwise create a new one
  if (baseFilename) {
    // Extract any seed number if present (format: XXXXXXXX-seednum.png)
    const seedMatch = baseFilename.match(/-(\d+)\.[^.]+$/);
    const seedPart = seedMatch ? `-${seedMatch[1]}` : '';
    return `${jobId.substring(0, 8)}_${timestamp}${seedPart}.png`;
  }
  
  return `${jobId.substring(0, 8)}_${timestamp}_${randomId}.png`;
}

/**
 * Extracts and saves preview images from various event data formats
 * @param {Object} eventData - The event data from Forge
 * @param {Object} job - The job object
 * @returns {Promise<string|null>} - Saved preview image filename or null
 */
async function extractAndSavePreviewImage(eventData, job) {
    try {
        // Try to find image data in different places based on event type
        let previewImageUrl = null;
        let previewImageData = null;
        let baseFilename = null;
        
        // Case 1: process_generating event with preview image
        if (eventData.msg === 'process_generating' && eventData.preview) {
            // Direct base64 image in the preview field
            previewImageData = eventData.preview;
        }
        // Case 2: process_completed event with images in output.data[0]
        else if (eventData.msg === 'process_completed' && eventData.output && eventData.output.data) {
            if (Array.isArray(eventData.output.data[0]) && eventData.output.data[0].length > 0) {
                // The first image in the array
                const firstImage = eventData.output.data[0][0];
                if (firstImage && firstImage.image && firstImage.image.url) {
                    previewImageUrl = firstImage.image.url;
                    baseFilename = path.basename(firstImage.image.path || firstImage.image.url);
                }
            }
            // Case 3: Base64 images in output.data.images
            else if (eventData.output.data.images && eventData.output.data.images.length > 0) {
                previewImageData = eventData.output.data.images[0];
            }
        }
        
        // If we found a URL, download the image
        if (previewImageUrl) {
            try {
                const filename = makeImageFilename(job.mobilesd_job_id, baseFilename);
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Downloading image from ${previewImageUrl}`);
                
                const response = await axios.get(previewImageUrl, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data, 'binary');
                
                // Ensure directory exists
                fs.mkdirSync(STABLE_DIFFUSION_SAVE_PATH, { recursive: true });
                
                // Save the image using synchronous writeFile
                const filePath = path.join(STABLE_DIFFUSION_SAVE_PATH, filename);
                fs.writeFileSync(filePath, buffer);
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Image saved to ${filePath}`);
                
                return filename;
            } catch (downloadError) {
                console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error downloading preview image:`, downloadError.message);
                return null;
            }
        }
        // If we found base64 data, save it
        else if (previewImageData) {
            const filename = makeImageFilename(job.mobilesd_job_id);
            return await saveBase64Image(previewImageData, filename);
        }
        
        return null;
    } catch (error) {
        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error extracting preview image:`, error.message);
        return null;
    }
}

// Add or update function to save base64 image
/**
 * Saves a base64 image to a file
 * @param {string} base64Data - The base64 image data
 * @param {string} filename - The filename to save the image as
 * @returns {Promise<string|null>} - The saved filename or null on error
 */
async function saveBase64Image(base64Data, filename) {
    try {
        // Ensure the output directory exists
        fs.mkdirSync(STABLE_DIFFUSION_SAVE_PATH, { recursive: true });
        
        // Remove the data:image prefix if present
        let imageData = base64Data;
        if (base64Data.startsWith('data:image')) {
            const matches = base64Data.match(/^data:image\/\w+;base64,(.+)$/);
            if (matches && matches.length > 1) {
                imageData = matches[1];
            } else {
                // Couldn't extract the base64 part - fallback to original
                console.warn(`[Monitor] Could not extract base64 data - using original string.`);
            }
        }
        
        // Convert base64 to buffer and save to file
        const buffer = Buffer.from(imageData, 'base64');
        const filePath = path.join(STABLE_DIFFUSION_SAVE_PATH, filename);
        fs.writeFileSync(filePath, buffer);
        console.log(`[Monitor] Saved base64 image to ${filePath}`);
        
        return filename;
    } catch (error) {
        console.error(`[Monitor] Error saving base64 image:`, error.message);
        return null;
    }
}

module.exports = {
    startMonitoringJob,
    closeMonitor,
    reinitializeMonitoring,
    getActiveMonitors: () => activeMonitors,
    updateAndBroadcastProgress
}; 