const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const jobQueue = require('../utils/jobQueueHelpers');
const { readServersConfig } = require('../utils/configHelpers');

const POLLING_INTERVAL_MS = process.env.DISPATCHER_POLLING_INTERVAL_MS || 5000;
let pollIntervalId = null;
let isStopping = false;

/**
 * Parse raw generation info string into structured parameters
 * This function handles generation info strings from extensions like Civitai Browser+
 */
function parseRawGenerationInfo(rawGenInfo) {
    if (!rawGenInfo || typeof rawGenInfo !== 'string') {
        throw new Error('Invalid raw generation info provided');
    }
    
    const params = {};
    const lines = rawGenInfo.trim().split('\n');
    
    if (lines.length === 0) {
        throw new Error('Empty generation info string');
    }
    
    // First line is typically the positive prompt
    params.positive_prompt = lines[0].trim();
    params.prompt = params.positive_prompt; // Also set prompt for compatibility
    
    // Initialize defaults
    params.negative_prompt = "";
    params.steps = 20;
    params.cfg_scale = 7.0;
    params.width = 512;
    params.height = 512;
    params.sampler_name = "Euler a";
    params.seed = -1;
    params.batch_size = 1;
    params.n_iter = 1;
    params.send_images = true;
    params.save_images = true;
    
    // Look for negative prompt and parameters
    let parametersLine = "";
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('Negative prompt:')) {
            params.negative_prompt = line.substring(16).trim();
        } else if (line.includes('Steps:') || line.includes('Sampler:') || line.includes('CFG scale:')) {
            parametersLine = line;
            break;
        }
    }
    
    // Parse parameters from the parameters line
    if (parametersLine) {
        const paramParts = parametersLine.split(',').map(part => part.trim());
        
        for (const part of paramParts) {
            if (!part.includes(':')) continue;
            
            const [key, ...valueParts] = part.split(':');
            const keyLower = key.trim().toLowerCase();
            const value = valueParts.join(':').trim();
            
            try {
                switch (keyLower) {
                    case 'steps':
                        params.steps = parseInt(value, 10);
                        break;
                    case 'sampler':
                        params.sampler_name = value;
                        break;
                    case 'cfg scale':
                        params.cfg_scale = parseFloat(value);
                        break;
                    case 'seed':
                        params.seed = parseInt(value, 10);
                        break;
                    case 'size':
                        if (value.includes('x')) {
                            const [width, height] = value.split('x');
                            params.width = parseInt(width.trim(), 10);
                            params.height = parseInt(height.trim(), 10);
                        }
                        break;
                    case 'model':
                        params.checkpoint_name = value;
                        break;
                    case 'model hash':
                        params.model_hash = value;
                        break;
                    case 'denoising strength':
                        params.denoising_strength = parseFloat(value);
                        break;
                    case 'hires upscale':
                        params.hr_scale = parseFloat(value);
                        break;
                    case 'hires upscaler':
                        params.hr_upscaler = value;
                        break;
                    case 'clip skip':
                        params.clip_skip = parseInt(value, 10);
                        break;
                    case 'schedule type':
                        params.schedule_type = value;
                        break;
                }
            } catch (parseError) {
                console.warn(`[Parser] Failed to parse parameter ${key}: ${value}`, parseError);
            }
        }
    }
    
    return params;
}

/**
 * Main job processing function using REST API approach
 * Processes jobs from the queue and dispatches them to Forge via /sdapi/v1/txt2img
 */
async function processJob(job) {
    const { mobilesd_job_id, target_server_alias, generation_params_json, generation_params } = job;
    console.log(`[Dispatcher] Processing job ${mobilesd_job_id} for target '${target_server_alias}'`);

    let parsed_generation_params;
    try {
        // Handle both formats: generation_params_json (string) and generation_params (object)
        if (generation_params && typeof generation_params === 'object') {
            console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using generation_params object directly`);
            parsed_generation_params = generation_params;
        } else if (generation_params_json && typeof generation_params_json === 'string') {
            console.log(`[Dispatcher] Job ${mobilesd_job_id}: Parsing generation_params_json string`);
            parsed_generation_params = JSON.parse(generation_params_json);
        } else {
            throw new Error(`Neither generation_params nor generation_params_json provided. generation_params: ${typeof generation_params}, generation_params_json: ${typeof generation_params_json}`);
        }
        
        // Check if this is raw generation info that needs parsing
        if (parsed_generation_params.raw_generation_info && typeof parsed_generation_params.raw_generation_info === 'string') {
            console.log(`[Dispatcher] Job ${mobilesd_job_id}: Processing raw generation info from extension`);
            console.log(`[Dispatcher] Job ${mobilesd_job_id}: Raw generation info: ${parsed_generation_params.raw_generation_info.substring(0, 100)}...`);
            
            try {
                parsed_generation_params = parseRawGenerationInfo(parsed_generation_params.raw_generation_info);
                console.log(`[Parser] Parsed raw generation info into ${Object.keys(parsed_generation_params).length} parameters`);
                console.log(`[Parser] Prompt: "${(parsed_generation_params.positive_prompt || parsed_generation_params.prompt || '').substring(0, 50)}..."`);
                console.log(`[Parser] Model: ${parsed_generation_params.checkpoint_name || 'default'}`);
                console.log(`[Parser] Steps: ${parsed_generation_params.steps || 20}, CFG: ${parsed_generation_params.cfg_scale || 7}, Size: ${parsed_generation_params.width || 512}x${parsed_generation_params.height || 512}`);
                console.log(`[Dispatcher] Job ${mobilesd_job_id}: Successfully parsed raw generation info`);
            } catch (parseError) {
                console.error(`[Dispatcher] Job ${mobilesd_job_id}: Failed to parse raw generation info: ${parseError.message}`);
                await jobQueue.updateJob(mobilesd_job_id, { 
                    status: 'failed', 
                    result_details_json: JSON.stringify({ 
                        error: 'Failed to parse raw generation info.', 
                        details: parseError.message,
                        raw_info: parsed_generation_params.raw_generation_info.substring(0, 200) + '...'
                    }) 
                });
                return;
            }
        } else {
            console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using standard generation parameters`);
        }
        
        // Log the final generation parameters for debugging
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Final generation parameters:`, JSON.stringify({
            has_positive_prompt: !!(parsed_generation_params.positive_prompt || parsed_generation_params.prompt),
            positive_prompt: (parsed_generation_params.positive_prompt || parsed_generation_params.prompt || "(empty)").substring(0, 50) + "...",
            has_negative_prompt: !!parsed_generation_params.negative_prompt,
            negative_prompt: (parsed_generation_params.negative_prompt || "(empty)").substring(0, 30) + "...",
            checkpoint: parsed_generation_params.checkpoint_name || parsed_generation_params.sd_checkpoint || "(none)",
            steps: parsed_generation_params.steps || 20,
            cfg_scale: parsed_generation_params.cfg_scale || 7.0,
            size: `${parsed_generation_params.width || 512}x${parsed_generation_params.height || 512}`
        }));
        
        // Ensure positive_prompt is at least an empty string, not undefined
        if (parsed_generation_params.positive_prompt === undefined) {
            if (parsed_generation_params.prompt !== undefined) {
                console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using 'prompt' field as positive_prompt`);
                parsed_generation_params.positive_prompt = parsed_generation_params.prompt;
            } else {
                console.warn(`[Dispatcher] Job ${mobilesd_job_id}: positive_prompt is undefined, setting to empty string`);
                parsed_generation_params.positive_prompt = "";
            }
        }
        
        // Ensure negative_prompt is at least an empty string, not undefined
        if (parsed_generation_params.negative_prompt === undefined) {
            console.warn(`[Dispatcher] Job ${mobilesd_job_id}: negative_prompt is undefined, setting to empty string`);
            parsed_generation_params.negative_prompt = "";
        }
    } catch (e) {
        console.error(`[Dispatcher] Job ${mobilesd_job_id}: Failed to parse generation parameters. Error: ${e.message}`);
        await jobQueue.updateJob(mobilesd_job_id, { status: 'failed', result_details_json: JSON.stringify({ error: 'Invalid generation parameters format.', details: e.message }) });
        return;
    }

    // Get server details based on target_server_alias
    let serverDetails;
    try {
        const servers = await readServersConfig();
        serverDetails = servers.find(s => s.alias === target_server_alias);

        if (!serverDetails) {
            console.error(`[Dispatcher] Job ${mobilesd_job_id}: Server config not found for alias '${target_server_alias}'.`);
            await jobQueue.updateJob(mobilesd_job_id, { 
                status: 'failed', 
                result_details_json: JSON.stringify({ error: `Server config not found for alias '${target_server_alias}'.` })
            });
            return;
        }
        if (!serverDetails.apiUrl) {
            console.error(`[Dispatcher] Job ${mobilesd_job_id}: apiUrl missing in server config for alias '${target_server_alias}'.`);
            await jobQueue.updateJob(mobilesd_job_id, { 
                status: 'failed', 
                result_details_json: JSON.stringify({ error: `apiUrl missing for server '${target_server_alias}'.` })
            });
            return;
        }
    } catch (configError) {
        console.error(`[Dispatcher] Job ${mobilesd_job_id}: Error reading server configurations: ${configError.message}`);
        await jobQueue.updateJob(mobilesd_job_id, { 
            status: 'failed', 
            result_details_json: JSON.stringify({ error: `Error reading server configurations: ${configError.message}` })
        });
        return;
    }

    const forgeBaseUrl = serverDetails.apiUrl;
    console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using Forge server URL ${forgeBaseUrl} for alias '${target_server_alias}'.`);

    // Check for checkpoint name in either parameter format for backward compatibility
    let checkpoint_name = parsed_generation_params.checkpoint_name;
    if (!checkpoint_name && parsed_generation_params.sd_checkpoint) {
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using sd_checkpoint parameter as checkpoint_name: "${parsed_generation_params.sd_checkpoint}"`);
        checkpoint_name = parsed_generation_params.sd_checkpoint;
        parsed_generation_params.checkpoint_name = checkpoint_name;
    }
    
    if (!checkpoint_name) {
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: No checkpoint specified, will use current model on target server.`);
        checkpoint_name = null;
    }

    console.log(`[Dispatcher] Job ${mobilesd_job_id}: Confirmed checkpoint to use: "${checkpoint_name}"`);
    
    const axiosConfig = { timeout: 60000 }; // 60 second timeout for generation
    if (serverDetails.username && serverDetails.password) {
        axiosConfig.auth = {
            username: serverDetails.username,
            password: serverDetails.password,
        };
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using basic authentication for server '${target_server_alias}'.`);
    }

    try {
        // REST API approach - direct communication with /sdapi/v1/txt2img
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using REST API approach with /sdapi/v1/txt2img (headless operation)`);
        
        // Prepare the payload for the Forge txt2img API
        const txt2imgPayload = {
            prompt: parsed_generation_params.positive_prompt || parsed_generation_params.prompt || "",
            negative_prompt: parsed_generation_params.negative_prompt || "",
            steps: parsed_generation_params.steps || 20,
            sampler_name: parsed_generation_params.sampler_name || parsed_generation_params.sampler || "Euler a",
            cfg_scale: parsed_generation_params.cfg_scale || 7.0,
            width: parsed_generation_params.width || 512,
            height: parsed_generation_params.height || 512,
            seed: parsed_generation_params.seed || -1,
            batch_size: parsed_generation_params.batch_size || 1,
            n_iter: parsed_generation_params.n_iter || 1,
            restore_faces: parsed_generation_params.restore_faces || false,
            tiling: parsed_generation_params.tiling || false,
            send_images: false,  // Don't send images in response to reduce payload size
            save_images: true,   // Save images to disk
            override_settings: {}
        };
        
        // Add checkpoint override if specified
        if (checkpoint_name) {
            const normalizedCheckpoint = checkpoint_name.replace(/\\/g, '/');
            txt2imgPayload.override_settings.sd_model_checkpoint = normalizedCheckpoint;
            console.log(`[Dispatcher] Job ${mobilesd_job_id}: Added checkpoint override: ${normalizedCheckpoint}`);
        }
        
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Submitting to /sdapi/v1/txt2img with payload:`, {
            prompt: txt2imgPayload.prompt.substring(0, 50) + "...",
            steps: txt2imgPayload.steps,
            size: `${txt2imgPayload.width}x${txt2imgPayload.height}`,
            sampler: txt2imgPayload.sampler_name,
            cfg_scale: txt2imgPayload.cfg_scale
        });
        
        // Submit to the txt2img API endpoint (synchronous)
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Starting synchronous generation via REST API...`);
        const txt2imgResponse = await axios.post(`${forgeBaseUrl}/sdapi/v1/txt2img`, txt2imgPayload, axiosConfig);
        
        // Process the response immediately since it's synchronous
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Generation completed successfully. Processing response...`);
        const responseData = txt2imgResponse.data;
        
        let resultInfo = {};
        if (responseData.info) {
            try {
                resultInfo = JSON.parse(responseData.info);
                console.log(`[Dispatcher] Job ${mobilesd_job_id}: Parsed generation info successfully`);
            } catch (parseError) {
                console.error(`[Dispatcher] Job ${mobilesd_job_id}: Failed to parse response info:`, parseError);
                resultInfo = { raw_info: responseData.info, parse_error: parseError.message };
            }
        }
        
        // Update job to completed status
        await jobQueue.updateJob(mobilesd_job_id, {
            status: 'completed',
            processing_started_at: new Date().toISOString(),
            completion_timestamp: new Date().toISOString(),
            result_details: {
                message: "Job completed successfully via REST API.",
                submission_type: "sdapi_txt2img",
                generation_info: resultInfo,
                positive_prompt: parsed_generation_params.positive_prompt || parsed_generation_params.prompt || "",
                negative_prompt: parsed_generation_params.negative_prompt || ""
            }
        });
        
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Job marked as completed via REST API.`);
        return;

    } catch (error) {
        console.error(`[Dispatcher] Job ${mobilesd_job_id}: Error during REST API interaction with ${forgeBaseUrl}. ${error.message}`);
        let errorResponseData = null;
        if (error.response) {
            console.error(`[Dispatcher] Job ${mobilesd_job_id}: Error status: ${error.response.status}, data: ${JSON.stringify(error.response.data)}`);
            errorResponseData = error.response.data;
        } else {
            console.error(`[Dispatcher] Job ${mobilesd_job_id}: No error response object. Error details: ${error}`);
        }
        await jobQueue.updateJob(mobilesd_job_id, {
            status: 'failed',
            result_details_json: JSON.stringify({
                error: `REST API interaction failed: ${error.message}`,
                details: errorResponseData || String(error.stack)
            }),
        });
    }
}

async function pollForJobs() {
    if (isStopping) {
        console.log('[Dispatcher] Poll: Stop signal received, not polling.');
        return;
    }
    try {
        // Get recent pending jobs only (created within the last 24 hours)
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        const oneDayAgoISOString = oneDayAgo.toISOString();

        const pendingJobs = await jobQueue.findPendingJobs(1, oneDayAgoISOString); 
        
        if (pendingJobs && pendingJobs.length > 0) {
            const jobToProcess = pendingJobs[0];
            console.log(`[Dispatcher] Poll: Found pending job ${jobToProcess.mobilesd_job_id}. Attempting to process.`);
            await processJob(jobToProcess); 
        }
    } catch (error) {
        console.error('[Dispatcher] Poll: Error during job polling or processing initiation:', error);
    } finally {
        if (!isStopping) {
            pollIntervalId = setTimeout(pollForJobs, POLLING_INTERVAL_MS);
        }
    }
}

function startDispatcher() {
    if (pollIntervalId) {
        console.warn('[Dispatcher] Start: Dispatcher service is already running or start attempted multiple times.');
        return;
    }
    console.log(`[Dispatcher] Start: Initializing dispatcher service. Polling interval: ${POLLING_INTERVAL_MS}ms.`);
    console.log('[Dispatcher] Note: Using REST API approach for headless operation.');
    isStopping = false;
    pollForJobs(); 
    console.log('[Dispatcher] Start: Dispatcher service started and initial poll scheduled.');
}

function stopDispatcher() {
    console.log('[Dispatcher] Stop: Attempting to stop dispatcher service...');
    isStopping = true;
    if (pollIntervalId) {
        clearTimeout(pollIntervalId);
        pollIntervalId = null;
        console.log('[Dispatcher] Stop: Polling interval cleared.');
    }
    console.log('[Dispatcher] Stop: Dispatcher service has been signaled to stop.');
}

module.exports = {
    processJob,
    startDispatcher,
    stopDispatcher,
    parseRawGenerationInfo
}; 