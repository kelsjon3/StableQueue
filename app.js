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

// TODO: Add API routes here (e.g., app.use('/api/v1/servers', serverRoutes));

app.listen(PORT, () => {
  console.log(`MobileSD server listening on port ${PORT}`);
});
