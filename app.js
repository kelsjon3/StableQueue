const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const { startDispatcher, stopDispatcher } = require('./services/gradioJobDispatcher');
const { readServersConfig, addServerConfig, updateServerConfig, deleteServerConfig, initializeDataDirectory } = require('./utils/configHelpers');
const { readJobQueue, addJobToQueue, getJobById } = require('./utils/jobQueueHelpers');
const serversRouter = require('./routes/servers');
const resourcesRouter = require('./routes/resources');
const civitaiRouter = require('./routes/civitai');
const generationRouter = require('./routes/generation');
const galleryRouter = require('./routes/gallery');
const modelsRouter = require('./routes/models');
const gradioJobDispatcher = require('./services/gradioJobDispatcher');
const forgeJobMonitor = require('./services/forgeJobMonitor');
const dispatcher = require('./services/dispatcher');
const modelDB = require('./utils/modelDatabase');

// Load environment variables from .env file
dotenv.config();

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

// API routes
app.use('/api/v1/servers', serversRouter);
app.use('/api/v1', resourcesRouter); // Mounts /loras, /checkpoints
app.use('/api/v1/civitai', civitaiRouter);
app.use('/api/v1', generationRouter); // Mounts /generate, /queue/jobs/:jobId/status
app.use('/api/v1/gallery', galleryRouter); // Mount the new gallery routes
app.use('/api/v1', modelsRouter); // Mount the new models routes

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

// Start the server
let server;

initializeDataDirectory();

server = app.listen(PORT, async () => {
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
