const axios = require('axios');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter } = require('events');
const Database = require('better-sqlite3');

// Metadata extension for Civitai models
const METADATA_EXT = '.civitai.json';
const CIVITAI_API_BASE = 'https://civitai.com/api/v1';

class DownloadQueueManager extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.activeDownloads = new Map(); // Map of downloadId -> download info
    this.maxConcurrentDownloads = 2; // Default concurrency limit
    this.dbPath = process.env.CONFIG_DATA_PATH || './data';
    this.db = null;
    this.initialized = false;
    this.isProcessing = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Ensure the database directory exists
      await fsp.mkdir(this.dbPath, { recursive: true });
      
      // Connect to the SQLite database using better-sqlite3
      const dbFilePath = path.join(this.dbPath, 'downloads.db');
      this.db = new Database(dbFilePath);

      // Create downloads table if it doesn't exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS downloads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model_id TEXT,
          model_version_id TEXT NOT NULL,
          model_name TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          priority INTEGER DEFAULT 1,
          target_filename TEXT,
          target_directory TEXT NOT NULL,
          download_url TEXT,
          file_size_kb INTEGER,
          progress REAL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          error_message TEXT
        )
      `);

      this.initialized = true;
      console.log('[DownloadQueueManager] Initialized successfully');
      
      // Reload any pending downloads from the database
      await this.reloadPendingDownloads();
      
      // Start processing the queue
      this.processQueue();
    } catch (error) {
      console.error('[DownloadQueueManager] Initialization error:', error);
      throw error;
    }
  }

  async reloadPendingDownloads() {
    try {
      // Get pending and in-progress downloads from the database
      const pendingDownloads = this.db.prepare(
        `SELECT * FROM downloads WHERE status IN ('pending', 'downloading') ORDER BY priority DESC, created_at ASC`
      ).all();
      
      // Reset in-progress downloads to pending
      this.db.prepare(
        `UPDATE downloads SET status = 'pending' WHERE status = 'downloading'`
      ).run();
      
      // Add to the in-memory queue
      pendingDownloads.forEach(download => {
        this.queue.push({
          id: download.id,
          modelId: download.model_id,
          modelVersionId: download.model_version_id,
          modelName: download.model_name,
          type: download.type,
          priority: download.priority,
          targetFilename: download.target_filename,
          targetDirectory: download.target_directory,
          downloadUrl: download.download_url,
          fileSizeKb: download.file_size_kb
        });
      });
      
      console.log(`[DownloadQueueManager] Reloaded ${pendingDownloads.length} pending downloads`);
    } catch (error) {
      console.error('[DownloadQueueManager] Error reloading pending downloads:', error);
    }
  }

  async addToQueue(downloadInfo) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const { 
        modelId, 
        modelVersionId, 
        modelName, 
        type, 
        priority = 1, 
        targetFilename = null 
      } = downloadInfo;
      
      if (!modelVersionId || !modelName || !type) {
        throw new Error('Missing required download information');
      }
      
      // Determine target directory based on model type
      const targetDirectory = type.toLowerCase() === 'lora' 
        ? process.env.LORA_PATH 
        : type.toLowerCase() === 'checkpoint' 
          ? process.env.CHECKPOINT_PATH 
          : null;
          
      if (!targetDirectory) {
        throw new Error(`Invalid model type or missing environment variable for ${type.toUpperCase()}_PATH`);
      }
      
      // Check if this model version is already in the queue or actively downloading
      const existingInQueue = this.queue.find(item => item.modelVersionId === modelVersionId);
      const existingActive = Array.from(this.activeDownloads.values()).find(
        item => item.modelVersionId === modelVersionId
      );
      
      if (existingInQueue || existingActive) {
        return { success: false, message: 'This model version is already in the download queue' };
      }
      
      // Check if already completed in the database
      const existing = this.db.prepare(
        `SELECT * FROM downloads WHERE model_version_id = ? AND status = 'completed'`
      ).get(modelVersionId);
      
      if (existing) {
        return { success: false, message: 'This model version has already been downloaded' };
      }
      
      // If no download URL provided, fetch model info from Civitai
      let downloadUrl = downloadInfo.downloadUrl;
      let fileSizeKb = downloadInfo.fileSizeKb;
      
      if (!downloadUrl) {
        try {
          const versionData = await this.fetchModelVersionInfo(modelVersionId);
          if (versionData) {
            downloadUrl = versionData.downloadUrl;
            fileSizeKb = versionData.fileSizeKb;
            // Use Civitai filename if targetFilename not provided
            if (!targetFilename && versionData.filename) {
              targetFilename = versionData.filename;
            }
          }
        } catch (error) {
          return { success: false, message: `Failed to fetch model info: ${error.message}` };
        }
      }
      
      // Insert into database
      const result = this.db.prepare(
        `INSERT INTO downloads 
         (model_id, model_version_id, model_name, type, status, priority, target_filename, target_directory, download_url, file_size_kb) 
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
      ).run(modelId, modelVersionId, modelName, type, priority, targetFilename, targetDirectory, downloadUrl, fileSizeKb);
      
      const downloadId = result.lastInsertRowid;
      
      // Add to in-memory queue
      const queueItem = { 
        id: downloadId,
        modelId, 
        modelVersionId, 
        modelName, 
        type, 
        priority, 
        targetFilename, 
        targetDirectory,
        downloadUrl,
        fileSizeKb
      };
      
      this.queue.push(queueItem);
      
      // Sort queue by priority (higher number = higher priority)
      this.queue.sort((a, b) => b.priority - a.priority);
      
      // Emit event
      this.emit('download:added', queueItem);
      
      // Trigger queue processing
      this.processQueue();
      
      return { success: true, downloadId, message: 'Model added to download queue' };
    } catch (error) {
      console.error('[DownloadQueueManager] Error adding to queue:', error);
      return { success: false, message: `Failed to add to queue: ${error.message}` };
    }
  }

  async fetchModelVersionInfo(modelVersionId) {
    try {
      const response = await axios.get(`${CIVITAI_API_BASE}/model-versions/${modelVersionId}`);
      const versionData = response.data;
      
      if (!versionData || !versionData.files || versionData.files.length === 0) {
        throw new Error('Model version not found or has no files');
      }
      
      const primaryFile = versionData.files[0];
      
      return {
        downloadUrl: primaryFile.downloadUrl,
        filename: primaryFile.name,
        fileSizeKb: primaryFile.sizeKB,
        modelId: versionData.modelId
      };
    } catch (error) {
      console.error(`[DownloadQueueManager] Error fetching model info for ${modelVersionId}:`, error);
      throw error;
    }
  }

  async processQueue() {
    if (this.isProcessing || !this.initialized) return;
    
    this.isProcessing = true;
    
    try {
      while (this.queue.length > 0 && this.activeDownloads.size < this.maxConcurrentDownloads) {
        const download = this.queue.shift();
        
        // Start the download
        this.startDownload(download);
      }
    } catch (error) {
      console.error('[DownloadQueueManager] Error processing queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async startDownload(download) {
    try {
      // Update database
      this.db.prepare(
        `UPDATE downloads SET status = 'downloading', started_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(download.id);
      
      // Add to active downloads
      this.activeDownloads.set(download.id, download);
      
      // Emit event
      this.emit('download:started', { id: download.id, modelName: download.modelName, type: download.type });
      
      // Determine final filename
      let finalFilename = download.targetFilename;
      if (!finalFilename) {
        // Extract filename from download URL if not provided
        const urlPath = new URL(download.downloadUrl).pathname;
        finalFilename = path.basename(urlPath);
      }
      
      // Final path
      const finalFilePath = path.join(download.targetDirectory, finalFilename);
      const metadataFilePath = path.join(
        download.targetDirectory, 
        path.basename(finalFilename, path.extname(finalFilename)) + METADATA_EXT
      );
      
      // Ensure target directory exists
      await fsp.mkdir(download.targetDirectory, { recursive: true });
      
      // Create write stream
      const writer = fs.createWriteStream(finalFilePath);
      
      // Download with progress tracking
      const response = await axios({
        method: 'get',
        url: download.downloadUrl,
        responseType: 'stream'
      });
      
      // Get content length for progress calculation
      const totalBytes = parseInt(response.headers['content-length'], 10);
      let downloadedBytes = 0;
      
      // Set up the download
      response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const progress = (downloadedBytes / totalBytes) * 100;
        
        // Update progress in database (but not too frequently to avoid database load)
        if (Math.floor(progress) % 5 === 0) {
          this.db.prepare(
            `UPDATE downloads SET progress = ? WHERE id = ?`
          ).run(progress, download.id);
        }
        
        // Emit progress event
        this.emit('download:progress', { 
          id: download.id, 
          progress,
          downloadedBytes,
          totalBytes,
          modelName: download.modelName
        });
      });
      
      // Pipe the download stream to the file
      response.data.pipe(writer);
      
      // Wait for download to complete
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
      });
      
      // Create metadata file
      const metadataContent = {
        modelId: download.modelId,
        modelVersionId: download.modelVersionId,
        downloadedFrom: `https://civitai.com/models/${download.modelId}?modelVersionId=${download.modelVersionId}`,
        fileName: finalFilename,
        sizeKB: download.fileSizeKb,
        type: download.type
      };
      await fsp.writeFile(metadataFilePath, JSON.stringify(metadataContent, null, 2), 'utf-8');
      
      // Update database
      this.db.prepare(
        `UPDATE downloads SET status = 'completed', completed_at = CURRENT_TIMESTAMP, progress = 100 WHERE id = ?`
      ).run(download.id);
      
      // Remove from active downloads
      this.activeDownloads.delete(download.id);
      
      // Emit completion event
      this.emit('download:completed', { 
        id: download.id, 
        modelName: download.modelName, 
        type: download.type,
        filePath: finalFilePath,
        metadataPath: metadataFilePath
      });
      
      // Process next in queue
      this.processQueue();
      
      return { success: true, filePath: finalFilePath };
} catch (error) {
     console.error(`[DownloadQueueManager] Error downloading ${download.modelName}:`, error);
     
    // Clean up partial download if it exists
    try {
      const finalFilePath = path.join(download.targetDirectory, download.targetFilename || 'temp');
      if (await fsp.access(finalFilePath).then(() => true).catch(() => false)) {
        await fsp.unlink(finalFilePath);
        console.log(`[DownloadQueueManager] Cleaned up partial download: ${finalFilePath}`);
      }
    } catch (cleanupError) {
      console.error('[DownloadQueueManager] Error cleaning up partial download:', cleanupError);
    }
    
     // Update database with error
      this.db.prepare(
        `UPDATE downloads SET status = 'failed', error_message = ? WHERE id = ?`
      ).run(error.message, download.id);
      
      // Remove from active downloads
      this.activeDownloads.delete(download.id);
      
      // Emit error event
      this.emit('download:error', { 
        id: download.id, 
        modelName: download.modelName, 
        error: error.message 
      });
      
      // Continue processing queue
      this.processQueue();
      
      return { success: false, error: error.message };
    }
  }

  async cancelDownload(downloadId) {
    try {
      // Check if download is in queue
      const queueIndex = this.queue.findIndex(item => item.id === downloadId);
      
      if (queueIndex !== -1) {
        // Remove from queue
        this.queue.splice(queueIndex, 1);
        
        // Update database
        this.db.prepare(
          `UPDATE downloads SET status = 'cancelled' WHERE id = ?`
        ).run(downloadId);
        
        // Emit event
        this.emit('download:cancelled', { id: downloadId });
        
        return { success: true, message: 'Download cancelled' };
      } 

if (this.activeDownloads.has(downloadId)) {
  const download = this.activeDownloads.get(downloadId);
  if (download.cancelSource) {
    download.cancelSource.cancel('Download cancelled by user');
  }
}

  if (download.cancelSource) {
    download.cancelSource.cancel('Download cancelled by user');
  }
        // We'll just mark it as cancelled in the database and it will be cancelled on next server restart
        this.db.prepare(
          `UPDATE downloads SET status = 'cancelled' WHERE id = ?`
        ).run(downloadId);
        
        // Emit event
        this.emit('download:cancelled', { id: downloadId });
        
        return { success: true, message: 'Download marked for cancellation and will stop on next server restart' };
      } else {
        return { success: false, message: 'Download not found in queue or active downloads' };
      }
    } catch (error) {
      console.error(`[DownloadQueueManager] Error cancelling download ${downloadId}:`, error);
      return { success: false, message: `Failed to cancel download: ${error.message}` };
    }
  }

  async getQueueStatus() {
    try {
      // Get all downloads from database
      const downloads = this.db.prepare(
        `SELECT * FROM downloads ORDER BY 
         CASE 
           WHEN status = 'downloading' THEN 1
           WHEN status = 'pending' THEN 2
           WHEN status = 'completed' THEN 3
           ELSE 4
         END,
         priority DESC, created_at DESC`
      ).all();
      
      return {
        activeDownloads: downloads.filter(d => d.status === 'downloading'),
        pendingDownloads: downloads.filter(d => d.status === 'pending'),
        completedDownloads: downloads.filter(d => d.status === 'completed'),
        failedDownloads: downloads.filter(d => d.status === 'failed' || d.status === 'cancelled')
      };
    } catch (error) {
      console.error('[DownloadQueueManager] Error getting queue status:', error);
      throw error;
    }
  }

  async cleanupOldDownloads(daysToKeep = 7) {
    try {
      // Delete completed, failed, or cancelled downloads older than specified days
      const result = this.db.prepare(
        `DELETE FROM downloads 
         WHERE status IN ('completed', 'failed', 'cancelled') 
         AND completed_at < datetime('now', '-' || ? || ' days')`
      ).run(daysToKeep);
      
      return { success: true, deletedCount: result.changes };
    } catch (error) {
      console.error('[DownloadQueueManager] Error cleaning up old downloads:', error);
      return { success: false, error: error.message };
    }
  }

  async retryFailedDownload(downloadId) {
    try {
      // Get the failed download
      const download = this.db.prepare(
        `SELECT * FROM downloads WHERE id = ? AND status = 'failed';`
      ).get(downloadId);
      
      if (!download) {
        return { success: false, message: 'Failed download not found' };
      }
      
      // Update status to pending
      this.db.prepare(
        `UPDATE downloads SET status = 'pending', error_message = NULL, progress = 0 WHERE id = ?`
      ).run(downloadId);
      
      // Add back to queue
      this.queue.push({
        id: download.id,
        modelId: download.model_id,
        modelVersionId: download.model_version_id,
        modelName: download.model_name,
        type: download.type,
        priority: download.priority,
        targetFilename: download.target_filename,
        targetDirectory: download.target_directory,
        downloadUrl: download.download_url,
        fileSizeKb: download.file_size_kb
      });
      
      // Sort queue by priority
      this.queue.sort((a, b) => b.priority - a.priority);
      
      // Process queue
      this.processQueue();
      
      return { success: true, message: 'Download queued for retry' };
    } catch (error) {
      console.error(`[DownloadQueueManager] Error retrying download ${downloadId}:`, error);
      return { success: false, message: `Failed to retry download: ${error.message}` };
    }
  }

  // Change the concurrency limit
  setMaxConcurrentDownloads(limit) {
    if (typeof limit === 'number' && limit > 0) {
      this.maxConcurrentDownloads = limit;
      // Process queue in case we can start more downloads now
      this.processQueue();
    }
  }
    }
  }

  // Close connections when shutting down
  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }
}

// Create and export a singleton instance
const downloadQueueManager = new DownloadQueueManager();

module.exports = downloadQueueManager;     this.initialized = false;
  }
}

// Create and export a singleton instance
const downloadQueueManager = new DownloadQueueManager();

module.exports = downloadQueueManager; module.exports = downloadQueueManager;     this.initialized = false;
  }
}

// Create and export a singleton instance
const downloadQueueManager = new DownloadQueueManager();

module.exports = downloadQueueManager; 