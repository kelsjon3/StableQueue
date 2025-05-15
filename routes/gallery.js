const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const router = express.Router();

// Environment variable for image save path, with fallback
const STABLE_DIFFUSION_SAVE_PATH = process.env.STABLE_DIFFUSION_SAVE_PATH || './outputs';

// GET /api/v1/gallery/images - List all images in the gallery
router.get('/images', async (req, res) => {
    try {
        console.log(`[Gallery] Listing images from ${STABLE_DIFFUSION_SAVE_PATH}`);
        const files = await fs.readdir(STABLE_DIFFUSION_SAVE_PATH);
        
        // Filter for image files
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
        const imageFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return imageExtensions.includes(ext);
        });
        
        // Get additional info for each image
        const imagesWithInfo = await Promise.all(imageFiles.map(async (filename) => {
            const filePath = path.join(STABLE_DIFFUSION_SAVE_PATH, filename);
            const stats = await fs.stat(filePath);
            
            // Try to extract job ID from filename (if it follows our naming convention)
            let jobId = null;
            const jobIdMatch = filename.match(/^([0-9a-f]{8})_/);
            if (jobIdMatch) {
                jobId = jobIdMatch[1];
            }
            
            return {
                filename,
                created: stats.mtime,
                size: stats.size,
                job_id_prefix: jobId
            };
        }));
        
        // Sort by creation date (newest first)
        imagesWithInfo.sort((a, b) => b.created - a.created);
        
        res.status(200).json({
            total: imagesWithInfo.length,
            images: imagesWithInfo
        });
    } catch (error) {
        console.error(`[Gallery] Error listing images: ${error.message}`);
        res.status(500).json({ error: `Failed to list images: ${error.message}` });
    }
});

// DELETE /api/v1/gallery/images/:filename - Delete an image
router.delete('/images/:filename', async (req, res) => {
    const { filename } = req.params;
    
    // Validate filename to prevent directory traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const filePath = path.join(STABLE_DIFFUSION_SAVE_PATH, filename);
    
    try {
        await fs.access(filePath); // Check if file exists
        await fs.unlink(filePath);
        res.status(200).json({ message: `Image ${filename} deleted successfully` });
    } catch (error) {
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: `Image ${filename} not found` });
        } else {
            console.error(`[Gallery] Error deleting image ${filename}: ${error.message}`);
            res.status(500).json({ error: `Failed to delete image: ${error.message}` });
        }
    }
});

// GET /api/v1/gallery/images/:filename/info - Get metadata for an image
router.get('/images/:filename/info', async (req, res) => {
    const { filename } = req.params;
    
    // Validate filename to prevent directory traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const filePath = path.join(STABLE_DIFFUSION_SAVE_PATH, filename);
    
    try {
        // Check if file exists and get basic info
        const stats = await fs.stat(filePath);
        
        // Try to extract job ID from filename
        let jobId = null;
        const jobIdMatch = filename.match(/^([0-9a-f]{8})_/);
        if (jobIdMatch) {
            jobId = jobIdMatch[1];
        }
        
        // Build the response
        const result = {
            filename,
            created: stats.mtime,
            size: stats.size,
            job_id_prefix: jobId,
            url: `/outputs/${filename}` // Assuming this path is configured in app.js to serve static files
        };
        
        // If you implement a metadata sidecar file (e.g., JSON with the same base name)
        // you could read and include that data here
        
        res.status(200).json(result);
    } catch (error) {
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: `Image ${filename} not found` });
        } else {
            console.error(`[Gallery] Error getting image info for ${filename}: ${error.message}`);
            res.status(500).json({ error: `Failed to get image info: ${error.message}` });
        }
    }
});

module.exports = router; 