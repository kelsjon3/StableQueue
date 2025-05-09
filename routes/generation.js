const express = require('express');
const axios = require('axios');
const { readServersConfig } = require('../utils/configHelpers');
const crypto = require('crypto'); // For potential future use (e.g., unique IDs) or filename generation
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

// Helper function to get server config by alias
const getServerByAlias = async (alias) => {
  const servers = await readServersConfig();
  const server = servers.find(s => s.alias === alias);
  return server;
};

// Helper function to get Axios config with auth
const getAxiosConfig = (server) => {
  const config = {};
  if (server.auth && server.auth.username && server.auth.password) {
    // Basic Auth
    config.auth = {
      username: server.auth.username,
      password: server.auth.password
    };
    console.log(`Using Basic Auth for ${server.alias}`);
  }
  // TODO: Add support for other auth types if needed (e.g., API Key header)
  // else if (server.apiKey) { ... }
  return config;
};


// POST /api/v1/generate - Handle image generation request
router.post('/generate', async (req, res) => {
  const { 
    server_alias,
    // Fields from MobileSD UI - map these to Forge's 24-element array
    positive_prompt,
    negative_prompt = "", 
    // style_preset = "simple", // New field based on Forge API
    // prompt_matrix_variation_toggle = false, // New field
    // controlnet_preprocessors = [], // New field
    // controlnet_models = [], // New field
    // init_image_base64 = "", // New field (for img2img)
    // mask_image_base64 = "", // New field (for inpainting)
    // resize_mode_img2img = "Just Resize", // New field (for img2img)
    sampling_category = "Both", // Corresponds to "Sampling category"
    enable_hires_fix = false,
    upscaler_model = "None",
    refiner_model = "None",
    num_images = 1, // Corresponds to "Number of images to generate"
    seed = "", // Keep as string, Forge might handle -1 as random if empty
    subseed = "", // Keep as string
    // resize_method_txt2img = "Crop and Resize", // New field
    width = -1, // Use -1 for defaults
    height = -1, // Use -1 for defaults
    steps = -1, // Use -1 for defaults (e.g. 20)
    cfg_scale = 0, // Use 0 for defaults (e.g. 7)
    sampler_index = 1, // Integer index, assuming 'Euler a' or similar default is often 1. This needs to be mapped from sampler_name.
    restore_faces = false,
    scheduler_or_quality_preset = "Balanced", // New field

    // MobileSD specific controls
    // save_image_to_server_path = true, // Will be handled after receiving image from SSE
    // return_image_data = false // Will be handled after receiving image from SSE
  } = req.body;

  // --- 1. Input Validation ---
  if (!server_alias || !positive_prompt) {
    return res.status(400).json({ message: 'Missing required fields: server_alias and positive_prompt.' });
  }

  try {
    // --- 2. Get Server Configuration ---
    const server = await getServerByAlias(server_alias);
    if (!server) {
      return res.status(404).json({ message: `Server configuration not found for alias: ${server_alias}` });
    }

    // --- 3. Construct Forge API Payload (for /queue/join) ---
    
    // Generate a unique session hash
    const session_hash = crypto.randomBytes(16).toString('hex').slice(0, 10); // e.g., "abc123xyz" like

    let finalPositivePrompt = positive_prompt;
    // Lora string is already part of positive_prompt from frontend if selected

    // New payload structure for fn_index: 257
    // Based on user-provided HAR data from Forge UI
    let forgePayloadData = [
        `task(${crypto.randomBytes(8).toString('hex')})`, // 0: Task ID (dynamic)
        finalPositivePrompt,                              // 1: Positive Prompt (includes LoRAs)
        negative_prompt || "",                           // 2: Negative Prompt
        [],                                               // 3: Empty array (as per HAR)
        parseInt(req.body.num_images, 10) || 1,           // 4: Batch Count / Num Images
        1,                                                // 5: Batch Size (fixed to 1 for now)
        parseFloat(req.body.cfg_scale) || 1.1,            // 6: CFG Scale (default 1.1, min for neg prompt)
        3.5,                                              // 7: Unknown (fixed 3.5 from HAR)
        parseInt(req.body.width, 10) || 512,              // 8: Width
        parseInt(req.body.height, 10) || 512,             // 9: Height
        req.body.enable_hires_fix || false,               // 10: Hires. Fix enabled
        0.7,                                              // 11: Hires. Denoising Strength (fixed 0.7)
        2,                                                // 12: Hires. Upscale Factor (fixed 2)
        "Latent",                                         // 13: Hires. Upscaler (fixed "Latent")
        0,                                                // 14: Hires. Steps (fixed 0)
        0,                                                // 15: Hires. CFG (fixed 0)
        0,                                                // 16: Unknown (fixed 0 from HAR)
        "Use same checkpoint",                            // 17: Checkpoint Name (fixed to use Forge's current)
        ["Use same choices"],                             // 18: Unknown (fixed from HAR)
        "Use same sampler",                               // 19: Sampler Name (fixed to use Forge's current for this slot)
        "Use same scheduler",                             // 20: Scheduler (fixed to use Forge's current)
        String(req.body.seed || ""),                       // 21: Seed
        String(req.body.subseed || ""),                    // 22: Subseed
        1,                                                // 23: Subseed Strength (fixed 1)
        3.5,                                              // 24: Unknown (fixed 3.5 from HAR, was sampler_index for fn_111)
        null,                                             // 25: Unknown (fixed null from HAR)
        req.body.refiner_model || "None",                 // 26: Refiner Model
        parseInt(req.body.steps, 10) || 20,               // 27: Steps
        req.body.sampler_name || "Euler",                 // 28: Sampler Name (actual for generation)
        req.body.style_preset || "Simple",                // 29: Style Preset (HAR value "Simple")
        req.body.restore_faces || false,                  // 30: Restore Faces
        req.body.sdxl_prompt_stitching ? req.body.sdxl_prompt_stitching : "", // 31: SDXL Prompt Stitching (from HAR, index 30 was "") - assuming empty if not provided
        // Defaulting the rest of the long array from the HAR payload structure for fn_index 257
        // Elements 32 onwards from the second HAR payload provided by user for fn_index 257
        0.8, -1, false, -1, 0, 0, 0,                     // 32-38
        null, null, null,                                 // 39-41 (ControlNets, defaulting to null as per second HAR)
        false, 7, 1, "Constant", 0, "Constant", 0, 1,    // 42-49
        "enable", "MEAN", "AD", 1, false,                  // 50-54
        1.01, 1.02, 0.99, 0.95,                           // 55-58
        0, 1, false,                                      // 59-61
        0.5, 2, 1, false,                                 // 62-65
        3, 0, 0, 1, false,                                // 66-70
        3, 2, 0,                                          // 71-73
        0.35, true,                                       // 74-75
        "bicubic", "bicubic", false, 0,                     // 76-79
        "anisotropic", 0, "reinhard", 100, 0,              // 80-84
        "subtract", 0, 0, "gaussian", "add", 0, 100, 127, 0, // 85-93
        "hard_clamp", 5, 0,                               // 94-96
        "None", "None", false,                             // 97-99
        "MultiDiffusion", 768, 768, 64, 4, false, 1,      // 100-106 (Tiled Diffusion/VAE settings?)
        false, false, false, false,                       // 107-110
        "positive", "comma", 0, false, false,              // 111-115 (Prompt processing options?)
        "start", "", false,                                // 116-118
        "Seed", "", "", "Nothing", "", "", "Nothing", "", "", // 119-128 (Looks like UI state for other fields)
        true, false, false, false, false, false, false, 0, false // 129-137 (More UI flags)
    ];

    const forgeApiPayload = {
      fn_index: 257, // Updated fn_index
      session_hash: session_hash,
      trigger_id: 16, // As per HAR analysis
      data: forgePayloadData
    };

    console.log(`Sending payload to ${server.apiUrl}/queue/join for server ${server.alias}`);
    // console.log('Forge Payload:', JSON.stringify(forgeApiPayload, null, 2));

    // --- 4. Make API Call to Forge --- 
    const axiosConfig = getAxiosConfig(server);
    // The /queue/join endpoint itself usually returns quickly with a queue position or similar.
    // The actual image generation happens asynchronously, and results are fetched via /queue/data (SSE).
    await axios.post(`${server.apiUrl}/queue/join`, forgeApiPayload, axiosConfig);

    // --- 5. Respond to MobileSD Client ---
    // Since generation is async, we immediately respond with the session_hash
    // The client will use this to connect to our /api/v1/progress endpoint (which will poll Forge's /queue/data)
    res.json({ 
      success: true, 
      message: 'Generation request queued.',
      session_hash: session_hash, // Client needs this
      server_alias: server_alias // Client might need this to call the correct progress endpoint
    });

  } catch (error) {
    console.error('Error during image generation process:', error);
    let statusCode = 500;
    let message = 'An error occurred during image generation.';
    if (error.response) {
      // Error from Forge API call
      statusCode = error.response.status || 502; // 502 Bad Gateway if status missing
      message = `Error from Forge API (${server_alias}): ${error.response.statusText}`; 
      console.error('Forge API Error Status:', error.response.status);
      console.error('Forge API Error Data:', error.response.data);
      // Try to include more detail from Forge's response if available
      message = error.response.data?.detail || error.response.data?.error || message;
       if (typeof error.response.data === 'string') { message = error.response.data; }
    } else if (error.request) {
      // Request made but no response received (Forge unreachable?)
      message = `Failed to connect to Forge API (${server_alias}) at ${error.config?.url}`;
      statusCode = 503; // Service Unavailable
    } else {
      // Other errors (setup, file system, etc.)
      message = error.message || message;
    }
    res.status(statusCode).json({ success: false, message: message });
  }
});

// GET /api/v1/progress - Get generation progress from a specific server
router.get('/progress', async (req, res) => {
  const { server_alias, session_hash } = req.query; // session_hash is new

  if (!server_alias || !session_hash) {
    return res.status(400).json({ message: 'Missing required query parameters: server_alias and session_hash.' });
  }

  try {
    const server = await getServerByAlias(server_alias);
    if (!server) {
      return res.status(404).json({ message: `Server configuration not found for alias: ${server_alias}` });
    }

    const axiosConfig = getAxiosConfig(server);
    // Configure Axios for SSE
    axiosConfig.responseType = 'stream'; 

    console.log(`Connecting to SSE stream at ${server.apiUrl}/queue/data?session_hash=${session_hash} for server ${server.alias}`);
    
    const forgeStreamResponse = await axios.get(
      `${server.apiUrl}/queue/data?session_hash=${session_hash}`,
      axiosConfig
    );

    // Set appropriate headers for SSE on our response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish the connection

    // Pipe the stream from Forge to our client
    forgeStreamResponse.data.pipe(res);

    // Handle stream events for logging or cleanup
    forgeStreamResponse.data.on('data', (chunk) => {
      // console.log(`SSE Data from ${server.alias} (session: ${session_hash}):`, chunk.toString());
      // TODO: Here we need to parse the SSE messages.
      // If a message indicates completion and contains image data:
      // 1. Extract base64 image.
      // 2. Save image if STABLE_DIFFUSION_SAVE_PATH is set (similar to old logic).
      // 3. Potentially send a final "completed" message back through our own SSE to the client,
      //    or the client just handles the raw SSE from Forge.
      // For now, we are just proxying the stream.
      // A more robust solution would parse messages here and then decide what to forward.
      
      // Example of trying to parse SSE data:
      const message = chunk.toString();
      const lines = message.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const jsonData = JSON.parse(line.substring(5)); // Remove 'data:' prefix
            // console.log('Parsed SSE JSON data:', jsonData);
            if (jsonData.msg === 'process_completed' && jsonData.output && jsonData.output.data && jsonData.output.data[0]) {
              // This is an example structure, actual structure might vary
              // const base64Image = jsonData.output.data[0]; // This might be the image or part of it
              // console.log(`Image generation completed for session ${session_hash} on ${server.alias}`);
              // TODO: Trigger image saving logic here if STABLE_DIFFUSION_SAVE_PATH is set
              // And potentially send a custom "completed with image" message to client.
            }
          } catch (e) {
            // console.warn('Could not parse SSE data line as JSON:', line.substring(5));
          }
        }
      }
    });

    forgeStreamResponse.data.on('end', () => {
      console.log(`SSE stream ended for ${server.alias} (session: ${session_hash})`);
      res.end(); // End the client response when the source stream ends
    });

    forgeStreamResponse.data.on('error', (err) => {
      console.error(`SSE stream error for ${server.alias} (session: ${session_hash}):`, err);
      if (!res.headersSent) {
         res.status(500).json({ success: false, message: 'SSE stream error from Forge.'});
      } else {
         res.end(); // Important to end the response if headers already sent
      }
    });

    // Keep the connection open. Client will close it or it will timeout.
    // We are piping, so we don't explicitly end `res` here unless the source stream ends or errors.
    req.on('close', () => {
        console.log(`Client closed connection for SSE stream ${server.alias} (session: ${session_hash})`);
        // Clean up: Abort the Axios request to Forge if the client disconnects.
        if (forgeStreamResponse.request) {
            forgeStreamResponse.request.abort();
        }
        if (!res.writableEnded) {
            res.end();
        }
    });


  } catch (error) {
     console.error('Error establishing SSE connection to Forge:', error);
    let statusCode = 500;
    let message = 'An error occurred establishing SSE connection.';
     if (error.response) {
      statusCode = error.response.status || 502; 
      message = `Error from Forge API (${server_alias}): ${error.response.statusText}`;
      console.error('Forge API Error Status:', error.response.status);
      console.error('Forge API Error Data:', error.response.data);
      message = error.response.data?.detail || error.response.data?.error || message;
       if (typeof error.response.data === 'string') { message = error.response.data; }
    } else if (error.request) {
      message = `Failed to connect to Forge API (${server_alias}) at ${error.config?.url}`;
      statusCode = 503; 
    } else {
      message = error.message || message;
    }
    res.status(statusCode).json({ success: false, message: message });
  }
});

module.exports = router; 