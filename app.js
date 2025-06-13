const express = require('express');
const path = require('path');
const fs = require('fs');
const socketIo = require('socket.io');
const http = require('http');
const { startDispatcher, stopDispatcher } = require('./services/gradioJobDispatcher');
const { readServersConfig, addServerConfig, updateServerConfig, deleteServerConfig, initializeDataDirectory } = require('./utils/configHelpers');
const { readJobQueue, addJobToQueue, getJobById } = require('./utils/jobQueueHelpers');
const { runMigration } = require('./utils/dbMigration');
const { globalRateLimiter } = require('./utils/apiRateLimiter');
const serversRouter = require('./routes/servers');
const resourcesRouter = require('./routes/resources');
const generationRouter = require('./routes/generation');
const v2GenerationRouter = require('./routes/v2Generation');
const apiKeysRouter = require('./routes/apiKeys');
const galleryRouter = require('./routes/gallery');
const settingsRouter = require('./routes/settings');
const forgeJobMonitor = require('./services/forgeJobMonitor');
const jobStatusManager = require('./services/jobStatusManager');
const modelsRouter = require('./routes/models');

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
  process.exit(1);
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
app.use('/api/v1', resourcesRouter);
app.use('/api/v1', generationRouter);
app.use('/api/v1/gallery', galleryRouter);
app.use('/api/v1/api-keys', apiKeysRouter);
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v2', v2GenerationRouter);
app.use('/api/v1', modelsRouter);

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
  console.log('Starting StableQueue services...');
  
  try {
    console.log('Starting job queue dispatcher...');
    startDispatcher();
    console.log('Job queue dispatcher started successfully.');
    
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
        console.log('[App] Stopping job dispatcher...');
        stopDispatcher();
    }

    if (readJobQueue && typeof readJobQueue.closeDB === 'function') {
        try {
            await readJobQueue.closeDB();
            console.log('[App] Database connection closed.');
        } catch (dbError) {
            console.error('[App] Error closing database connection:', dbError);
        }
    }

    console.log('[App] StableQueue services stopped. Exiting.');
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
  console.log(`StableQueue server listening on port ${PORT}`);
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
