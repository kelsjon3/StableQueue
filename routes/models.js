const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { scanModelDirectory } = require('../utils/configHelpers');
const modelDB = require('../utils/modelDatabase');
const axios = require('axios');

const router = express.Router();

// Common extensions for model files
const MODEL_EXTENSIONS = ['.safetensors', '.pt', '.ckpt'];
const CIVITAI_API_BASE = 'https://civitai.com/api/v1';

// Add rate limiting for Civitai API
const CIVITAI_RATE_LIMIT = {
    lastRequestTime: 0,
    minDelayMs: 1000, // 1 second minimum between requests
    timeout: 10000 // 10 second timeout
};

/**
 * Make a rate-limited request to Civitai API
 * @param {string} url - The API URL to request
 * @param {Object} options - Axios request options
 * @returns {Promise} - Axios response
 */
async function rateLimitedCivitaiRequest(url, options = {}) {
    const now = Date.now();
    const timeSinceLastRequest = now - CIVITAI_RATE_LIMIT.lastRequestTime;
    
    // If we need to wait to respect rate limit
    if (timeSinceLastRequest < CIVITAI_RATE_LIMIT.minDelayMs) {
        const waitTime = CIVITAI_RATE_LIMIT.minDelayMs - timeSinceLastRequest;
        console.log(`[Civitai] Rate limiting: waiting ${waitTime}ms before next request`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Set timeout and update last request time
    CIVITAI_RATE_LIMIT.lastRequestTime = Date.now();
    
    try {
        return await axios.get(url, { 
            ...options,
            timeout: CIVITAI_RATE_LIMIT.timeout 
        });
    } catch (error) {
        if (error.response && error.response.status === 429) {
            console.error(`[Civitai] Rate limit exceeded: ${error.message}`);
        } else if (error.code === 'ECONNABORTED') {
            console.error(`[Civitai] Request timeout after ${CIVITAI_RATE_LIMIT.timeout/1000}s: ${url}`);
        } else {
            console.error(`[Civitai] Request failed: ${error.message}`);
        }
        throw error;
    }
}

/**
 * GET /api/v1/models
 * Returns a combined list of checkpoints and LoRAs with metadata
 */
router.get('/models', async (req, res) => {
    try {
        const checkpointPath = process.env.CHECKPOINT_PATH;
        const loraPath = process.env.LORA_PATH;
        
        if (!checkpointPath || !loraPath) {
            return res.status(500).json({ 
                success: false, 
                message: 'Model paths not configured. Check CHECKPOINT_PATH and LORA_PATH environment variables.' 
            });
        }
        
        // Scan both directories
        const checkpoints = await scanModelDirectory(checkpointPath, MODEL_EXTENSIONS, checkpointPath);
        const loras = await scanModelDirectory(loraPath, MODEL_EXTENSIONS, loraPath);
        
        // Add type and base model info to each model
        const checkpointsWithType = checkpoints.map(model => {
            return {
                ...model,
                type: 'checkpoint',
                baseModel: extractBaseModel(model),
                preview_url: getPreviewUrl(model, 'checkpoint'),
                civitai_url: getCivitaiUrl(model),
                // Add description if available from metadata
                description: model.description || model.model?.description || null
            };
        });
        
        const lorasWithType = loras.map(model => {
            return {
                ...model,
                type: 'lora',
                baseModel: extractBaseModel(model),
                preview_url: getPreviewUrl(model, 'lora'),
                civitai_url: getCivitaiUrl(model),
                // Add description if available from metadata
                description: model.description || model.model?.description || null
            };
        });
        
        // Combine and return
        const combinedModels = [...checkpointsWithType, ...lorasWithType];
        
        res.json({
            success: true,
            count: combinedModels.length,
            models: combinedModels
        });
        
    } catch (error) {
        console.error('Error retrieving models:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to retrieve models', 
            error: error.message 
        });
    }
});

/**
 * GET /api/v1/models/:id/preview
 * Serves the preview image for a model
 */
router.get('/models/:id/preview', async (req, res) => {
    try {
        const modelId = req.params.id;
        const type = req.query.type || 'checkpoint'; // Default to checkpoint if not specified
        
        // Route currently expects ID in format: relativePath/filename (without extension)
        // This could be enhanced to use database IDs in the future
        const modelPath = modelId;
        const basePath = type === 'checkpoint' ? process.env.CHECKPOINT_PATH : process.env.LORA_PATH;
        
        if (!basePath) {
            return res.status(500).json({ 
                success: false, 
                message: `${type.toUpperCase()}_PATH not configured` 
            });
        }
        
        // The preview image is assumed to be {filename}.preview.png in the same directory
        // This matches Forge's convention
        const parts = modelPath.split('/');
        const filename = parts.pop(); // Get just the filename
        const directory = parts.join('/'); // Recombine the directory path
        
        const fullDirectory = path.join(basePath, directory);
        const modelBasename = filename.substring(0, filename.lastIndexOf('.'));
        
        // Try different common preview naming conventions, prioritizing JPG files
        const previewOptions = [
            // First check for JPG and other common formats
            path.join(fullDirectory, `${modelBasename}.jpg`),
            path.join(fullDirectory, `${modelBasename}.jpeg`),
            path.join(fullDirectory, `${modelBasename}.png`),
            // Then check Forge-style preview files
            path.join(fullDirectory, `${modelBasename}.preview.png`),
            // Check other image formats
            path.join(fullDirectory, `${modelBasename}.webp`),
            path.join(fullDirectory, `${modelBasename}.gif`),
            path.join(fullDirectory, `${modelBasename}.preview.jpg`),
            path.join(fullDirectory, `${modelBasename}.preview.jpeg`),
            path.join(fullDirectory, `${modelBasename}.preview.webp`)
        ];
        
        // Try to find any existing preview image
        let previewPath = null;
        for (const option of previewOptions) {
            try {
                await fs.access(option);
                previewPath = option;
                console.log(`[Models] Found preview image: ${option}`);
                break;
            } catch (err) {
                // File doesn't exist or isn't accessible, try next option
            }
        }
        
        if (!previewPath) {
            // If no preview found, return a default placeholder
            return res.status(404).json({
                success: false,
                message: 'No preview image found for this model'
            });
        }
        
        // Send the preview image
        res.sendFile(previewPath);
        
    } catch (error) {
        console.error('Error serving model preview:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to serve model preview', 
            error: error.message 
        });
    }
});

/**
 * GET /api/v1/models/:id/info
 * Returns detailed information about a specific model
 */
router.get('/models/:id/info', async (req, res) => {
    try {
        const modelId = req.params.id;
        const type = req.query.type || 'checkpoint'; // Default to checkpoint if not specified
        const fetchFromCivitai = req.query.fetchFromCivitai === 'true'; // Optional param to fetch latest data from Civitai
        
        // Route currently expects ID in format: relativePath/filename (with extension)
        const modelPath = modelId;
        const basePath = type === 'checkpoint' ? process.env.CHECKPOINT_PATH : process.env.LORA_PATH;
        
        if (!basePath) {
            return res.status(500).json({ 
                success: false, 
                message: `${type.toUpperCase()}_PATH not configured` 
            });
        }
        
        // Extract parts
        const parts = modelPath.split('/');
        const filename = parts.pop(); // Get just the filename
        const directory = parts.join('/'); // Recombine the directory path
        
        const fullDirectory = path.join(basePath, directory);
        const fullPath = path.join(fullDirectory, filename);
        const modelBasename = filename.substring(0, filename.lastIndexOf('.'));
        
        // Check if the model exists
        try {
            await fs.access(fullPath);
        } catch (err) {
            return res.status(404).json({
                success: false,
                message: 'Model file not found'
            });
        }
        
        // Try to load metadata - first check Forge style (model.json), then our format (.civitai.json)
        let metadata = {};
        let metadataSource = null;
        
        // First check Forge-style metadata (modelname.json)
        const forgeMetadataPath = path.join(fullDirectory, `${modelBasename}.json`);
        try {
            const jsonData = await fs.readFile(forgeMetadataPath, 'utf-8');
            metadata = JSON.parse(jsonData);
            if (metadata.modelId || metadata.model?.id || metadata.id) {
                console.log(`[Models] Found Forge-style metadata at ${forgeMetadataPath}`);
                metadataSource = forgeMetadataPath;
            }
        } catch (err) {
            // Forge metadata doesn't exist or can't be parsed
            
            // Try our .civitai.json format as fallback
            const civitaiMetadataPath = path.join(fullDirectory, `${modelBasename}.civitai.json`);
            try {
                const jsonData = await fs.readFile(civitaiMetadataPath, 'utf-8');
                metadata = JSON.parse(jsonData);
                if (metadata.modelId || metadata.model?.id || metadata.id) {
                    console.log(`[Models] Found MobileSD-style metadata at ${civitaiMetadataPath}`);
                    metadataSource = civitaiMetadataPath;
                }
            } catch (err) {
                // No valid metadata found
                console.log(`[Models] No metadata found for ${modelBasename}`);
            }
        }
        
        // Try to find preview image
        const previewOptions = [
            path.join(fullDirectory, `${modelBasename}.preview.png`),
            path.join(fullDirectory, `${modelBasename}.png`),
            path.join(fullDirectory, `${modelBasename}.jpg`),
            path.join(fullDirectory, `${modelBasename}.jpeg`),
            path.join(fullDirectory, `${modelBasename}.webp`)
        ];
        
        let previewPath = null;
        for (const option of previewOptions) {
            if (fsSync.existsSync(option)) {
                previewPath = option;
                break;
            }
        }
        
        // Get file stats
        const stats = await fs.stat(fullPath);
        
        // Look up model in database (if available)
        const modelDbEntry = modelDB.findModel(modelPath, type);
        
        // Define modelInfo with local data
        let modelInfo = {
            success: true,
            id: modelPath,
            type: type,
            filename: filename,
            relativePath: directory,
            fullPath: fullPath,
            baseModel: extractBaseModelFromMetadata(metadata) || "Unknown",
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            has_preview: !!previewPath,
            preview_url: previewPath ? `/api/v1/models/${encodeURIComponent(modelPath)}/preview?type=${type}` : null,
            civitai_id: metadata.modelId || metadata.model?.id || metadata.id || null,
            civitai_url: getCivitaiUrlFromMetadata(metadata),
            metadata_path: metadataSource,
            metadata: metadata
        };
        
        // Add database info if available
        if (modelDbEntry) {
            modelInfo.forge_format = modelDbEntry.forge_format;
            modelInfo.hash = modelDbEntry.hash;
        }
        
        // Fetch additional information from Civitai if requested and model has a Civitai ID
        if (fetchFromCivitai && modelInfo.civitai_id) {
            try {
                // Prefer specific version ID if available
                if (metadata.modelVersionId) {
                    const versionResponse = await rateLimitedCivitaiRequest(`${CIVITAI_API_BASE}/model-versions/${metadata.modelVersionId}`);
                    const versionData = versionResponse.data;
                    
                    // Enhance modelInfo with additional Civitai data
                    modelInfo.civitai_data = {
                        name: versionData.name,
                        description: versionData.description,
                        baseModel: versionData.baseModel,
                        trainedWords: versionData.trainedWords || [],
                        tags: versionData.tags || [],
                        stats: versionData.stats,
                        modelVersionId: versionData.id,
                        downloadUrl: versionData.downloadUrl,
                        images: versionData.images?.map(img => ({
                            url: img.url,
                            nsfw: img.nsfw,
                            width: img.width,
                            height: img.height,
                            hash: img.hash
                        })) || []
                    };
                } else if (modelInfo.civitai_id) {
                    // Fallback to model ID
                    const modelResponse = await rateLimitedCivitaiRequest(`${CIVITAI_API_BASE}/models/${modelInfo.civitai_id}`);
                    const modelData = modelResponse.data;
                    
                    // Use the most recent model version
                    const latestVersion = modelData.modelVersions?.[0];
                    
                    if (latestVersion) {
                        modelInfo.civitai_data = {
                            name: modelData.name,
                            description: modelData.description,
                            baseModel: latestVersion.baseModel,
                            trainedWords: latestVersion.trainedWords || [],
                            tags: modelData.tags || [],
                            stats: {
                                downloadCount: modelData.stats?.downloadCount,
                                favoriteCount: modelData.stats?.favoriteCount,
                                commentCount: modelData.stats?.commentCount,
                                ratingCount: modelData.stats?.ratingCount,
                                rating: modelData.stats?.rating
                            },
                            modelVersionId: latestVersion.id,
                            images: latestVersion.images?.map(img => ({
                                url: img.url,
                                nsfw: img.nsfw,
                                width: img.width,
                                height: img.height,
                                hash: img.hash
                            })) || []
                        };
                    }
                }
                
                console.log(`[Models] Enhanced model ${modelPath} with Civitai data`);
            } catch (civitaiError) {
                console.warn(`[Models] Error fetching Civitai data for model ${modelPath}:`, civitaiError.message);
                // Don't fail the whole request if Civitai fetch fails
                modelInfo.civitai_fetch_error = civitaiError.message;
            }
        }
        
        res.json(modelInfo);
        
    } catch (error) {
        console.error('Error retrieving model info:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to retrieve model info', 
            error: error.message 
        });
    }
});

/**
 * POST /api/v1/models/:id/refresh-metadata
 * Refreshes metadata for a model from Civitai
 */
router.post('/models/:id/refresh-metadata', async (req, res) => {
    try {
        const modelPathId = req.params.id;
        const type = req.query.type || 'checkpoint'; // Default to checkpoint if not specified
        
        // Get model info first
        const modelPath = modelPathId;
        const basePath = type === 'checkpoint' ? process.env.CHECKPOINT_PATH : process.env.LORA_PATH;
        
        if (!basePath) {
            return res.status(500).json({ 
                success: false, 
                message: `${type.toUpperCase()}_PATH not configured` 
            });
        }
        
        // Extract parts
        const parts = modelPath.split('/');
        const filename = parts.pop(); // Get just the filename
        const directory = parts.join('/'); // Recombine the directory path
        
        const fullDirectory = path.join(basePath, directory);
        const fullPath = path.join(fullDirectory, filename);
        const modelBasename = filename.substring(0, filename.lastIndexOf('.'));
        
        // Check if model exists
        try {
            await fs.access(fullPath);
        } catch (err) {
            return res.status(404).json({
                success: false,
                message: 'Model file not found'
            });
        }
        
        // Check for existing files in the directory
        console.log(`[Models] Checking for existing metadata for ${modelBasename}`);
        
        // Check first for Forge-style JSON (just the model name, no .civitai suffix)
        let forgeMetadataPath = path.join(fullDirectory, `${modelBasename}.json`);
        let metadataPath = forgeMetadataPath; // Default to Forge-style path
        let existingMetadata = {};
        let existingMetadataFound = false;
        
        // First try to read Forge-style JSON (just the model name)
        try {
            const jsonData = await fs.readFile(forgeMetadataPath, 'utf-8');
            existingMetadata = JSON.parse(jsonData);
            if (existingMetadata.modelId || existingMetadata.model?.id) {
                console.log(`[Models] Found existing Forge-style metadata at ${forgeMetadataPath}`);
                existingMetadataFound = true;
            }
        } catch (err) {
            // Forge-style metadata doesn't exist or can't be parsed
            console.log(`[Models] No Forge-style metadata found at ${forgeMetadataPath}`);
            
            // Try our .civitai.json format as fallback
            try {
                const civitaiMetadataPath = path.join(fullDirectory, `${modelBasename}.civitai.json`);
                const jsonData = await fs.readFile(civitaiMetadataPath, 'utf-8');
                existingMetadata = JSON.parse(jsonData);
                if (existingMetadata.modelId || existingMetadata.model?.id) {
                    console.log(`[Models] Found existing MobileSD metadata at ${civitaiMetadataPath}`);
                    existingMetadataFound = true;
                    // Use our format if that's what we found
                    metadataPath = civitaiMetadataPath;
                }
            } catch (err) {
                // Neither format found
                console.log(`[Models] No existing metadata found for ${modelBasename}`);
            }
        }
        
        // Get values from existing metadata or from request body
        let civitaiVersionId = req.body.modelVersionId;
        let civitaiModelId = req.body.modelId;
        let modelName = req.body.modelName || filename.replace(/\.\w+$/, ''); 
        
        // Extract IDs from existing metadata if available
        if (existingMetadataFound) {
            // Use existing IDs if not provided in request
            civitaiVersionId = civitaiVersionId || existingMetadata.modelVersionId || existingMetadata.model?.modelVersionId;
            civitaiModelId = civitaiModelId || existingMetadata.modelId || existingMetadata.model?.id;
            modelName = existingMetadata.name || existingMetadata.model?.name || modelName;
        }
        
        // Check for existing preview images (before making any API calls)
        const previewOptions = [
            path.join(fullDirectory, `${modelBasename}.preview.png`),
            path.join(fullDirectory, `${modelBasename}.png`),
            path.join(fullDirectory, `${modelBasename}.jpg`),
            path.join(fullDirectory, `${modelBasename}.jpeg`),
            path.join(fullDirectory, `${modelBasename}.webp`)
        ];
        
        let existingPreviewPath = null;
        for (const option of previewOptions) {
            try {
                await fs.access(option);
                existingPreviewPath = option;
                console.log(`[Models] Found existing preview image at ${option}`);
                break;
            } catch (err) {
                // Continue checking other formats
            }
        }
        
        // Fetch data from Civitai if we don't have sufficient information
        let metadata = { ...existingMetadata };
        let fetchSuccess = existingMetadataFound;
        
        // Only fetch if we need to
        if (!fetchSuccess || req.query.force === 'true') {
            fetchSuccess = false; // Reset if forced refresh
        
            // First try using direct IDs if available
            if (civitaiVersionId) {
                try {
                    // Fetch by version ID (preferred)
                    console.log(`[Models] Fetching by version ID: ${civitaiVersionId}`);
                    const versionResponse = await rateLimitedCivitaiRequest(`${CIVITAI_API_BASE}/model-versions/${civitaiVersionId}`);
                    const versionData = versionResponse.data;
                    
                    // Update metadata in Forge-compatible format
                    metadata = {
                        id: versionData.modelId, // Forge format uses this field name
                        modelId: versionData.modelId.toString(),
                        modelVersionId: civitaiVersionId.toString(),
                        name: versionData.name,
                        baseModel: versionData.baseModel,
                        description: versionData.description,
                        trainedWords: versionData.trainedWords || [],
                        type: versionData.type,
                        model: { // Include both formats for maximum compatibility
                            name: versionData.name,
                            id: versionData.modelId.toString(),
                            baseModel: versionData.baseModel,
                            description: versionData.description
                        },
                        fileName: filename,
                        downloadUrl: versionData.downloadUrl,
                        updated_at: new Date().toISOString()
                    };
                    fetchSuccess = true;
                } catch (error) {
                    console.warn(`[Models] Error fetching from Civitai by version ID: ${error.message}`);
                    // Continue to next method
                }
            }
            
            if (!fetchSuccess && civitaiModelId) {
                try {
                    // Fetch by model ID (fallback)
                    console.log(`[Models] Fetching by model ID: ${civitaiModelId}`);
                    const modelResponse = await rateLimitedCivitaiRequest(`${CIVITAI_API_BASE}/models/${civitaiModelId}`);
                    const modelData = modelResponse.data;
                    
                    // Use the most recent model version
                    const latestVersion = modelData.modelVersions?.[0];
                    
                    if (latestVersion) {
                        metadata = {
                            id: civitaiModelId, // Forge format uses this field name
                            modelId: civitaiModelId.toString(),
                            modelVersionId: latestVersion.id.toString(),
                            name: modelData.name,
                            baseModel: latestVersion.baseModel,
                            description: modelData.description,
                            trainedWords: latestVersion.trainedWords || [],
                            type: latestVersion.type,
                            model: { // Include both formats for compatibility
                                name: modelData.name,
                                id: civitaiModelId.toString(),
                                baseModel: latestVersion.baseModel,
                                description: modelData.description
                            },
                            fileName: filename,
                            downloadUrl: latestVersion.downloadUrl,
                            updated_at: new Date().toISOString()
                        };
                        fetchSuccess = true;
                    }
                } catch (error) {
                    console.warn(`[Models] Error fetching from Civitai by model ID: ${error.message}`);
                    // Continue to next method
                }
            }
            
            // If we couldn't fetch by ID, try searching by name
            if (!fetchSuccess) {
                try {
                    // Search Civitai API by name
                    const searchQuery = modelName.replace(/[._-]/g, ' ').trim();
                    console.log(`[Models] Searching Civitai for: ${searchQuery}`);
                    
                    // Limit to appropriate type and determine base model if possible
                    const baseModel = type === 'checkpoint' ? determineBaseModelFromFilename(filename) : null;
                    const typeParam = type === 'checkpoint' ? 'Checkpoint' : 'LORA';
                    
                    let searchUrl = `${CIVITAI_API_BASE}/models?limit=5&query=${encodeURIComponent(searchQuery)}&types=${typeParam}`;
                    if (baseModel) {
                        searchUrl += `&baseModels=${encodeURIComponent(baseModel)}`;
                    }
                    
                    const searchResponse = await rateLimitedCivitaiRequest(searchUrl);
                    const searchResults = searchResponse.data.items;
                    
                    if (searchResults && searchResults.length > 0) {
                        // Use the top result
                        const topResult = searchResults[0];
                        console.log(`[Models] Found potential match: ${topResult.name} (ID: ${topResult.id})`);
                        
                        // Fetch detailed model data
                        const modelResponse = await rateLimitedCivitaiRequest(`${CIVITAI_API_BASE}/models/${topResult.id}`);
                        const modelData = modelResponse.data;
                        
                        // Use the most recent model version
                        const latestVersion = modelData.modelVersions?.[0];
                        
                        if (latestVersion) {
                            metadata = {
                                id: topResult.id, // Forge format uses this field name
                                modelId: topResult.id.toString(),
                                modelVersionId: latestVersion.id.toString(),
                                name: modelData.name,
                                baseModel: latestVersion.baseModel,
                                description: modelData.description,
                                trainedWords: latestVersion.trainedWords || [],
                                type: latestVersion.type,
                                model: { // Include both formats for compatibility
                                    name: modelData.name,
                                    id: topResult.id.toString(),
                                    baseModel: latestVersion.baseModel,
                                    description: modelData.description
                                },
                                fileName: filename,
                                downloadUrl: latestVersion.downloadUrl,
                                updated_at: new Date().toISOString()
                            };
                            fetchSuccess = true;
                            console.log(`[Models] Found match on Civitai: ${modelData.name} (ID: ${topResult.id})`);
                        }
                    } else {
                        console.log(`[Models] No search results found for query: ${searchQuery}`);
                    }
                } catch (error) {
                    console.warn(`[Models] Error searching Civitai: ${error.message}`);
                    // Continue to final error check
                }
            }
        }
        
        if (!fetchSuccess) {
            return res.status(404).json({
                success: false,
                message: 'Could not find model on Civitai. No ID available and search yielded no results.'
            });
        }
        
        // Save metadata using the Forge-compatible path
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
        console.log(`[Models] Saved metadata to ${metadataPath}`);
        
        // Try to download a preview image if none exists
        const previewFilename = `${modelBasename}.preview.png`; // Forge standard format
        let previewPath = path.join(fullDirectory, previewFilename);
        
        if (!existingPreviewPath && metadata.modelVersionId) {
            try {
                // Fetch version details to get images
                console.log(`[Models] Fetching images for version ID: ${metadata.modelVersionId}`);
                const versionResponse = await rateLimitedCivitaiRequest(`${CIVITAI_API_BASE}/model-versions/${metadata.modelVersionId}`);
                const images = versionResponse.data.images;
                
                if (images && images.length > 0) {
                    // Use the first image as preview
                    const previewUrl = images[0].url;
                    console.log(`[Models] Downloading preview image from: ${previewUrl}`);
                    
                    // Download the image
                    const imageResponse = await rateLimitedCivitaiRequest(previewUrl, { responseType: 'arraybuffer' });
                    const imageData = imageResponse.data;
                    
                    // Save in multiple formats for maximum compatibility
                    
                    // 1. Save as Forge standard format (.preview.png)
                    await fs.writeFile(previewPath, imageData);
                    console.log(`[Models] Saved preview image to ${previewFilename}`);
                    
                    // 2. Save as simple jpg with same name as model (modelname.jpg)
                    const jpgPath = path.join(fullDirectory, `${modelBasename}.jpg`);
                    await fs.writeFile(jpgPath, imageData);
                    console.log(`[Models] Also saved preview image as ${modelBasename}.jpg`);
                    
                    // 3. If we downloaded from a jpg url, also save as .jpeg for extra compatibility
                    if (previewUrl.toLowerCase().endsWith('.jpg') || previewUrl.toLowerCase().endsWith('.jpeg')) {
                        const jpegPath = path.join(fullDirectory, `${modelBasename}.jpeg`);
                        await fs.writeFile(jpegPath, imageData);
                        console.log(`[Models] Also saved preview image as ${modelBasename}.jpeg`);
                    }
                    
                } else {
                    console.log(`[Models] No images found for version ID: ${metadata.modelVersionId}`);
                }
            } catch (previewError) {
                console.warn(`[Models] Error downloading preview image for ${modelPath}:`, previewError.message);
                // Continue anyway - preview is optional
            }
        } else if (existingPreviewPath) {
            // If we found an existing preview image but it's not in all formats, copy it to the other formats
            try {
                console.log(`[Models] Using existing preview image: ${existingPreviewPath}`);
                
                // Read the existing preview image
                const existingImageData = await fs.readFile(existingPreviewPath);
                
                // Copy to other formats if they don't exist
                
                // Check if .preview.png exists and create if not
                const forgePath = path.join(fullDirectory, `${modelBasename}.preview.png`);
                if (existingPreviewPath !== forgePath && !fsSync.existsSync(forgePath)) {
                    await fs.writeFile(forgePath, existingImageData);
                    console.log(`[Models] Copied existing preview to Forge format: ${modelBasename}.preview.png`);
                }
                
                // Check if .jpg exists and create if not
                const jpgPath = path.join(fullDirectory, `${modelBasename}.jpg`);
                if (existingPreviewPath !== jpgPath && !fsSync.existsSync(jpgPath)) {
                    await fs.writeFile(jpgPath, existingImageData);
                    console.log(`[Models] Copied existing preview to JPG format: ${modelBasename}.jpg`);
                }
            } catch (copyError) {
                console.warn(`[Models] Error copying existing preview to other formats:`, copyError.message);
                // Continue anyway - this is just for convenience
            }
        }
        
        res.json({
            success: true,
            message: 'Model metadata refreshed successfully',
            metadata: metadata,
            metadataPath: metadataPath,
            previewPath: existingPreviewPath || (fsSync.existsSync(previewPath) ? previewPath : null)
        });
        
    } catch (error) {
        console.error('Error refreshing model metadata:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to refresh model metadata', 
            error: error.message 
        });
    }
});

// Helper function to extract base model from metadata
function extractBaseModel(model) {
    // If model has Civitai metadata, try to extract base model
    if (model.baseModel) return model.baseModel;
    if (model.model?.baseModel) return model.model.baseModel;
    
    // Determine from filename using common patterns
    const filename = model.filename.toLowerCase();
    
    if (filename.includes('sdxl') || filename.includes('sd-xl')) return 'SDXL';
    if (filename.includes('sd15') || filename.includes('sd-15')) return 'SD 1.5';
    if (filename.includes('sd3')) return 'SD 3';
    if (filename.includes('sd2') || filename.includes('sd-2')) return 'SD 2';
    if (filename.includes('pony')) return 'Pony';
    if (filename.includes('flux-1') || filename.includes('flux.1')) return 'Flux.1 D';
    if (filename.includes('flux') && !filename.includes('reflux')) return 'Flux';
    if (filename.includes('reflux')) return 'Reflux';
    
    // Default fallback
    return 'Unknown';
}

// Helper function for extracting base model from metadata
function extractBaseModelFromMetadata(metadata) {
    if (metadata.baseModel) return metadata.baseModel;
    if (metadata.model?.baseModel) return metadata.model.baseModel;
    if (metadata.trainedWords?.includes('SDXL')) return 'SDXL';
    
    return null;
}

// Helper function to get preview URL
function getPreviewUrl(model, type) {
    const modelPath = model.relativePath ? 
                       `${model.relativePath}/${model.filename}` : 
                       model.filename;
    
    return `/api/v1/models/${encodeURIComponent(modelPath)}/preview?type=${type}`;
}

// Helper function to get Civitai URL
function getCivitaiUrl(model) {
    if (model.modelId) {
        return `https://civitai.com/models/${model.modelId}`;
    }
    if (model.model && model.model.id) {
        return `https://civitai.com/models/${model.model.id}`;
    }
    return null;
}

// Helper function to get Civitai URL from metadata
function getCivitaiUrlFromMetadata(metadata) {
    if (metadata.modelId) {
        return `https://civitai.com/models/${metadata.modelId}`;
    }
    if (metadata.model && metadata.model.id) {
        return `https://civitai.com/models/${metadata.model.id}`;
    }
    return null;
}

// Helper function to determine base model from filename
function determineBaseModelFromFilename(filename) {
    const lowerName = filename.toLowerCase();
    
    if (lowerName.includes('sdxl') || lowerName.includes('sd-xl')) return 'SDXL';
    if (lowerName.includes('sd15') || lowerName.includes('sd-15')) return 'SD 1.5';
    if (lowerName.includes('sd3')) return 'SD 3';
    if (lowerName.includes('sd2') || lowerName.includes('sd-2')) return 'SD 2';
    if (lowerName.includes('pony')) return 'Pony Diffusion';
    if (lowerName.includes('flux-1') || lowerName.includes('flux.1')) return 'Flux';
    
    // Default to the most common
    return 'SD 1.5';
}

module.exports = router; 