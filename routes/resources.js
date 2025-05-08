const express = require('express');
const {
  scanModelDirectory
} = require('../utils/configHelpers'); // Adjusted path

const router = express.Router();

const LORA_EXTENSIONS = ['.safetensors', '.pt', '.ckpt']; // Common LoRA extensions
const CHECKPOINT_EXTENSIONS = ['.safetensors', '.pt', '.ckpt']; // Common Checkpoint extensions

// GET /api/v1/loras - List available LoRAs
router.get('/loras', async (req, res) => {
  const loraPath = process.env.LORA_PATH;
  if (!loraPath) {
    return res.status(500).json({ message: 'LORA_PATH environment variable is not set.' });
  }
  try {
    // Pass LORA_PATH as the rootModelPath for relative path calculation
    const loras = await scanModelDirectory(loraPath, LORA_EXTENSIONS, loraPath);
    res.json(loras);
  } catch (error) {
    console.error('Error retrieving LoRAs:', error);
    res.status(500).json({ message: 'Failed to retrieve LoRAs.', error: error.message });
  }
});

// GET /api/v1/checkpoints - List available Checkpoints
router.get('/checkpoints', async (req, res) => {
  const checkpointPath = process.env.CHECKPOINT_PATH;
  if (!checkpointPath) {
    return res.status(500).json({ message: 'CHECKPOINT_PATH environment variable is not set.' });
  }
  try {
    // Pass CHECKPOINT_PATH as the rootModelPath for relative path calculation
    const checkpoints = await scanModelDirectory(checkpointPath, CHECKPOINT_EXTENSIONS, checkpointPath);
    res.json(checkpoints);
  } catch (error) {
    console.error('Error retrieving Checkpoints:', error);
    res.status(500).json({ message: 'Failed to retrieve Checkpoints.', error: error.message });
  }
});

module.exports = router; 