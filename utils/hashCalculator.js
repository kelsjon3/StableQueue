const fs = require('fs').promises;
const crypto = require('crypto');
const path = require('path');

/**
 * Calculate AutoV2 hash of a model file with optimized chunk size for large files
 * AutoV2 is the hash format used by Automatic1111, based on SHA256 but with specific handling for model files
 * @param {string} filePath - Path to the file
 * @param {Function} [progressCallback] - Optional progress callback function(progress, eta)
 * @returns {Promise<string|null>} AutoV2 hash (10 characters) or null on error
 */
async function calculateFileHash(filePath, progressCallback = null) {
    try {
        console.log(`[HashCalculator] Starting AutoV2 calculation for ${path.basename(filePath)}`);
        const startTime = Date.now();
        
        const stats = await fs.stat(filePath);
        const fileSize = stats.size;
        const fileSizeGB = fileSize / (1024 * 1024 * 1024);
        
        console.log(`[HashCalculator] File size: ${(fileSize / (1024 * 1024)).toFixed(1)} MB`);
        
        // Check file size limit (15GB)
        const MAX_FILE_SIZE = 15 * 1024 * 1024 * 1024; // 15GB
        if (fileSize > MAX_FILE_SIZE) {
            throw new Error(`File size (${fileSizeGB.toFixed(1)}GB) exceeds maximum limit of 15GB`);
        }
        
        // Use larger chunks for better performance on large files
        // 1MB chunks are much more efficient than 4KB for multi-GB files
        const chunkSize = 1024 * 1024; // 1MB chunks
        
        const hash = crypto.createHash('sha256');
        const fileHandle = await fs.open(filePath, 'r');
        
        let bytesRead = 0;
        let lastProgressUpdate = 0;
        const progressUpdateInterval = 100; // Update progress every 100ms
        
        try {
            const buffer = Buffer.alloc(chunkSize);
            
            while (bytesRead < fileSize) {
                const { bytesRead: chunkBytesRead } = await fileHandle.read(buffer, 0, chunkSize, bytesRead);
                
                if (chunkBytesRead === 0) break;
                
                hash.update(buffer.subarray(0, chunkBytesRead));
                bytesRead += chunkBytesRead;
                
                // Update progress callback if provided
                if (progressCallback && Date.now() - lastProgressUpdate > progressUpdateInterval) {
                    const progress = (bytesRead / fileSize) * 100;
                    const elapsedTime = (Date.now() - startTime) / 1000;
                    const estimatedTotalTime = elapsedTime / (bytesRead / fileSize);
                    const eta = Math.max(0, estimatedTotalTime - elapsedTime);
                    
                    progressCallback(progress, eta);
                    lastProgressUpdate = Date.now();
                }
            }
        } finally {
            await fileHandle.close();
        }
        
        // Get the full SHA256 hash
        const fullHash = hash.digest('hex');
        
        // AutoV2 is the first 10 characters of the SHA256 hash (lowercase)
        const autoV2Hash = fullHash.substring(0, 10);
        const totalTime = (Date.now() - startTime) / 1000;
        
        console.log(`[HashCalculator] AutoV2 calculated in ${totalTime.toFixed(1)}s: ${autoV2Hash}`);
        
        // Final progress update
        if (progressCallback) {
            progressCallback(100, 0);
        }
        
        return autoV2Hash;
        
    } catch (error) {
        console.error(`[HashCalculator] Error calculating AutoV2 for ${filePath}:`, error);
        throw error;
    }
}

/**
 * Get estimated time for hash calculation based on file size
 * @param {number} fileSizeBytes - File size in bytes
 * @returns {number} Estimated time in seconds
 */
function getEstimatedHashTime(fileSizeBytes) {
    // Based on empirical testing: approximately 1.5 seconds per GB
    const fileSizeGB = fileSizeBytes / (1024 * 1024 * 1024);
    const baseTimePerGB = 90; // 1.5 minutes per GB in seconds
    return Math.round(fileSizeGB * baseTimePerGB);
}

/**
 * Check if file size is within acceptable limits for hash calculation
 * @param {number} fileSizeBytes - File size in bytes
 * @returns {Object} Result with isAllowed, reason, and sizeInfo
 */
function checkFileSizeForHashing(fileSizeBytes) {
    const MAX_FILE_SIZE = 15 * 1024 * 1024 * 1024; // 15GB
    const fileSizeGB = fileSizeBytes / (1024 * 1024 * 1024);
    const fileSizeMB = fileSizeBytes / (1024 * 1024);
    
    let sizeDisplay;
    if (fileSizeGB >= 1) {
        sizeDisplay = `${fileSizeGB.toFixed(1)}GB`;
    } else {
        sizeDisplay = `${fileSizeMB.toFixed(0)}MB`;
    }
    
    if (fileSizeBytes > MAX_FILE_SIZE) {
        return {
            isAllowed: false,
            reason: `File size (${sizeDisplay}) exceeds maximum limit of 15GB`,
            sizeInfo: {
                bytes: fileSizeBytes,
                displaySize: sizeDisplay,
                estimatedTime: null
            }
        };
    }
    
    const estimatedTime = getEstimatedHashTime(fileSizeBytes);
    
    return {
        isAllowed: true,
        reason: null,
        sizeInfo: {
            bytes: fileSizeBytes,
            displaySize: sizeDisplay,
            estimatedTime: estimatedTime
        }
    };
}

/**
 * Format time duration in human-readable format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
function formatDuration(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
}

module.exports = {
    calculateFileHash,
    getEstimatedHashTime,
    checkFileSizeForHashing,
    formatDuration
}; 