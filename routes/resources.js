const express = require('express');
const { scanModelDirectory } = require('../utils/configHelpers'); // Import shared helper

const router = express.Router();

// Constants and scanModelDirectory helper function moved to utils/configHelpers.js

// GET /api/v1/loras - List available LoRA models
router.get('/loras', async (req, res) => {
  try {
    const loras = await scanModelDirectory(process.env.LORA_PATH);
    res.json(loras);
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve LoRA list.', error: error.message });
  }
});

// GET /api/v1/checkpoints - List available checkpoint models
router.get('/checkpoints', async (req, res) => {
  try {
    const checkpoints = await scanModelDirectory(process.env.CHECKPOINT_PATH);
    res.json(checkpoints);
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve checkpoint list.', error: error.message });
  }
});

module.exports = router; 