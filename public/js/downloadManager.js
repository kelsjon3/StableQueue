/**
 * Download Queue Manager UI
 * Handles the UI for the download queue management
 */
class DownloadManager {
  constructor() {
    this.currentDownloads = [];
    this.pendingDownloads = [];
    this.completedDownloads = [];
    this.failedDownloads = [];
    this.activeTab = 'active';
    this.initialized = false;
    this.isPolling = false;
    this.pollingInterval = null;
    this.statusUpdateInterval = 3000; // 3 seconds
  }
  
  /**
   * Initialize the download manager UI
   */
  async init() {
    if (this.initialized) return;
    
    this.container = document.getElementById('downloads-container');
    if (!this.container) {
      console.error('Download manager container not found');
      return;
    }
    
    // Create UI components
    this.createUI();
    
    // Start polling for download status
    this.startPolling();
    
    // Add event listeners for the tabs
    this.setupEventListeners();
    
    this.initialized = true;
    
    // Initial data fetch
    await this.refreshDownloads();
  }
  
  /**
   * Create the download manager UI
   */
  createUI() {
    // Create tabs
    const tabsHtml = `
      <div class="download-tabs">
        <button class="download-tab active" data-tab="active">Active</button>
        <button class="download-tab" data-tab="pending">Pending</button>
        <button class="download-tab" data-tab="completed">Completed</button>
        <button class="download-tab" data-tab="failed">Failed</button>
      </div>
    `;
    
    // Create content area
    const contentHtml = `
      <div class="download-content">
        <div class="download-tab-content active-tab" id="download-tab-active">
          <div class="download-list" id="active-downloads-list">
            <div class="loader">Loading active downloads...</div>
          </div>
        </div>
        <div class="download-tab-content" id="download-tab-pending">
          <div class="download-list" id="pending-downloads-list">
            <div class="loader">Loading pending downloads...</div>
          </div>
        </div>
        <div class="download-tab-content" id="download-tab-completed">
          <div class="download-list" id="completed-downloads-list">
            <div class="loader">Loading completed downloads...</div>
          </div>
        </div>
        <div class="download-tab-content" id="download-tab-failed">
          <div class="download-list" id="failed-downloads-list">
            <div class="loader">Loading failed downloads...</div>
          </div>
        </div>
      </div>
    `;
    
    // Create download settings area
    const settingsHtml = `
      <div class="download-settings">
        <h3>Download Settings</h3>
        <div class="setting-group">
          <label for="max-concurrent-downloads">Max Concurrent Downloads:</label>
          <input type="number" id="max-concurrent-downloads" min="1" max="5" value="2">
          <button id="save-download-settings">Save Settings</button>
        </div>
        <div class="setting-group">
          <button id="cleanup-downloads">Cleanup Old Downloads</button>
        </div>
      </div>
    `;
    
    // Assemble the UI
    this.container.innerHTML = `
      <div class="download-manager">
        <h2>Download Queue Manager</h2>
        ${tabsHtml}
        ${contentHtml}
        ${settingsHtml}
      </div>
    `;
    
    // Add CSS styles
    this.addStyles();
  }
  
  /**
   * Add CSS styles for the download manager
   */
  addStyles() {
    // Check if the styles already exist
    if (document.getElementById('download-manager-styles')) return;
    
    const styleElement = document.createElement('style');
    styleElement.id = 'download-manager-styles';
    styleElement.textContent = `
      .download-manager {
        background-color: #f5f5f5;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 20px;
      }
      
      .download-tabs {
        display: flex;
        border-bottom: 1px solid #ddd;
        margin-bottom: 15px;
      }
      
      .download-tab {
        background: none;
        border: none;
        padding: 10px 15px;
        cursor: pointer;
        font-size: 14px;
        border-bottom: 3px solid transparent;
      }
      
      .download-tab.active {
        border-bottom: 3px solid #007bff;
        font-weight: bold;
      }
      
      .download-tab-content {
        display: none;
      }
      
      .download-tab-content.active-tab {
        display: block;
      }
      
      .download-list {
        min-height: 100px;
      }
      
      .download-item {
        background-color: white;
        border-radius: 4px;
        padding: 15px;
        margin-bottom: 10px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      
      .download-item-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      
      .download-item-title {
        font-weight: bold;
        margin: 0;
      }
      
      .download-type-badge {
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 12px;
        color: white;
        background-color: #6c757d;
      }
      
      .download-type-badge.lora {
        background-color: #28a745;
      }
      
      .download-type-badge.checkpoint {
        background-color: #007bff;
      }
      
      .download-progress-bar {
        height: 8px;
        background-color: #e9ecef;
        border-radius: 4px;
        margin: 10px 0;
        overflow: hidden;
      }
      
      .download-progress-bar-inner {
        height: 100%;
        background-color: #007bff;
        border-radius: 4px;
        transition: width 0.3s ease;
      }
      
      .download-item-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 10px;
      }
      
      .download-item-actions button {
        padding: 5px 10px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      
      .cancel-download {
        background-color: #dc3545;
        color: white;
      }
      
      .retry-download {
        background-color: #ffc107;
        color: #212529;
      }
      
      .remove-download {
        background-color: #6c757d;
        color: white;
      }
      
      .download-error {
        color: #dc3545;
        font-size: 13px;
        margin-top: 5px;
      }
      
      .download-settings {
        margin-top: 20px;
        padding-top: 20px;
        border-top: 1px solid #ddd;
      }
      
      .setting-group {
        margin-bottom: 15px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      
      .setting-group input {
        width: 60px;
        padding: 5px;
      }
      
      .setting-group button {
        padding: 5px 10px;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      
      .loader {
        text-align: center;
        padding: 20px;
        color: #6c757d;
      }
      
      .no-downloads {
        text-align: center;
        padding: 20px;
        color: #6c757d;
        font-style: italic;
      }
    `;
    
    document.head.appendChild(styleElement);
  }
  
  /**
   * Set up event listeners for the tabs and buttons
   */
  setupEventListeners() {
    // Tab switching
    const tabs = this.container.querySelectorAll('.download-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active class from all tabs
        tabs.forEach(t => t.classList.remove('active'));
        
        // Add active class to clicked tab
        tab.classList.add('active');
        
        // Hide all tab content
        const tabContents = this.container.querySelectorAll('.download-tab-content');
        tabContents.forEach(content => content.classList.remove('active-tab'));
        
        // Show the corresponding tab content
        const tabName = tab.dataset.tab;
        this.activeTab = tabName;
        document.getElementById(`download-tab-${tabName}`).classList.add('active-tab');
      });
    });
    
    // Save settings button
    const saveSettingsBtn = this.container.querySelector('#save-download-settings');
    saveSettingsBtn.addEventListener('click', () => {
      const maxConcurrentDownloads = parseInt(document.getElementById('max-concurrent-downloads').value, 10);
      this.saveSettings({ maxConcurrentDownloads });
    });
    
    // Cleanup button
    const cleanupBtn = this.container.querySelector('#cleanup-downloads');
    cleanupBtn.addEventListener('click', () => {
      this.cleanupDownloads();
    });
    
    // Add global event delegation for download item actions
    this.container.addEventListener('click', (event) => {
      // Cancel download button
      if (event.target.classList.contains('cancel-download')) {
        const downloadId = event.target.dataset.downloadId;
        this.cancelDownload(downloadId);
      }
      
      // Retry download button
      if (event.target.classList.contains('retry-download')) {
        const downloadId = event.target.dataset.downloadId;
        this.retryDownload(downloadId);
      }
      
      // TODO: Add other action buttons as needed
    });
  }
  
  /**
   * Start polling for download status updates
   */
  startPolling() {
    if (this.isPolling) return;
    
    this.isPolling = true;
    this.pollingInterval = setInterval(() => {
      this.refreshDownloads();
    }, this.statusUpdateInterval);
  }
  
  /**
   * Stop polling for download status updates
   */
  stopPolling() {
    if (!this.isPolling) return;
    
    clearInterval(this.pollingInterval);
    this.isPolling = false;
  }
  
  /**
   * Refresh the download lists
   */
  async refreshDownloads() {
    try {
      const response = await fetch('/api/v1/downloads/queue');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch downloads: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.queue) {
        this.currentDownloads = data.queue.activeDownloads || [];
        this.pendingDownloads = data.queue.pendingDownloads || [];
        this.completedDownloads = data.queue.completedDownloads || [];
        this.failedDownloads = data.queue.failedDownloads || [];
        
        this.updateDownloadLists();
      }
    } catch (error) {
      console.error('Error refreshing downloads:', error);
    }
  }
  
  /**
   * Update all download lists in the UI
   */
  updateDownloadLists() {
    this.updateActiveDownloads();
    this.updatePendingDownloads();
    this.updateCompletedDownloads();
    this.updateFailedDownloads();
  }
  
  /**
   * Update the active downloads list
   */
  updateActiveDownloads() {
    const container = document.getElementById('active-downloads-list');
    if (!container) return;
    
    if (this.currentDownloads.length === 0) {
      container.innerHTML = '<div class="no-downloads">No active downloads</div>';
      return;
    }
    
    let html = '';
    
    this.currentDownloads.forEach(download => {
      const progress = download.progress || 0;
      
      html += `
        <div class="download-item" data-download-id="${download.id}">
          <div class="download-item-header">
            <h3 class="download-item-title">${download.model_name}</h3>
            <span class="download-type-badge ${download.type.toLowerCase()}">${download.type}</span>
          </div>
          <div class="download-details">
            <div>File: ${this.escapeHtml(download.target_filename || 'Unknown')}</div>
            <div>Size: ${download.file_size_kb ? `${(download.file_size_kb / 1024).toFixed(2)} MB` : 'Unknown'}</div>
          </div>
          <div class="download-progress-bar">
            <div class="download-progress-bar-inner" style="width: ${progress}%"></div>
          </div>
          <div class="download-progress-text">${progress.toFixed(1)}% complete</div>
          <div class="download-item-actions">
            <button class="cancel-download" data-download-id="${download.id}">Cancel</button>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }
  
  /**
   * Update the pending downloads list
   */
  updatePendingDownloads() {
    const container = document.getElementById('pending-downloads-list');
    if (!container) return;
    
    if (this.pendingDownloads.length === 0) {
      container.innerHTML = '<div class="no-downloads">No pending downloads</div>';
      return;
    }
    
    let html = '';
    
    this.pendingDownloads.forEach(download => {
      html += `
        <div class="download-item" data-download-id="${download.id}">
          <div class="download-item-header">
            <h3 class="download-item-title">${download.model_name}</h3>
            <span class="download-type-badge ${download.type.toLowerCase()}">${download.type}</span>
          </div>
          <div class="download-details">
            <div>File: ${download.target_filename || 'Unknown'}</div>
            <div>Size: ${download.file_size_kb ? `${(download.file_size_kb / 1024).toFixed(2)} MB` : 'Unknown'}</div>
          </div>
          <div class="download-item-actions">
            <button class="cancel-download" data-download-id="${download.id}">Cancel</button>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }
  
  /**
   * Update the completed downloads list
   */
  updateCompletedDownloads() {
    const container = document.getElementById('completed-downloads-list');
    if (!container) return;
    
    if (this.completedDownloads.length === 0) {
      container.innerHTML = '<div class="no-downloads">No completed downloads</div>';
      return;
    }
    
    let html = '';
    
    this.completedDownloads.forEach(download => {
      const completedDate = new Date(download.completed_at).toLocaleString();
      
      html += `
        <div class="download-item" data-download-id="${download.id}">
          <div class="download-item-header">
            <h3 class="download-item-title">${download.model_name}</h3>
            <span class="download-type-badge ${download.type.toLowerCase()}">${download.type}</span>
          </div>
          <div class="download-details">
            <div>File: ${download.target_filename || 'Unknown'}</div>
            <div>Size: ${download.file_size_kb ? `${(download.file_size_kb / 1024).toFixed(2)} MB` : 'Unknown'}</div>
            <div>Completed: ${completedDate}</div>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }
  
  /**
   * Update the failed downloads list
   */
  updateFailedDownloads() {
    const container = document.getElementById('failed-downloads-list');
    if (!container) return;
    
    if (this.failedDownloads.length === 0) {
      container.innerHTML = '<div class="no-downloads">No failed downloads</div>';
      return;
    }
    
    let html = '';
    
    this.failedDownloads.forEach(download => {
      html += `
        <div class="download-item" data-download-id="${download.id}">
          <div class="download-item-header">
            <h3 class="download-item-title">${download.model_name}</h3>
            <span class="download-type-badge ${download.type.toLowerCase()}">${download.type}</span>
          </div>
          <div class="download-details">
            <div>File: ${download.target_filename || 'Unknown'}</div>
            <div>Size: ${download.file_size_kb ? `${(download.file_size_kb / 1024).toFixed(2)} MB` : 'Unknown'}</div>
          </div>
          ${download.error_message ? `<div class="download-error">Error: ${download.error_message}</div>` : ''}
          <div class="download-item-actions">
            <button class="retry-download" data-download-id="${download.id}">Retry</button>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }
  
  /**
   * Cancel a download
   * @param {number} downloadId - The download ID to cancel
   */
  async cancelDownload(downloadId) {
    try {
      const response = await fetch(`/api/v1/downloads/queue/${downloadId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Refresh the downloads list
        await this.refreshDownloads();
      } else {
        console.error('Failed to cancel download:', data.message);
        alert(`Failed to cancel download: ${data.message}`);
      }
    } catch (error) {
      console.error('Error cancelling download:', error);
      alert('An error occurred while trying to cancel the download');
    }
  }
  
  /**
   * Retry a failed download
   * @param {number} downloadId - The download ID to retry
   */
  async retryDownload(downloadId) {
    try {
      const response = await fetch(`/api/v1/downloads/queue/${downloadId}/retry`, {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Refresh the downloads list
        await this.refreshDownloads();
      } else {
        console.error('Failed to retry download:', data.message);
        alert(`Failed to retry download: ${data.message}`);
      }
    } catch (error) {
      console.error('Error retrying download:', error);
      alert('An error occurred while trying to retry the download');
    }
  }
  
  /**
   * Save download settings
   * @param {Object} settings - The settings to save
   */
  async saveSettings(settings) {
    try {
      const response = await fetch('/api/v1/downloads/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      });
      
      const data = await response.json();
      
      if (data.success) {
        alert('Settings saved successfully');
      } else {
        console.error('Failed to save settings:', data.message);
        alert(`Failed to save settings: ${data.message}`);
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('An error occurred while trying to save settings');
    }
  }
  
  /**
   * Clean up old downloads
   */
  async cleanupDownloads() {
    const daysToKeep = prompt('Enter the number of days to keep completed downloads (default: 7):', '7');
    
    if (daysToKeep === null) return; // User cancelled
    
    const days = parseInt(daysToKeep, 10) || 7;
    
    try {
      const response = await fetch('/api/v1/downloads/cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ daysToKeep: days })
      });
      
      const data = await response.json();
      
      if (data.success) {
        alert(`Cleaned up ${data.deletedCount} old downloads`);
        // Refresh the downloads list
        await this.refreshDownloads();
      } else {
        console.error('Failed to clean up downloads:', data.message);
        alert(`Failed to clean up downloads: ${data.message}`);
      }
    } catch (error) {
      console.error('Error cleaning up downloads:', error);
      alert('An error occurred while trying to clean up downloads');
    }
  }
  
  /**
   * Add a model to the download queue
   * @param {Object} modelInfo - Information about the model to download
   * @returns {Promise<Object>} - Result of the download queue addition
   */
  async addToQueue(modelInfo) {
    try {
      const response = await fetch('/api/v1/downloads/queue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(modelInfo)
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Refresh the downloads list
        await this.refreshDownloads();
        
        // Switch to the pending tab to show the new download
        const pendingTab = this.container.querySelector('.download-tab[data-tab="pending"]');
        if (pendingTab) {
          pendingTab.click();
        }
      }
      
      return data;
    } catch (error) {
      console.error('Error adding to download queue:', error);
      return { success: false, message: 'An error occurred while trying to add to download queue' };
    }
  }
}

// Create a singleton instance
const downloadManager = new DownloadManager();

// Make it globally available
window.downloadManager = downloadManager;

// Initialize when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize if the container exists
  const container = document.getElementById('downloads-container');
  if (container) {
    downloadManager.init();
  }
}); 