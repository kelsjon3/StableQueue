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
    positive_prompt,
    negative_prompt = "", 
    seed = -1,
    loras = [], // Example: [{ name: "lora_filename_without_extension", weight: 0.7 }]
    sampler_name = "Euler a",
    steps = 20,
    cfg_scale = 7.0,
    width = 512,
    height = 512,
    save_image_to_server_path = true,
    return_image_data = false
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

    // --- 3. Construct Forge API Payload --- 
    let finalPrompt = positive_prompt;
    if (loras && loras.length > 0) {
      const loraString = loras.map(lora => `<lora:${lora.name}:${lora.weight}>`).join(' ');
      finalPrompt = `${positive_prompt} ${loraString}`.trim();
    }

    const forgePayload = {
      prompt: finalPrompt,
      negative_prompt: negative_prompt,
      seed: seed,
      sampler_name: sampler_name,
      steps: steps,
      cfg_scale: cfg_scale,
      width: width,
      height: height,
      send_images: true, // We need the image data back
      save_images: false // Intermediary handles saving if requested
      // Add any other standard A1111/Forge parameters if needed
    };

    console.log(`Sending payload to ${server.apiUrl}/sdapi/v1/txt2img for server ${server.alias}`);
    // console.log('Payload:', JSON.stringify(forgePayload, null, 2)); // Log payload if debugging needed

    // --- 4. Make API Call to Forge --- 
    const axiosConfig = getAxiosConfig(server);
    const forgeResponse = await axios.post(`${server.apiUrl}/sdapi/v1/txt2img`, forgePayload, axiosConfig);

    // --- 5. Process Forge Response --- 
    if (forgeResponse.data && forgeResponse.data.images && forgeResponse.data.images.length > 0) {
      const base64Image = forgeResponse.data.images[0];
      let savedFilename = null;
      let serverSavePath = null;

      // --- 6. Save Image if Requested --- 
      if (save_image_to_server_path) {
        const savePathDir = process.env.STABLE_DIFFUSION_SAVE_PATH;
        if (!savePathDir) {
          console.warn('WARN: STABLE_DIFFUSION_SAVE_PATH not set. Cannot save image.');
          // Decide if this should be an error response or just a warning
        } else {
          try {
            // Generate a unique filename (simple example using timestamp and seed)
            const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
            const randomSuffix = crypto.randomBytes(4).toString('hex');
            savedFilename = `${timestamp}_seed${seed}_${randomSuffix}.png`;
            serverSavePath = path.join(savePathDir, savedFilename);

            // Ensure save directory exists
            await fs.mkdir(savePathDir, { recursive: true });

            // Decode and save the image
            const imageBuffer = Buffer.from(base64Image, 'base64');
            await fs.writeFile(serverSavePath, imageBuffer);
            console.log(`Image saved successfully to: ${serverSavePath}`);

          } catch (saveError) {
            console.error('Error saving image:', saveError);
            // Decide how to handle save error - maybe return success but with a warning?
            savedFilename = null; // Reset filename if save failed
            serverSavePath = null;
            // Consider returning a specific error message about saving failure
          }
        }
      }

      // --- 7. Construct Success Response --- 
      const successResponse = {
        success: true,
        message: 'Image generated successfully.'
      };
      if (savedFilename) {
        successResponse.image_filename = savedFilename;
        successResponse.server_save_path = serverSavePath;
      }
      if (return_image_data) {
        successResponse.image_data = base64Image;
      }
      // Optionally include generation parameters from Forge response if needed
      // successResponse.parameters = forgeResponse.data.parameters;
      // successResponse.info = forgeResponse.data.info;
      
      res.json(successResponse);

    } else {
      // Handle cases where Forge API returns success but no images
      console.error('Forge API returned success but no image data.', forgeResponse.data);
      res.status(500).json({ success: false, message: 'Forge API returned success but no image data.' });
    }

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
  const { server_alias } = req.query;

  if (!server_alias) {
    return res.status(400).json({ message: 'Missing required query parameter: server_alias.' });
  }

  try {
    const server = await getServerByAlias(server_alias);
    if (!server) {
      return res.status(404).json({ message: `Server configuration not found for alias: ${server_alias}` });
    }

    // Make API Call to Forge progress endpoint
    const axiosConfig = getAxiosConfig(server);
    console.log(`Fetching progress from ${server.apiUrl}/sdapi/v1/progress for server ${server.alias}`);
    const forgeResponse = await axios.get(`${server.apiUrl}/sdapi/v1/progress`, axiosConfig);

    // Relay the exact response from Forge
    res.json(forgeResponse.data);

  } catch (error) {
     console.error('Error fetching progress:', error);
    let statusCode = 500;
    let message = 'An error occurred fetching progress.';
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