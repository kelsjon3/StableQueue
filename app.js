const express = require('express');
const path = require('path');
const fs = require('fs');
const socketIo = require('socket.io');
const http = require('http'); // Add http module for creating server
const { startDispatcher, stopDispatcher } = require('./services/gradioJobDispatcher');
const { readServersConfig, addServerConfig, updateServerConfig, deleteServerConfig, initializeDataDirectory } = require('./utils/configHelpers');
const { readJobQueue, addJobToQueue, getJobById } = require('./utils/jobQueueHelpers');
const { runMigration } = require('./utils/dbMigration'); // Import the database migration function
const { globalRateLimiter } = require('./utils/apiRateLimiter'); // Import global rate limiter
const serversRouter = require('./routes/servers');
const resourcesRouter = require('./routes/resources');
const civitaiRouter = require('./routes/civitai');
const generationRouter = require('./routes/generation');
const v2GenerationRouter = require('./routes/v2Generation'); // Import the new v2 generation router
const apiKeysRouter = require('./routes/apiKeys'); // Import the API keys router
const galleryRouter = require('./routes/gallery');
const modelsRouter = require('./routes/models');
const downloadsRouter = require('./routes/downloads');
const gradioJobDispatcher = require('./services/gradioJobDispatcher');
const forgeJobMonitor = require('./services/forgeJobMonitor');
const dispatcher = require('./services/dispatcher');
const modelDB = require('./utils/modelDatabase');
const jobStatusManager = require('./services/jobStatusManager');
const downloadQueueManager = require('./services/downloadQueueManager');

// Load environment variables from .env file if it exists
try {
  if (fs.existsSync('.env')) {
    require('dotenv').config();
    console.log('Environment variables loaded from .env file');
  }
} catch (error) {
  console.warn('Error loading .env file:', error.message);
}

// Run database migration to ensure schema is up to date
console.log('Running database migration...');
const migrationResult = runMigration({ verbose: process.env.NODE_ENV !== 'production' });
if (!migrationResult.success) {
  console.error('Database migration failed:', migrationResult.message);
  process.exit(1); // Exit if migration fails
} else {
  console.log('Database migration completed successfully');
}

const app = express();

// Environment variables
const PORT = process.env.PORT || 3000;
const STABLE_DIFFUSION_SAVE_PATH = process.env.STABLE_DIFFUSION_SAVE_PATH || './outputs';

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve generated images from the outputs directory
app.use('/outputs', express.static(STABLE_DIFFUSION_SAVE_PATH));

// Apply global rate limiting to all API routes
app.use('/api', globalRateLimiter);

// API routes
app.use('/api/v1/servers', serversRouter);
app.use('/api/v1', resourcesRouter); // Mounts /loras, /checkpoints
app.use('/api/v1', civitaiRouter);
app.use('/api/v1', generationRouter); // Mounts /generate, /queue/jobs/:jobId/status
app.use('/api/v1/gallery', galleryRouter); // Mount the new gallery routes
app.use('/api/v1', modelsRouter); // Mount the new models routes
app.use('/api/v1/downloads', downloadsRouter); // Mount the new downloads routes
app.use('/api/v1/api-keys', apiKeysRouter); // Register API keys router
app.use('/api/v2', v2GenerationRouter); // Register v2 generation router

// Basic status endpoint
app.get('/status', (req, res) => {
    res.status(200).send('MobileSD Server is running');
});

// Serve frontend SPA (ensure this is after API routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the services
async function startServices() {
  console.log('Starting MobileSD services...');
  
  try {
    // Initialize the model database
    console.log('Initializing model database...');
    await modelDB.populateModelCache();
    
    // Initialize the download queue manager
    console.log('Initializing download queue manager...');
    await downloadQueueManager.initialize();
    console.log('Download queue manager initialized.');
    
    // Start job dispatcher
    console.log('Starting job queue dispatcher...');
    gradioJobDispatcher.startDispatcher();
    console.log('Job queue dispatcher started.');
    
    // DISABLE legacy dispatcher - it's causing infinite loops
    console.log('Legacy dispatcher disabled to prevent issues with job processing.');
    
    console.log('All services started.');
  } catch (error) {
    console.error('Error starting services:', error);
  }
}

// Graceful Shutdown Handler
const signals = {
    'SIGHUP': 1,
    'SIGINT': 2,
    'SIGTERM': 15
};

const shutdown = async (signal, value) => {
    console.log(`[App] Received signal ${signal}. Shutting down gracefully...`);
    
    if (typeof stopDispatcher === 'function') {
        console.log('[App] Stopping Gradio Job Dispatcher...');
        stopDispatcher();
    }

    // Close the download queue manager
    if (downloadQueueManager && typeof downloadQueueManager.close === 'function') {
        try {
            await downloadQueueManager.close();
            console.log('[App] Download queue manager closed.');
        } catch (error) {
            console.error('[App] Error closing download queue manager:', error);
        }
    }

    if (readJobQueue && typeof readJobQueue.closeDB === 'function') {
        try {
            await readJobQueue.closeDB();
            console.log('[App] Database connection (via readJobQueue) closed.');
        } catch (dbError) {
            console.error('[App] Error closing database connection (via readJobQueue): ', dbError);
        }
    }

    console.log('[App] MobileSD services stopped. Exiting.');
    process.exit(128 + value);
};

Object.keys(signals).forEach((signal) => {
    process.on(signal, async () => {
        await shutdown(signal, signals[signal]);
    });
});

// Create HTTP server
const server = http.createServer(app);

// Initialize socket.io for job status updates
jobStatusManager.initialize(server);

// Start the server
initializeDataDirectory();

server.listen(PORT, async () => {
  console.log(`MobileSD server listening on port ${PORT}`);
  console.log(`Serving static files from: ${path.join(__dirname, 'public')}`);
  console.log(`Using config directory: ${process.env.CONFIG_DATA_PATH || path.join(__dirname, 'data')}`);
  console.log(`Using LoRA path: ${process.env.LORA_PATH || 'Not Set'}`);
  console.log(`Using Checkpoint path: ${process.env.CHECKPOINT_PATH || 'Not Set'}`);
  console.log(`Using Save path: ${process.env.STABLE_DIFFUSION_SAVE_PATH || 'Not Set'}`);
  
  await startServices();
  
  if (forgeJobMonitor && typeof forgeJobMonitor.reinitializeMonitoring === 'function') {
    console.log('[App] Reinitializing Forge Job Monitor for any processing jobs...');
    forgeJobMonitor.reinitializeMonitoring();
  }
});

module.exports = app;
