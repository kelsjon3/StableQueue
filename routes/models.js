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
        
        // Try to find preview image
        const previewOptions = [
            path.join(fullDirectory, `${modelBasename}.preview.jpeg`),
            path.join(fullDirectory, `${modelBasename}.preview.jpg`),
            path.join(fullDirectory, `${modelBasename}.preview.png`),
            path.join(fullDirectory, `${modelBasename}.preview.webp`),
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

/**
 * POST /api/v1/models/scan
 * Scans configured model directories for models and updates the database
 * Uses metadata from .civitai.json files or embedded metadata
 */
router.post('/models/scan', async (req, res) => {
    console.log('[Models] /api/v1/models/scan endpoint called');
    try {
        // Get scan options from request body
        const { calculateHashes = false } = req.body;
        console.log(`[ModelScan] Options: calculateHashes=${calculateHashes}`);
        
        // Log model count before scan
        const preScanCount = modelDB.getAllModels().length;
        console.log(`[ModelScan] Models in DB before scan: ${preScanCount}`);
        
        // Use single MODEL_PATH that searches recursively
        const modelPath = process.env.MODEL_PATH || process.env.CHECKPOINT_PATH;
        
        if (!modelPath) {
            return res.status(500).json({ 
                success: false, 
                message: 'Model path not configured. Set MODEL_PATH environment variable or use legacy CHECKPOINT_PATH.' 
            });
        }

        console.log(`[ModelScan] Scanning models recursively from: ${modelPath}`);
        
        // Scan single directory recursively and determine type by extension/location
        const allModels = await scanModelDirectory(modelPath, MODEL_EXTENSIONS, modelPath);
        
        let stats = {
            total: allModels.length,
            added: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            checkpoints: 0,
            loras: 0,
            hashesCalculated: 0,
            hashesSkipped: 0,
            hashErrors: 0
        };

        // Process all models in single unified loop
        for (const model of allModels) {
            try {
                const modelDir = path.join(modelPath, model.relativePath || '');
                model.local_path = modelDir;
                
                // Read metadata using established hierarchy
                const metadata = await readModelMetadata(model);
                
                // Determine metadata completeness and status
                let metadataStatus = 'none';
                if (metadata) {
                    if (metadata._complete) {
                        metadataStatus = 'complete';
                    } else {
                        metadataStatus = 'partial';
                    }
                }
                
                // Create base model data - always include filename and local_path
                const modelData = {
                    name: model.filename,
                    type: null, // Will be set later from metadata or remain null
                    local_path: modelDir,
                    filename: model.filename,
                    preview_path: model.previewPath || null,
                    preview_url: model.previewPath ? `/api/v1/models/${encodeURIComponent(model.filename)}/preview?type=checkpoint` : null,
                    metadata_status: metadataStatus,
                    metadata_source: metadata?._json_source || (metadata?._has_embedded ? 'embedded' : 'none'),
                    has_embedded_metadata: metadata?._has_embedded || false
                };
                
                // Add metadata fields if available (don't infer anything)
                if (metadata) {
                    // Handle different hash field names from different sources
                    const hash_autov2 = metadata.hash_autov2 || metadata.AutoV2 || null;
                    const hash_sha256 = metadata.hash_sha256 || metadata.SHA256 || metadata.sha256 || null;
                    
                    // Extract type from explicit metadata sources
                    if (metadata.type) {
                        modelData.type = metadata.type;
                    } else if (metadata['modelspec.architecture']) {
                        // Extract type from modelspec.architecture (e.g., "flux-1-dev/lora" → "lora")
                        const architecture = metadata['modelspec.architecture'];
                        if (architecture && typeof architecture === 'string') {
                            if (architecture.includes('/lora')) {
                                modelData.type = 'lora';
                            } else if (architecture.includes('/checkpoint') || architecture.includes('checkpoint')) {
                                modelData.type = 'checkpoint';
                            }
                        }
                    }
                    
                    // Helper function to safely convert complex values to strings for SQLite
                    const toSafeValue = (value) => {
                        if (value === null || value === undefined) return null;
                        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
                        if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
                        return String(value);
                    };
                    
                    Object.assign(modelData, {
                        hash_autov2: hash_autov2 || null,
                        hash_sha256: hash_sha256 || null,
                        civitai_id: toSafeValue(metadata.modelId || metadata.model?.id),
                        civitai_version_id: toSafeValue(metadata.modelVersionId || metadata.model?.modelVersionId),
                        civitai_model_name: toSafeValue(metadata.name || metadata.model?.name),
                        civitai_model_base: toSafeValue(metadata.baseModel || metadata.model?.baseModel || metadata['sd version']),
                        civitai_model_type: toSafeValue(metadata.type || metadata.model?.type),
                        civitai_model_version_name: toSafeValue(metadata.versionName || metadata.name),
                        civitai_model_version_desc: toSafeValue(metadata.description || metadata.model?.description),
                        civitai_model_version_date: toSafeValue(metadata.createdAt || metadata.model?.createdAt),
                        civitai_download_url: toSafeValue(metadata.downloadUrl || metadata.model?.downloadUrl),
                        civitai_trained_words: toSafeValue(getEnhancedActivationText(metadata)),
                        civitai_file_size_kb: toSafeValue(metadata.fileSizeKB || metadata['preferred weight']),
                        civitai_nsfw: metadata.model?.nsfw || metadata.nsfw || false,
                        civitai_blurhash: null // Will be populated when images are processed
                    });
                }
                
                // Check for existing model by multiple criteria (proper duplicate detection)
                let existingModel = null;
                
                // First try to find by hash (most reliable)
                if (modelData.hash_autov2) {
                    const hashMatches = modelDB.findModelsByHash(modelData.hash_autov2, 'autov2');
                    if (hashMatches.length > 0) {
                        existingModel = hashMatches[0];
                    }
                } else if (modelData.hash_sha256) {
                    const hashMatches = modelDB.findModelsByHash(modelData.hash_sha256, 'sha256');
                    if (hashMatches.length > 0) {
                        existingModel = hashMatches[0];
                    }
                }
                
                // If no hash match, try by filename and path
                if (!existingModel) {
                    const allModels = modelDB.getAllModels();
                    existingModel = allModels.find(m => 
                        m.filename === modelData.filename && 
                        m.local_path === modelData.local_path
                    );
                }

                // Calculate hash if requested and needed (for new models OR existing models missing hashes)
                if (calculateHashes && (!modelData.hash_autov2 || (existingModel && !existingModel.hash_autov2))) {
                    try {
                        const fullModelPath = path.join(modelDir, model.filename);
                        const fileStats = await fs.stat(fullModelPath);
                        const sizeCheck = checkFileSizeForHashing(fileStats.size);
                        
                        if (sizeCheck.isAllowed) {
                            console.log(`[ModelScan] Calculating AutoV2 for ${model.filename} (${sizeCheck.sizeInfo.displaySize})`);
                            const calculatedHash = await calculateFileHash(fullModelPath);
                            if (calculatedHash) {
                                modelData.hash_autov2 = calculatedHash;
                                stats.hashesCalculated++;
                                console.log(`[ModelScan] Hash calculated: ${calculatedHash}`);
                            }
                        } else {
                            console.log(`[ModelScan] Skipping hash calculation for ${model.filename}: ${sizeCheck.reason}`);
                            stats.hashesSkipped++;
                        }
                    } catch (hashError) {
                        console.error(`[ModelScan] Hash calculation failed for ${model.filename}:`, hashError);
                        stats.hashErrors++;
                    }
                }
                
                if (existingModel) {
                    // Model exists - check ALL fields for null values and potential population
                    let hasNewInfo = false;
                    
                    // Enhanced debug logging - show full objects
                    console.log(`\n[ModelScan] ======= COMPREHENSIVE DEBUG FOR ${modelData.filename} =======`);
                    console.log(`[ModelScan] Metadata found: ${!!metadata}`);
                    console.log(`[ModelScan] Metadata status: ${metadataStatus}`);
                    console.log(`[ModelScan] Metadata source: ${modelData.metadata_source}`);
                    
                    // Show key existing model fields
                    console.log(`[ModelScan] EXISTING MODEL KEY FIELDS:`);
                    console.log(`  type: "${existingModel.type}"`);
                    console.log(`  hash_autov2: "${existingModel.hash_autov2}"`);
                    console.log(`  metadata_status: "${existingModel.metadata_status}"`);
                    console.log(`  metadata_source: "${existingModel.metadata_source}"`);
                    console.log(`  has_embedded_metadata: "${existingModel.has_embedded_metadata}"`);
                    
                    // Show key new model fields
                    console.log(`[ModelScan] NEW MODEL DATA KEY FIELDS:`);
                    console.log(`  type: "${modelData.type}"`);
                    console.log(`  hash_autov2: "${modelData.hash_autov2}"`);
                    console.log(`  metadata_status: "${modelData.metadata_status}"`);
                    console.log(`  metadata_source: "${modelData.metadata_source}"`);
                    console.log(`  has_embedded_metadata: "${modelData.has_embedded_metadata}"`);
                    
                    // Always check metadata status improvements
                    if (metadata && metadataStatus !== 'none') {
                        if (existingModel.metadata_status === 'none' || 
                            (existingModel.metadata_status === 'partial' && metadataStatus === 'complete') ||
                            (existingModel.metadata_source === 'none' && modelData.metadata_source !== 'none')) {
                            hasNewInfo = true;
                            console.log(`[ModelScan] ✓ Metadata status improvement detected for ${modelData.filename}`);
                        }
                    }
                    
                    // Comprehensive field checking - check ALL database fields for null values
                    const allFieldsToCheck = [
                        'name', 'type', 'hash_autov2', 'hash_sha256',
                        'civitai_id', 'civitai_version_id', 'civitai_model_name', 'civitai_model_base', 
                        'civitai_model_type', 'civitai_model_version_name', 'civitai_model_version_desc',
                        'civitai_model_version_date', 'civitai_download_url', 'civitai_trained_words',
                        'civitai_file_size_kb', 'civitai_nsfw', 'civitai_blurhash',
                        'metadata_status', 'metadata_source', 'has_embedded_metadata'
                    ];
                    
                    console.log(`[ModelScan] FIELD-BY-FIELD COMPARISON:`);
                    let fieldsWithNewInfo = [];
                    
                    for (const field of allFieldsToCheck) {
                        // Check if existing field is null/empty AND new data has actual content
                        const existingValue = existingModel[field];
                        const newValue = modelData[field];
                        
                        const isExistingNull = (existingValue === null || existingValue === undefined || existingValue === '');
                        const hasNewValue = (newValue !== null && newValue !== undefined && newValue !== '');
                        
                        // Debug every single field comparison
                        console.log(`  ${field}: existing="${existingValue}" → new="${newValue}" (existingNull=${isExistingNull}, hasNew=${hasNewValue})`);
                        
                        if (isExistingNull && hasNewValue) {
                            hasNewInfo = true;
                            fieldsWithNewInfo.push(field);
                            console.log(`[ModelScan] ✓ Found new data for field "${field}": ${newValue}`);
                        }
                    }
                    
                    console.log(`[ModelScan] SUMMARY:`);
                    console.log(`  Fields with new info: [${fieldsWithNewInfo.join(', ')}]`);
                    console.log(`  hasNewInfo: ${hasNewInfo}`);
                    console.log(`[ModelScan] ======= END DEBUG FOR ${modelData.filename} =======\n`);
                    
                    if (hasNewInfo) {
                        // Update existing model with new information
                        modelData.id = existingModel.id; // Preserve existing ID
                        try {
                    const modelId = modelDB.addOrUpdateModel(modelData);
                    const serverId = req.headers['x-server-id'] || 'local';
                    modelDB.updateModelServerAvailability(modelId, serverId);
                        } catch (dbError) {
                            console.error(`[ModelScan] Database update error for ${modelData.filename}:`, dbError.message);
                            console.error(`[ModelScan] Problematic update modelData:`, JSON.stringify(modelData, null, 2));
                            throw dbError;
                        }
                        
                        stats.updated++;
                        console.log(`[ModelScan] ✓ Updated model: ${modelData.filename} (new ${modelData.metadata_source} metadata, ${fieldsWithNewInfo.length} fields updated)`);
                    } else {
                        // No new information, skip
                        stats.skipped++;
                        console.log(`[ModelScan] ✗ Skipped model: ${modelData.filename} (no new information)`);
                    }
                } else {
                    // New model - add regardless of available parameters
                    try {
                        const modelId = modelDB.addOrUpdateModel(modelData);
                        const serverId = req.headers['x-server-id'] || 'local';
                        modelDB.updateModelServerAvailability(modelId, serverId);
                    } catch (dbError) {
                        console.error(`[ModelScan] Database error for ${modelData.filename}:`, dbError.message);
                        console.error(`[ModelScan] Problematic modelData:`, JSON.stringify(modelData, null, 2));
                        throw dbError;
                    }
                    
                    stats.added++;
                    
                    // Track counts by type if we have it
                    if (modelData.type === 'checkpoint') {
                        stats.checkpoints++;
                    } else if (modelData.type === 'lora') {
                        stats.loras++;
                    }
                    
                    const metadataInfo = metadata ? 
                        `(${metadataStatus} metadata from ${modelData.metadata_source})` : 
                        '(no metadata)';
                    console.log(`[ModelScan] Added new model: ${modelData.filename} ${metadataInfo}`);
                }
            } catch (error) {
                console.error(`Error processing model ${model.filename}:`, error);
                stats.errors++;
            }
        }

        // Log model count after scan
        const postScanCount = modelDB.getAllModels().length;
        console.log(`[ModelScan] Models in DB after scan: ${postScanCount}`);
        
        let logMessage = `[ModelScan] Scan complete: ${stats.added} added, ${stats.updated} updated, ${stats.skipped} skipped, ${stats.errors} errors`;
        if (calculateHashes) {
            logMessage += `, ${stats.hashesCalculated} hashes calculated, ${stats.hashesSkipped} hashes skipped, ${stats.hashErrors} hash errors`;
        }
        console.log(logMessage);

        let responseMessage = `Scanned ${stats.total} models: ${stats.added} added, ${stats.updated} updated, ${stats.skipped} skipped`;
        if (calculateHashes) {
            responseMessage += `, ${stats.hashesCalculated} hashes calculated`;
        }

        res.json({
            success: true,
            stats,
            message: responseMessage
        });
    } catch (error) {
        console.error('Error scanning models:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to scan models', 
            error: error.message 
        });
    }
});

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
            
            // Validate that it contains model metadata (not just tensor info)
            if (parsedJson.modelId || parsedJson.model?.id || parsedJson.civitaiVersionId || 
                parsedJson.name || parsedJson.description || parsedJson.baseModel) {
                jsonMetadata = parsedJson;
                jsonSource = 'forge';
                console.log(`[ModelScan] Found Forge-style metadata: ${forgeJsonPath}`);
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

module.exports = router; 