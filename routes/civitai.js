const express = require('express');
const axios = require('axios');
const fs = require('fs'); // Use standard fs for streams
const fsp = require('fs').promises; // Use promises for metadata file operations
const path = require('path');
const { scanModelDirectory } = require('../utils/configHelpers'); // Import shared helper

const router = express.Router();
const CIVITAI_API_BASE = 'https://civitai.com/api/v1';
const METADATA_EXT = '.civitai.json'; // Define METADATA_EXT locally as it's not exported from configHelpers

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
    // ... (Error handling as before) ...
     res.status(statusCode).json({ success: false, message: message });
  }
});


// POST /api/v1/civitai/download-model - Download a model by version ID
router.post('/civitai/download-model', async (req, res) => {
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
    res.status(statusCode).json({ success: false, message: message });
  }
});


module.exports = router; 