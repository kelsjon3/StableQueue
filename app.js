const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const { startDispatcher, stopDispatcher } = require('./services/dispatcher');
const { initializeConfig, readServersConfig, addServerConfig, updateServerConfig, deleteServerConfig } = require('./utils/configHelpers');
const { initializeJobQueue, readJobQueue, addJobToQueue, getJobById } = require('./utils/jobQueueHelpers');
const serversRouter = require('./routes/servers');
const resourcesRouter = require('./routes/resources');
const civitaiRouter = require('./routes/civitai');
const generationRouter = require('./routes/generation');

// Load environment variables from .env file
dotenv.config();

const app = express();

// Environment variables
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/v1/servers', serversRouter);
app.use('/api/v1', resourcesRouter); // Mounts /loras, /checkpoints
app.use('/api/v1/civitai', civitaiRouter);
app.use('/api/v1', generationRouter); // Mounts /generate, /queue/jobs/:jobId/status

// Basic status endpoint
app.get('/status', (req, res) => {
    res.status(200).send('MobileSD Server is running');
});

// Serve frontend SPA (ensure this is after API routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`MobileSD server listening on port ${PORT}`);
  console.log(`Serving static files from: ${path.join(__dirname, 'public')}`);
  console.log(`Using config directory: ${process.env.CONFIG_DATA_PATH || path.join(__dirname, 'data')}`);
  console.log(`Using LoRA path: ${process.env.LORA_PATH || 'Not Set'}`);
  console.log(`Using Checkpoint path: ${process.env.CHECKPOINT_PATH || 'Not Set'}`);
  console.log(`Using Save path: ${process.env.STABLE_DIFFUSION_SAVE_PATH || 'Not Set'}`);

  // Start the background dispatcher
  startDispatcher();
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('SIGINT signal received: closing HTTP server and stopping services');
    stopDispatcher();
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server and stopping services');
    stopDispatcher();
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
