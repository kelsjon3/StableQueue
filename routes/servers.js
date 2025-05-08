const express = require('express');
const {
  readServersConfig,
  writeServersConfig
} = require('../utils/configHelpers'); // Adjusted path

const router = express.Router();

// Helper functions (getConfigFilePath, readServersConfig, writeServersConfig) are now in ../utils/configHelpers.js

// --- API Endpoints ---

// GET /api/v1/servers - List all saved server configurations
router.get('/', async (req, res) => {
  try {
    const servers = await readServersConfig();
    res.json(servers);
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve server configurations.', error: error.message });
  }
});

// POST /api/v1/servers - Add a new server configuration
router.post('/', async (req, res) => {
  try {
    const { alias, apiUrl, auth } = req.body;
    if (!alias || !apiUrl) {
      return res.status(400).json({ message: 'Missing required fields: alias and apiUrl.' });
    }

    const servers = await readServersConfig();
    if (servers.find(s => s.alias === alias)) {
      return res.status(400).json({ message: `Server with alias '${alias}' already exists.` });
    }

    const newServer = { alias, apiUrl, auth: auth || null }; // Ensure auth is null if not provided
    servers.push(newServer);
    await writeServersConfig(servers);
    res.status(201).json({ message: 'Server configuration added successfully.', server: newServer });
  } catch (error) {
    res.status(500).json({ message: 'Failed to add server configuration.', error: error.message });
  }
});

// GET /api/v1/servers/:alias - Get a specific server configuration by alias
router.get('/:alias', async (req, res) => {
  try {
    const servers = await readServersConfig();
    const server = servers.find(s => s.alias === req.params.alias);
    if (server) {
      res.json(server);
    } else {
      res.status(404).json({ message: 'Server configuration not found.' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve server configuration.', error: error.message });
  }
});

// PUT /api/v1/servers/:alias - Update a server configuration
router.put('/:alias', async (req, res) => {
  try {
    const newAlias = req.body.alias; // Get the new alias from the body
    const { apiUrl, authUser, authPass } = req.body; // Get other fields, matching client
    const originalAlias = req.params.alias; // The alias used to identify the server in the URL

    if (!newAlias || !apiUrl) {
      return res.status(400).json({ message: 'Missing required fields: alias and apiUrl.' });
    }

    let servers = await readServersConfig();
    const serverIndex = servers.findIndex(s => s.alias === originalAlias);

    if (serverIndex === -1) {
      return res.status(404).json({ message: 'Server configuration not found to update.' });
    }

    // If alias is being changed, check if the new alias already exists (and isn't the current server)
    if (newAlias !== originalAlias && servers.some(s => s.alias === newAlias)) {
      return res.status(400).json({ message: `Another server with alias '${newAlias}' already exists.` });
    }

    // Update the server details
    servers[serverIndex] = {
      alias: newAlias, // Use the new alias from the body
      apiUrl,
      // Store authUser and authPass; store as undefined if empty string from form so they might be omitted or set to null
      authUser: authUser || undefined, 
      authPass: authPass || undefined,
    };
    
    // Clean up undefined auth properties to ensure they are omitted or null if not provided
    if (servers[serverIndex].authUser === undefined) delete servers[serverIndex].authUser;
    if (servers[serverIndex].authPass === undefined) delete servers[serverIndex].authPass;

    await writeServersConfig(servers);
    res.json({ message: 'Server configuration updated successfully.', server: servers[serverIndex] });
  } catch (error) {
    console.error('Error updating server configuration:', error);
    res.status(500).json({ message: 'Failed to update server configuration.', error: error.message });
  }
});

// DELETE /api/v1/servers/:alias - Delete a server configuration
router.delete('/:alias', async (req, res) => {
  try {
    const aliasToDelete = req.params.alias;
    let servers = await readServersConfig();
    const filteredServers = servers.filter(s => s.alias !== aliasToDelete);

    if (servers.length === filteredServers.length) {
      return res.status(404).json({ message: 'Server configuration not found to delete.' });
    }

    await writeServersConfig(filteredServers);
    res.json({ message: 'Server configuration deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete server configuration.', error: error.message });
  }
});

module.exports = router; 