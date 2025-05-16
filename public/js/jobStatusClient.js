/**
 * MobileSD Job Status Client
 * 
 * This module connects to the MobileSD server via socket.io and provides
 * real-time updates on job status and progress.
 * 
 * Usage:
 * 1. Include this script in your HTML along with socket.io client library
 * 2. Create a new instance of MobileSdJobClient
 * 3. Subscribe to events using onJobUpdate, onJobProgress, etc.
 */

class MobileSdJobClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || window.location.origin;
    this.socket = null;
    this.connected = false;
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.reconnectTimer = null;
    this.callbacks = {
      onConnect: [],
      onDisconnect: [],
      onJobUpdate: [],
      onJobProgress: [],
      onInitialJobs: []
    };
    
    this.connect();
  }
  
  /**
   * Connect to the socket.io server
   */
  connect() {
    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Only try to connect if we're not already connected
    if (this.socket && this.connected) return;
    
    console.log('[JobClient] Connecting to WebSocket server...');
    
    // Create socket.io connection
    this.socket = io(this.baseUrl);
    
    // Set up socket event handlers
    this.socket.on('connect', () => {
      console.log('[JobClient] Connected to server');
      this.connected = true;
      this._triggerCallbacks('onConnect');
    });
    
    this.socket.on('disconnect', () => {
      console.log('[JobClient] Disconnected from server');
      this.connected = false;
      this._triggerCallbacks('onDisconnect');
      
      // Auto-reconnect if enabled
      if (this.autoReconnect) {
        console.log(`[JobClient] Attempting to reconnect in ${this.reconnectInterval / 1000} seconds...`);
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectInterval);
      }
    });
    
    this.socket.on('initial_jobs', (jobs) => {
      console.log('[JobClient] Received initial jobs:', jobs.length);
      this._triggerCallbacks('onInitialJobs', jobs);
    });
    
    this.socket.on('job_update', (job) => {
      console.log(`[JobClient] Received job update for job ${job.mobilesd_job_id}`);
      this._triggerCallbacks('onJobUpdate', job);
    });
    
    this.socket.on('job_progress', (data) => {
      console.log(`[JobClient] Received job progress for job ${data.jobId}: ${data.progress_percentage}%`);
      this._triggerCallbacks('onJobProgress', data);
    });
  }
  
  /**
   * Disconnect from the socket.io server
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  
  /**
   * Subscribe to job updates for a specific job ID
   * @param {string} jobId - The job ID to subscribe to
   */
  subscribeToJob(jobId) {
    if (!this.connected || !this.socket) {
      console.warn(`[JobClient] Cannot subscribe to job ${jobId}: not connected`);
      return;
    }
    
    console.log(`[JobClient] Subscribing to job ${jobId}`);
    this.socket.emit('subscribe_job', jobId);
  }
  
  /**
   * Register a callback function for connection event
   * @param {function} callback - Function to call when connected
   */
  onConnect(callback) {
    this._registerCallback('onConnect', callback);
    // If already connected, call the callback immediately
    if (this.connected) callback();
  }
  
  /**
   * Register a callback function for disconnection event
   * @param {function} callback - Function to call when disconnected
   */
  onDisconnect(callback) {
    this._registerCallback('onDisconnect', callback);
  }
  
  /**
   * Register a callback function for initial jobs data
   * @param {function} callback - Function to call with initial jobs
   */
  onInitialJobs(callback) {
    this._registerCallback('onInitialJobs', callback);
  }
  
  /**
   * Register a callback function for job updates
   * @param {function} callback - Function to call with job data
   */
  onJobUpdate(callback) {
    this._registerCallback('onJobUpdate', callback);
  }
  
  /**
   * Register a callback function for job progress updates
   * @param {function} callback - Function to call with progress data
   */
  onJobProgress(callback) {
    this._registerCallback('onJobProgress', callback);
  }
  
  /**
   * Register a callback for a specific event
   * @private
   */
  _registerCallback(event, callback) {
    if (typeof callback !== 'function') {
      throw new Error(`Callback for ${event} must be a function`);
    }
    this.callbacks[event].push(callback);
  }
  
  /**
   * Trigger all callbacks for a specific event
   * @private
   */
  _triggerCallbacks(event, data) {
    const callbacks = this.callbacks[event] || [];
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`[JobClient] Error in ${event} callback:`, err);
      }
    });
  }
}

// If running in a browser, attach to window
if (typeof window !== 'undefined') {
  window.MobileSdJobClient = MobileSdJobClient;
}

// If using CommonJS or ES modules, export the class
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MobileSdJobClient;
} 