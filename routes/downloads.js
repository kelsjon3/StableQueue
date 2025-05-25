const express = require('express');
const router = express.Router();
const downloadQueueManager = require('../services/downloadQueueManager');

// Initialize the download queue manager when this route is first loaded
downloadQueueManager.initialize().catch(error => {
  console.error('Failed to initialize download queue manager:', error);
});

// GET /api/v1/downloads/queue - Get the current state of the download queue
router.get('/queue', async (req, res) => {
  try {
    const queueStatus = await downloadQueueManager.getQueueStatus();
    res.json({
      success: true,
      queue: queueStatus
    });
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get download queue status' 
    });
  }
});

// POST /api/v1/downloads/queue - Add a model to the download queue
router.post('/queue', async (req, res) => {
  const { 
    modelId, 
    modelVersionId, 
    modelName, 
    type, 
    priority, 
    targetFilename, 
    downloadUrl,
    fileSizeKb
  } = req.body;

  if (!modelVersionId || !modelName || !type) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: modelVersionId, modelName, and type are required' 
    });
  }

  try {
    const result = await downloadQueueManager.addToQueue({
      modelId,
      modelVersionId,
      modelName,
      type,
      priority,
      targetFilename,
      downloadUrl,
      fileSizeKb
    });

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error adding to download queue:', error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to add to download queue: ${error.message}` 
    });
  }
});

// DELETE /api/v1/downloads/queue/:id - Cancel a download by ID
router.delete('/queue/:id', async (req, res) => {
  const downloadId = parseInt(req.params.id, 10);
  
  if (isNaN(downloadId)) {
    return res.status(400).json({ success: false, message: 'Invalid download ID' });
  }

  try {
    const result = await downloadQueueManager.cancelDownload(downloadId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error(`Error cancelling download ${downloadId}:`, error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to cancel download: ${error.message}` 
    });
  }
});

// POST /api/v1/downloads/queue/:id/retry - Retry a failed download
router.post('/queue/:id/retry', async (req, res) => {
  const downloadId = parseInt(req.params.id, 10);
  
  if (isNaN(downloadId)) {
    return res.status(400).json({ success: false, message: 'Invalid download ID' });
  }

  try {
    const result = await downloadQueueManager.retryFailedDownload(downloadId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error(`Error retrying download ${downloadId}:`, error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to retry download: ${error.message}` 
    });
  }
});

// POST /api/v1/downloads/cleanup - Clean up old downloads
router.post('/cleanup', async (req, res) => {
  const { daysToKeep = 7 } = req.body;
  
  try {
    const result = await downloadQueueManager.cleanupOldDownloads(daysToKeep);
    res.json(result);
  } catch (error) {
    console.error('Error cleaning up old downloads:', error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to clean up old downloads: ${error.message}` 
    });
  }
});

// POST /api/v1/downloads/settings - Update download queue settings
router.post('/settings', (req, res) => {
  const { maxConcurrentDownloads } = req.body;
  
  if (maxConcurrentDownloads !== undefined) {
    if (typeof maxConcurrentDownloads !== 'number' || maxConcurrentDownloads <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'maxConcurrentDownloads must be a positive number' 
      });
    }
    
    downloadQueueManager.setMaxConcurrentDownloads(maxConcurrentDownloads);
  }
  
  res.json({ 
    success: true, 
    settings: { 
      maxConcurrentDownloads: downloadQueueManager.maxConcurrentDownloads 
    } 
  });
});

module.exports = router; 