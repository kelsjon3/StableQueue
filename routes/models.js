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

// Cache for 404 hashes to avoid repeat API calls in the same scan session
const CIVITAI_404_CACHE = new Set();

// Scan cancellation flag
let SCAN_CANCELLED = false;

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
        
        // Look up model in database to get the preview_path
        const allModels = modelDB.getAllModels();
        const model = allModels.find(m => m.filename === modelId);
        
        if (!model) {
            return res.status(404).json({
                success: false,
                message: 'Model not found in database'
            });
        }
        
        // Use the stored preview_path from database
        if (!model.preview_path) {
            return res.status(404).json({
                success: false,
                message: 'No preview image found for this model'
            });
        }
        
        // Check if the preview file exists
        try {
            await fs.access(model.preview_path);
            res.sendFile(model.preview_path);
        } catch (err) {
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
 * GET /api/v1/models/:id
 * Returns a single model by database ID (for refreshing after rescan)
 */
router.get('/models/:id', async (req, res) => {
    try {
        const modelId = req.params.id;
        console.log(`[Models] GET /models/${modelId} - fetching single model`);
        
        const allModels = modelDB.getAllModels();
        const model = allModels.find(m => m.id == modelId);
        
        if (!model) {
            return res.status(404).json({
                success: false,
                message: 'Model not found in database'
            });
        }
        
        // Return model with preview info
        const modelWithPreview = {
            ...model,
            has_preview: !!model.preview_path
        };
        
        res.json({
            success: true,
            model: modelWithPreview
        });
    } catch (error) {
        console.error('Error retrieving model:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve model',
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
                break; // Only delete the first found preview
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
 * Core model scanning function that can process all models or a filtered subset
 * @param {Array} modelsToProcess - Array of model objects to process
 * @param {Object} options - Scanning options
 * @returns {Object} - Scanning results with stats
 */
async function processModels(modelsToProcess, options = {}) {
    const { modelPath } = options;
    const jobStatusManager = require('../services/jobStatusManager');
    
    let stats = {
        total: modelsToProcess.length,
        added: 0,
        updated: 0,
        refreshed: 0,
        skipped: 0,
        errors: 0,
        hashesCalculated: 0,
        hashesSkipped: 0,
        hashErrors: 0,
        civitaiCalls: 0
    };

    // Track duplicates by AutoV2 hash
    const hashTracker = new Map(); // hash -> [array of {filename, local_path}]
    const duplicateGroups = []; // Array of duplicate groups for reporting

    // Broadcast scan start
    jobStatusManager.broadcastScanStart();

    // Process models
    for (let i = 0; i < modelsToProcess.length; i++) {
        const model = modelsToProcess[i];
        
        try {
            // Broadcast current progress
            const progress = {
                current: i + 1,
                total: modelsToProcess.length,
                currentFile: model.filename,
                stats: { 
                    ...stats,
                    duplicates: duplicateGroups.length // Add current duplicate count
                }
            };
            jobStatusManager.broadcastScanProgress(progress);

            // Check for scan cancellation
            if (SCAN_CANCELLED) {
                console.log(`[ModelScan] Scan cancelled at model ${i + 1}/${modelsToProcess.length}: ${model.filename}`);
                
                // Duplicate groups are already maintained in real-time, no need to regenerate

                // Add duplicate info to stats
                const cancelledStats = {
                    ...stats,
                    cancelled: true,
                    message: `Scan stopped by user after processing ${i}/${modelsToProcess.length} models`,
                    duplicates: {
                        count: duplicateGroups.length,
                        groups: duplicateGroups
                    }
                };

                // Log duplicate report for cancelled scan
                if (duplicateGroups.length > 0) {
                    console.log(`\n[ModelScan] DUPLICATE REPORT (Partial - scan stopped): Found ${duplicateGroups.length} groups of duplicate files:`);
                    duplicateGroups.forEach((group, index) => {
                        console.log(`\n  Group ${index + 1} (Hash: ${group.hash}):`);
                        group.files.forEach(file => {
                            console.log(`    - ${file.filename} at ${file.path}`);
                        });
                    });
                    console.log('');
                } else {
                    console.log('[ModelScan] No duplicate files found in processed models (scan was stopped)');
                }
                
                // Broadcast scan stopped status
                jobStatusManager.broadcastScanComplete(cancelledStats);
                
                // Return current stats with cancellation info
                return cancelledStats;
            }

            // Step 1: Setup model data
            const modelDir = modelPath ? path.join(modelPath, model.relativePath || '') : model.local_path;
            model.local_path = modelDir;
            
            // Step 2: Read metadata
            const metadata = await readModelMetadata(model);
            
            // Step 3: Create model data object
            let modelData = {
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
            
            // Check if model already exists in database by filename/path to get ALL existing data
            const existingByPath = modelDB.findModelByPath(model.filename, model.local_path);
            if (existingByPath) {
                // Load ALL existing database fields into modelData (only if modelData field is null/undefined)
                // This prevents data loss and unnecessary API calls
                const fieldsToLoad = [
                    'hash_autov2', 'hash_sha256', 'civitai_id', 'civitai_version_id', 'civitai_model_name',
                    'civitai_model_base', 'civitai_model_type', 'civitai_model_version_name', 
                    'civitai_model_version_desc', 'civitai_model_version_date', 'civitai_download_url',
                    'civitai_trained_words', 'civitai_file_size_kb', 'civitai_nsfw', 'civitai_blurhash',
                    'civitai_checked', 'preview_path', 'preview_url', 'forge_format'
                ];
                
                let fieldsLoaded = 0;
                fieldsToLoad.forEach(field => {
                    if (existingByPath[field] !== null && existingByPath[field] !== undefined && 
                        (modelData[field] === null || modelData[field] === undefined)) {
                        
                        // Convert SQLite boolean values to JavaScript booleans for consistency
                        if (field === 'civitai_nsfw' || field === 'has_embedded_metadata') {
                            modelData[field] = existingByPath[field] === 1 || existingByPath[field] === '1' || existingByPath[field] === true;
                        } else {
                            modelData[field] = existingByPath[field];
                        }
                        fieldsLoaded++;
                    }
                });
                
                // Also load type if not already determined
                if (existingByPath.type && !modelData.type) {
                    modelData.type = existingByPath.type;
                    fieldsLoaded++;
                }
                
                // Load metadata status fields if they're more complete in database
                if (existingByPath.metadata_status && existingByPath.metadata_status !== 'incomplete' && 
                    (!modelData.metadata_status || modelData.metadata_status === 'incomplete' || modelData.metadata_status === 'none')) {
                    modelData.metadata_status = existingByPath.metadata_status;
                    fieldsLoaded++;
                }
                
                if (existingByPath.metadata_source && existingByPath.metadata_source !== 'none' && 
                    (!modelData.metadata_source || modelData.metadata_source === 'none')) {
                    modelData.metadata_source = existingByPath.metadata_source;
                    fieldsLoaded++;
                }
                
                if (existingByPath.has_embedded_metadata !== null && modelData.has_embedded_metadata === false) {
                    // Convert SQLite integer boolean to JavaScript boolean
                    modelData.has_embedded_metadata = existingByPath.has_embedded_metadata === 1 || existingByPath.has_embedded_metadata === '1' || existingByPath.has_embedded_metadata === true;
                    fieldsLoaded++;
                }
                
                console.log(`[ModelScan] Found existing model: ${model.filename} - loaded ${fieldsLoaded} fields from database`);
            }
            
            // Step 4.5: Calculate missing hashes - MANDATORY for proper system function
            // Per workflow: "Hash is mandatory - every model must have an AutoV2 hash before proceeding"
            // Always calculate missing hashes regardless of user preference
            if (!modelData.hash_autov2 || !modelData.hash_sha256) {
                console.log(`[ModelScan] Missing hashes for ${model.filename} - calculating now (mandatory)`);
                await calculateMissingHashes(modelData, model, stats);
            }
            
            // Step 4.6: Enhanced duplicate detection and cleanup (per issue #3)
            // If 2 database entries with the same hash exist, delete the entry giving priority to entry with both hashes present
            if (modelData.hash_autov2 || modelData.hash_sha256) {
                const hashToCheck = modelData.hash_autov2 || modelData.hash_sha256;
                const hashType = modelData.hash_autov2 ? 'autov2' : 'sha256';
                const existingModels = modelDB.findModelsByHash(hashToCheck, hashType);
                
                if (existingModels.length >= 2) {
                    console.log(`[ModelScan] Found ${existingModels.length} existing models with same ${hashType} hash: ${hashToCheck}`);
                    
                    // Sort by completeness: models with both hashes first, then by ID (older first)
                    existingModels.sort((a, b) => {
                        const aComplete = !!(a.hash_autov2 && a.hash_sha256);
                        const bComplete = !!(b.hash_autov2 && b.hash_sha256);
                        
                        if (aComplete && !bComplete) return -1;  // a has both hashes, keep it
                        if (!aComplete && bComplete) return 1;   // b has both hashes, keep it
                        return a.id - b.id; // Both same completeness, keep older (lower ID)
                    });
                    
                    // Keep the first (most complete/oldest), delete the rest
                    const toKeep = existingModels[0];
                    const toDelete = existingModels.slice(1);
                    
                    console.log(`[ModelScan] Keeping model ID ${toKeep.id} (${toKeep.hash_autov2 ? 'has AutoV2' : 'no AutoV2'}, ${toKeep.hash_sha256 ? 'has SHA256' : 'no SHA256'})`);
                    
                    for (const duplicate of toDelete) {
                        console.log(`[ModelScan] Deleting duplicate model ID ${duplicate.id}: ${duplicate.filename} (${duplicate.hash_autov2 ? 'has AutoV2' : 'no AutoV2'}, ${duplicate.hash_sha256 ? 'has SHA256' : 'no SHA256'})`);
                        modelDB.deleteModel(duplicate.id);
                        if (!stats.deleted) stats.deleted = 0;
                        stats.deleted++;
                    }
                }
            }

            // Track duplicates by AutoV2 hash (Step 2 from workflow) - Do this BEFORE database logic
            if (modelData.hash_autov2) {
                const fileInfo = {
                    filename: model.filename,
                    local_path: model.local_path,
                    fullPath: path.join(model.local_path, model.filename)
                };
                
                if (!hashTracker.has(modelData.hash_autov2)) {
                    hashTracker.set(modelData.hash_autov2, []);
                }
                hashTracker.get(modelData.hash_autov2).push(fileInfo);
                
                // Update duplicate count in real-time for UI
                const currentDuplicateCount = Array.from(hashTracker.values()).filter(files => files.length > 1).length;
                if (currentDuplicateCount !== duplicateGroups.length) {
                    duplicateGroups.length = 0; // Clear existing
                    for (const [hash, files] of hashTracker.entries()) {
                        if (files.length > 1) {
                            duplicateGroups.push({
                                hash,
                                files: files.map(f => ({ filename: f.filename, path: f.local_path, fullPath: f.fullPath }))
                            });
                        }
                    }
                }
            }
            
            // Step 4.7: Fetch Civitai metadata only if we need it
            // Don't call API if: 1) already has Civitai data, 2) marked as not_found, 3) in 404 cache
            const hasCivitaiData = modelData.civitai_id || modelData.civitai_version_id || modelData.civitai_model_name;
            const markedAsNotFound = modelData.civitai_checked === 'not_found';
            const hashAlready404 = CIVITAI_404_CACHE.has(modelData.hash_autov2);
            
            const needsCivitaiCheck = modelData.hash_autov2 && 
                !hasCivitaiData && 
                !markedAsNotFound && 
                !hashAlready404;
            
            if (needsCivitaiCheck) {
                try {
                    console.log(`[ModelScan] Fetching Civitai metadata for ${model.filename} using AutoV2 hash ${modelData.hash_autov2}`);
                    stats.civitaiCalls++;
                    
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
                        
                        // Mark as successfully found on Civitai
                        modelData.civitai_checked = 'found';
                    } else {
                        console.log(`[ModelScan] No Civitai metadata found for hash ${modelData.hash_autov2}`);
                    }
                } catch (metadataError) {
                    console.warn(`[ModelScan] Failed to fetch Civitai metadata for ${model.filename}:`, metadataError.message);
                    console.log(`[ModelScan DEBUG] Error details for ${model.filename}:`, {
                        message: metadataError.message,
                        hasResponse: !!metadataError.response,
                        responseStatus: metadataError.response?.status,
                        messageIncludes404: metadataError.message.includes('404'),
                        responseIs404: metadataError.response && metadataError.response.status === 404
                    });
                    
                    // If 404 error, mark as not found to prevent future API calls
                    if (metadataError.message.includes('404') || (metadataError.response && metadataError.response.status === 404)) {
                        console.log(`[ModelScan] Model ${model.filename} not found on Civitai (404) - marking as not_found`);
                        
                        // Add hash to session 404 cache to avoid repeat API calls in this scan
                        CIVITAI_404_CACHE.add(modelData.hash_autov2);
                        
                        // Mark as not found on Civitai - this prevents future API calls
                        modelData.civitai_checked = 'not_found';
                        
                        // Mark metadata as checked but not found
                        if (!modelData.metadata_source || modelData.metadata_source === 'none') {
                            modelData.metadata_source = 'none';
                            modelData.metadata_status = 'none';
                        }
                    } else {
                        console.log(`[ModelScan DEBUG] 404 condition not met for ${model.filename} - not setting as not_found`);
                    }
                }
            }
            
            // Step 6: Check for local preview image and download if needed
            // Per Step 6: Check for local preview image named {modelname}.preview.jpeg first
            if (!modelData.preview_path && modelData.hash_autov2 && modelData.civitai_checked !== 'not_found' && !CIVITAI_404_CACHE.has(modelData.hash_autov2)) {
                const baseName = model.filename.substring(0, model.filename.lastIndexOf('.'));
                const previewPath = path.join(modelDir, `${baseName}.preview.jpeg`);
                const autoV2Hash = modelData.hash_autov2;
                
                // Double-check if preview file exists before making API call
                try {
                    await fs.access(previewPath);
                    // Preview file exists, use it
                    modelData.preview_path = previewPath;
                    modelData.preview_url = `/api/v1/models/${encodeURIComponent(model.filename)}/preview?type=checkpoint`;
                    console.log(`[ModelScan] Found existing preview image: ${previewPath}`);
                } catch (accessError) {
                    // Preview doesn't exist, try to download from Civitai
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
                            console.log(`[ModelScan] No preview images available for hash ${autoV2Hash} - generating placeholder`);
                            // Generate placeholder when no images are available on Civitai
                            try {
                                await generatePlaceholderPreview(model.filename, modelData.type, previewPath);
                                
                                modelData.preview_path = previewPath;
                                modelData.preview_url = `/api/v1/models/${encodeURIComponent(model.filename)}/preview?type=checkpoint`;
                                console.log(`[ModelScan] Generated placeholder preview: ${previewPath}`);
                            } catch (placeholderError) {
                                console.error(`[ModelScan] Failed to generate placeholder for ${model.filename}:`, placeholderError.message);
                            }
                        }
                    } catch (downloadError) {
                        console.warn(`[ModelScan] Failed to download preview for ${model.filename} using hash ${modelData.hash_autov2}:`, downloadError.message);
                        
                        // Generate placeholder image for 404 errors only (model not found on Civitai)
                        // Other errors (network, rate limits) should allow retry on next scan
                        if (downloadError.message.includes('404') || (downloadError.response && downloadError.response.status === 404)) {
                            // Add to 404 cache to avoid repeat API calls in this scan
                            CIVITAI_404_CACHE.add(modelData.hash_autov2);
                            try {
                                console.log(`[ModelScan] Generating placeholder preview for ${model.filename} (404 - not found on Civitai)`);
                                await generatePlaceholderPreview(model.filename, modelData.type, previewPath);
                                
                                modelData.preview_path = previewPath;
                                modelData.preview_url = `/api/v1/models/${encodeURIComponent(model.filename)}/preview?type=checkpoint`;
                                console.log(`[ModelScan] Generated placeholder preview: ${previewPath}`);
                            } catch (placeholderError) {
                                console.error(`[ModelScan] Failed to generate placeholder for ${model.filename}:`, placeholderError.message);
                            }
                        }
                    }
                }
            } else if (!modelData.preview_path && modelData.hash_autov2 && modelData.civitai_checked === 'not_found') {
                // Model is known to not exist on Civitai, generate placeholder
                const baseName = model.filename.substring(0, model.filename.lastIndexOf('.'));
                const previewPath = path.join(modelDir, `${baseName}.preview.jpeg`);
                
                try {
                    console.log(`[ModelScan] Model ${model.filename} not on Civitai - generating placeholder preview`);
                    await generatePlaceholderPreview(model.filename, modelData.type, previewPath);
                    
                    modelData.preview_path = previewPath;
                    modelData.preview_url = `/api/v1/models/${encodeURIComponent(model.filename)}/preview?type=checkpoint`;
                    console.log(`[ModelScan] Generated placeholder preview: ${previewPath}`);
                } catch (placeholderError) {
                    console.error(`[ModelScan] Failed to generate placeholder for ${model.filename}:`, placeholderError.message);
                }
            } else if (!modelData.preview_path) {
                console.log(`[ModelScan] No AutoV2 hash for ${model.filename} - skipping preview download`);
            }
            
            // Step 4.8: Check for existing database entry by filename AND path (per step #2)
            // Create database entry for new file if filename OR local_path is unique
            const existingByExactPath = modelDB.findModelByPath(model.filename, model.local_path);
            if (existingByExactPath) {
                // Same filename + path: Update existing entry with new metadata
                existingModel = existingByExactPath;
                skipModel = false; // Don't skip - we want to update
                console.log(`[ModelScan] Found existing database entry for ${model.filename} at same path - will update`);
            } else {
                // Different filename or path: Create new database entry (per step #2)
                existingModel = null;
                skipModel = false; // Don't skip - create new entry
                console.log(`[ModelScan] Creating new database entry for ${model.filename} (unique filename/path combination)`);
            }
            
            // Step 5: Database operation
            if (skipModel) {
                // Model already exists (by hash), skip it
                stats.skipped++;
                console.log(`[ModelScan] Skipping duplicate model: ${model.filename} (hash match with ${existingModel.filename})`);
            } else if (existingModel) {
                // Model exists at same path, update it
                try {
                    // Log what fields are being updated by comparing existing vs new data
                    const fieldsToCheck = [
                        'hash_autov2', 'hash_sha256', 'civitai_id', 'civitai_version_id', 'civitai_model_name',
                        'civitai_model_base', 'civitai_model_type', 'civitai_model_version_name', 
                        'civitai_model_version_desc', 'civitai_model_version_date', 'civitai_download_url',
                        'civitai_trained_words', 'civitai_file_size_kb', 'civitai_nsfw', 'civitai_blurhash',
                        'civitai_checked', 'preview_path', 'preview_url', 'forge_format', 'type',
                        'metadata_status', 'metadata_source', 'has_embedded_metadata'
                    ];
                    
                    const updatedFields = [];
                    fieldsToCheck.forEach(field => {
                        const existingValue = existingModel[field];
                        const newValue = modelData[field];
                        
                        // Check if the field will actually be updated (new value is different and not null)
                        // Handle boolean comparisons specially
                        let valuesAreDifferent = false;
                        
                        if (field === 'civitai_nsfw' || field === 'has_embedded_metadata') {
                            // Normalize both values to booleans for comparison
                            const existingBool = existingValue === 1 || existingValue === '1' || existingValue === true;
                            const newBool = newValue === true;
                            valuesAreDifferent = existingBool !== newBool;
                        } else {
                            valuesAreDifferent = (newValue !== null && newValue !== undefined && newValue !== existingValue);
                        }
                        
                        if (valuesAreDifferent) {
                            updatedFields.push(`${field}: "${existingValue}" → "${newValue}"`);
                        }
                    });
                    
                    modelDB.addOrUpdateModel(modelData);
                    
                    if (updatedFields.length > 0) {
                        // Actual field changes - count as update
                        stats.updated++;
                        console.log(`[ModelScan] Updated existing model: ${model.filename}`);
                        console.log(`[ModelScan]   Fields updated: ${updatedFields.join(', ')}`);
                    } else {
                        // Only timestamp updated - don't count as update in stats
                        stats.refreshed++;
                        console.log(`[ModelScan] Refreshed existing model: ${model.filename} (no field changes - timestamp updated)`);
                    }
                } catch (updateError) {
                    console.error(`[ModelScan] Failed to update model ${model.filename}:`, updateError);
                    stats.errors++;
                }
            } else {
                // New model, add it
                try {
                    const newModel = modelDB.addOrUpdateModel(modelData);
                    stats.added++;
                    console.log(`[ModelScan] Added new model: ${model.filename} (ID: ${newModel.id})`);
                } catch (addError) {
                    console.error(`[ModelScan] Failed to add model ${model.filename}:`, addError);
                    stats.errors++;
                }
            }
            
        } catch (modelError) {
            console.error(`[ModelScan] Error processing model ${model.filename}:`, modelError);
            stats.errors++;
        }
    }
    
    // Step 6: Post-processing - Mark duplicate models (no automatic deletion)
    // Identify models with the same hash and mark them as duplicates for user review
    console.log(`\n[ModelScan] POST-PROCESSING: Identifying duplicate models...`);
    
    const duplicateHashes = new Map(); // hash -> [model_ids]
    
    // Find all models with the same hash
    const allModels = modelDB.getAllModels();
    allModels.forEach(model => {
        if (model.hash_autov2) {
            if (!duplicateHashes.has(model.hash_autov2)) {
                duplicateHashes.set(model.hash_autov2, []);
            }
            duplicateHashes.get(model.hash_autov2).push(model);
        }
    });
    
    // Mark duplicates in the database for UI indication
    duplicateHashes.forEach((models, hash) => {
        if (models.length > 1) {
            console.log(`[ModelScan] Found ${models.length} models with hash ${hash} - marking as duplicates:`);
            models.forEach((model, index) => {
                console.log(`  - ID ${model.id}: ${model.filename} (${model.local_path})`);
                
                // Mark all models with this hash as duplicates
                try {
                    modelDB.markModelAsDuplicate(model.id, hash, models.length, index + 1);
                } catch (markError) {
                    console.error(`[ModelScan] Failed to mark model ID ${model.id} as duplicate:`, markError.message);
                }
            });
        }
    });
    
    console.log(`[ModelScan] POST-PROCESSING: Duplicate identification complete (no files deleted)`);
    
    // Step 7: Clean up stale duplicate markings
    // If a user manually deleted duplicate files, we need to clear duplicate status for remaining unique files
    console.log(`\n[ModelScan] POST-PROCESSING: Cleaning up stale duplicate markings...`);
    
    const staleCleanupCount = await cleanupStaleDuplicateMarkings();
    if (staleCleanupCount > 0) {
        console.log(`[ModelScan] POST-PROCESSING: Cleared duplicate status for ${staleCleanupCount} models that are now unique`);
    } else {
        console.log(`[ModelScan] POST-PROCESSING: No stale duplicate markings found`);
    }
    
    // Note: No automatic deletion - user can review duplicates and decide what to do

    // Duplicate groups are already maintained in real-time during processing
    // No need to regenerate them here

    // Add duplicate info to stats
    stats.duplicates = {
        count: duplicateGroups.length,
        groups: duplicateGroups
    };

    // Log duplicate report
    if (duplicateGroups.length > 0) {
        console.log(`\n[ModelScan] DUPLICATE REPORT: Found ${duplicateGroups.length} groups of duplicate files:`);
        duplicateGroups.forEach((group, index) => {
            console.log(`\n  Group ${index + 1} (Hash: ${group.hash}):`);
            group.files.forEach(file => {
                console.log(`    - ${file.filename} at ${file.path}`);
            });
        });
        console.log('');
    } else {
        console.log('[ModelScan] No duplicate files found (all AutoV2 hashes are unique)');
    }

    // Broadcast scan completion
    jobStatusManager.broadcastScanComplete(stats);
    
    return stats;
}

/**
 * POST /api/v1/models/scan
 * Scans configured model directories for models and updates the database
 * Uses metadata from .civitai.json files or embedded metadata
 */
router.post('/models/scan', async (req, res) => {
    logScanPhase('INITIALIZATION');
    
    try {
        // Reset scan cancellation flag at the start of each scan
        SCAN_CANCELLED = false;
        console.log('[ModelScan] Reset scan cancellation flag');
        
        // Clear session-based 404 cache at the start of each scan
        CIVITAI_404_CACHE.clear();
        console.log('[ModelScan] Cleared session 404 cache for new scan');
        
        // Log database state before
        const preScanCount = modelDB.getAllModels().length;
        logScanPhase('PRE_SCAN_STATE', { modelsInDB: preScanCount });
        
        let modelPath = process.env.MODEL_PATH || process.env.CHECKPOINT_PATH;
        if (!modelPath) {
            throw new Error('Model path not configured');
        }
        
        // Allow scanning of specific subdirectory for testing
        const scanSubdir = req.body.subdirectory || req.query.subdirectory;
        if (scanSubdir) {
            modelPath = path.join(modelPath, scanSubdir);
            console.log(`[ModelScan] Scanning subdirectory: ${modelPath}`);
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
        
        // Set up path info for each model
        allModels.forEach(model => {
            model.local_path = path.join(modelPath, model.relativePath || '');
        });
        
        // Use shared processing function
        const stats = await processModels(allModels, { modelPath });
        
        // Check if scan was cancelled
        if (stats.cancelled) {
            logScanPhase('SCAN_CANCELLED', stats);
            
            res.json({
                success: true,
                stats,
                cancelled: true,
                message: stats.message || 'Scan was stopped by user'
            });
            return;
        }
        
        logScanPhase('SCAN_COMPLETE', stats);
        
        // Final database count verification
        const finalCount = modelDB.getAllModels().length;
        console.log(`[ModelScan] Database count after scan: ${finalCount} models`);
        
        // Include duplicate info in response message
        let message = `Scan processed ${stats.total} models: ${stats.added} added, ${stats.updated} updated, ${stats.refreshed} refreshed, ${stats.skipped} skipped, ${stats.errors} errors. Database now has ${finalCount} models.`;
        if (stats.duplicates && stats.duplicates.count > 0) {
            message += ` Found ${stats.duplicates.count} groups of duplicate files (see console for details).`;
        }

        res.json({
            success: true,
            stats,
            message
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
 * POST /api/v1/models/scan/stop
 * Stops the currently running model scan
 */
router.post('/models/scan/stop', async (req, res) => {
    try {
        console.log('[ModelScan] Stop scan requested');
        
        // Set the cancellation flag
        SCAN_CANCELLED = true;
        
        console.log('[ModelScan] Scan cancellation flag set');
        
        res.json({
            success: true,
            message: 'Scan stop request received'
        });
        
    } catch (error) {
        console.error('Error stopping scan:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to stop scan',
            error: error.message
        });
    }
});

/**
 * POST /api/v1/models/cleanup-duplicates
 * Clean up stale duplicate markings for models that are now unique
 */
router.post('/models/cleanup-duplicates', async (req, res) => {
    try {
        console.log('[Models] Manual duplicate cleanup requested');
        
        const clearedCount = await cleanupStaleDuplicateMarkings();
        
        res.json({
            success: true,
            message: `Cleaned up duplicate markings for ${clearedCount} models that are now unique`,
            clearedCount: clearedCount
        });
    } catch (error) {
        console.error('Error cleaning up duplicate markings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to clean up duplicate markings',
            error: error.message
        });
    }
});

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
                    // Construct preview save path (use .jpeg for consistency with scanning logic)
                    const modelDir = path.join(existingModel.local_path);
                    const baseName = existingModel.filename.substring(0, existingModel.filename.lastIndexOf('.'));
                    const previewPath = path.join(modelDir, `${baseName}.preview.jpeg`);
                    
                    // Check if preview already exists (use async fs.access for consistency)
                    let previewExists = false;
                    try {
                        await fs.access(previewPath);
                        previewExists = true;
                    } catch (accessError) {
                        previewExists = false;
                    }
                    
                    if (!previewExists) {
                        console.log(`[Models] Downloading preview image from: ${previewImage.url}`);
                        
                        // Download the image
                        const imageResponse = await rateLimitedCivitaiRequest(previewImage.url, {
                            responseType: 'arraybuffer'
                        });
                        
                        if (imageResponse && imageResponse.data) {
                            // Ensure directory exists
                            await fs.mkdir(modelDir, { recursive: true });
                            
                            // Save the image as .jpeg
                            await fs.writeFile(previewPath, imageResponse.data);
                            
                            previewDownloaded = true;
                            console.log(`[Models] Preview image saved to: ${previewPath}`);
                        }
                    } else {
                        console.log(`[Models] Preview image already exists: ${previewPath}`);
                    }
                } catch (imageError) {
                    console.error(`[Models] Failed to download preview image:`, imageError);
                    
                    // Generate placeholder image for 404 errors only (model not found on Civitai)
                    // Other errors (network, rate limits) should allow retry on next fetch
                    if (imageError.message.includes('404') || (imageError.response && imageError.response.status === 404)) {
                        try {
                            const modelDir = path.join(existingModel.local_path);
                            const baseName = existingModel.filename.substring(0, existingModel.filename.lastIndexOf('.'));
                            const previewPath = path.join(modelDir, `${baseName}.preview.jpeg`);
                            
                            console.log(`[Models] Generating placeholder preview for ${existingModel.filename} (404 - not found on Civitai)`);
                            await generatePlaceholderPreview(existingModel.filename, existingModel.type, previewPath);
                            console.log(`[Models] Generated placeholder preview: ${previewPath}`);
                        } catch (placeholderError) {
                            console.error(`[Models] Failed to generate placeholder for ${existingModel.filename}:`, placeholderError.message);
                        }
                    }
                }
            }
        } else {
            // No images available on Civitai - generate placeholder
            try {
                const modelDir = path.join(existingModel.local_path);
                const baseName = existingModel.filename.substring(0, existingModel.filename.lastIndexOf('.'));
                const previewPath = path.join(modelDir, `${baseName}.preview.jpeg`);
                
                // Check if preview already exists
                let previewExists = false;
                try {
                    await fs.access(previewPath);
                    previewExists = true;
                } catch (accessError) {
                    previewExists = false;
                }
                
                if (!previewExists) {
                    console.log(`[Models] No preview images available on Civitai for ${existingModel.filename} - generating placeholder`);
                    await generatePlaceholderPreview(existingModel.filename, existingModel.type, previewPath);
                    console.log(`[Models] Generated placeholder preview: ${previewPath}`);
                }
            } catch (placeholderError) {
                console.error(`[Models] Failed to generate placeholder for ${existingModel.filename}:`, placeholderError.message);
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
 * POST /api/v1/models/:id/rescan
 * Rescans a single model file and updates its database entry
 */
router.post('/models/:id/rescan', async (req, res) => {
    try {
        const modelId = req.params.id;
        const options = req.body || {};
        
        console.log(`[SingleRescan] Starting rescan for model ID: ${modelId}`);
        console.log(`[SingleRescan] Options:`, options);
        
        // Get the model from database
        const existingModel = modelDB.getAllModels().find(m => m.id == modelId);
        if (!existingModel) {
            return res.status(404).json({
                success: false,
                message: 'Model not found in database'
            });
        }
        
        console.log(`[SingleRescan] Found model: ${existingModel.filename}`);
        
        // Construct full file path
        const fullPath = path.join(existingModel.local_path, existingModel.filename);
        
        // Check if file exists
        try {
            await fs.access(fullPath);
            console.log(`[SingleRescan] File verified: ${fullPath}`);
        } catch (err) {
            return res.status(404).json({
                success: false,
                message: 'Model file not found on disk'
            });
        }
        
        // Initialize operation tracking
        let hashCalculated = false;
        let civitaiDataFetched = false;
        let previewDownloaded = false;
        let updated = false;
        
        // Get current model data to check what's missing
        const modelData = { ...existingModel };
        
        // Calculate missing hashes if requested or if missing
        if (options.generateHash || !modelData.hash_autov2 || !modelData.hash_sha256) {
            const { calculateSHA256Hash, calculateAutoV2Hash } = require('../utils/hashCalculator');
            
            console.log(`[SingleRescan] Missing hashes - AutoV2: ${!modelData.hash_autov2}, SHA256: ${!modelData.hash_sha256}`);
            
            try {
                // Calculate AutoV2 hash if missing
                if (!modelData.hash_autov2) {
                    console.log(`[SingleRescan] Calculating AutoV2 hash for ${existingModel.filename}...`);
                    const autoV2Hash = await calculateAutoV2Hash(fullPath);
                    if (autoV2Hash) {
                        modelData.hash_autov2 = autoV2Hash;
                        console.log(`[SingleRescan] AutoV2 hash calculated: ${autoV2Hash}`);
                        hashCalculated = true;
                        updated = true;
                    }
                }
                
                // Calculate SHA256 hash if missing
                if (!modelData.hash_sha256) {
                    console.log(`[SingleRescan] Calculating SHA256 hash for ${existingModel.filename}...`);
                    const sha256Hash = await calculateSHA256Hash(fullPath);
                    if (sha256Hash) {
                        modelData.hash_sha256 = sha256Hash;
                        console.log(`[SingleRescan] SHA256 hash calculated: ${sha256Hash}`);
                        hashCalculated = true;
                        updated = true;
                    }
                }
            } catch (hashError) {
                console.error(`[SingleRescan] Hash calculation error:`, hashError);
            }
        }
        
        // Fetch Civitai data if requested and hash available
        if ((options.retrieveFromCivitai || options.getPreview) && modelData.hash_autov2) {
            try {
                console.log(`[SingleRescan] Fetching Civitai data for hash: ${modelData.hash_autov2}`);
                const civitaiResponse = await rateLimitedCivitaiRequest(`${process.env.CIVITAI_API_BASE || 'https://civitai.com/api/v1'}/model-versions/by-hash/${modelData.hash_autov2}`);
                
                if (civitaiResponse?.data) {
                    const modelVersion = civitaiResponse.data;
                    console.log(`[SingleRescan] Found Civitai data: ${modelVersion.model?.name || 'Unknown'}`);
                    
                    // Update only missing fields
                    if (!modelData.civitai_id && modelVersion.model?.id) {
                        modelData.civitai_id = modelVersion.model.id;
                        updated = true;
                    }
                    if (!modelData.civitai_model_name && modelVersion.model?.name) {
                        modelData.civitai_model_name = modelVersion.model.name;
                        updated = true;
                    }
                    // Add other Civitai fields as needed...
                    
                    civitaiDataFetched = true;
                }
            } catch (civitaiError) {
                console.warn(`[SingleRescan] Civitai fetch failed:`, civitaiError.message);
            }
        }
        
        // Save updated model data to database if changes were made
        if (updated) {
            console.log(`[SingleRescan] Saving updated model data to database...`);
            modelDB.addOrUpdateModel(modelData);
            console.log(`[SingleRescan] Model ${existingModel.filename} updated successfully`);
        } else {
            console.log(`[SingleRescan] No changes needed for model ${existingModel.filename}`);
        }
        
        // Return success response
        res.json({
            success: true,
            message: 'Model rescanned successfully',
            model: {
                id: existingModel.id,
                filename: existingModel.filename,
                updated: updated
            },
            stats: {
                total: 1,
                added: 0,
                updated: updated ? 1 : 0,
                refreshed: updated ? 0 : 1,
                skipped: 0,
                errors: 0,
                hashesCalculated: hashCalculated ? 1 : 0,
                hashesSkipped: 0,
                hashErrors: 0,
                civitaiCalls: civitaiDataFetched ? 1 : 0
            },
            operations: {
                hashCalculated: hashCalculated,
                civitaiDataFetched: civitaiDataFetched,
                previewDownloaded: previewDownloaded
            }
        });
        
    } catch (error) {
        console.error('[SingleRescan] Error rescanning model:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to rescan model',
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

/**
 * DELETE /api/v1/models/delete-from-disk
 * Deletes a model file and its associated files from disk
 * Body should contain: { local_path: string, filename: string }
 */
router.delete('/models/delete-from-disk', async (req, res) => {
    try {
        const { local_path, filename } = req.body;
        
        if (!local_path || !filename) {
            return res.status(400).json({
                success: false,
                message: 'Both local_path and filename are required'
            });
        }
        
        // Find model by path and filename combination (unique identifier)
        const models = modelDB.getAllModels();
        const model = models.find(m => m.local_path === local_path && m.filename === filename);
        
        if (!model) {
            return res.status(404).json({
                success: false,
                message: `Model not found in database with path: ${local_path} and filename: ${filename}`
            });
        }

        console.log(`[DeleteModel] Deleting model: ${filename} from ${local_path} (Found DB ID: ${model.id})`);
        
        const filesToDelete = [];
        const errors = [];
        
        // 1. Main model file
        const modelPath = path.join(model.local_path, model.filename);
        filesToDelete.push({ path: modelPath, type: 'model file' });
        
        // 2. Preview image (using various possible extensions)
        const modelBasename = model.filename.substring(0, model.filename.lastIndexOf('.'));
        const previewExtensions = ['.preview.jpeg', '.preview.jpg', '.preview.png', '.jpeg', '.jpg', '.png'];
        for (const ext of previewExtensions) {
            const previewPath = path.join(model.local_path, modelBasename + ext);
            try {
                await fs.access(previewPath);
                filesToDelete.push({ path: previewPath, type: 'preview image' });
                break; // Only delete the first found preview
            } catch (err) {
                // Preview doesn't exist, continue
            }
        }
        
        // 3. JSON metadata files
        const jsonExtensions = ['.json', '.civitai.json'];
        for (const ext of jsonExtensions) {
            const jsonPath = path.join(model.local_path, modelBasename + ext);
            try {
                await fs.access(jsonPath);
                filesToDelete.push({ path: jsonPath, type: 'metadata file' });
            } catch (err) {
                // JSON doesn't exist, continue
            }
        }

        // Delete files
        const deletedFiles = [];
        for (const file of filesToDelete) {
            try {
                await fs.unlink(file.path);
                deletedFiles.push(file);
                console.log(`[DeleteModel] Deleted ${file.type}: ${file.path}`);
            } catch (err) {
                const error = `Failed to delete ${file.type}: ${file.path} - ${err.message}`;
                errors.push(error);
                console.error(`[DeleteModel] ${error}`);
            }
        }

        // Remove from database if model file was successfully deleted
        const modelFileDeleted = deletedFiles.some(f => f.type === 'model file');
        if (modelFileDeleted) {
            try {
                // Re-verify the model still exists in database using path/filename (the unique identifier)
                const verifyModel = modelDB.getAllModels().find(m => 
                    m.local_path === local_path && m.filename === filename
                );
                
                if (!verifyModel) {
                    throw new Error(`Model not found in database during verification with path: ${local_path} and filename: ${filename}`);
                }
                
                console.log(`[DeleteModel] Verified database entry exists - Path: ${local_path}, Filename: ${filename}, ID: ${verifyModel.id}`);
                
                // Delete the database entry using the verified model's ID
                modelDB.deleteModel(verifyModel.id);
                console.log(`[DeleteModel] Removed model from database: ${filename} (ID: ${verifyModel.id})`);
            } catch (err) {
                errors.push(`Failed to remove model from database: ${err.message}`);
                console.error(`[DeleteModel] Failed to remove from database: ${err.message}`);
            }
        }

        // Return response
        if (deletedFiles.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No files were deleted',
                errors: errors
            });
        }

        res.json({
            success: true,
            message: `Successfully deleted ${deletedFiles.length} file(s)`,
            deletedFiles: deletedFiles.map(f => ({ type: f.type, path: path.basename(f.path) })),
            errors: errors.length > 0 ? errors : undefined,
            modelRemovedFromDatabase: modelFileDeleted
        });

    } catch (error) {
        console.error('[DeleteModel] Error deleting model:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete model',
            error: error.message
        });
    }
});

/**
 * PUT /api/v1/models/update-field
 * Updates a specific field for a model identified by path and filename
 * Body should contain: { local_path: string, filename: string, field: string, value: any }
 */
router.put('/models/update-field', async (req, res) => {
    try {
        const { local_path, filename, field, value } = req.body;
        
        if (!local_path || !filename || !field) {
            return res.status(400).json({
                success: false,
                message: 'local_path, filename, and field are required'
            });
        }
        
        // Find model by path and filename combination (unique identifier)
        const models = modelDB.getAllModels();
        const model = models.find(m => m.local_path === local_path && m.filename === filename);
        
        if (!model) {
            return res.status(404).json({
                success: false,
                message: `Model not found in database with path: ${local_path} and filename: ${filename}`
            });
        }
        
        // Validate field is allowed to be updated
        const allowedFields = ['civitai_nsfw']; // Add more fields as needed
        if (!allowedFields.includes(field)) {
            return res.status(400).json({
                success: false,
                message: `Field '${field}' is not allowed to be updated. Allowed fields: ${allowedFields.join(', ')}`
            });
        }
        
        console.log(`[UpdateModel] Updating ${field} for model: ${filename} from ${local_path} to value: ${value}`);
        
        // Update the model in the database
        try {
            const updatedModel = { ...model, [field]: value };
            const modelId = modelDB.addOrUpdateModel(updatedModel);
            
            console.log(`[UpdateModel] Successfully updated ${field} for model: ${filename} (ID: ${modelId})`);
            
            res.json({
                success: true,
                message: `Successfully updated ${field}`,
                model: {
                    id: modelId,
                    filename: filename,
                    [field]: value
                }
            });
            
        } catch (updateError) {
            throw new Error(`Failed to update model in database: ${updateError.message}`);
        }
        
    } catch (error) {
        console.error('[UpdateModel] Error updating model field:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update model field',
            error: error.message
        });
    }
});

/**
 * Clean up stale duplicate markings for models that are now unique
 * This happens when a user manually deletes duplicate files from disk
 * @returns {number} Number of models whose duplicate status was cleared
 */
async function cleanupStaleDuplicateMarkings() {
    try {
        const modelDB = require('../utils/modelDatabase');
        
        // Get all models currently marked as duplicates
        const duplicateGroups = modelDB.getDuplicateModels();
        let clearedCount = 0;
        
        // Check each duplicate group
        for (const [hash, models] of Object.entries(duplicateGroups)) {
            // Filter out models whose files no longer exist on disk
            const existingModels = [];
            
            for (const model of models) {
                const fullPath = path.join(model.local_path, model.filename);
                try {
                    await fs.access(fullPath);
                    existingModels.push(model);
                } catch (error) {
                    // File doesn't exist anymore - this model was deleted
                    console.log(`[ModelScan] File no longer exists: ${fullPath} (was duplicate ${model.duplicate_group_index}/${model.duplicate_group_size})`);
                }
            }
            
            // If only one model remains in the group, it's no longer a duplicate
            if (existingModels.length === 1) {
                const remainingModel = existingModels[0];
                console.log(`[ModelScan] Clearing duplicate status for now-unique model: ${remainingModel.filename} (hash: ${hash})`);
                
                try {
                    modelDB.clearModelDuplicateStatus(remainingModel.id);
                    clearedCount++;
                } catch (clearError) {
                    console.error(`[ModelScan] Failed to clear duplicate status for model ID ${remainingModel.id}:`, clearError.message);
                }
            } else if (existingModels.length === 0) {
                // All files in this duplicate group were deleted - nothing to clean up
                console.log(`[ModelScan] All files in duplicate group ${hash} were deleted`);
            } else if (existingModels.length < models.length) {
                // Some files were deleted, but multiple still exist - update group indices
                console.log(`[ModelScan] Updating duplicate group ${hash}: ${existingModels.length} files remain (was ${models.length})`);
                
                existingModels.forEach((model, index) => {
                    try {
                        modelDB.markModelAsDuplicate(model.id, hash, existingModels.length, index + 1);
                    } catch (updateError) {
                        console.error(`[ModelScan] Failed to update duplicate group index for model ID ${model.id}:`, updateError.message);
                    }
                });
            }
        }
        
        return clearedCount;
    } catch (error) {
        console.error('[ModelScan] Error cleaning up stale duplicate markings:', error.message);
        return 0;
    }
}

module.exports = router; 