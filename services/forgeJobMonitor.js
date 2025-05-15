const EventSource = require('eventsource');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios'); // For downloading images
const jobQueue = require('../utils/jobQueueHelpers');
const { getServerByAlias } = require('../utils/configHelpers'); // Changed from getServerConfig to getServerByAlias

// Store active monitoring connections, keyed by mobilesd_job_id
const activeMonitors = {};

const STABLE_DIFFUSION_SAVE_PATH = process.env.STABLE_DIFFUSION_SAVE_PATH || './outputs'; // Ensure this aligns with your Docker setup

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
        await fs.mkdir(saveDir, { recursive: true });

        // Create a filename based on job ID and time
        const prefix = isPreview ? 'preview_' : '';
        const filename = `${prefix}${job.mobilesd_job_id.substring(0,8)}_${Date.now()}.png`;
        const savePath = path.join(saveDir, filename);

        await fs.writeFile(savePath, imageBuffer);
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

        const saveDir = path.resolve(STABLE_DIFFUSION_SAVE_PATH);
        await fs.mkdir(saveDir, { recursive: true });
        const savePath = path.join(saveDir, filename);

        await fs.writeFile(savePath, response.data);
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

async function handleProcessCompleted(job, eventData) {
    // Only log a concise message here, not the full event data
    let processedSuccessfully = false; // Flag to indicate if we found and processed images
    let foundImagesToDownload = false; // Flag to indicate we at least found images, even if downloading fails

    if (!eventData || !eventData.output) {
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: This appears to be an empty process_completed event. Checking if another will follow.`);
        return processedSuccessfully; // Return false
    }

    // Store the raw event data for debugging purposes
    await jobQueue.updateJob(job.mobilesd_job_id, {
        result_details: { 
            ...job.result_details,
            last_completed_event: eventData
        }
    });

    let imagesToDownload = [];
    
    // Check all possible output structures for images
    
    // Structure 1: output.data is an array where first element contains the images
    if (eventData.output.data && 
        Array.isArray(eventData.output.data) && 
        eventData.output.data.length > 0 &&
        Array.isArray(eventData.output.data[0])) {
        
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Checking output.data[0] array for images`);
        eventData.output.data[0].forEach(item => {
            if (item && item.image && typeof item.image.path === 'string') {
                const forgePath = item.image.path.replace(/\\/g, '/'); // Normalize to forward slashes for path.basename
                imagesToDownload.push({
                    urlPath: item.image.path, // Keep original Windows path for download URL construction
                    localFilename: `${job.mobilesd_job_id.substring(0,8)}_${Date.now()}_${path.basename(forgePath)}`
                });
                foundImagesToDownload = true; // Mark that we found images
            } else if (item && item.image && typeof item.image.url === 'string') {
                // Some Forge versions provide a direct URL
                const imageUrl = item.image.url;
                const filename = imageUrl.split('/').pop() || `${Date.now()}_image.png`;
                imagesToDownload.push({
                    directUrl: imageUrl,
                    localFilename: `${job.mobilesd_job_id.substring(0,8)}_${Date.now()}_${filename}`
                });
                foundImagesToDownload = true; // Mark that we found images
            } else {
                console.warn(`[Monitor] Job ${job.mobilesd_job_id}: Encountered an item in process_completed data[0] without a valid image.path string. Item:`, JSON.stringify(item));
            }
        });
    }
    
    // Structure 2: output.data is an array of image objects directly
    if (imagesToDownload.length === 0 && 
        eventData.output.data && 
        Array.isArray(eventData.output.data) &&
        eventData.output.data.length > 0 &&
        eventData.output.data[0] && 
        typeof eventData.output.data[0] === 'object') {
        
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Checking output.data array for image objects`);
        eventData.output.data.forEach(item => {
            if (item && typeof item === 'object') {
                // Check if item is an image object with 'name' and 'data' (base64)
                if (item.name && item.data && typeof item.data === 'string' && item.data.startsWith('data:image')) {
                    imagesToDownload.push({
                        base64Data: item.data,
                        localFilename: `${job.mobilesd_job_id.substring(0,8)}_${Date.now()}_${item.name}`
                    });
                    foundImagesToDownload = true;
                }
                // Or if it has a 'path' property like in structure 1
                else if (item.path && typeof item.path === 'string') {
                    const forgePath = item.path.replace(/\\/g, '/'); 
                    imagesToDownload.push({
                        urlPath: item.path,
                        localFilename: `${job.mobilesd_job_id.substring(0,8)}_${Date.now()}_${path.basename(forgePath)}`
                    });
                    foundImagesToDownload = true;
                }
                // Or if it has an 'image' property with a 'path'
                else if (item.image && typeof item.image.path === 'string') {
                    const forgePath = item.image.path.replace(/\\/g, '/');
                    imagesToDownload.push({
                        urlPath: item.image.path,
                        localFilename: `${job.mobilesd_job_id.substring(0,8)}_${Date.now()}_${path.basename(forgePath)}`
                    });
                    foundImagesToDownload = true;
                }
                // Or if it has a direct URL
                else if (item.url && typeof item.url === 'string') {
                    const filename = item.url.split('/').pop() || `${Date.now()}_image.png`;
                    imagesToDownload.push({
                        directUrl: item.url,
                        localFilename: `${job.mobilesd_job_id.substring(0,8)}_${Date.now()}_${filename}`
                    });
                    foundImagesToDownload = true;
                }
            }
        });
    }
    
    // Structure 3: Check if images are in the 'changed_state_ids' section (some versions of Forge)
    if (imagesToDownload.length === 0 && 
        eventData.output.changed_state_ids && 
        Array.isArray(eventData.output.changed_state_ids)) {
        
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Checking changed_state_ids for image data`);
        eventData.output.changed_state_ids.forEach(stateId => {
            if (stateId && typeof stateId === 'object' && stateId.image) {
                const imageData = stateId.image;
                
                if (typeof imageData === 'string' && imageData.startsWith('data:image')) {
                    // Handle base64 image data
                    imagesToDownload.push({
                        base64Data: imageData,
                        localFilename: `${job.mobilesd_job_id.substring(0,8)}_${Date.now()}_generated.png`
                    });
                    foundImagesToDownload = true;
                } else if (imageData.path && typeof imageData.path === 'string') {
                    // Handle file path
                    const forgePath = imageData.path.replace(/\\/g, '/');
                    imagesToDownload.push({
                        urlPath: imageData.path,
                        localFilename: `${job.mobilesd_job_id.substring(0,8)}_${Date.now()}_${path.basename(forgePath)}`
                    });
                    foundImagesToDownload = true;
                }
            }
        });
    }

    // If we found images but imagesToDownload is empty, something strange happened
    if (foundImagesToDownload && imagesToDownload.length === 0) {
        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Found images in the response but failed to add them to the download list.`);
    }

    if (imagesToDownload.length === 0) {
        console.warn(`[Monitor] Job ${job.mobilesd_job_id}: No images found to download in this 'process_completed' event. Waiting for potentially more events.`);
        
        // Check if this job has received multiple empty completions
        const currentJob = await jobQueue.getJobById(job.mobilesd_job_id);
        const emptyCompletionCount = (currentJob.result_details && currentJob.result_details.empty_completion_count) || 0;
        
        // Mark job as failed after 3 empty completions
        if (emptyCompletionCount >= 2) {
            console.error(`[Monitor] Job ${job.mobilesd_job_id}: Received ${emptyCompletionCount + 1} empty completion events without images. Marking job as failed.`);
            await jobQueue.updateJob(job.mobilesd_job_id, {
                status: 'failed',
                result_details: { 
                    ...currentJob.result_details,
                    error: 'Job completed on Forge but no images were found in the response after multiple attempts.',
                    raw_response: JSON.stringify(eventData)
                },
                completion_timestamp: new Date().toISOString()
            });
            return true; // Return true to close monitor
        } else {
            // Update counter and continue waiting
            await jobQueue.updateJob(job.mobilesd_job_id, {
                result_details: { 
                    ...currentJob.result_details,
                    empty_completion_count: emptyCompletionCount + 1
                }
            });
        }
        
        return processedSuccessfully; // Return false to keep monitor open
    }

    // If we have images to download, proceed
    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Found ${imagesToDownload.length} image(s) to download.`);
    const savedImageFilenames = [];
    
    for (const imageInfo of imagesToDownload) {
        let savedName = null;
        
        // Handle base64 data directly
        if (imageInfo.base64Data) {
            try {
                // Base64 handling logic (extract data part and write to file)
                const base64Data = imageInfo.base64Data.split(',')[1];
                const saveDir = path.resolve(STABLE_DIFFUSION_SAVE_PATH);
                await fs.mkdir(saveDir, { recursive: true });
                const savePath = path.join(saveDir, imageInfo.localFilename);
                
                await fs.writeFile(savePath, Buffer.from(base64Data, 'base64'));
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Base64 image saved to ${savePath}`);
                savedName = imageInfo.localFilename;
            } catch (error) {
                console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error saving base64 image:`, error.message);
            }
        }
        // Handle direct URLs
        else if (imageInfo.directUrl) {
            try {
                const axiosConfig = { responseType: 'arraybuffer' };
                const response = await axios.get(imageInfo.directUrl, axiosConfig);
                
                const saveDir = path.resolve(STABLE_DIFFUSION_SAVE_PATH);
                await fs.mkdir(saveDir, { recursive: true });
                const savePath = path.join(saveDir, imageInfo.localFilename);
                
                await fs.writeFile(savePath, response.data);
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Direct URL image saved to ${savePath}`);
                savedName = imageInfo.localFilename;
            } catch (error) {
                console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error downloading direct URL image:`, error.message);
            }
        }
        // Use downloadImage for file paths
        else if (imageInfo.urlPath) {
            savedName = await downloadImage(imageInfo.urlPath, job, imageInfo.localFilename);
        }
        
        if (savedName) {
            savedImageFilenames.push(savedName);
        }
    }

    // Extract generation info if available
    let generationInfo = null;
    if (eventData.output.data && eventData.output.data.length > 1 && typeof eventData.output.data[1] === 'string') {
        try {
            generationInfo = JSON.parse(eventData.output.data[1]);
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: Parsed generation info:`, JSON.stringify(generationInfo, null, 2));
        } catch (e) {
            console.warn(`[Monitor] Job ${job.mobilesd_job_id}: Failed to parse generation info string from eventData.output.data[1]. Storing raw string. Error: ${e.message}`);
            // Store the raw string if JSON parsing fails but it might still be useful text
            generationInfo = eventData.output.data[1];
        }
    } else {
        console.warn(`[Monitor] Job ${job.mobilesd_job_id}: Generation info string not found at eventData.output.data[1].`);
    }

    // We got this far, so we found images, now check if we saved any successfully
    if (savedImageFilenames.length > 0) {
        // Update job to completed with saved images
        await jobQueue.updateJob(job.mobilesd_job_id, {
            status: 'completed',
            result_details: {
                images: savedImageFilenames,
                info: 'Job completed and images downloaded by MobileSD backend.',
                generation_info: generationInfo,
                raw_response: JSON.stringify(eventData)
            },
            completion_timestamp: new Date().toISOString()
        });
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Marked as 'completed'. Saved images: ${savedImageFilenames.join(', ')}`);
        processedSuccessfully = true;
    } else if (foundImagesToDownload) {
        // We found images but couldn't save any - mark as error
        await jobQueue.updateJob(job.mobilesd_job_id, {
            status: 'failed',
            result_details: { 
                error: 'Images were found in Forge response but all failed to download/save.',
                raw_response: JSON.stringify(eventData)
            },
            completion_timestamp: new Date().toISOString()
        });
        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Failed to download any images despite them being found.`);
        processedSuccessfully = true; // Mark as processed to close the monitor
    }

    return processedSuccessfully;
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

    // Build a combined info object
    const progressInfo = {
        ...job.result_details,
        progress_update: eventData,
        progress_percentage: percentage || 0,
        step: eventData.step,
        total_steps: eventData.total_steps
    };

    // URGENT FIX: Always log progress updates for easier debugging
    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Progress update - ${percentage ? percentage.toFixed(1) + '%' : 'Unknown'} (Step ${eventData.step || '?'}/${eventData.total_steps || '?'})`);

    if (eventData.output && typeof eventData.output === 'object') {
        // Check for preview image in various possible locations
        let previewImage = null;
        if (eventData.output.image && typeof eventData.output.image === 'string' && eventData.output.image.startsWith('data:image')) {
            // Direct base64 image
            previewImage = await savePreviewImage(eventData.output.image, job);
        } else if (eventData.output.preview && typeof eventData.output.preview === 'string' && eventData.output.preview.startsWith('data:image')) {
            // Preview field with base64
            previewImage = await savePreviewImage(eventData.output.preview, job);
        } else if (eventData.output.data && Array.isArray(eventData.output.data) && eventData.output.data.length > 0) {
            // For array data, check if we have any base64 images
            for (const item of eventData.output.data) {
                if (item && typeof item === 'string' && item.startsWith('data:image')) {
                    previewImage = await savePreviewImage(item, job);
                    break;
                } else if (item && item.image && typeof item.image === 'string' && item.image.startsWith('data:image')) {
                    previewImage = await savePreviewImage(item.image, job);
                    break;
                }
            }
        } else if (eventData.output.changed_state_ids && Array.isArray(eventData.output.changed_state_ids)) {
            // For state IDs, also check for any base64 images
            for (const state of eventData.output.changed_state_ids) {
                if (state && typeof state === 'string' && state.startsWith('data:image')) {
                    previewImage = await savePreviewImage(state, job);
                    break;
                } else if (state && state.image && typeof state.image === 'string' && state.image.startsWith('data:image')) {
                    previewImage = await savePreviewImage(state.image, job);
                    break;
                }
            }
        }

        if (previewImage) {
            progressInfo.preview_image = previewImage;
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: New preview image saved: ${previewImage}`);
        }
    }

    // URGENT FIX: Split the update calls to make progress update more reliable
    try {
        // First update just the progress percentage for quick UI updates
        await jobQueue.updateJob(job.mobilesd_job_id, {
            result_details: { 
                progress_percentage: percentage || 0,
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
        lastProgressValue: 0
    };

    const es = new EventSource(sseUrl, eventSourceInitDict);
    activeMonitors[mobilesdJobId] = es;

    es.onopen = function() {
        console.log(`[Monitor] Job ${job.mobilesd_job_id}: SSE connection opened to Forge.`);
    };

    es.onmessage = async function(event) {
        try {
            // URGENT FIX: Add extensive logging for all events to debug
            const eventString = event.data.substring(0, 1000); // Limit length for logging
            console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Received event: ${eventString}`);
            
            const eventData = JSON.parse(event.data);
            
            // URGENT FIX: Always record the raw event data for debugging purposes
            // This will help us understand what events we're receiving from Forge
            await jobQueue.updateJob(job.mobilesd_job_id, {
                result_details: { 
                    ...job.result_details,
                    last_event_msg: eventData.msg,
                    last_event_time: new Date().toISOString(),
                    last_event_type: eventData.msg || "unknown"
                }
            });
            
            // NEW FIX: Extract progress information from any event type
            // This allows us to catch progress info even if we don't get process_generating events
            const progressPercentage = getProgressFromEventData(eventData);
            
            if (progressPercentage !== null) {
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Extracted progress: ${progressPercentage}%`);
                
                // Important: Update just the progress percentage immediately
                await jobQueue.updateJob(job.mobilesd_job_id, {
                    result_details: { 
                        ...job.result_details,
                        progress_percentage: progressPercentage
                    }
                });
                
                // If this isn't a process_generating event, we need to update the status to processing
                // This ensures jobs don't get stuck in pending even if process_generating events aren't received
                if (job.status !== 'processing') {
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Updating status to processing due to progress info`);
                    await jobQueue.updateJob(job.mobilesd_job_id, {
                        status: 'processing'
                    });
                }
            }

            // NEW FIX: Check for preview images in any event, not just process_generating
            let previewFilename = await extractAndSavePreviewImage(eventData, job);
            if (previewFilename) {
                console.log(`[Monitor] Job ${job.mobilesd_job_id}: Found and saved preview image in event`);
                
                // Update the job with the preview image filename
                await jobQueue.updateJob(job.mobilesd_job_id, {
                    result_details: { 
                        ...job.result_details,
                        preview_image: previewFilename
                    }
                });
            }

            // Function to reliably extract progress from various event data formats
            function getProgressFromEventData(data) {
                // Try to find progress info from multiple sources
                let percentage = null;
                
                // Log the event structure for debugging
                console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Event structure keys: ${Object.keys(data).join(', ')}`);
                if (data.output) {
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Output keys: ${Object.keys(data.output).join(', ')}`);
                }
                
                // IMPROVED DETECTION: Check direct progress field
                if (data.progress && typeof data.progress === 'number') {
                    percentage = Math.round(data.progress * 100);
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found progress in data.progress: ${percentage}%`);
                }
                // Check value.progress field
                else if (data.value && typeof data.value.progress === 'number') {
                    percentage = Math.round(data.value.progress * 100);
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found progress in data.value.progress: ${percentage}%`);
                }
                // Check for value object with percent field
                else if (data.value && data.value.percent && typeof data.value.percent === 'number') {
                    percentage = Math.round(data.value.percent * 100);
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found progress in data.value.percent: ${percentage}%`);
                }
                // Check for direct percent field
                else if (data.percent && typeof data.percent === 'number') {
                    percentage = Math.round(data.percent * 100);
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found progress in data.percent: ${percentage}%`);
                }
                // Check step/total_steps fields
                else if (data.step !== undefined && data.total_steps !== undefined && 
                         typeof data.step === 'number' && typeof data.total_steps === 'number' && 
                         data.total_steps > 0) {
                    percentage = Math.round((data.step / data.total_steps) * 100);
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Calculated progress from step/total_steps: ${percentage}%`);
                }
                // Check in output data for steps
                else if (data.output && data.output.step !== undefined && data.output.total_steps !== undefined) {
                    percentage = Math.round((data.output.step / data.output.total_steps) * 100);
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Calculated progress from output.step/total_steps: ${percentage}%`);
                }
                // Try to extract from message string if present
                else if (data.msg && typeof data.msg === 'string') {
                    // Try percentage pattern (e.g., "50%")
                    const percentMatch = data.msg.match(/(\d+\.?\d*)%/);
                    if (percentMatch && percentMatch[1]) {
                        percentage = parseFloat(percentMatch[1]);
                        console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Extracted progress from msg percentage: ${percentage}%`);
                    }
                    // Try step pattern (e.g., "Step 10/20")
                    else {
                        const stepMatch = data.msg.match(/[sS]tep\s+(\d+)\s*\/\s*(\d+)/i);
                        if (stepMatch && stepMatch[1] && stepMatch[2]) {
                            const step = parseInt(stepMatch[1], 10);
                            const totalSteps = parseInt(stepMatch[2], 10);
                            if (!isNaN(step) && !isNaN(totalSteps) && totalSteps > 0) {
                                percentage = Math.round((step / totalSteps) * 100);
                                console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Extracted progress from msg step: ${percentage}%`);
                            }
                        }
                    }
                }
                
                // NEW FIX: Check inside nested output structures for progress info
                if (percentage === null && data.output) {
                    // Check in data array for progress info
                    if (data.output.data && Array.isArray(data.output.data)) {
                        for (let i = 0; i < data.output.data.length; i++) {
                            if (typeof data.output.data[i] === 'string' && data.output.data[i].includes('%')) {
                                const percentMatch = data.output.data[i].match(/(\d+\.?\d*)%/);
                                if (percentMatch && percentMatch[1]) {
                                    percentage = parseFloat(percentMatch[1]);
                                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found progress in output.data[${i}]: ${percentage}%`);
                                    break;
                                }
                            }
                        }
                    }
                }
                
                return percentage;
            }

            // Helper function to extract and save preview images from any event data
            async function extractAndSavePreviewImage(data, job) {
                // IMPROVED DETECTION: Look for preview images in more places
                console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Searching for preview image in event data`);
                
                // First check if there's a direct preview field at the top level
                if (data.preview && typeof data.preview === 'string' && data.preview.startsWith('data:image')) {
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in top-level preview field`);
                    return await savePreviewImage(data.preview, job);
                }
                
                // Check if there's a direct image field at the top level
                if (data.image && typeof data.image === 'string' && data.image.startsWith('data:image')) {
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in top-level image field`);
                    return await savePreviewImage(data.image, job);
                }
                
                // No preview if no output object
                if (!data.output || typeof data.output !== 'object') {
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: No output object found`);
                    
                    // Check in data.value as a fallback (some events use this structure)
                    if (data.value && typeof data.value === 'object') {
                        if (data.value.preview && typeof data.value.preview === 'string' && 
                            data.value.preview.startsWith('data:image')) {
                            console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in data.value.preview`);
                            return await savePreviewImage(data.value.preview, job);
                        }
                    }
                    
                    return null;
                }
                
                // Try all possible locations of preview images
                const output = data.output;
                
                // Check common locations for preview images
                if (output.image && typeof output.image === 'string' && output.image.startsWith('data:image')) {
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in output.image`);
                    return await savePreviewImage(output.image, job);
                }
                
                if (output.preview && typeof output.preview === 'string' && output.preview.startsWith('data:image')) {
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in output.preview`);
                    return await savePreviewImage(output.preview, job);
                }
                
                // Check within value object (common in progress events)
                if (output.value && output.value.preview && typeof output.value.preview === 'string' && 
                    output.value.preview.startsWith('data:image')) {
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in output.value.preview`);
                    return await savePreviewImage(output.value.preview, job);
                }
                
                // Direct value object check
                if (output.value && typeof output.value === 'string' && output.value.startsWith('data:image')) {
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in output.value string`);
                    return await savePreviewImage(output.value, job);
                }
                
                // Check in data array if it exists
                if (output.data && Array.isArray(output.data)) {
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Checking output.data array (length: ${output.data.length})`);
                    
                    // For base64 strings directly in array
                    for (let i = 0; i < output.data.length; i++) {
                        const item = output.data[i];
                        
                        if (typeof item === 'string' && item.startsWith('data:image')) {
                            console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in output.data[${i}] string`);
                            return await savePreviewImage(item, job);
                        }
                        
                        // For objects with image property
                        if (item && typeof item === 'object') {
                            if (item.image && typeof item.image === 'string' && item.image.startsWith('data:image')) {
                                console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in output.data[${i}].image`);
                                return await savePreviewImage(item.image, job);
                            }
                            
                            if (item.preview && typeof item.preview === 'string' && item.preview.startsWith('data:image')) {
                                console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in output.data[${i}].preview`);
                                return await savePreviewImage(item.preview, job);
                            }
                            
                            // Deeper nested check
                            if (item.data && typeof item.data === 'string' && item.data.startsWith('data:image')) {
                                console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in output.data[${i}].data`);
                                return await savePreviewImage(item.data, job);
                            }
                            
                            // Check for arrays within arrays (special case for some Forge versions)
                            if (Array.isArray(item) && item.length > 0) {
                                for (let j = 0; j < item.length; j++) {
                                    const subitem = item[j];
                                    
                                    if (typeof subitem === 'string' && subitem.startsWith('data:image')) {
                                        console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in output.data[${i}][${j}] string`);
                                        return await savePreviewImage(subitem, job);
                                    }
                                    
                                    if (subitem && typeof subitem === 'object') {
                                        if (subitem.image && typeof subitem.image === 'string' && subitem.image.startsWith('data:image')) {
                                            console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in output.data[${i}][${j}].image`);
                                            return await savePreviewImage(subitem.image, job);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Check in changed_state_ids array if it exists
                if (output.changed_state_ids && Array.isArray(output.changed_state_ids)) {
                    console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Checking changed_state_ids array`);
                    
                    for (let i = 0; i < output.changed_state_ids.length; i++) {
                        const item = output.changed_state_ids[i];
                        
                        if (typeof item === 'string' && item.startsWith('data:image')) {
                            console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in changed_state_ids[${i}] string`);
                            return await savePreviewImage(item, job);
                        }
                        
                        if (item && typeof item === 'object' && item.image) {
                            if (typeof item.image === 'string' && item.image.startsWith('data:image')) {
                                console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: Found preview image in changed_state_ids[${i}].image`);
                                return await savePreviewImage(item.image, job);
                            }
                        }
                    }
                }
                
                console.log(`[Monitor][DEBUG] Job ${job.mobilesd_job_id}: No preview image found in event data`);
                return null; // No preview image found
            }

            switch (eventData.msg) {
                case 'estimation':
                    await jobQueue.updateJob(job.mobilesd_job_id, {
                        result_details: { ...job.result_details, progress_estimation: eventData }
                    });
                    break;
                case 'progress':
                    // Extract progress percentage from the event data
                    let progressValue = 0;
                    if (eventData.value && typeof eventData.value.progress === 'number') {
                        progressValue = Math.round(eventData.value.progress * 100);
                    } else if (eventData.progress && typeof eventData.progress === 'number') {
                        progressValue = Math.round(eventData.progress * 100);
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
                    
                    // Check if this progress event contains a preview image
                    if (eventData.value && eventData.value.preview && typeof eventData.value.preview === 'string' && 
                        eventData.value.preview.startsWith('data:image')) {
                        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Progress event contains a preview image`);
                        
                        // Save the preview image
                        const previewFilename = await savePreviewImage(eventData.value.preview, job);
                        if (previewFilename) {
                            // Update the job with the preview image filename
                            await jobQueue.updateJob(job.mobilesd_job_id, {
                                result_details: { 
                                    ...job.result_details, 
                                    preview_image: previewFilename,
                                    progress_percentage: progressValue
                                }
                            });
                        }
                    }
                    break;
                case 'process_starts':
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Forge process starting.`);
                    await jobQueue.updateJob(job.mobilesd_job_id, {
                        result_details: { ...job.result_details, info: 'Forge image generation process started.' }
                    });
                    break;
                case 'process_generating':
                    // Call the dedicated handler function for process_generating events
                    const shouldCloseMonitor = await handleProcessGenerating(job, eventData);
                    if (shouldCloseMonitor) {
                        closeMonitor(job.mobilesd_job_id, 'Process generating handler requested close');
                    }
                    break;
                case 'process_completed':
                    try {
                        // Only log a message that we received an event, but don't log the full data unless in debug mode
                        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Received 'process_completed' event from Forge.`);
                        
                        // Create a flag to identify if this is an image-containing event
                        const hasImages = eventData.output && 
                                        eventData.output.data && 
                                        Array.isArray(eventData.output.data) && 
                                        eventData.output.data.length > 0 &&
                                        Array.isArray(eventData.output.data[0]) &&
                                        eventData.output.data[0].length > 0;
                        
                        // If this appears to be the main image-containing event, store it
                        if (hasImages) {
                            console.log(`[Monitor] Job ${job.mobilesd_job_id}: This event appears to contain images, storing for processing`);
                            monitorState.lastImageEvent = eventData;
                            
                            // Only process if not already processing an image
                            if (!monitorState.processingImage) {
                                monitorState.processingImage = true;
                                try {
                                    const processedImages = await handleProcessCompleted(job, monitorState.lastImageEvent);
                                    
                                    // If images were successfully processed, mark as completed
                                    if (processedImages) {
                                        monitorState.hasCompletedProcessing = true;
                                        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Images successfully processed, closing monitor`);
                                        closeMonitor(mobilesdJobId, "process_completed_with_images");
                                    } else {
                                        monitorState.processingImage = false;
                                        console.log(`[Monitor] Job ${job.mobilesd_job_id}: Expected to process images but none were processed. Keeping monitor open for now.`);
                                    }
                                } catch (error) {
                                    console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error processing image event:`, error);
                                    monitorState.processingImage = false;
                                }
                            }
                        } else {
                            // Handle an empty completion event
                            console.log(`[Monitor] Job ${job.mobilesd_job_id}: This appears to be an empty process_completed event. Checking if another will follow.`);
                            await handleProcessCompleted(job, eventData);
                        }
                    } catch (error) {
                        console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error in process_completed handler:`, error);
                    }
                    break;
                case 'send_hash': // Initial message confirming session_hash is being listened to
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Forge confirmed session hash listener.`);
                    break;
                case 'queue_full':
                     console.warn(`[Monitor] Job ${job.mobilesd_job_id}: Forge queue is full. Rank: ${eventData.rank}, Size: ${eventData.queue_size}`);
                     await jobQueue.updateJob(job.mobilesd_job_id, {
                        status: 'queued_on_forge', // Custom status
                        result_details: { info: `Forge queue is full. Current rank ${eventData.rank}.` }
                    });
                    break;
                default:
                    // console.log(`[Monitor] Job ${job.mobilesd_job_id}: Unhandled SSE message type: ${eventData.msg}`);
            }
        } catch (parseError) {
            console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error parsing SSE event data: ${parseError.message}. Data:`, event.data);
        }
    };

    es.onerror = async function(err) {
        console.error(`[Monitor] Job ${job.mobilesd_job_id}: SSE connection error to Forge:`, err);
        
        // If we have an image event that hasn't been processed yet, process it now
        if (monitorState.lastImageEvent && !monitorState.processingImage && !monitorState.hasCompletedProcessing) {
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: SSE connection closed but we have an unprocessed image event. Processing now.`);
            
            monitorState.processingImage = true;
            try {
                const processedImages = await handleProcessCompleted(job, monitorState.lastImageEvent);
                if (processedImages) {
                    monitorState.hasCompletedProcessing = true;
                    console.log(`[Monitor] Job ${job.mobilesd_job_id}: Images successfully processed after connection closed.`);
                }
            } catch (processingError) {
                console.error(`[Monitor] Job ${job.mobilesd_job_id}: Error processing image event after connection closed:`, processingError);
            }
            monitorState.processingImage = false;
        }
        
        // Only fail the job if it wasn't already completed successfully and we don't have pending images
        const currentJob = await jobQueue.getJobById(mobilesdJobId); // Get fresh job data
        if (currentJob && currentJob.status !== 'completed' && !monitorState.hasCompletedProcessing) {
            // If we have an unprocessed image event but failed to process it, include that in the error message
            if (monitorState.lastImageEvent && !monitorState.hasCompletedProcessing) {
                await jobQueue.updateJob(mobilesdJobId, {
                    status: 'failed',
                    result_details: { 
                        error: `SSE connection error to Forge with unprocessed image event: ${err.message || 'Unknown SSE error'}`,
                        unprocessed_event: monitorState.lastImageEvent
                    },
                    completion_timestamp: new Date().toISOString()
                });
            } else {
                await jobQueue.updateJob(mobilesdJobId, {
                    status: 'failed',
                    result_details: { error: `SSE connection error to Forge: ${err.message || 'Unknown SSE error'}` },
                    completion_timestamp: new Date().toISOString()
                });
            }
        } else if (currentJob && currentJob.status === 'completed') {
            console.log(`[Monitor] Job ${job.mobilesd_job_id}: SSE error occurred after job was already completed. No status change.`);
        }

        // Always clean up the monitor regardless
        delete activeMonitors[mobilesdJobId];
        console.log(`[Monitor] Job ${mobilesdJobId}: SSE connection closed. Reason: onerror.`);
    };
}

function closeMonitor(mobilesdJobId, reason = "unknown") {
    if (activeMonitors[mobilesdJobId]) {
        activeMonitors[mobilesdJobId].close();
        delete activeMonitors[mobilesdJobId];
        console.log(`[Monitor] Job ${mobilesdJobId}: SSE connection closed. Reason: ${reason}.`);
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


module.exports = {
    startMonitoringJob,
    closeMonitor,
    reinitializeMonitoring,
    getActiveMonitors: () => activeMonitors
}; 