const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const jobQueue = require('../utils/jobQueueHelpers');
const { readServersConfig } = require('../utils/configHelpers'); // RE-ADD this import
// const { readServersConfig } = require('../utils/configHelpers'); // Not used by current active functions
const forgeJobMonitor = require('./forgeJobMonitor'); // Uncommented this line
// const { readServersConfig } = require('../utils/configHelpers'); // Not used by current active functions
// const forgeJobMonitor = require('./forgeJobMonitor'); // Not directly used by the active dispatcher logic itself

const POLLING_INTERVAL_MS = process.env.DISPATCHER_POLLING_INTERVAL_MS || 5000;
let pollIntervalId = null;
let isStopping = false;

// Removed: isProcessingAJobGlobally (let this be handled by the single job fetch in pollForJobs)
// Removed: FORGE_FN_INDEX_SET_CHECKPOINT, FORGE_FN_INDEX_GENERATE_IMAGE (constants are used directly or derived from HAR fn_index values)
// Removed: GRADIO_FN_INDEX_SET_CHECKPOINT, GRADIO_FN_INDEX_GENERATE (as above)

// Removed: મુખ્ય_forge_generation_payload_template (the HAR-based one in constructGenerationPayloadData is used)
// Removed: harFn257DataString and harFn257Parsed (this logic is now self-contained in constructGenerationPayloadData)

/**
 * Constructs the data array for the main generation payload (fn_index: 257).
 * This is based on the HAR analysis of a Forge UI generation request.
 * The user MUST verify these mappings and defaults against their specific Forge setup.
 * @param {object} params - The generation parameters from the job queue.
 * @param {string} forgeInternalTaskId - A unique ID for this task attempt, e.g., "task(xxxx)".
 * @param {boolean} isWindowsServer - Whether the server is Windows-based (affects path normalization).
 * @returns {Array<any>} The data array for the Gradio payload.
 */
function constructGenerationPayloadData(params, forgeInternalTaskId, isWindowsServer = true) {
    // Make a copy of the params to avoid modifying the original
    const localParams = {...params};
    
    // Normalize checkpoint path based on server OS
    if (localParams.checkpoint_name) {
        if (isWindowsServer) {
            // For Windows servers, convert forward slashes to backslashes
            localParams.checkpoint_name = localParams.checkpoint_name.replace(/\//g, '\\');
        } else {
            // For Linux servers, convert backslashes to forward slashes
            localParams.checkpoint_name = localParams.checkpoint_name.replace(/\\/g, '/');
        }
    }
    
    // This entire array is based on the provided HAR data for fn_index: 257
    // It has 124 elements, but Forge is expecting 140 elements
    // We'll start with the 124 elements and then extend it
    const data = JSON.parse(String.raw`[
        "task(u1axq3memngtu5x)", 
        "",                      
        "",                 
        [],                      
        1,                       
        1,                       
        5,                       
        3.5,                     
        1152,                    
        896,                     
        false,                   
        0.7,                     
        2,                       
        "Latent",                
        0,                       
        0,                       
        0,                       
        "Use same checkpoint",   
        ["Use same choices"],    
        "Use same sampler",      
        "Use same scheduler",    
        "",                      
        "",                      
        5,                       
        3.5,                     
        null,                    
        "None",                  
        20,                      
        "DPM++ 2M SDE",          
        "Karras",                
        false,                   
        "",                      
        0.8,                     
        -1,                      
        false,                   
        -1,                      
        0,                       
        0,                       
        0,                       
        null,                    
        null,                    
        null,                    
        false,                   
        7,                       
        1,                       
        "Constant",              
        0,                       
        "Constant",              
        0,                       
        1,                       
        "enable",                
        "MEAN",                  
        "AD",                    
        1,                       
        false,                   
        1.01,                    
        1.02,                    
        0.99,                    
        0.95,                    
        0,                       
        1,                       
        false,                   
        0.5,                     
        2,                       
        1,                       
        false,                   
        3,                       
        0,                       
        0,                       
        1,                       
        false,                   
        3,                       
        2,                       
        0,                       
        0.35,                    
        true,                    
        "bicubic",               
        "bicubic",               
        false,                   
        0,                       
        "anisotropic",           
        0,                       
        "reinhard",              
        100,                     
        0,                       
        "subtract",              
        0,                       
        0,                       
        "gaussian",              
        "add",                   
        0,                       
        100,                     
        127,                     
        0,                       
        "hard_clamp",            
        5,                       
        0,                       
        "None",                  
        "None",                  
        false,                   
        "MultiDiffusion",        
        768,                     
        768,                     
        64,                      
        4,                       
        false,                   
        1,                       
        false,                   
        false,                   
        false,                   
        false,                   
        "positive",              
        "comma",                 
        0,                       
        false,                   
        false,                   
        "start",                 
        "",                      
        false,                   
        "Seed",                  
        "",                      
        "",                      
        "Nothing",               
        ""                       
    ]`);

    // Add 16 additional default values to accommodate the 140 expected inputs
    // These default values are placeholders and should be updated based on your Forge's requirements
    for (let i = 0; i < 16; i++) {
        data.push("");  // Add empty string defaults for the missing parameters
    }

    console.log(`[Dispatcher] Constructed data array with ${data.length} elements (Forge expects 140)`);

    // Debug prompt values before applying
    console.log(`[Dispatcher] Positive prompt parameter: "${params.positive_prompt}"`);
    
    // Apply parameters from the job to the HAR-based template
    data[0] = forgeInternalTaskId;
    
    // IMPORTANT: Set all the key parameters from parsed generation info
    if (params.positive_prompt !== undefined) {
        data[1] = params.positive_prompt;
        console.log(`[Dispatcher] Set positive prompt in data[1] to: "${data[1].substring(0, 50)}${data[1].length > 50 ? '...' : ''}"`);
    } else if (params.prompt !== undefined) {
        data[1] = params.prompt;
        console.log(`[Dispatcher] Set positive prompt in data[1] from 'prompt' parameter: "${data[1].substring(0, 50)}${data[1].length > 50 ? '...' : ''}"`);
    }
    
    if (params.negative_prompt !== undefined) {
        data[2] = params.negative_prompt;
        console.log(`[Dispatcher] Set negative prompt in data[2] to: "${data[2].substring(0, 50)}${data[2].length > 50 ? '...' : ''}"`);
    }
    
    if (params.styles !== undefined) data[3] = params.styles; // Array of strings
    if (params.batch_count !== undefined) data[4] = parseInt(params.batch_count, 10);
    if (params.batch_size !== undefined) data[5] = parseInt(params.batch_size, 10);
    
    // Set generation parameters from parsed info
    if (params.cfg_scale !== undefined) {
        data[6] = parseFloat(params.cfg_scale);
        console.log(`[Dispatcher] Set CFG scale in data[6] to: ${data[6]}`);
    }
    
    if (params.width !== undefined) {
        data[8] = parseInt(params.width, 10);
        console.log(`[Dispatcher] Set width in data[8] to: ${data[8]}`);
    }
    
    if (params.height !== undefined) {
        data[9] = parseInt(params.height, 10);
        console.log(`[Dispatcher] Set height in data[9] to: ${data[9]}`);
    }
    
    if (params.steps !== undefined) {
        data[27] = parseInt(params.steps, 10);
        console.log(`[Dispatcher] Set steps in data[27] to: ${data[27]}`);
    }
    
    if (params.sampler_name !== undefined) {
        data[28] = params.sampler_name;
        console.log(`[Dispatcher] Set sampler in data[28] to: ${data[28]}`);
    }
    
    if (params.schedule_type !== undefined) {
        data[29] = params.schedule_type;
        console.log(`[Dispatcher] Set schedule type in data[29] to: ${data[29]}`);
    }
    
    if (params.seed !== undefined && params.seed !== -1) {
        data[33] = parseInt(params.seed, 10);
        console.log(`[Dispatcher] Set seed in data[33] to: ${data[33]}`);
    }
    
    // Handle hi-res fix parameters if present
    if (params.denoising_strength !== undefined) {
        data[11] = parseFloat(params.denoising_strength);
        console.log(`[Dispatcher] Set denoising strength in data[11] to: ${data[11]}`);
    }
    
    if (params.hr_scale !== undefined) {
        data[12] = parseFloat(params.hr_scale);
        console.log(`[Dispatcher] Set hires scale in data[12] to: ${data[12]}`);
    }
    
    // Additional parameter mappings (avoiding duplication)
    if (params.enable_hr !== undefined) data[10] = !!params.enable_hr;
    if (params.hr_upscaler !== undefined) data[13] = params.hr_upscaler;
    if (params.hr_second_pass_steps !== undefined) data[14] = parseInt(params.hr_second_pass_steps, 10);
    if (params.hr_resize_x !== undefined) data[15] = parseInt(params.hr_resize_x, 10);
    if (params.hr_resize_y !== undefined) data[16] = parseInt(params.hr_resize_y, 10);
    
    // Set checkpoint directly in the generation array if provided
    if (params.checkpoint_name !== undefined) data[17] = params.checkpoint_name;
    
    // Set script name to empty to disable scripts
    data[26] = "";  // script_name
    
    if (params.scheduler !== undefined) data[29] = params.scheduler;
    if (params.clip_skip !== undefined) data[27] = parseInt(params.clip_skip, 10);
    
    if (params.restore_faces !== undefined) data[30] = !!params.restore_faces;
    if (params.tiling !== undefined) data[31] = !!params.tiling; 

    // Final summary of critical parameters
    console.log(`[Dispatcher] Final data array summary:`);
    console.log(`  - Prompt (data[1]): "${data[1] ? data[1].substring(0, 50) + '...' : 'empty'}"`);
    console.log(`  - Negative (data[2]): "${data[2] ? data[2].substring(0, 30) + '...' : 'empty'}"`);
    console.log(`  - Steps (data[27]): ${data[27]}`);
    console.log(`  - CFG (data[6]): ${data[6]}`);
    console.log(`  - Size (data[8]x[9]): ${data[8]}x${data[9]}`);
    console.log(`  - Sampler (data[28]): ${data[28]}`);
    console.log(`  - Seed (data[33]): ${data[33]}`);
    
    return data;
}

// Removed: constructForgeGenerationPayload function
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
            params.negative_prompt = line.substring(16).trim(); // Remove "Negative prompt: " prefix
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
                    case 'clip skip':
                        params.clip_skip = parseInt(value, 10);
                        break;
                    case 'denoising strength':
                        params.denoising_strength = parseFloat(value);
                        break;
                    case 'schedule type':
                        params.schedule_type = value;
                        break;
                    case 'hires upscale':
                        params.hr_scale = parseFloat(value);
                        break;
                    case 'hires upscaler':
                        params.hr_upscaler = value;
                        break;
                    case 'hires cfg scale':
                        params.hr_second_pass_steps = parseFloat(value);
                        break;
                    case 'version':
                        params.version = value;
                        break;
                    case 'lora hashes':
                        // Handle LoRA information
                        params.lora_hashes = value;
                        break;
                }
            } catch (parseError) {
                console.warn(`[Parser] Failed to parse parameter ${keyLower}: ${parseError.message}`);
                // Continue parsing other parameters
            }
        }
    }
    
    console.log(`[Parser] Parsed raw generation info into ${Object.keys(params).length} parameters`);
    console.log(`[Parser] Prompt: "${params.positive_prompt.substring(0, 50)}${params.positive_prompt.length > 50 ? '...' : ''}"`);
    console.log(`[Parser] Model: ${params.checkpoint_name || '(not specified)'}`);
    console.log(`[Parser] Steps: ${params.steps}, CFG: ${params.cfg_scale}, Size: ${params.width}x${params.height}`);
    
    return params;
}

// Removed: dispatchJobToForge function
// Removed: processQueue function

async function processJob(job) {
    const { mobilesd_job_id, target_server_alias, generation_params_json, generation_params } = job;
    console.log(`[Dispatcher] Processing job ${mobilesd_job_id} for target '${target_server_alias}'`);

    let parsed_generation_params;
    try {
        // Handle both formats: generation_params_json (string) and generation_params (object)
        if (generation_params && typeof generation_params === 'object') {
            // Manual dispatch or newer format - already an object
            console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using generation_params object directly`);
            parsed_generation_params = generation_params;
        } else if (generation_params_json && typeof generation_params_json === 'string') {
            // Original format - JSON string that needs parsing
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
            // Standard generation parameters
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
            // Check for 'prompt' field which may be used instead of 'positive_prompt'
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

    // Dynamically get server details based on target_server_alias
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
        // **FORCE REST API APPROACH - ALWAYS USE /sdapi/v1/txt2img**
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using REST API approach with /sdapi/v1/txt2img (Gradio interface disabled)`);
        
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
        
        // Submit to the txt2img API endpoint (this will be synchronous and block until complete)
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
        
        // Update job to completed status immediately
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
        return; // Exit successfully

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

        // Modify to get only recent pending jobs
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
    console.log('[Dispatcher] Note: Forge server URL will be determined dynamically per job from server configurations.');
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

async function submitJobToForge(mobilesd_job_id, generation_params, target_server_alias, parsed_server_details) {
    const { serverDetails, forgeBaseUrl } = parsed_server_details;
    const checkpoint_name = generation_params.checkpoint;
    
    const forge_session_hash = uuidv4();
    const forgeInternalTaskId = `task(${uuidv4().replace(/-/g, "")})`; 

    const axiosConfig = { timeout: 30000 };
    if (serverDetails.username && serverDetails.password) {
        axiosConfig.auth = {
            username: serverDetails.username,
            password: serverDetails.password,
        };
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using basic authentication for server '${target_server_alias}'.`);
    }

    try {
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Using simple paste approach instead of direct fn_index call`);
        
        // Reconstruct the generation info string from parameters
        const generationInfo = reconstructGenerationInfo(generation_params);
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Reconstructed generation info: ${generationInfo.slice(0, 100)}...`);
        
        // Step 1: Put the generation info in the prompt textarea
        const promptPayload = {
            data: [generationInfo],
            event_data: null,
            fn_index: null, // Will be determined by targeting the right component
            session_hash: forge_session_hash,
            component_id: "txt2img_prompt"  // Target the prompt textarea directly
        };
        
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Step 1 - Setting prompt with generation info...`);
        await axios.post(`${forgeBaseUrl}/queue/join`, promptPayload, axiosConfig);
        
        // Step 2: Trigger the paste button to parse the generation info
        const pastePayload = {
            data: [],
            event_data: null,
            fn_index: null,
            session_hash: forge_session_hash,
            component_id: "paste"  // Target the paste button
        };
        
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Step 2 - Triggering paste to parse generation info...`);
        await axios.post(`${forgeBaseUrl}/queue/join`, pastePayload, axiosConfig);
        
        // Step 3: Find and trigger the generate button
        const generatePayload = {
            data: [],
            event_data: null,
            fn_index: null,
            session_hash: forge_session_hash,
            component_id: "txt2img_generate"  // Target the generate button
        };
        
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Step 3 - Triggering generation...`);
        await axios.post(`${forgeBaseUrl}/queue/join`, generatePayload, axiosConfig);
        
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Generation task submitted successfully using paste approach.`);
        
        await jobQueue.updateJob(mobilesd_job_id, {
            status: 'processing',
            forge_session_hash: forge_session_hash,
            processing_started_at: new Date().toISOString(),
            forge_internal_task_id: forgeInternalTaskId,
            result_details: { 
                forge_internal_task_id: forgeInternalTaskId,
                message: "Job dispatched to Forge using paste approach.",
                submission_type: "paste_and_generate",
                positive_prompt: generation_params.positive_prompt || generation_params.prompt || "",
                negative_prompt: generation_params.negative_prompt || ""
            }
        });
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Status updated to 'processing', forge_session_hash: ${forge_session_hash}, forge_internal_task_id: ${forgeInternalTaskId}.`);

        // Start monitoring the job after it's set to 'processing'
        try {
            console.log(`[Dispatcher] Job ${mobilesd_job_id}: Starting monitoring via forgeJobMonitor.`);
            await forgeJobMonitor.startMonitoringJob(mobilesd_job_id);
        } catch (monitoringError) {
            console.error(`[Dispatcher] Job ${mobilesd_job_id}: Error starting job monitoring: ${monitoringError.message}`);
        }

    } catch (error) {
        console.error(`[Dispatcher] Job ${mobilesd_job_id}: Error during Forge interaction with ${forgeBaseUrl}. ${error.message}`);
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
                error: `Forge interaction failed: ${error.message}`,
                details: errorResponseData || String(error.stack)
            }),
        });
    }
}

function reconstructGenerationInfo(params) {
    // Reconstruct the generation info string in the same format that CivitAI images use
    let genInfo = '';
    
    if (params.positive_prompt || params.prompt) {
        genInfo += params.positive_prompt || params.prompt;
    }
    
    if (params.negative_prompt) {
        genInfo += `\nNegative prompt: ${params.negative_prompt}`;
    }
    
    // Add parameters in the standard format
    const paramParts = [];
    
    if (params.steps) paramParts.push(`Steps: ${params.steps}`);
    if (params.sampler) paramParts.push(`Sampler: ${params.sampler}`);
    if (params.cfg_scale) paramParts.push(`CFG scale: ${params.cfg_scale}`);
    if (params.seed) paramParts.push(`Seed: ${params.seed}`);
    if (params.size) {
        const [width, height] = params.size.split('x');
        paramParts.push(`Size: ${width}x${height}`);
    } else if (params.width && params.height) {
        paramParts.push(`Size: ${params.width}x${params.height}`);
    }
    if (params.checkpoint) paramParts.push(`Model: ${params.checkpoint}`);
    if (params.denoising_strength) paramParts.push(`Denoising strength: ${params.denoising_strength}`);
    if (params.hires_scale && params.hires_scale !== 1) paramParts.push(`Hires upscale: ${params.hires_scale}`);
    
    if (paramParts.length > 0) {
        genInfo += `\n${paramParts.join(', ')}`;
    }
    
    return genInfo;
}

module.exports = {
    startDispatcher,
    stopDispatcher,
    processJob,
    _constructGenerationPayloadData: constructGenerationPayloadData 
}; 