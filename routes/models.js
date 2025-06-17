const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { scanModelDirectory } = require('../utils/configHelpers');
const modelDB = require('../utils/modelDatabase');
const axios = require('axios');
const { calculateFileHash, checkFileSizeForHashing, formatDuration } = require('../utils/hashCalculator');

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
    // Log all Civitai API calls to help debug rate limiting issues
    console.log(`[Civitai API CALL] ${url} - Called from: ${new Error().stack.split('\n')[2].trim()}`);
    
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
 * Returns a combined list of checkpoints and LoRAs with metadata FROM DATABASE ONLY
 * NO CIVITAI API CALLS ARE MADE FROM THIS ENDPOINT
 */
router.get('/models', async (req, res) => {
    try {
        console.log('[Models] GET /models - fetching from database only, NO Civitai calls');
        const models = modelDB.getAllModels();
        
        // Return models as-is from database with preview_path field
        const modelsWithPreviewUrls = models.map(model => {
            return {
                ...model,
                has_preview: !!model.preview_path // True if preview_path exists, false if null
            };
        });
        
        res.json({
            success: true,
            count: modelsWithPreviewUrls.length,
            models: modelsWithPreviewUrls
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
        const type = req.query.type || 'checkpoint';
        
        console.log(`[Preview Debug] Request for model: ${modelId}, type: ${type}`);
        
        // Look up model in database to get the preview_path
        const allModels = modelDB.getAllModels();
        const model = allModels.find(m => m.filename === modelId);
        
        if (!model) {
            console.log(`[Preview Debug] Model not found in database: ${modelId}`);
            return res.status(404).json({
                success: false,
                message: 'Model not found in database'
            });
        }
        
        // Use the stored preview_path from database
        if (!model.preview_path) {
            console.log(`[Preview Debug] No preview_path stored for model: ${modelId}`);
            return res.status(404).json({
                success: false,
                message: 'No preview image found for this model'
            });
        }
        
        console.log(`[Preview Debug] Using stored preview_path: ${model.preview_path}`);
        
        // Check if the preview file exists
        try {
            await fs.access(model.preview_path);
            console.log(`[Preview Debug] Serving preview: ${model.preview_path}`);
            res.sendFile(model.preview_path);
        } catch (err) {
            console.log(`[Preview Debug] Preview file not found at stored path: ${model.preview_path}`);
            return res.status(404).json({
                success: false,
                message: 'Preview image file not found'
            });
        }
        
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
        
        // Try to find preview image - ONLY check *.preview.jpeg per Rule #1
        const previewPath = path.join(fullDirectory, `${modelBasename}.preview.jpeg`);
        let hasPreview = false;
        try {
            if (fsSync.existsSync(previewPath)) {
                hasPreview = true;
            }
        } catch (err) {
            // Preview file doesn't exist
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
            has_preview: hasPreview,
            preview_url: hasPreview ? `/api/v1/models/${encodeURIComponent(modelPath)}/preview?type=${type}` : null,
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
        
        // After fetching metadata from Civitai, extract all relevant fields for DB
        let hash_autov2 = null;
        let hash_sha256 = null;
        let file_size_kb = null;
        if (metadata && metadata.modelVersionId) {
            try {
                const versionResponse = await rateLimitedCivitaiRequest(`${CIVITAI_API_BASE}/model-versions/${metadata.modelVersionId}`);
                const versionData = versionResponse.data;
                // Find the main file (usually .safetensors or .ckpt)
                const mainFile = (versionData.files || []).find(f => f.name && (f.name.endsWith('.safetensors') || f.name.endsWith('.ckpt')));
                if (mainFile && mainFile.hashes) {
                    hash_autov2 = mainFile.hashes.AutoV2 || null;
                    hash_sha256 = mainFile.hashes.SHA256 || null;
                    file_size_kb = mainFile.sizeKB || null;
                }
            } catch (err) {
                console.warn(`[Models] Could not fetch file hashes for version ${metadata.modelVersionId}: ${err.message}`);
            }
        }
        // Prepare trained words as JSON string
        let trained_words = null;
        if (metadata.trainedWords && Array.isArray(metadata.trainedWords)) {
            trained_words = JSON.stringify(metadata.trainedWords);
        }
        // Store all metadata in the database
        modelDB.addOrUpdateModel({
            name: modelName,
            type: type,
            local_path: directory,
            filename: filename,
            civitai_id: metadata.modelId || civitaiModelId || null,
            civitai_version_id: metadata.modelVersionId || civitaiVersionId || null,
            forge_format: null, // Not used here
            hash_autov2: hash_autov2,
            hash_sha256: hash_sha256,
            civitai_model_name: metadata.name || null,
            civitai_model_base: metadata.baseModel || metadata.model?.baseModel || metadata['sd version'] || null,
            civitai_model_type: metadata.type || metadata.model?.type || null,
            civitai_model_version_name: metadata.name || null,
            civitai_model_version_desc: metadata.description || metadata.model?.description,
            civitai_model_version_date: metadata.updated_at || metadata.createdAt || null,
            civitai_download_url: metadata.downloadUrl || null,
            civitai_trained_words: trained_words,
            civitai_file_size_kb: file_size_kb,
            civitai_nsfw: metadata.model?.nsfw || metadata.nsfw || false,
            civitai_blurhash: null // Will be populated when images are processed
        });
        
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
                    const blurhash = images[0].hash;
                    console.log(`[Models] Downloading preview image from: ${previewUrl}`);
                    
                    // Update model with blurhash if available
                    if (blurhash) {
                        modelDB.addOrUpdateModel({
                            name: modelName,
                            type: type,
                            local_path: directory,
                            filename: filename,
                            civitai_blurhash: blurhash
                        });
                        console.log(`[Models] Updated model with blurhash: ${blurhash.substring(0, 16)}...`);
                    }
                    
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

// Add these logging functions at the top of the scan endpoint

function logScanPhase(phase, data = {}) {
    console.log(`\n🔄 === SCAN PHASE: ${phase} ===`);
    if (Object.keys(data).length > 0) {
        console.log('Data:', data);
    }
}

function logModelProcessing(model, step, result = {}) {
    console.log(`\n📄 [${model.filename}] Step: ${step}`);
    if (Object.keys(result).length > 0) {
        console.log(`   Result:`, result);
    }
}

/**
 * POST /api/v1/models/scan
 * Scans configured model directories for models and updates the database
 * Uses metadata from .civitai.json files or embedded metadata
 */
router.post('/models/scan', async (req, res) => {
    logScanPhase('INITIALIZATION', { calculateHashes: req.body.calculateHashes });
    
    try {
        const { calculateHashes = false } = req.body;
        
        // Log database state before
        const preScanCount = modelDB.getAllModels().length;
        logScanPhase('PRE_SCAN_STATE', { modelsInDB: preScanCount });
        
        const modelPath = process.env.MODEL_PATH || process.env.CHECKPOINT_PATH;
        if (!modelPath) {
            throw new Error('Model path not configured');
        }
        
        logScanPhase('DIRECTORY_DISCOVERY', { modelPath });
        const allModels = await scanModelDirectory(modelPath, MODEL_EXTENSIONS, modelPath);
        logScanPhase('DISCOVERY_COMPLETE', { 
            totalFound: allModels.length,
            sampleFiles: allModels.slice(0, 3).map(m => m.filename)
        });
        
        // Process all models found
        logScanPhase('PROCESSING_ALL_MODELS', { 
            processingCount: allModels.length
        });
        
        let stats = {
            total: allModels.length,
            added: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            hashesCalculated: 0,
            hashesSkipped: 0,
            hashErrors: 0
        };

        // Process models
        for (const model of allModels) {
            try {
                // Step 1: Setup model data
                const modelDir = path.join(modelPath, model.relativePath || '');
                model.local_path = modelDir;
                
                // Step 2: Read metadata
                const metadata = await readModelMetadata(model);
                
                // Step 3: Create model data object
                const modelData = {
                    name: model.filename,
                    type: null,
                    local_path: modelDir,
                    filename: model.filename,
                    preview_path: model.previewPath || null,
                    preview_url: model.previewPath ? `/api/v1/models/${encodeURIComponent(model.filename)}/preview?type=checkpoint` : null,
                    metadata_status: metadata ? (metadata._complete ? 'complete' : 'partial') : 'none',
                    metadata_source: metadata?._json_source || (metadata?._has_embedded ? 'embedded' : 'none'),
                    has_embedded_metadata: metadata?._has_embedded || false
                };
                
                // Step 3.5: Handle preview images (Phase 5 from plan)
                if (!model.previewPath) {
                    // Check for *.preview.jpeg files ONLY (per rule #1)
                    const baseName = model.filename.substring(0, model.filename.lastIndexOf('.'));
                    const previewPath = path.join(modelDir, `${baseName}.preview.jpeg`);
                    try {
                        await fs.access(previewPath);
                        modelData.preview_path = previewPath;
                        modelData.preview_url = `/api/v1/models/${encodeURIComponent(model.filename)}/preview?type=checkpoint`;
                    } catch (err) {
                        // No local preview image found - will download later after hash determination
                        modelData.preview_path = null;
                    }
                }
                
                // Extract metadata fields if available
                if (metadata) {
                    // Helper function to safely convert complex values to strings for SQLite
                    const toSafeValue = (value) => {
                        if (value === null || value === undefined) return null;
                        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
                        if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
                        return String(value);
                    };
                    
                    // Handle different hash field names from different sources
                    const hash_autov2 = metadata.hash_autov2 || metadata.AutoV2 || null;
                    const hash_sha256 = metadata.hash_sha256 || metadata.SHA256 || metadata.sha256 || null;
                    
                    // Extract type from metadata (Priority Order per Rule #3)
                    let extractedType = null;
                    
                    // Priority 1: Direct type field (Forge/Civitai JSON)
                    if (metadata.type) {
                        extractedType = metadata.type.toLowerCase();
                    } else if (metadata.model?.type) {
                        extractedType = metadata.model.type.toLowerCase();
                    }
                    // Priority 2: Civitai model type
                    else if (metadata.civitai_model_type) {
                        extractedType = metadata.civitai_model_type.toLowerCase();
                    }
                    // Priority 3: Embedded metadata architecture 
                    else if (metadata['modelspec.architecture']) {
                        const architecture = metadata['modelspec.architecture'];
                        if (architecture && typeof architecture === 'string') {
                            if (architecture.includes('/lora') || architecture.includes('lora')) {
                                extractedType = 'lora';
                            } else if (architecture.includes('/checkpoint') || architecture.includes('checkpoint')) {
                                extractedType = 'checkpoint';
                            }
                        }
                    }
                    
                    // Normalize type values
                    if (extractedType) {
                        if (extractedType.includes('lora') || extractedType === 'lora') {
                            modelData.type = 'lora';
                        } else if (extractedType.includes('checkpoint') || extractedType === 'checkpoint') {
                            modelData.type = 'checkpoint';
                        }
                    }
                    
                    // Add all metadata fields (handle both Civitai and Forge formats)
                    Object.assign(modelData, {
                        hash_autov2: hash_autov2,
                        hash_sha256: hash_sha256,
                        civitai_id: toSafeValue(metadata.modelId || metadata.model?.id),
                        civitai_version_id: toSafeValue(metadata.modelVersionId || metadata.model?.modelVersionId),
                        civitai_model_name: toSafeValue(metadata.name || metadata.model?.name),
                        civitai_model_base: toSafeValue(metadata.baseModel || metadata.model?.baseModel || metadata['sd version']),
                        civitai_model_type: toSafeValue(metadata.type || metadata.model?.type),
                        civitai_model_version_name: toSafeValue(metadata.versionName || metadata.name),
                        civitai_model_version_desc: toSafeValue(metadata.description || metadata.model?.description || metadata.notes),
                        civitai_model_version_date: toSafeValue(metadata.createdAt || metadata.model?.createdAt),
                        civitai_download_url: toSafeValue(metadata.downloadUrl || metadata.model?.downloadUrl),
                        civitai_trained_words: toSafeValue(getEnhancedActivationText(metadata) || metadata['activation text']),
                        civitai_file_size_kb: toSafeValue(metadata.fileSizeKB || metadata['preferred weight']),
                        civitai_nsfw: metadata.model?.nsfw || metadata.nsfw || false
                    });
                }
                
                // Step 4: Hash-only duplicate detection (per plan)
                let existingModel = null;
                let skipModel = false;
                
                // First, check if model already exists in database by filename/path
                const existingByPath = modelDB.findModelByPath(model.filename, model.local_path);
                if (existingByPath && (existingByPath.hash_autov2 || existingByPath.hash_sha256)) {
                    // Use existing model's hash for duplicate detection
                    modelData.hash_autov2 = existingByPath.hash_autov2;
                    modelData.hash_sha256 = existingByPath.hash_sha256;
                    console.log(`[ModelScan] Using existing hash for ${model.filename}: ${existingByPath.hash_autov2 || existingByPath.hash_sha256}`);
                }
                
                // Step 4.5: Calculate hashes if requested and missing (per revised workflow)
                if (calculateHashes) {
                    await calculateMissingHashes(modelData, model, stats);
                }
                
                // Step 4.6: Fetch Civitai metadata if we have AutoV2 hash but missing metadata
                if (modelData.hash_autov2 && (!modelData.civitai_model_name || !modelData.metadata_source || modelData.metadata_source === 'none')) {
                    try {
                        console.log(`[ModelScan] Fetching Civitai metadata for ${model.filename} using AutoV2 hash ${modelData.hash_autov2}`);
                        
                        const hashResponse = await rateLimitedCivitaiRequest(`${CIVITAI_API_BASE}/model-versions/by-hash/${modelData.hash_autov2}`);
                        const modelVersion = hashResponse.data;
                        
                        if (modelVersion) {
                            console.log(`[ModelScan] Found Civitai metadata for ${model.filename}: ${modelVersion.model?.name || 'Unknown'}`);
                            
                            // Extract and store Civitai metadata (only update null fields per scanning rules)
                            if (!modelData.civitai_id && (modelVersion.modelId || modelVersion.model?.id)) {
                                modelData.civitai_id = modelVersion.modelId || modelVersion.model.id;
                            }
                            if (!modelData.civitai_version_id && modelVersion.id) {
                                modelData.civitai_version_id = modelVersion.id;
                            }
                            if (!modelData.civitai_model_name && modelVersion.model?.name) {
                                modelData.civitai_model_name = modelVersion.model.name;
                            }
                            if (!modelData.civitai_model_base && modelVersion.baseModel) {
                                modelData.civitai_model_base = modelVersion.baseModel;
                            }
                            if (!modelData.civitai_model_type && modelVersion.model?.type) {
                                modelData.civitai_model_type = modelVersion.model.type;
                            }
                            if (!modelData.civitai_model_version_name && modelVersion.name) {
                                modelData.civitai_model_version_name = modelVersion.name;
                            }
                            if (!modelData.civitai_model_version_desc && modelVersion.description) {
                                modelData.civitai_model_version_desc = modelVersion.description;
                            }
                            if (!modelData.civitai_model_version_date && modelVersion.createdAt) {
                                modelData.civitai_model_version_date = modelVersion.createdAt;
                            }
                            if (!modelData.civitai_download_url && modelVersion.downloadUrl) {
                                modelData.civitai_download_url = modelVersion.downloadUrl;
                            }
                            if (!modelData.civitai_trained_words && modelVersion.trainedWords) {
                                modelData.civitai_trained_words = JSON.stringify(modelVersion.trainedWords);
                            }
                            if (!modelData.civitai_nsfw && modelVersion.model?.nsfw) {
                                modelData.civitai_nsfw = modelVersion.model.nsfw;
                            }
                            if (!modelData.civitai_blurhash && modelVersion.images?.[0]?.hash) {
                                modelData.civitai_blurhash = modelVersion.images[0].hash;
                            }
                            
                            // Update metadata source if we got data from Civitai
                            if (!modelData.metadata_source || modelData.metadata_source === 'none') {
                                modelData.metadata_source = 'civitai';
                                modelData.metadata_status = 'complete';
                            }
                        } else {
                            console.log(`[ModelScan] No Civitai metadata found for hash ${modelData.hash_autov2}`);
                        }
                    } catch (metadataError) {
                        console.warn(`[ModelScan] Failed to fetch Civitai metadata for ${model.filename}:`, metadataError.message);
                    }
                }
                
                // Step 4.75: Try to download preview image if we have a hash but no local preview
                if (!modelData.preview_path && modelData.hash_autov2) {
                    const baseName = model.filename.substring(0, model.filename.lastIndexOf('.'));
                    const previewPath = path.join(modelDir, `${baseName}.preview.jpeg`);
                    const autoV2Hash = modelData.hash_autov2;
                    
                    try {
                        
                        console.log(`[ModelScan] Attempting to download preview for ${model.filename} using AutoV2 hash ${autoV2Hash}`);
                        
                        // Use Civitai hash-based lookup
                        const hashResponse = await rateLimitedCivitaiRequest(`${CIVITAI_API_BASE}/model-versions/by-hash/${autoV2Hash}`);
                        const modelVersion = hashResponse.data;
                        
                        if (modelVersion && modelVersion.images && modelVersion.images.length > 0) {
                            // Download preview image
                            const previewUrl = modelVersion.images[0].url;
                            console.log(`[ModelScan] Downloading preview image from: ${previewUrl}`);
                            
                            // Download the image
                            const imageResponse = await rateLimitedCivitaiRequest(previewUrl, { responseType: 'arraybuffer' });
                            const imageData = imageResponse.data;
                            
                            // Save as *.preview.jpeg (exact format per Rule #1)
                            await fs.writeFile(previewPath, imageData);
                            console.log(`[ModelScan] Downloaded preview image to ${previewPath}`);
                            
                            modelData.preview_path = previewPath;
                            modelData.preview_url = `/api/v1/models/${encodeURIComponent(model.filename)}/preview?type=checkpoint`;
                        } else {
                            console.log(`[ModelScan] No preview images available for hash ${autoV2Hash}`);
                        }
                    } catch (downloadError) {
                        console.warn(`[ModelScan] Failed to download preview for ${model.filename} using hash ${modelData.hash_autov2}:`, downloadError.message);
                        
                        // Generate placeholder image for 404 errors
                        if (downloadError.message.includes('404')) {
                            try {
                                console.log(`[ModelScan] Generating placeholder preview for ${model.filename}`);
                                await generatePlaceholderPreview(model.filename, modelData.type, previewPath);
                                
                                modelData.preview_path = previewPath;
                                modelData.preview_url = `/api/v1/models/${encodeURIComponent(model.filename)}/preview?type=checkpoint`;
                                console.log(`[ModelScan] Generated placeholder preview: ${previewPath}`);
                            } catch (placeholderError) {
                                console.error(`[ModelScan] Failed to generate placeholder for ${model.filename}:`, placeholderError.message);
                            }
                        }
                    }
                } else if (!modelData.preview_path) {
                    console.log(`[ModelScan] No AutoV2 hash for ${model.filename} - skipping preview download`);
                }
                
                // Now check for duplicates using hash (hash-only detection)
                // Per scanning rules: same hash + same path = update, same hash + different path = skip
                if (modelData.hash_autov2) {
                    const hashMatches = modelDB.findModelsByHash(modelData.hash_autov2, 'autov2');
                    if (hashMatches.length > 0) {
                        const hashMatch = hashMatches[0];
                        // Check if it's the same path (update) or different path (skip)
                        if (hashMatch.filename === model.filename && hashMatch.local_path === model.local_path) {
                            // Same path: Update null fields with new metadata (per scanning rules)
                            existingModel = hashMatch;
                            skipModel = false; // Don't skip - we want to update
                        } else {
                            // Different path: Skip as duplicate (per scanning rules)
                            existingModel = hashMatch;
                            skipModel = true;
                        }
                    }
                } else if (modelData.hash_sha256) {
                    const hashMatches = modelDB.findModelsByHash(modelData.hash_sha256, 'sha256');
                    if (hashMatches.length > 0) {
                        const hashMatch = hashMatches[0];
                        // Check if it's the same path (update) or different path (skip)
                        if (hashMatch.filename === model.filename && hashMatch.local_path === model.local_path) {
                            // Same path: Update null fields with new metadata (per scanning rules)
                            existingModel = hashMatch;
                            skipModel = false; // Don't skip - we want to update
                        } else {
                            // Different path: Skip as duplicate (per scanning rules)
                            existingModel = hashMatch;
                            skipModel = true;
                        }
                    }
                }
                // If no hash available → treat as new model (per plan)
                
                // Step 5: Database operation
                if (skipModel) {
                    // Model already exists (by hash), skip it
                    stats.skipped++;
                } else {
                    // Always add model if no hash duplicate found
                    // Use addOrUpdateModel but it will handle its own duplicate detection
                    try {
                        const modelId = modelDB.addOrUpdateModel(modelData);
                        const serverId = req.headers['x-server-id'] || 'local';
                        modelDB.updateModelServerAvailability(modelId, serverId);
                        stats.added++;
                        
                        // Log progress every 50 models
                        if (stats.added % 50 === 0) {
                            console.log(`[ModelScan] Progress: ${stats.added} models added so far...`);
                        }
                    } catch (dbError) {
                        console.error(`[ModelScan] Database error for ${model.filename}:`, dbError.message);
                        stats.errors++;
                    }
                }
                
            } catch (error) {
                console.error(`[ModelScan] Error processing ${model.filename}:`, error.message);
                stats.errors++;
            }
        }
        
        logScanPhase('SCAN_COMPLETE', stats);
        
        // Final database count verification
        const finalCount = modelDB.getAllModels().length;
        console.log(`[ModelScan] Database count after scan: ${finalCount} models`);
        
        res.json({
            success: true,
            stats,
            message: `Scan processed ${stats.total} models: ${stats.added} added, ${stats.skipped} skipped, ${stats.errors} errors. Database now has ${finalCount} models.`
        });
        
    } catch (error) {
        logScanPhase('SCAN_FAILED', { error: error.message });
        res.status(500).json({ 
            success: false, 
            message: 'Scan failed', 
            error: error.message 
        });
    }
});

/**
 * Calculate missing hashes for a model (AutoV2 and/or SHA256)
 * @param {Object} modelData - Model data object to update
 * @param {Object} model - Original model scan data
 * @param {Object} stats - Statistics object to update
 */
async function calculateMissingHashes(modelData, model, stats) {
    const { calculateSHA256Hash, calculateAutoV2Hash } = require('../utils/hashCalculator');
    const modelFilePath = path.join(model.local_path, model.filename);
    
    // Check what hashes we have and what we need
    const hasAutoV2 = !!modelData.hash_autov2;
    const hasSHA256 = !!modelData.hash_sha256;
    
    if (hasAutoV2 && hasSHA256) {
        console.log(`[ModelScan] Skipping hash calculation for ${model.filename} (already has both hashes)`);
        stats.hashesSkipped++;
        return;
    }
    
    try {
        // Verify file exists before attempting hash calculation
        try {
            await fs.access(modelFilePath);
        } catch (accessError) {
            throw new Error(`File not accessible: ${accessError.message}`);
        }
        
        // Strategy: If we need both hashes, calculate SHA256 first and derive AutoV2
        // If we only need one, calculate just that one
        
        if (!hasSHA256 && !hasAutoV2) {
            // Need both hashes - calculate them independently
            console.log(`[ModelScan] Calculating both SHA256 and AutoV2 hashes for ${model.filename}...`);
            
            try {
                // Calculate SHA256 first (full file hash)
                const sha256Hash = await calculateSHA256Hash(modelFilePath);
                if (sha256Hash) {
                    modelData.hash_sha256 = sha256Hash;
                    console.log(`[ModelScan] Calculated SHA256: ${sha256Hash}`);
                }
                
                // Calculate AutoV2 independently (subset hash for model identification)
                const autoV2Hash = await calculateAutoV2Hash(modelFilePath);
                if (autoV2Hash) {
                    modelData.hash_autov2 = autoV2Hash;
                    console.log(`[ModelScan] Calculated AutoV2: ${autoV2Hash}`);
                }
                
                if (sha256Hash || autoV2Hash) {
                    stats.hashesCalculated++;
                } else {
                    console.warn(`[ModelScan] Both hash calculations returned null for ${model.filename}`);
                    stats.hashErrors++;
                }
            } catch (hashError) {
                console.error(`[ModelScan] Error calculating both hashes for ${model.filename}:`, hashError.message);
                stats.hashErrors++;
            }
            
        } else if (!hasSHA256 && hasAutoV2) {
            // Need SHA256 only (already have AutoV2)
            console.log(`[ModelScan] Calculating SHA256 hash for ${model.filename} (already has AutoV2)...`);
            
            const sha256Hash = await calculateSHA256Hash(modelFilePath);
            if (sha256Hash) {
                modelData.hash_sha256 = sha256Hash;
                console.log(`[ModelScan] Calculated SHA256: ${sha256Hash}`);
                stats.hashesCalculated++;
            } else {
                console.warn(`[ModelScan] SHA256 calculation returned null for ${model.filename}`);
                stats.hashErrors++;
            }
            
        } else if (hasSHA256 && !hasAutoV2) {
            // Need AutoV2 only (already have SHA256) - must calculate separately
            console.log(`[ModelScan] Calculating AutoV2 hash for ${model.filename} (already has SHA256)...`);
            
            const autoV2Hash = await calculateAutoV2Hash(modelFilePath);
            if (autoV2Hash) {
                modelData.hash_autov2 = autoV2Hash;
                console.log(`[ModelScan] Calculated AutoV2: ${autoV2Hash}`);
                stats.hashesCalculated++;
            } else {
                console.warn(`[ModelScan] AutoV2 calculation returned null for ${model.filename}`);
                stats.hashErrors++;
            }
        }
        
    } catch (hashError) {
        console.error(`[ModelScan] Hash calculation error for ${model.filename}:`, hashError.message);
        console.error(`[ModelScan] Error details:`, {
            filename: model.filename,
            path: model.local_path,
            errorType: hashError.constructor.name,
            stack: hashError.stack?.split('\n')[0] // First line of stack trace
        });
        stats.hashErrors++;
    }
}

/**
 * Helper function to read metadata from a model file or its associated JSON files
 * Priority: Forge-style JSON > Civitai JSON > Embedded metadata
 * @param {Object} model - Model information from scanModelDirectory
 * @returns {Promise<Object|null>} Metadata object or null if not found
 */
async function readModelMetadata(model) {
    const { readModelFileMetadata, validateMetadataCompleteness, mergeMetadata } = require('../utils/safetensorsMetadataReader');
    
    try {
        const baseName = model.filename.substring(0, model.filename.lastIndexOf('.'));
        const modelFilePath = path.join(model.local_path, model.filename);
        
        let jsonMetadata = null;
        let jsonSource = null;
    
        // Step 1: Try to read Forge-style JSON first (modelname.json)
        const forgeJsonPath = path.join(model.local_path, `${baseName}.json`);
        try {
            const jsonData = await fs.readFile(forgeJsonPath, 'utf-8');
            const parsedJson = JSON.parse(jsonData);
            
            // Accept any JSON that contains model-related fields (don't be too strict)
            if (parsedJson && typeof parsedJson === 'object' && Object.keys(parsedJson).length > 0) {
                // Check if it contains any model-related fields (even if null/empty)
                const modelFields = ['modelId', 'civitaiVersionId', 'name', 'description', 'baseModel', 
                                   'sd version', 'activation text', 'preferred weight', 'notes', 'type',
                                   'hash_autov2', 'AutoV2', 'hash_sha256', 'SHA256'];
                const hasModelField = modelFields.some(field => 
                    parsedJson.hasOwnProperty(field) || parsedJson.model?.hasOwnProperty(field)
                );
                
                if (hasModelField) {
                    jsonMetadata = parsedJson;
                    jsonSource = 'forge';
                    console.log(`[ModelScan] Found Forge-style metadata: ${forgeJsonPath}`);
                }
            }
        } catch (err) {
            // Forge JSON not found or invalid
        }
    
        // Step 2: If no Forge JSON, try Civitai-style JSON (.civitai.json)
        if (!jsonMetadata) {
            const civitaiJsonPath = path.join(model.local_path, `${baseName}.civitai.json`);
            try {
                const jsonData = await fs.readFile(civitaiJsonPath, 'utf-8');
                const parsedJson = JSON.parse(jsonData);
                
                if (validateMetadataCompleteness(parsedJson)) {
                    jsonMetadata = parsedJson;
                    jsonSource = 'civitai';
                    console.log(`[ModelScan] Found Civitai-style metadata: ${civitaiJsonPath}`);
                }
            } catch (err) {
                // Civitai JSON not found or invalid
            }
        }
        
        // Step 3: Try to read embedded metadata from the model file
        let embeddedMetadata = null;
        try {
            embeddedMetadata = await readModelFileMetadata(modelFilePath);
            if (embeddedMetadata) {
                console.log(`[ModelScan] Found embedded metadata in: ${modelFilePath}`);
            }
        } catch (err) {
            console.warn(`[ModelScan] Could not read embedded metadata from ${modelFilePath}: ${err.message}`);
        }
        
        // Step 4: Merge metadata sources (JSON takes priority)
        if (jsonMetadata || embeddedMetadata) {
            const mergedMetadata = mergeMetadata(jsonMetadata, embeddedMetadata);
            
            // Add metadata source information for debugging
            mergedMetadata._json_source = jsonSource;
            mergedMetadata._has_embedded = !!embeddedMetadata;
            mergedMetadata._complete = validateMetadataCompleteness(mergedMetadata);
            
            return mergedMetadata;
        }
        
        // Step 5: No metadata found anywhere
        console.log(`[ModelScan] No metadata found for ${model.filename}`);
        return null;
        
    } catch (error) {
        console.error(`[ModelScan] Error reading metadata for ${model.filename}:`, error);
        return null;
    }
}

/**
 * Enhanced activation text extraction from multiple metadata sources
 * Priority: JSON trainedWords/activation text > Rich tag frequency data > Simple fallback
 * @param {Object} metadata - Merged metadata from all sources
 * @returns {string|null} Enhanced activation text or null if not found
 */
function getEnhancedActivationText(metadata) {
    // Priority 1: JSON explicit fields (trainedWords or activation text)
    if (metadata.trainedWords || metadata['activation text']) {
        return metadata.trainedWords || metadata['activation text'];
    }
    
    // Priority 2: Rich tag frequency data from embedded metadata
    if (metadata.ss_tag_frequency) {
        try {
            let tagFrequency = metadata.ss_tag_frequency;
            
            // Parse if it's a JSON string
            if (typeof tagFrequency === 'string') {
                tagFrequency = JSON.parse(tagFrequency);
            }
            
            // Extract tags from the frequency data
            if (tagFrequency && typeof tagFrequency === 'object') {
                // Look for the main tag group (usually "img" or similar)
                const tagGroups = Object.keys(tagFrequency);
                if (tagGroups.length > 0) {
                    const mainGroup = tagFrequency[tagGroups[0]];
                    if (mainGroup && typeof mainGroup === 'object') {
                        // Get tags sorted by frequency (most common first)
                        const sortedTags = Object.entries(mainGroup)
                            .sort(([,a], [,b]) => b - a)
                            .map(([tag, count]) => ({ tag, count }));
                        
                        if (sortedTags.length > 0) {
                            // Use the most frequent tag as primary, or combine top tags
                            const primaryTag = sortedTags[0].tag;
                            
                            // If we have multiple high-frequency tags, combine them
                            const highFreqTags = sortedTags
                                .filter(({ count }) => count >= Math.max(2, sortedTags[0].count * 0.5))
                                .map(({ tag }) => tag)
                                .slice(0, 3); // Limit to top 3 tags
                            
                            if (highFreqTags.length > 1) {
                                return highFreqTags.join(', ');
                            } else {
                                return primaryTag;
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.warn(`[ModelScan] Could not parse ss_tag_frequency for enhanced activation text: ${error.message}`);
        }
    }
    
    // Priority 3: No enhanced activation text found
    return null;
}

// Helper function to extract base model from metadata
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

/**
 * POST /api/v1/models/:id/availability
 * Update availability of a model on a server
 */
router.post('/models/:id/availability', async (req, res) => {
    try {
        const modelId = req.params.id;
        const serverId = req.headers['x-server-id'];
        
        if (!serverId) {
            return res.status(400).json({
                success: false,
                message: 'Server ID required in x-server-id header'
            });
        }

        const success = modelDB.updateModelServerAvailability(modelId, serverId);
        
        if (success) {
            res.json({
                success: true,
                message: 'Model availability updated'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to update model availability'
            });
        }
    } catch (error) {
        console.error('Error updating model availability:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update model availability',
            error: error.message
        });
    }
});

/**
 * DELETE /api/v1/models/:id/availability
 * Remove availability of a model on a server
 */
router.delete('/models/:id/availability', async (req, res) => {
    try {
        const modelId = req.params.id;
        const serverId = req.headers['x-server-id'];
        
        if (!serverId) {
            return res.status(400).json({
                success: false,
                message: 'Server ID required in x-server-id header'
            });
        }

        const success = modelDB.removeModelServerAvailability(modelId, serverId);
        
        if (success) {
            res.json({
                success: true,
                message: 'Model availability removed'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to remove model availability'
            });
        }
    } catch (error) {
        console.error('Error removing model availability:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove model availability',
            error: error.message
        });
    }
});

/**
 * POST /api/v1/models/reset-database
 * Resets the entire models database (destructive operation)
 */
router.post('/models/reset-database', async (req, res) => {
    try {
        console.log('[Models] Database reset requested');
        
        const success = modelDB.resetDatabase();
        
        if (success) {
            console.log('[Models] Database reset completed successfully');
            res.json({
                success: true,
                message: 'Models database has been reset successfully'
            });
        } else {
            console.error('[Models] Database reset failed');
            res.status(500).json({
                success: false,
                message: 'Failed to reset models database'
            });
        }
    } catch (error) {
        console.error('Error resetting models database:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset models database',
            error: error.message
        });
    }
});

/**
 * GET /api/v1/models/:id/availability
 * Get all servers that have this model
 */
router.get('/models/:id/availability', async (req, res) => {
    try {
        const modelId = req.params.id;
        const servers = modelDB.getModelServers(modelId);
        
        res.json({
            success: true,
            servers
        });
    } catch (error) {
        console.error('Error getting model availability:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get model availability',
            error: error.message
        });
    }
});

/**
 * POST /api/v1/models/:id/fetch-from-civitai
 * Fetches missing metadata and preview image from Civitai using model hash
 */
router.post('/models/:id/fetch-from-civitai', async (req, res) => {
    try {
        const modelId = req.params.id;
        console.log(`[Models] Fetch from Civitai requested for model ID: ${modelId}`);
        
        // Get the model from database
        const existingModel = modelDB.getAllModels().find(m => m.id == modelId);
        if (!existingModel) {
            return res.status(404).json({
                success: false,
                message: 'Model not found'
            });
        }
        
        console.log(`[Models] Found model: ${existingModel.filename}`);
        
        // Check if we have a hash to query with
        const hash = existingModel.hash_autov2 || existingModel.hash_sha256;
        if (!hash) {
            return res.status(400).json({
                success: false,
                message: 'Model has no hash available for Civitai lookup'
            });
        }
        
        console.log(`[Models] Using hash for Civitai lookup: ${hash.substring(0, 16)}...`);
        
        // Query Civitai API by hash
        const civitaiUrl = `https://civitai.com/api/v1/model-versions/by-hash/${hash}`;
        const civitaiHeaders = {
            'Accept': 'application/json',
            'User-Agent': 'StableQueue/1.0'
        };
        
        // Add API key if available
        if (process.env.CIVITAI_API_KEY) {
            civitaiHeaders['Authorization'] = `Bearer ${process.env.CIVITAI_API_KEY}`;
        }
        
        console.log(`[Models] Querying Civitai: ${civitaiUrl}`);
        const civitaiResponse = await rateLimitedCivitaiRequest(civitaiUrl, {
            headers: civitaiHeaders
        });
        
        if (!civitaiResponse || !civitaiResponse.data) {
            return res.status(404).json({
                success: false,
                message: 'Model not found on Civitai'
            });
        }
        
        const versionData = civitaiResponse.data;
        console.log(`[Models] Found Civitai data for model: ${versionData.model.name}`);
        
        // Extract metadata from Civitai response
        const updatedMetadata = {
            civitai_id: versionData.modelId || versionData.model.id,
            civitai_version_id: versionData.id,
            civitai_model_name: versionData.model.name,
            civitai_model_base: versionData.baseModel,
            civitai_model_type: versionData.model.type,
            civitai_model_version_name: versionData.name,
            civitai_model_version_desc: versionData.description,
            civitai_model_version_date: versionData.createdAt,
            civitai_download_url: versionData.downloadUrl,
            civitai_trained_words: versionData.trainedWords ? JSON.stringify(versionData.trainedWords) : null,
            civitai_nsfw: versionData.model.nsfw || false,
            civitai_blurhash: versionData.images && versionData.images.length > 0 ? versionData.images[0].hash : null,
            metadata_status: 'complete',
            metadata_source: 'civitai'
        };
        
        // Extract file information for additional metadata
        if (versionData.files && versionData.files.length > 0) {
            const mainFile = versionData.files.find(f => 
                f.name && (f.name.endsWith('.safetensors') || f.name.endsWith('.ckpt'))
            );
            if (mainFile) {
                if (mainFile.hashes) {
                    if (mainFile.hashes.AutoV2) updatedMetadata.hash_autov2 = mainFile.hashes.AutoV2;
                    if (mainFile.hashes.SHA256) updatedMetadata.hash_sha256 = mainFile.hashes.SHA256;
                }
                if (mainFile.sizeKB) {
                    updatedMetadata.civitai_file_size_kb = mainFile.sizeKB;
                }
            }
        }
        
        // Update the model in the database
        const updateData = {
            ...existingModel,
            ...updatedMetadata
        };
        
        modelDB.addOrUpdateModel(updateData);
        console.log(`[Models] Updated model metadata in database`);
        
        // Try to download preview image if available and we don't have one
        let previewDownloaded = false;
        if (versionData.images && versionData.images.length > 0) {
            const previewImage = versionData.images[0]; // Use first image as preview
            
            if (previewImage.url) {
                try {
                    // Construct preview save path
                    const modelDir = path.join(existingModel.local_path);
                    const baseName = existingModel.filename.substring(0, existingModel.filename.lastIndexOf('.'));
                    const previewPath = path.join(modelDir, `${baseName}.preview.png`);
                    
                    // Check if preview already exists
                    const previewExists = fs.existsSync ? fs.existsSync(previewPath) : false;
                    
                    if (!previewExists) {
                        console.log(`[Models] Downloading preview image from: ${previewImage.url}`);
                        
                        // Download the image
                        const imageResponse = await rateLimitedCivitaiRequest(previewImage.url, {
                            responseType: 'stream'
                        });
                        
                        if (imageResponse && imageResponse.data) {
                            // Ensure directory exists
                            await fsp.mkdir(modelDir, { recursive: true });
                            
                            // Save the image
                            const writeStream = fsSync.createWriteStream(previewPath);
                            imageResponse.data.pipe(writeStream);
                            
                            await new Promise((resolve, reject) => {
                                writeStream.on('finish', resolve);
                                writeStream.on('error', reject);
                            });
                            
                            previewDownloaded = true;
                            console.log(`[Models] Preview image saved to: ${previewPath}`);
                        }
                    } else {
                        console.log(`[Models] Preview image already exists: ${previewPath}`);
                    }
                } catch (imageError) {
                    console.error(`[Models] Failed to download preview image:`, imageError);
                    // Don't fail the whole request for image download errors
                }
            }
        }
        
        // Return success response
        res.json({
            success: true,
            message: `Successfully fetched metadata from Civitai${previewDownloaded ? ' and downloaded preview image' : ''}`,
            metadata: {
                model_name: versionData.model.name,
                version_name: versionData.name,
                base_model: versionData.baseModel,
                civitai_id: versionData.modelId || versionData.model.id,
                civitai_version_id: versionData.id,
                preview_downloaded: previewDownloaded,
                trained_words: versionData.trainedWords || []
            }
        });
        
    } catch (error) {
        console.error('Error fetching from Civitai:', error);
        
        // Handle specific error cases
        if (error.response?.status === 404) {
            return res.status(404).json({
                success: false,
                message: 'Model not found on Civitai'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to fetch metadata from Civitai',
            error: error.message
        });
    }
});

/**
 * POST /api/v1/models/:id/calculate-hash
 * Calculate AutoV2 hash for a model file
 */
router.post('/models/:id/calculate-hash', async (req, res) => {
    try {
        const modelId = req.params.id;
        console.log(`[Models] Hash calculation requested for model ID: ${modelId}`);
        
        // Get the model from database
        const existingModel = modelDB.getAllModels().find(m => m.id == modelId);
        if (!existingModel) {
            return res.status(404).json({
                success: false,
                message: 'Model not found'
            });
        }
        
        console.log(`[Models] Found model: ${existingModel.filename}`);
        
        // Check if model already has an AutoV2 hash
        if (existingModel.hash_autov2) {
            return res.status(400).json({
                success: false,
                message: 'Model already has an AutoV2 hash',
                hash: existingModel.hash_autov2
            });
        }
        
        // Construct full file path
        const fullPath = path.join(existingModel.local_path, existingModel.filename);
        
        // Check if file exists
        try {
            await fs.access(fullPath);
        } catch (err) {
            return res.status(404).json({
                success: false,
                message: 'Model file not found on disk'
            });
        }
        
        // Get file stats and check size limits
        const stats = await fs.stat(fullPath);
        const sizeCheck = checkFileSizeForHashing(stats.size);
        
        if (!sizeCheck.isAllowed) {
            return res.status(400).json({
                success: false,
                message: sizeCheck.reason,
                fileSize: sizeCheck.sizeInfo.displaySize
            });
        }
        
        console.log(`[Models] Starting hash calculation for ${existingModel.filename} (${sizeCheck.sizeInfo.displaySize})`);
        console.log(`[Models] Estimated time: ${formatDuration(sizeCheck.sizeInfo.estimatedTime)}`);
        
        // Calculate hash
        const startTime = Date.now();
        const hash = await calculateFileHash(fullPath);
        const calculationTime = (Date.now() - startTime) / 1000;
        
        // Update model in database
        const updateData = {
            ...existingModel,
            hash_autov2: hash
        };
        
        modelDB.addOrUpdateModel(updateData);
        console.log(`[Models] Updated model with AutoV2 hash: ${hash}`);
        
        res.json({
            success: true,
            message: 'Hash calculated successfully',
            hash: hash,
            fileSize: sizeCheck.sizeInfo.displaySize,
            calculationTime: formatDuration(calculationTime)
        });
        
    } catch (error) {
        console.error('Error calculating hash:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate hash',
            error: error.message
        });
    }
});

/**
 * GET /api/v1/models/:id/hash-info
 * Get hash calculation information for a model (file size, estimated time, etc.)
 */
router.get('/models/:id/hash-info', async (req, res) => {
    try {
        const modelId = req.params.id;
        
        // Get the model from database
        const existingModel = modelDB.getAllModels().find(m => m.id == modelId);
        if (!existingModel) {
            return res.status(404).json({
                success: false,
                message: 'Model not found'
            });
        }
        
        // Construct full file path
        const fullPath = path.join(existingModel.local_path, existingModel.filename);
        
        // Check if file exists
        try {
            await fs.access(fullPath);
        } catch (err) {
            return res.status(404).json({
                success: false,
                message: 'Model file not found on disk'
            });
        }
        
        // Get file stats and check size limits
        const stats = await fs.stat(fullPath);
        const sizeCheck = checkFileSizeForHashing(stats.size);
        
        const response = {
            success: true,
            model: {
                id: existingModel.id,
                filename: existingModel.filename,
                hasHash: !!existingModel.hash_autov2,
                existingHash: existingModel.hash_autov2 || null
            },
            fileInfo: {
                size: sizeCheck.sizeInfo.displaySize,
                sizeBytes: stats.size,
                canCalculateHash: sizeCheck.isAllowed,
                reason: sizeCheck.reason,
                estimatedTime: sizeCheck.sizeInfo.estimatedTime,
                estimatedTimeDisplay: sizeCheck.sizeInfo.estimatedTime ? 
                    formatDuration(sizeCheck.sizeInfo.estimatedTime) : null
            }
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('Error getting hash info:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get hash information',
            error: error.message
        });
    }
});

/**
 * Generate a simple text-based placeholder preview image
 * @param {string} filename - Model filename
 * @param {string} modelType - Model type (checkpoint, lora, vae, etc.)
 * @param {string} outputPath - Where to save the placeholder image
 */
async function generatePlaceholderPreview(filename, modelType, outputPath) {
    const { createCanvas } = require('canvas');
    
    // Determine model type and colors
    const typeInfo = getModelTypeInfo(filename, modelType);
    
    // Create canvas (512x512 to match typical preview size)
    const canvas = createCanvas(512, 512);
    const ctx = canvas.getContext('2d');
    
    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, typeInfo.color1);
    gradient.addColorStop(1, typeInfo.color2);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    
    // Semi-transparent overlay for better text readability
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, 512, 512);
    
    // Model type badge
    ctx.fillStyle = typeInfo.badgeColor;
    ctx.fillRect(20, 20, 120, 40);
    
    // Model type text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(typeInfo.displayName, 80, 42);
    
    // Model filename (truncated if too long)
    const displayName = filename.length > 40 ? filename.substring(0, 37) + '...' : filename;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'white';
    
    // Multi-line text for long filenames
    const words = displayName.split(/[_\-\.]/);
    let lines = [];
    let currentLine = '';
    
    for (const word of words) {
        const testLine = currentLine + (currentLine ? '_' : '') + word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > 450 && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) lines.push(currentLine);
    
    // Draw filename lines
    const startY = 256 - (lines.length * 15);
    lines.forEach((line, index) => {
        ctx.fillText(line, 256, startY + (index * 25));
    });
    
    // Additional info
    ctx.font = '14px Arial';
    ctx.fillStyle = '#cccccc';
    ctx.fillText('No preview available', 256, 380);
    ctx.fillText('Generated placeholder', 256, 400);
    
    // Icon/symbol based on type
    ctx.font = 'bold 60px Arial';
    ctx.fillStyle = typeInfo.iconColor;
    ctx.fillText(typeInfo.icon, 256, 160);
    
    // Save the image
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.8 });
    await fs.writeFile(outputPath, buffer);
}

/**
 * Get display information for different model types
 * @param {string} filename - Model filename
 * @param {string} modelType - Model type from metadata
 * @returns {Object} Type information with colors and display name
 */
function getModelTypeInfo(filename, modelType) {
    const lowerName = filename.toLowerCase();
    const type = modelType?.toLowerCase();
    
    // Determine type from various sources
    if (type === 'lora' || lowerName.includes('lora')) {
        return {
            displayName: 'LoRA',
            color1: '#8e44ad',
            color2: '#9b59b6',
            badgeColor: '#8e44ad',
            iconColor: '#ffffff',
            icon: '🎭'
        };
    } else if (lowerName.includes('vae') || lowerName.includes('/vae/')) {
        return {
            displayName: 'VAE',
            color1: '#27ae60',
            color2: '#2ecc71',
            badgeColor: '#27ae60',
            iconColor: '#ffffff',
            icon: '⚙️'
        };
    } else if (lowerName.includes('upscale') || lowerName.includes('/upscale')) {
        return {
            displayName: 'UPSCALER',
            color1: '#e67e22',
            color2: '#f39c12',
            badgeColor: '#e67e22',
            iconColor: '#ffffff',
            icon: '📈'
        };
    } else if (type === 'checkpoint' || lowerName.includes('checkpoint')) {
        return {
            displayName: 'CHECKPOINT',
            color1: '#3498db',
            color2: '#2980b9',
            badgeColor: '#3498db',
            iconColor: '#ffffff',
            icon: '🖼️'
        };
    } else {
        return {
            displayName: 'MODEL',
            color1: '#7f8c8d',
            color2: '#95a5a6',
            badgeColor: '#7f8c8d',
            iconColor: '#ffffff',
            icon: '❓'
        };
    }
}

module.exports = router; 