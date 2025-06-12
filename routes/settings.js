const express = require('express');
const router = express.Router();
const { readAppSettings, updateAppSetting } = require('../utils/configHelpers');

// GET /api/v1/settings - Get current app settings
router.get('/', async (req, res) => {
  try {
    const settings = await readAppSettings();
    res.json({
      success: true,
      settings: settings
    });
  } catch (error) {
    console.error('Error getting app settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get app settings'
    });
  }
});

// PUT /api/v1/settings/queue-processing - Toggle queue processing
router.put('/queue-processing', async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled must be a boolean value'
      });
    }
    
    const updatedSettings = await updateAppSetting('queueProcessingEnabled', enabled);
    
    res.json({
      success: true,
      message: `Queue processing ${enabled ? 'enabled' : 'disabled'}`,
      settings: updatedSettings
    });
  } catch (error) {
    console.error('Error updating queue processing setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update queue processing setting'
    });
  }
});

// PUT /api/v1/settings - Update multiple settings
router.put('/', async (req, res) => {
  try {
    const updates = req.body;
    
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Request body must be an object'
      });
    }
    
    // Get current settings
    const currentSettings = await readAppSettings();
    
    // Apply updates
    const updatedSettings = { ...currentSettings, ...updates };
    
    // Write back
    const { writeAppSettings } = require('../utils/configHelpers');
    await writeAppSettings(updatedSettings);
    
    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings: updatedSettings
    });
  } catch (error) {
    console.error('Error updating app settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update app settings'
    });
  }
});

module.exports = router; 