const fs = require('fs').promises;

/**
 * Reads embedded metadata from a safetensors file header
 * Safetensors format: 8-byte header length + JSON metadata + tensor data
 * @param {string} filePath Path to the safetensors file
 * @returns {Promise<Object|null>} Metadata object or null if not found/error
 */
async function readSafetensorsMetadata(filePath) {
    try {
        // Read the first 8 bytes to get header length
        const fileHandle = await fs.open(filePath, 'r');
        const headerLengthBuffer = Buffer.alloc(8);
        await fileHandle.read(headerLengthBuffer, 0, 8, 0);
        
        // Header length is stored as little-endian 64-bit integer
        const headerLength = headerLengthBuffer.readBigUInt64LE(0);
        
        // Safeguard against unreasonably large headers (max 1MB)
        if (headerLength > 1024 * 1024) {
            console.warn(`[SafetensorsReader] Header length too large: ${headerLength}`);
            await fileHandle.close();
            return null;
        }
        
        // Read the JSON metadata header
        const metadataBuffer = Buffer.alloc(Number(headerLength));
        await fileHandle.read(metadataBuffer, 0, Number(headerLength), 8);
        await fileHandle.close();
        
        // Parse the JSON metadata
        const metadataString = metadataBuffer.toString('utf8');
        const metadata = JSON.parse(metadataString);
        
        // Extract the __metadata__ section which contains model information
        if (metadata.__metadata__) {
            console.log(`[SafetensorsReader] Found embedded metadata in ${filePath}`);
            return metadata.__metadata__;
        }
        
        console.log(`[SafetensorsReader] No __metadata__ section found in ${filePath}`);
        return null;
        
    } catch (error) {
        console.error(`[SafetensorsReader] Error reading safetensors metadata for ${filePath}:`, error);
        return null;
    }
}

/**
 * Reads embedded metadata from a .ckpt file (pickle format)
 * Note: This is more complex as it requires unpickling, but we can check for common metadata keys
 * @param {string} filePath Path to the .ckpt file
 * @returns {Promise<Object|null>} Metadata object or null if not found/error
 */
async function readCkptMetadata(filePath) {
    try {
        // For .ckpt files, we would need to implement pickle parsing
        // This is complex and potentially unsafe, so we'll return null for now
        // and rely on JSON sidecar files for .ckpt models
        console.log(`[CkptReader] Embedded metadata reading for .ckpt files not implemented yet: ${filePath}`);
        return null;
    } catch (error) {
        console.error(`[CkptReader] Error reading .ckpt metadata for ${filePath}:`, error);
        return null;
    }
}

/**
 * Main function to read embedded metadata from any supported model file
 * @param {string} filePath Path to the model file
 * @returns {Promise<Object|null>} Metadata object or null if not found/error
 */
async function readModelFileMetadata(filePath) {
    const fileExtension = filePath.toLowerCase().split('.').pop();
    
    switch (fileExtension) {
        case 'safetensors':
            return await readSafetensorsMetadata(filePath);
        case 'ckpt':
        case 'pt':
            return await readCkptMetadata(filePath);
        default:
            console.warn(`[ModelFileReader] Unsupported file format: ${fileExtension}`);
            return null;
    }
}

/**
 * Validates if metadata contains required parameters for complete model information
 * @param {Object} metadata Metadata object to validate
 * @returns {boolean} True if metadata is complete enough for database storage
 */
function validateMetadataCompleteness(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return false;
    }
    
    // Check for essential identification fields
    const hasIdentification = metadata.modelId || metadata.modelVersionId || 
                            metadata.hash_autov2 || metadata.hash_sha256 || 
                            metadata.sha256;
    
    // Check for descriptive fields
    const hasDescription = metadata.name || metadata.description || 
                         metadata.baseModel || metadata.trainedWords;
    
    // Metadata is considered complete if it has either identification or description
    return hasIdentification || hasDescription;
}

/**
 * Merges metadata from multiple sources (JSON file + embedded metadata)
 * Priority: JSON file > embedded metadata
 * @param {Object} jsonMetadata Metadata from JSON sidecar file
 * @param {Object} embeddedMetadata Metadata from model file
 * @returns {Object} Merged metadata object
 */
function mergeMetadata(jsonMetadata, embeddedMetadata) {
    const merged = { ...embeddedMetadata };
    
    // JSON metadata takes priority
    if (jsonMetadata) {
        Object.assign(merged, jsonMetadata);
    }
    
    // Ensure we have a source indicator
    merged._metadata_sources = [];
    if (jsonMetadata) merged._metadata_sources.push('json');
    if (embeddedMetadata) merged._metadata_sources.push('embedded');
    
    return merged;
}

module.exports = {
    readSafetensorsMetadata,
    readCkptMetadata,
    readModelFileMetadata,
    validateMetadataCompleteness,
    mergeMetadata
}; 