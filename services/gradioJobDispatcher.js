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
 * @returns {Array<any>} The data array for the Gradio payload.
 */
function constructGenerationPayloadData(params, forgeInternalTaskId) {
    // This entire array is based on the provided HAR data for fn_index: 257
    // It has 124 elements, but Forge is expecting 137 elements
    // We'll start with the 124 elements and then extend it
    const data = JSON.parse(String.raw`[
        "task(u1axq3memngtu5x)", 
        "3 pretty girls",        
        "dudes",                 
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

    // Add 13 additional default values to accommodate the 137 expected inputs
    // These default values are placeholders and should be updated based on your Forge's requirements
    for (let i = 0; i < 13; i++) {
        data.push("");  // Add empty string defaults for the missing parameters
    }

    console.log(`[Dispatcher] Constructed data array with ${data.length} elements (Forge expects 137)`);

    // Apply parameters from the job to the HAR-based template
    data[0] = forgeInternalTaskId;
    if (params.prompt !== undefined) data[1] = params.prompt;
    if (params.negative_prompt !== undefined) data[2] = params.negative_prompt;
    if (params.styles !== undefined) data[3] = params.styles; // Array of strings
    if (params.batch_count !== undefined) data[4] = parseInt(params.batch_count, 10);
    if (params.batch_size !== undefined) data[5] = parseInt(params.batch_size, 10);
    if (params.steps !== undefined) data[6] = parseInt(params.steps, 10);
    if (params.cfg_scale !== undefined) data[7] = parseFloat(params.cfg_scale);
    if (params.width !== undefined) data[8] = parseInt(params.width, 10);
    if (params.height !== undefined) data[9] = parseInt(params.height, 10);

    if (params.enable_hr !== undefined) data[10] = !!params.enable_hr;
    if (params.denoising_strength !== undefined) data[11] = parseFloat(params.denoising_strength);
    if (params.hr_scale !== undefined) data[12] = parseFloat(params.hr_scale);
    if (params.hr_upscaler !== undefined) data[13] = params.hr_upscaler;
    if (params.hr_second_pass_steps !== undefined) data[14] = parseInt(params.hr_second_pass_steps, 10);
    if (params.hr_resize_x !== undefined) data[15] = parseInt(params.hr_resize_x, 10);
    if (params.hr_resize_y !== undefined) data[16] = parseInt(params.hr_resize_y, 10);
    
    if (params.sampler_name !== undefined) data[28] = params.sampler_name;
    if (params.scheduler !== undefined) data[29] = params.scheduler;

    if (params.script_name !== undefined) data[26] = params.script_name;
    
    if (params.clip_skip !== undefined) data[27] = parseInt(params.clip_skip, 10);
    
    if (params.restore_faces !== undefined) data[30] = !!params.restore_faces;
    if (params.tiling !== undefined) data[31] = !!params.tiling; 

    if (params.seed !== undefined) {
        const seedVal = parseInt(params.seed, 10);
        data[39] = (seedVal === -1 || isNaN(seedVal)) ? null : seedVal;
    }
    
    return data;
}

// Removed: constructForgeGenerationPayload function
// Removed: dispatchJobToForge function
// Removed: processQueue function

async function processJob(job) {
    const { mobilesd_job_id, target_server_alias, generation_params_json } = job;
    console.log(`[Dispatcher] Processing job ${mobilesd_job_id} for target '${target_server_alias}'`);

    let generation_params;
    try {
        generation_params = JSON.parse(generation_params_json);
    } catch (e) {
        console.error(`[Dispatcher] Job ${mobilesd_job_id}: Failed to parse generation_params_json. Error: ${e.message}`);
        await jobQueue.updateJob(mobilesd_job_id, { status: 'failed', result_details_json: JSON.stringify({ error: 'Invalid generation_params JSON format.', details: e.message }) });
        return;
    }

    // Dynamically get server details based on target_server_alias
    let serverDetails;
    try {
        const servers = await readServersConfig(); // Ensure readServersConfig is async or handle accordingly
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

    const { checkpoint_name } = generation_params;
    if (!checkpoint_name) {
        console.error(`[Dispatcher] Job ${mobilesd_job_id}: Missing 'checkpoint_name' in generation_params.`);
        await jobQueue.updateJob(mobilesd_job_id, { status: 'failed', result_details_json: JSON.stringify({ error: "Missing 'checkpoint_name' in generation parameters." }) });
        return;
    }

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
        const checkpointPayload = {
            data: [checkpoint_name],
            event_data: null,
            fn_index: 8, 
            session_hash: forge_session_hash,
            trigger_id: 2845 // ADDED from HAR analysis
        };
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Setting checkpoint to '${checkpoint_name}' with session_hash '${forge_session_hash}'...`);
        await axios.post(`${forgeBaseUrl}/queue/join`, checkpointPayload, axiosConfig); 
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Checkpoint set successfully.`);

        const generationDataArray = constructGenerationPayloadData(generation_params, forgeInternalTaskId);
        const generationPayload = {
            data: generationDataArray,
            event_data: null,
            fn_index: 257, 
            session_hash: forge_session_hash,
            trigger_id: 16 // ADDED from HAR analysis
        };
        
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Submitting generation task with internal_task_id '${forgeInternalTaskId}'...`);
        await axios.post(`${forgeBaseUrl}/queue/join`, generationPayload, axiosConfig); 
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Generation task submitted successfully.`);

        await jobQueue.updateJob(mobilesd_job_id, {
            status: 'processing',
            forge_session_hash: forge_session_hash,
            processing_started_at: new Date().toISOString(),
            result_details_json: JSON.stringify({ 
                forge_internal_task_id: forgeInternalTaskId,
                message: "Job dispatched to Forge."
            })
        });
        console.log(`[Dispatcher] Job ${mobilesd_job_id}: Status updated to 'processing', forge_session_hash: ${forge_session_hash}, forge_internal_task_id: ${forgeInternalTaskId}.`);

        // Start monitoring the job after it's set to 'processing'
        try {
            console.log(`[Dispatcher] Job ${mobilesd_job_id}: Starting monitoring via forgeJobMonitor.`);
            await forgeJobMonitor.startMonitoringJob(mobilesd_job_id);
        } catch (monitoringError) {
            console.error(`[Dispatcher] Job ${mobilesd_job_id}: Error starting job monitoring: ${monitoringError.message}`);
            // Don't fail the job just because monitoring setup failed
            // The job is still processing on Forge, and we've logged the issue
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

async function pollForJobs() {
    if (isStopping) {
        console.log('[Dispatcher] Poll: Stop signal received, not polling.');
        return;
    }
    try {
        const pendingJobs = await jobQueue.findPendingJobs(1); 
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

module.exports = {
    startDispatcher,
    stopDispatcher,
    _constructGenerationPayloadData: constructGenerationPayloadData 
}; 