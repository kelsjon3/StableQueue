const express = require('express');
const axios = require('axios');
const fs = require('fs'); // Use standard fs for streams
const fsp = require('fs').promises; // Use promises for metadata file operations
const path = require('path');
const { scanModelDirectory } = require('../utils/configHelpers'); // Import shared helper
const downloadQueueManager = require('../services/downloadQueueManager');
const { promisify } = require('util');
const stream = require('stream');
const pipeline = promisify(stream.pipeline);

const router = express.Router();
const CIVITAI_API_BASE = 'https://civitai.com/api/v1';
const CIVITAI_API_KEY = process.env.CIVITAI_API_KEY;
const METADATA_EXT = '.civitai.json'; // Define METADATA_EXT locally as it's not exported from configHelpers

// Helper function to create Civitai API request headers 
function getCivitaiHeaders() {
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'MobileSD/1.0'
  };
  
  // Add API key if available
  if (CIVITAI_API_KEY) {
    headers['Authorization'] = `Bearer ${CIVITAI_API_KEY}`;
  }
  
  return headers;
}

// Function to check if an API key is available and log a warning if not
function checkApiKey() {
  if (!CIVITAI_API_KEY) {
    console.warn('CIVITAI_API_KEY is not set in environment variables. Some Civitai API features may be limited or unavailable.');
    return false;
  }
  return true;
}

// Log API key status at startup
console.log(`Civitai API integration ${CIVITAI_API_KEY ? 'is using an API key' : 'is running WITHOUT an API key (limited functionality)'}`);

// GET /api/v1/civitai/user-info - Get current user info (requires API key)
router.get('/civitai/user-info', async (req, res) => {
  if (!CIVITAI_API_KEY) {
    return res.status(401).json({ 
      success: false, 
      message: 'Civitai API key is not configured' 
    });
  }

  try {
    const response = await axios.get(`${CIVITAI_API_BASE}/me`, {
      headers: getCivitaiHeaders()
    });
    
    const userData = response.data;
    res.json({ 
      success: true, 
      username: userData.username,
      id: userData.id,
      email: userData.email
    });
  } catch (error) {
    console.error('Error fetching Civitai user info:', error);
    const statusCode = error.response?.status || 500;
    const message = error.response?.data?.error || error.message || 'Failed to fetch user info';
    res.status(statusCode).json({ 
      success: false, 
      message: message 
    });
  }
});

// POST /api/v1/civitai/image-info - Get generation parameters and model info from a Civitai image ID
router.post('/civitai/image-info', async (req, res) => {
  const { civitaiImageId } = req.body;

  if (!civitaiImageId) {
    return res.status(400).json({ message: 'Missing required field: civitaiImageId.' });
  }

  try {
    console.log(`Fetching image info from Civitai for image ID: ${civitaiImageId}`);
    const response = await axios.get(`${CIVITAI_API_BASE}/images/${civitaiImageId}`);
    const imageData = response.data;

    if (!imageData || !imageData.meta) {
      return res.status(404).json({ message: 'Image metadata not found or incomplete on Civitai.' });
    }

    const meta = imageData.meta;
    const generationParams = {
      positive_prompt: meta.prompt || '',
      negative_prompt: meta.negativePrompt || '',
      seed: meta.seed || -1,
      steps: meta.steps || null,
      sampler_name: meta.sampler || null,
      cfg_scale: meta.cfgScale || null,
      width: meta.Size ? parseInt(meta.Size.split('x')[0], 10) : null,
      height: meta.Size ? parseInt(meta.Size.split('x')[1], 10) : null,
    };

    const resources = [];
    // Scan local models once
    const localLoras = await scanModelDirectory(process.env.LORA_PATH);
    const localCheckpoints = await scanModelDirectory(process.env.CHECKPOINT_PATH);

    // Process resources mentioned in meta
    if (meta.resources && Array.isArray(meta.resources)) {
      for (const resource of meta.resources) {
        // Skip if essential IDs are missing
        if (!resource.modelName || !resource.modelVersionId || !resource.modelId) continue;

        const modelVersionIdStr = resource.modelVersionId.toString();
        const resourceInfo = {
          resourceName: resource.name || resource.modelName, // Prefer name if available
          civitaiModelId: resource.modelId.toString(),
          civitaiModelVersionId: modelVersionIdStr,
          type: resource.type?.toLowerCase(), // Ensure lowercase type
          isLocal: false, // Default to false
          downloadUrl: null, // Will be populated later if needed
          fileSizeKB: null,
        };

        // Check if local
        let localMatch = null;
        if (resourceInfo.type === 'lora') {
          localMatch = localLoras.find(l => l.civitaiModelVersionId === modelVersionIdStr);
        } else if (resourceInfo.type === 'checkpoint') { // Adjust type check if Civitai uses different casing
          localMatch = localCheckpoints.find(c => c.civitaiModelVersionId === modelVersionIdStr);
        }
        resourceInfo.isLocal = !!localMatch;

        resources.push(resourceInfo);
      }
    }

    // Additionally add the main checkpoint model if specified directly in meta
    const mainCheckpointVersionId = meta.ModelmodelVersionId?.toString();
    if (meta.Model && mainCheckpointVersionId && meta.ModelmodelId) {
       const checkpointResource = {
          resourceName: meta.Model,
          civitaiModelId: meta.ModelmodelId.toString(),
          civitaiModelVersionId: mainCheckpointVersionId,
          type: 'checkpoint',
          isLocal: !!localCheckpoints.find(c => c.civitaiModelVersionId === mainCheckpointVersionId),
          downloadUrl: null,
          fileSizeKB: null,
        };
         // Avoid duplicates if already added via resources array
         if (!resources.some(r => r.civitaiModelVersionId === mainCheckpointVersionId && r.type === 'checkpoint')) {
            resources.push(checkpointResource);
         }
    }

    // Fetch download URLs and file sizes for non-local resources (Can be slow, consider optional flag?)
    // For now, let's fetch them here as the plan requires them in the response.
    for (const resource of resources) {
       if (!resource.isLocal && resource.civitaiModelVersionId) {
          try {
             const versionResponse = await axios.get(`${CIVITAI_API_BASE}/model-versions/${resource.civitaiModelVersionId}`);
             const primaryFile = versionResponse.data?.files?.[0];
             if (primaryFile) {
                 resource.downloadUrl = primaryFile.downloadUrl;
                 resource.fileSizeKB = primaryFile.sizeKB;
             }
          } catch (fetchError) {
             console.warn(`WARN: Could not fetch details for model version ${resource.civitaiModelVersionId}`, fetchError.message);
          }
       }
    }

    res.json({ success: true, generationParams, resources });

  } catch (error) {
    console.error('Error fetching image info from Civitai:', error);
    const statusCode = error.response?.status || 500;
    const message = error.response?.data?.message || error.message || 'Unknown error occurred';
    res.status(statusCode).json({ success: false, message: message });
  }
});


// POST /api/v1/civitai/download-model - Download a model by version ID
router.post('/civitai/download-model', async (req, res) => {
  const { civitaiModelVersionId, targetType, filenameOverride, priority } = req.body;

  if (!civitaiModelVersionId || !targetType || !['lora', 'checkpoint'].includes(targetType.toLowerCase())) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing or invalid required fields: civitaiModelVersionId and targetType (must be lora or checkpoint).' 
    });
  }

  try {
    // 1. Get Model Version Info from Civitai
    console.log(`Fetching model version info from Civitai for version ID: ${civitaiModelVersionId}`);
    const versionResponse = await axios.get(`${CIVITAI_API_BASE}/model-versions/${civitaiModelVersionId}`);
    const versionData = versionResponse.data;

    if (!versionData || !versionData.files || versionData.files.length === 0 || !versionData.files[0].downloadUrl) {
      return res.status(404).json({ 
        success: false, 
        message: 'Model version or download URL not found on Civitai.' 
      });
    }

    const primaryFile = versionData.files[0]; // Assuming the first file is the primary one
    const downloadUrl = primaryFile.downloadUrl;
    const civitaiFilename = primaryFile.name;
    const modelId = versionData.modelId?.toString();
    const modelName = versionData.model?.name || versionData.name || civitaiFilename;
    const finalFilename = filenameOverride || civitaiFilename;

    // 2. Use the download queue manager instead of downloading directly
    // Check if download queue manager is initialized, if not initialize it
    if (!downloadQueueManager.initialized) {
      await downloadQueueManager.initialize();
    }

    // Add the download to the queue
    const queueResult = await downloadQueueManager.addToQueue({
      modelId,
      modelVersionId: civitaiModelVersionId,
      modelName,
      type: targetType.toLowerCase(),
      priority: priority || 1,
      targetFilename: finalFilename,
      downloadUrl,
      fileSizeKb: primaryFile.sizeKB
    });

    // If the download was added to the queue successfully
    if (queueResult.success) {
      res.status(202).json({
        success: true,
        message: 'Model added to download queue',
        downloadId: queueResult.downloadId,
        modelName,
        type: targetType.toLowerCase(),
        filename: finalFilename
      });
    } else {
      res.status(400).json(queueResult);
    }
  } catch (error) {
    console.error(`Error processing Civitai model download for version ${civitaiModelVersionId}:`, error);
    
    const statusCode = error.response?.status || 500;
    const message = error.response?.data?.message || error.message || 'Unknown error occurred.';
    
    res.status(statusCode).json({ success: false, message });
  }
});

// Legacy direct download implementation - kept for reference but can be removed later
router.post('/civitai/download-model-direct', async (req, res) => {
  const { civitaiModelVersionId, targetType, filenameOverride } = req.body;

  if (!civitaiModelVersionId || !targetType || !['lora', 'checkpoint'].includes(targetType.toLowerCase())) {
    return res.status(400).json({ message: 'Missing or invalid required fields: civitaiModelVersionId and targetType (must be lora or checkpoint).' });
  }

  const targetDir = targetType.toLowerCase() === 'lora' ? process.env.LORA_PATH : process.env.CHECKPOINT_PATH;
  if (!targetDir) {
    return res.status(500).json({ message: `Target directory path (${targetType.toUpperCase()}_PATH) is not configured.` });
  }

  let finalFilePath = null; // Define here for use in catch block

  try {
    // 1. Get Model Version Info from Civitai
    console.log(`Fetching model version info from Civitai for version ID: ${civitaiModelVersionId}`);
    const versionResponse = await axios.get(`${CIVITAI_API_BASE}/model-versions/${civitaiModelVersionId}`);
    const versionData = versionResponse.data;

    if (!versionData || !versionData.files || versionData.files.length === 0 || !versionData.files[0].downloadUrl) {
      return res.status(404).json({ message: 'Model version or download URL not found on Civitai.' });
    }

    const primaryFile = versionData.files[0]; // Assuming the first file is the primary one
    const downloadUrl = primaryFile.downloadUrl;
    const civitaiFilename = primaryFile.name;
    const modelId = versionData.modelId?.toString();
    const finalFilename = filenameOverride || civitaiFilename;
    finalFilePath = path.join(targetDir, finalFilename); // Assign here
    const metadataFilePath = path.join(targetDir, path.basename(finalFilename, path.extname(finalFilename)) + METADATA_EXT);

    console.log(`Attempting to download ${finalFilename} from ${downloadUrl} to ${finalFilePath}`);

    // Ensure target directory exists
    await fsp.mkdir(targetDir, { recursive: true });

    // 2. Download the file using streams
    const writer = fs.createWriteStream(finalFilePath);
    const downloadResponse = await axios({
      method: 'get',
      url: downloadUrl,
      responseType: 'stream',
      // Optional: Add headers if Civitai requires authentication/tokens in the future
      // headers: { 'Authorization': `Bearer YOUR_API_TOKEN` }
    });

    // Pipe the download stream to the file writer
    downloadResponse.data.pipe(writer);

    // Wait for the download to finish or error
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject); // Handle errors during file writing
      downloadResponse.data.on('error', reject); // Handle errors during download stream
    });

    console.log(`Successfully downloaded ${finalFilename} to ${finalFilePath}`);

    // 3. Create/Update metadata file
    const metadataContent = {
      modelId: modelId,
      modelVersionId: civitaiModelVersionId.toString(), // Ensure string
      downloadedFrom: `https://civitai.com/models/${modelId}?modelVersionId=${civitaiModelVersionId}`,
      // Add other useful info from versionData/primaryFile if desired (e.g., fileSizeKB)
      fileName: finalFilename,
      sizeKB: primaryFile.sizeKB,
      type: primaryFile.type, // e.g., 'Model', 'Pruned Model'
    };
    await fsp.writeFile(metadataFilePath, JSON.stringify(metadataContent, null, 2), 'utf-8');
    console.log(`Metadata file created/updated at ${metadataFilePath}`);

    res.json({ 
      success: true, 
      message: `Model ${finalFilename} downloaded successfully.`, 
      filePath: finalFilePath // Path on the server where MobileSD saved it
    });

  } catch (error) {
    console.error(`Error downloading Civitai model version ${civitaiModelVersionId}:`, error);
    // Attempt to clean up partially downloaded file if it exists and path was determined
    if (finalFilePath) {
      try {
          await fsp.access(finalFilePath);
          await fsp.unlink(finalFilePath);
          console.log(`Cleaned up partially downloaded file: ${finalFilePath}`);
      } catch (cleanupError) {
          // Ignore cleanup errors (file might not exist, permissions, etc.)
          if (cleanupError.code !== 'ENOENT') {
              console.warn(`Could not cleanup partial file ${finalFilePath}:`, cleanupError.message);
          }
      }
    }

    // ... (Error reporting as before) ...
    const statusCode = error.response?.status || 500;
    const message = error.response?.data?.message || error.message || 'Unknown error occurred';
    res.status(statusCode).json({ success: false, message: message });
  }
});

// Fallback function to scrape image data when API fails
async function getImageDataByScraping(imageId) {
  try {
    console.log(`Using web scraping method to get data for image ID: ${imageId}`);
    
    // Request the image page directly
    const response = await axios.get(`https://civitai.com/images/${imageId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml'
      },
      timeout: 15000
    });
    
    // If we didn't get HTML, we can't scrape
    if (!response.data || typeof response.data !== 'string') {
      throw new Error('Invalid response for scraping');
    }
    
    const html = response.data;
    console.log(`Received HTML response (${html.length} bytes) for scraping`);
    
    // Check if we got a 404 or error page
    if (html.includes('<title>404') || html.includes('<title>Error')) {
      throw new Error('Image not found (404) or error page returned');
    }
    
    // Extract image URL from Open Graph meta tags
    const ogImageMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
    const imageUrl = ogImageMatch ? ogImageMatch[1] : null;
    
    if (!imageUrl) {
      throw new Error('Could not find image URL in the page');
    }
    
    console.log(`Found image URL: ${imageUrl}`);
    
    // Look for JSON data in the page (modern sites often embed data in script tags)
    const jsonDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/i);
    let meta = {};
    let modelInfo = null;
    let promptData = null;
    
    if (jsonDataMatch && jsonDataMatch[1]) {
      try {
        console.log('Found embedded JSON data, attempting to parse');
        const pageData = JSON.parse(jsonDataMatch[1]);
        
        // Extract data from embedded JSON
        // The exact path depends on Civitai's page structure
        if (pageData.props?.pageProps?.trpcState?.json?.queries) {
          const queries = pageData.props.pageProps.trpcState.json.queries;
          
          // Find the image data in the queries
          for (const key in queries) {
            if (key.includes('getImage') && queries[key].state.data) {
              const imageData = queries[key].state.data;
              console.log('Found image data in embedded JSON');
              
              // Extract metadata and prompt information
              meta = imageData.meta || {};
              promptData = {
                positive: meta.prompt,
                negative: meta.negativePrompt
              };
              
              // Extract model information if available
              if (imageData.modelVersion) {
                console.log(`Found model data: ${imageData.modelVersion.model.name} (${imageData.modelVersion.name})`);
                modelInfo = {
                  type: 'checkpoint',
                  name: imageData.modelVersion.model.name,
                  version: imageData.modelVersion.name,
                  id: imageData.modelVersion.id,
                  modelId: imageData.modelVersion.modelId
                };
              }
              
              break;
            }
          }
        }
        
        // If we didn't find metadata in the usual place, try looking in other paths
        if (!meta.prompt && pageData.props?.pageProps?.image?.meta) {
          meta = pageData.props.pageProps.image.meta;
          console.log('Found metadata in alternative location in JSON');
        }
        
        // If we still don't have model info, look in alternative locations
        if (!modelInfo && pageData.props?.pageProps?.image?.modelVersion) {
          const mvData = pageData.props.pageProps.image.modelVersion;
          modelInfo = {
            type: 'checkpoint',
            name: mvData.model?.name || 'Unknown Model',
            version: mvData.name || 'Unknown Version',
            id: mvData.id,
            modelId: mvData.modelId
          };
          console.log('Found model info in alternative location in JSON');
        }
      } catch (parseError) {
        console.error('Error parsing embedded JSON data:', parseError.message);
        // Continue with other methods if JSON parsing fails
      }
    }
    
    // Try to extract prompt information from meta tags if not found in JSON
    if (!meta.prompt) {
      const promptMatch = html.match(/<meta name="description" content="([^"]+)"/i);
      if (promptMatch && promptMatch[1]) {
        // Sometimes the meta description contains the prompt
        meta.prompt = promptMatch[1];
        console.log('Extracted prompt from meta description tag');
      }
    }
    
    // Extract image dimensions if available
    let width = 0;
    let height = 0;
    
    // Try to get dimensions from the meta data
    if (meta.Size) {
      const sizeParts = meta.Size.split('x');
      if (sizeParts.length === 2) {
        width = parseInt(sizeParts[0], 10) || 0;
        height = parseInt(sizeParts[1], 10) || 0;
      }
    } else if (meta.Width && meta.Height) {
      width = parseInt(meta.Width, 10) || 0;
      height = parseInt(meta.Height, 10) || 0;
    } else if (meta.size) {
      // Try lowercase 'size' too (inconsistent naming in different responses)
      const sizeParts = meta.size.split('x');
      if (sizeParts.length === 2) {
        width = parseInt(sizeParts[0], 10) || 0;
        height = parseInt(sizeParts[1], 10) || 0;
      }
    }
    
    // If we couldn't get dimensions from the metadata, try to extract from other sources
    if (width === 0 || height === 0) {
      // Try to parse dimensions from the URL (some image services include dimensions)
      const dimensionsMatch = imageUrl.match(/width=(\d+).*?height=(\d+)/i);
      if (dimensionsMatch) {
        width = parseInt(dimensionsMatch[1], 10) || 0;
        height = parseInt(dimensionsMatch[2], 10) || 0;
      }
      
      // If still no dimensions, try to extract from image path
      if ((width === 0 || height === 0) && imageUrl) {
        const pathSizeMatch = imageUrl.match(/\/width=(\d+)\//i);
        if (pathSizeMatch) {
          width = parseInt(pathSizeMatch[1], 10) || 0;
          // If we only have width, estimate height based on common aspect ratios
          if (width > 0) {
            height = Math.round(width * 1.5); // Assume 2:3 aspect ratio if unknown
          }
        }
      }
    }
    
    // Normalize model info to ensure consistent structure
    if (modelInfo) {
      // Ensure all required fields are present
      modelInfo.type = modelInfo.type || 'checkpoint';
      modelInfo.name = modelInfo.name || 'Unknown Model';
      modelInfo.version = modelInfo.version || 'Unknown Version';
      // Ensure IDs are strings to avoid issues with large integers
      if (modelInfo.id) modelInfo.id = modelInfo.id.toString();
      if (modelInfo.modelId) modelInfo.modelId = modelInfo.modelId.toString();
    }
    
    // Build a response similar to what we'd get from the API
    const result = {
      id: imageId,
      url: imageUrl,
      width: width,
      height: height,
      meta: meta || {},
      modelVersion: modelInfo,
      scraped: true  // Flag to indicate this was obtained through scraping
    };
    
    console.log('Successfully extracted image data via scraping');
    console.log(`Image dimensions: ${width}x${height}`);
    console.log(`Prompt extracted: ${meta.prompt ? 'Yes' : 'No'}`);
    console.log(`Model info extracted: ${modelInfo ? 'Yes' : 'No'}`);
    
    return result;
    
  } catch (error) {
    console.error('Error in scraping image data:', error.message);
    throw new Error(`Web scraping failed: ${error.message}`);
  }
}

// Route to get image info from Civitai
router.get('/api/v1/civitai/image-info', async (req, res) => {
  const imageId = req.query.imageId;
  
  if (!imageId) {
    return res.status(400).json({ success: false, message: 'Image ID is required' });
  }
  
  // Check API key status
  const hasApiKey = checkApiKey();
  console.log(`Fetching image info from Civitai for image ID: ${imageId}${hasApiKey ? ' (with API key)' : ' (without API key)'}`);
  
  try {
    // Try various approaches to get the image data
    let imageFound = false;
    let imageData = null;
    
    // Attempt 1: Try the direct endpoint GET /api/v1/images/{imageId}
    // Note: As of now, this returns HTML instead of JSON, but we'll keep it in case
    // Civitai implements this endpoint in the future
    if (hasApiKey) {  // Only try if we have an API key
      try {
        const directEndpointUrl = `${CIVITAI_API_BASE}/images/${imageId}`;
        console.log(`Trying direct endpoint: ${directEndpointUrl}`);
        
        const response = await axios.get(directEndpointUrl, {
          headers: getCivitaiHeaders(),
          timeout: 15000,
          validateStatus: (status) => status === 200, // Only accept 200 status
          responseType: 'json'  // Explicitly request JSON
        });
        
        console.log(`Direct endpoint response status: ${response.status}`);
        console.log(`Direct endpoint response type: ${typeof response.data}`);
        console.log(`Direct endpoint response headers: ${JSON.stringify(response.headers)}`);
        console.log(`Direct endpoint content-type: ${response.headers['content-type']}`);
        
        if (typeof response.data === 'string') {
          console.log(`Direct endpoint response preview: ${response.data.substring(0, 200)}...`);
          // Try to parse the string response to see if it's valid JSON
          try {
            const parsedData = JSON.parse(response.data);
            console.log(`Successfully parsed string response as JSON`);
            response.data = parsedData;
          } catch (parseError) {
            console.log(`Failed to parse response string as JSON: ${parseError.message}`);
          }
        } else {
          console.log(`Response data is not a string, data type: ${typeof response.data}`);
          if (response.data === null) {
            console.log(`Response data is null`);
          } else if (typeof response.data === 'object') {
            console.log(`Response data keys: ${Object.keys(response.data).join(', ')}`);
          }
        }
        
        // Verify we got JSON, not HTML
        if (response.data && 
            response.data.id && 
            typeof response.data === 'object' && 
            !response.data.toString().includes('<!DOCTYPE html>')) {
          console.log(`Successfully found image via direct endpoint`);
          imageFound = true;
          imageData = response.data;
        } else {
          console.log(`Direct endpoint returned unexpected format (possibly HTML)`);
          if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
            console.log(`Response contains HTML instead of JSON`);
          }
        }
      } catch (directEndpointError) {
        console.log(`Direct endpoint approach failed: ${directEndpointError.message}`);
        if (directEndpointError.response) {
          console.log(`Status: ${directEndpointError.response.status}`);
          console.log(`Headers: ${JSON.stringify(directEndpointError.response.headers)}`);
          
          if (directEndpointError.response.data) {
            const preview = typeof directEndpointError.response.data === 'string' 
              ? directEndpointError.response.data.substring(0, 200) 
              : JSON.stringify(directEndpointError.response.data).substring(0, 200);
            console.log(`Response data preview: ${preview}...`);
          }
        }
      }
    }
    
    // Attempt 2: Try with postId parameter
    if (!imageFound) {
      console.log(`Trying to access image via the post endpoint`);
      
      const postIdUrl = `${CIVITAI_API_BASE}/images?postId=${imageId}&limit=1`;
      console.log(`Making request to: ${postIdUrl}`);
      
      try {
        const response = await axios.get(postIdUrl, {
          headers: getCivitaiHeaders(),
          timeout: 15000
        });
        
        console.log(`Post endpoint response status: ${response.status}`);
        console.log(`Post endpoint response headers: ${JSON.stringify(response.headers)}`);
        console.log(`Post endpoint content-type: ${response.headers['content-type']}`);
        
        if (response.data) {
          console.log(`Post endpoint response type: ${typeof response.data}`);
          if (typeof response.data === 'string') {
            console.log(`Post endpoint response preview: ${response.data.substring(0, 200)}...`);
            try {
              const parsedData = JSON.parse(response.data);
              console.log(`Successfully parsed post endpoint string response as JSON`);
              response.data = parsedData;
            } catch (parseError) {
              console.log(`Failed to parse post endpoint response as JSON: ${parseError.message}`);
            }
          }
          console.log(`Post endpoint returned ${response.data.items ? response.data.items.length : 0} items`);
        }
        
        if (response.data && response.data.items && response.data.items.length > 0) {
          console.log(`Successfully found image via postId search`);
          imageFound = true;
          imageData = response.data.items[0];
        } else {
          console.log(`Post ID approach returned no results`);
        }
      } catch (postIdError) {
        console.log(`Post ID approach failed: ${postIdError.message}`);
        if (postIdError.response) {
          console.log(`Status: ${postIdError.response.status}`);
          console.log(`Headers: ${JSON.stringify(postIdError.response.headers)}`);
          
          if (postIdError.response.data) {
            const preview = typeof postIdError.response.data === 'string' 
              ? postIdError.response.data.substring(0, 200) 
              : JSON.stringify(postIdError.response.data).substring(0, 200);
            console.log(`Response data preview: ${preview}...`);
          }
        }
      }
    }
    
    // Attempt 3: Fallback to web scraping if API approaches failed
    if (!imageFound) {
      console.log(`Could not find image via API methods, falling back to web scraping`);
      try {
        const scrapedData = await getImageDataByScraping(imageId);
        imageData = scrapedData;
        console.log(`Web scraping successful, data structure: ${JSON.stringify(Object.keys(scrapedData))}`);
        
        // If we have a modelVersionId from scraping, try to get more details about it via the API
        if (imageData.modelVersion && imageData.modelVersion.id && hasApiKey) {
          try {
            console.log(`Fetching model version data via API for ID: ${imageData.modelVersion.id}`);
            const modelResponse = await axios.get(`${CIVITAI_API_BASE}/model-versions/${imageData.modelVersion.id}`, {
              headers: getCivitaiHeaders()
            });
            
            // Add model details to our data
            imageData.modelData = modelResponse.data;
            console.log(`Successfully fetched model data for ID: ${imageData.modelVersion.id}`);
          } catch (modelError) {
            console.warn(`Could not fetch model data: ${modelError.message}`);
          }
        }
      } catch (scrapingError) {
        console.error(`Web scraping approach failed: ${scrapingError.message}`);
        // If we get here, we've tried all approaches and failed
        return res.status(404).json({ 
          success: false, 
          message: `Could not find image with ID ${imageId}`, 
          details: 'Tried direct API access, post ID search, and web scraping - all methods failed.',
          apiKeyMissing: !hasApiKey
        });
      }
    }
    
    if (!imageData) {
      return res.status(404).json({ 
        success: false, 
        message: `Could not find image with ID ${imageId}`, 
        details: 'No image data was found through any available methods.',
        apiKeyMissing: !hasApiKey
      });
    }
    
    // Log successful image data retrieval
    console.log(`Successfully retrieved data for image ID: ${imageId}. Building response...`);
    
    // Extract generation parameters if available
    const generationParams = imageData.meta?.prompt ? {
      positive_prompt: imageData.meta.prompt,
      negative_prompt: imageData.meta.negativePrompt,
      steps: imageData.meta.steps,
      sampler: imageData.meta.sampler,
      cfg_scale: imageData.meta.cfgScale,
      width: imageData.width,
      height: imageData.height,
      seed: imageData.meta.seed
    } : null;
    
    // Get information about resources used in this image
    const resources = [];
    
    // If we have civitai resources in meta data
    if (imageData.meta && imageData.meta.civitaiResources && Array.isArray(imageData.meta.civitaiResources)) {
      for (const resource of imageData.meta.civitaiResources) {
        // Skip if missing essential information
        if (!resource.modelId || !resource.modelVersionId) continue;
        
        // Check if this resource is already in our local directories
        const resourceTypeDir = resource.type === 'CHECKPOINT' ? process.env.CHECKPOINT_PATH : 
                             resource.type === 'LORA' ? process.env.LORA_PATH : null;
        
        let isLocal = false;
        
        if (resourceTypeDir) {
          try {
            // Scan the directory for the resource
            const modelVersionId = resource.modelVersionId.toString();
            const localModels = await scanModelDirectory(resourceTypeDir);
            isLocal = localModels.some(model => 
              model.civitaiModelVersionId === modelVersionId || 
              (model.civitaiModelId && model.civitaiModelId === resource.modelId.toString())
            );
          } catch (err) {
            console.warn(`Error checking if resource is local: ${err.message}`);
          }
        }
        
        resources.push({
          name: resource.name || 'Unknown Resource',
          type: resource.type.toLowerCase(),
          id: resource.modelVersionId,
          civitaiModelVersionId: resource.modelVersionId.toString(),
          civitaiModelId: resource.modelId.toString(),
          isLocal: isLocal,
          hash: resource.hash
        });
      }
    }
    
    // If we have model data from the API, use it
    if (imageData.modelData) {
      const modelType = imageData.modelData.type?.toLowerCase() || 'checkpoint';
      
      // Check if this model is already installed locally
      let isLocal = false;
      const resourceTypeDir = modelType === 'checkpoint' ? process.env.CHECKPOINT_PATH : 
                            modelType === 'lora' ? process.env.LORA_PATH : null;
      
      if (resourceTypeDir) {
        try {
          const modelVersionId = imageData.modelData.id.toString();
          const localModels = await scanModelDirectory(resourceTypeDir);
          isLocal = localModels.some(model => 
            model.civitaiModelVersionId === modelVersionId || 
            (model.civitaiModelId && model.civitaiModelId === imageData.modelData.modelId.toString())
          );
        } catch (err) {
          console.warn(`Error checking if model is local: ${err.message}`);
        }
      }
      
      resources.push({
        name: imageData.modelData.model.name,
        type: modelType,
        version: imageData.modelData.name,
        id: imageData.modelData.id,
        civitaiModelVersionId: imageData.modelData.id.toString(),
        civitaiModelId: imageData.modelData.modelId.toString(),
        downloadUrl: imageData.modelData.downloadUrl,
        trainedWords: imageData.modelData.trainedWords || [],
        baseModel: imageData.modelData.baseModel,
        isLocal: isLocal,
        fileSizeKB: imageData.modelData.files?.[0]?.sizeKB
      });
    } 
    // Otherwise, if there's a model reference from scraping, include it
    else if (imageData.modelVersion) {
      // Check if this model is already installed locally
      let isLocal = false;
      const modelType = 'checkpoint'; // Most likely a checkpoint if we're scraping
      
      try {
        const modelVersionId = imageData.modelVersion.id.toString();
        const localModels = await scanModelDirectory(process.env.CHECKPOINT_PATH);
        isLocal = localModels.some(model => 
          model.civitaiModelVersionId === modelVersionId || 
          (model.civitaiModelId && model.civitaiModelId === imageData.modelVersion.modelId?.toString())
        );
      } catch (err) {
        console.warn(`Error checking if scraped model is local: ${err.message}`);
      }
      
      resources.push({
        name: imageData.modelVersion.name || 'Unknown Model',
        type: 'checkpoint',
        id: imageData.modelVersion.id,
        civitaiModelVersionId: imageData.modelVersion.id.toString(),
        civitaiModelId: imageData.modelVersion.modelId?.toString() || '0',
        isLocal: isLocal
      });
    }

    // Attempt to get additional related images by model
    let relatedImages = [];
    if (resources.length > 0 && hasApiKey) {
      try {
        const mainResource = resources[0]; // Use the first resource as main
        const relatedImagesUrl = `${CIVITAI_API_BASE}/images?modelVersionId=${mainResource.civitaiModelVersionId}&limit=5`;
        console.log(`Fetching related images: ${relatedImagesUrl}`);
        
        const relatedResponse = await axios.get(relatedImagesUrl, {
          headers: getCivitaiHeaders(),
          timeout: 15000
        });
        
        if (relatedResponse.data && relatedResponse.data.items) {
          // Filter out current image
          relatedImages = relatedResponse.data.items
            .filter(img => img.id.toString() !== imageId.toString())
            .map(img => ({
              id: img.id,
              url: img.url,
              width: img.width,
              height: img.height,
              nsfw: img.nsfw,
              createdAt: img.createdAt,
              meta: img.meta
            }))
            .slice(0, 4); // Limit to 4 related images
        }
      } catch (error) {
        console.warn(`Could not fetch related images: ${error.message}`);
      }
    }
    
    // Return the combined data
    return res.json({
      success: true,
      image: {
        id: imageData.id,
        url: imageData.url,
        width: imageData.width || 0,
        height: imageData.height || 0,
        nsfw: (imageData.nsfw !== undefined) ? imageData.nsfw : 
             ((imageData.meta && imageData.meta.nsfw) || false),
        meta: imageData.meta || {}
      },
      generationParams,
      resources,
      relatedImages,
      source: imageFound ? 'api' : 'scraped',
      apiKeyMissing: !hasApiKey
    });
    
  } catch (error) {
    console.error('Error fetching image info from Civitai:', error.message);
    
    // Detailed error logging
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
      const responsePreview = typeof error.response.data === 'string' 
        ? error.response.data.substring(0, 200) 
        : JSON.stringify(error.response.data).substring(0, 200);
      console.error('Response preview:', responsePreview);
    }
    
    // Provide a helpful error message
    res.status(500).json({ 
      success: false, 
      message: `Failed to fetch image data: ${error.message}`, 
      details: 'The Civitai API structure doesn\'t provide a direct endpoint for single images by ID',
      apiKeyMissing: !hasApiKey
    });
  }
});

module.exports = router; 