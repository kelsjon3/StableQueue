const express = require('express');
const path = require('path');

const app = express();

// Environment variables
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// A simple root route to check if the server is running
// (This will be overridden by index.html from static serving if it exists at the root)
app.get('/status', (req, res) => {
  res.json({ status: 'MobileSD API is running' });
});

// API routes
const serverRoutes = require('./routes/servers');
app.use('/api/v1/servers', serverRoutes);

const generationRoutes = require('./routes/generation');
app.use('/api/v1', generationRoutes); // Contains /generate, /progress

const resourceRoutes = require('./routes/resources');
app.use('/api/v1', resourceRoutes); // Contains /loras, /checkpoints

const civitaiRoutes = require('./routes/civitai');
app.use('/api/v1', civitaiRoutes); // Contains /civitai/image-info, /civitai/download-model

// TODO: Any remaining API routes?

app.listen(PORT, () => {
  console.log(`MobileSD server listening on port ${PORT}`);
});
