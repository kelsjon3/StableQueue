const fs = require('fs').promises;
const path = require('path');

// Helper function to get the path to servers.json
const getConfigFilePath = () => {
  const configDataPath = process.env.CONFIG_DATA_PATH;
  if (!configDataPath) {
    console.error('ERROR: CONFIG_DATA_PATH environment variable is not set.');
    // Fallback for local dev if not set, but Docker setup must provide it.
    // Consider throwing an error here if it's absolutely required for the app to function.
    return path.join(__dirname, '../data/servers.json'); 
  }
  return path.join(configDataPath, 'servers.json');
};

// Helper function to get the path to app-settings.json
const getAppSettingsFilePath = () => {
  const configDataPath = process.env.CONFIG_DATA_PATH;
  if (!configDataPath) {
    return path.join(__dirname, '../data/app-settings.json');
  }
  return path.join(configDataPath, 'app-settings.json');
};

// Helper function to read server configurations
const readServersConfig = async () => {
  const filePath = getConfigFilePath();
  try {
    await fs.access(filePath); // Check if file exists
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('servers.json not found, returning empty array.');
      return [];
    }
    console.error('Error reading servers configuration:', error);
    throw error;
  }
};

// Helper function to write server configurations
const writeServersConfig = async (config) => {
  const filePath = getConfigFilePath();
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing servers configuration:', error);
    throw error;
  }
};

// Helper function to get a specific server's config by its alias
const getServerByAlias = async (alias) => {
  const servers = await readServersConfig();
  const server = servers.find(s => s.alias === alias);
  return server; // Returns the server object or undefined if not found
};

// Helper function to get Axios config, including basic auth if needed
const getAxiosConfig = (server) => {
  const config = {};
  if (server.username && server.password) {
    const credentials = Buffer.from(`${server.username}:${server.password}`).toString('base64');
    config.headers = {
      'Authorization': `Basic ${credentials}`
    };
  }
  // Add other default headers if necessary, e.g., Content-Type
  // config.headers = { ...config.headers, 'Content-Type': 'application/json' };
  return config;
};

// --- Model Scanning Helpers --- 

const VALID_MODEL_EXTENSIONS = ['.safetensors', '.pt', '.ckpt']; // Add other relevant extensions if needed
const METADATA_EXT = '.civitai.json';

// Base path for model scanning - used to calculate relative paths if needed
// This assumes your LORA_PATH and CHECKPOINT_PATH are somewhere like /mnt/user/models/Lora, /mnt/user/models/Stable-diffusion
// And you want relative paths like "MyCollection/model.safetensors" instead of just "model.safetensors"
// For simplicity, let's assume the .../models/ part is the base. This might need adjustment based on actual paths.
// Or, we pass the specific model type base path (LORA_PATH, CHECKPOINT_PATH) to calculate relative path from there.

// Helper function to scan a directory for models and their metadata
const scanModelDirectory = async (directoryPath, fileExtensions, rootModelPath) => {
  const models = [];
  try {
    const dirents = await fs.readdir(directoryPath, { withFileTypes: true });
    for (const dirent of dirents) {
      const fullPath = path.join(directoryPath, dirent.name);
      if (dirent.isDirectory()) {
        // Recursively scan subdirectories
        const subModels = await scanModelDirectory(fullPath, fileExtensions, rootModelPath);
        models.push(...subModels);
      } else if (dirent.isFile() && fileExtensions.some(ext => dirent.name.toLowerCase().endsWith(ext))) {
        let modelInfo = {
          filename: dirent.name,
          // Calculate relative path from the rootModelPath (e.g., LORA_PATH or CHECKPOINT_PATH)
          // to the directory containing the model file.
          // Example: if root is /models/Lora and file is /models/Lora/Sub/model.safetensors, relPath is "Sub"
          // if file is /models/Lora/model.safetensors, relPath is "."
          relativePath: path.relative(rootModelPath, directoryPath)
        };

        // Try to find and read associated metadata files
        const baseName = dirent.name.substring(0, dirent.name.lastIndexOf('.'));
        
        // Check for preview image - only look for the consistent naming pattern
        const previewPath = path.join(directoryPath, `${baseName}.preview.jpeg`);

        // First try Forge-style JSON (modelname.json)
        const forgeJsonPath = path.join(directoryPath, `${baseName}.json`);
        try {
          const jsonData = await fs.readFile(forgeJsonPath, 'utf-8');
          const parsedJson = JSON.parse(jsonData);
          // Only merge if it contains actual model metadata
          if (parsedJson.modelId || parsedJson.model?.id || parsedJson.name || parsedJson.description) {
          modelInfo = { ...modelInfo, ...parsedJson }; // Merge JSON data
            modelInfo._metadata_source = 'forge';
          }
        } catch (jsonError) {
          // Forge JSON not found, try Civitai format
          const civitaiJsonPath = path.join(directoryPath, `${baseName}.civitai.json`);
          try {
            const jsonData = await fs.readFile(civitaiJsonPath, 'utf-8');
            const parsedJson = JSON.parse(jsonData);
            modelInfo = { ...modelInfo, ...parsedJson }; // Merge JSON data
            modelInfo._metadata_source = 'civitai';
          } catch (civitaiError) {
            // No JSON metadata found, will rely on embedded metadata during scan
            modelInfo._metadata_source = 'none';
          }
        }
        
        // Check if the consistent preview file exists
        try {
          await fs.access(previewPath);
          modelInfo.previewAvailable = true;
          modelInfo.previewPath = previewPath; // Store full path for database
        } catch (err) {
          modelInfo.previewAvailable = false;
          modelInfo.previewPath = null;
        }

        models.push(modelInfo);
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${directoryPath}:`, error);
    // If a specific directory is inaccessible, we might want to skip it rather than failing all
    // For now, it will propagate up if it's a critical error for the initial path
  }
  return models;
};

// --- New function to ensure data directory exists ---
const initializeDataDirectory = async () => {
  const configPath = process.env.CONFIG_DATA_PATH || path.join(__dirname, '../data');
  try {
    await fs.mkdir(configPath, { recursive: true });
    console.log(`Data directory ensured at: ${configPath}`);
    // Optionally, ensure subdirectories like outputs if they are relative to data path
    // const outputPath = process.env.STABLE_DIFFUSION_SAVE_PATH || path.join(configPath, 'outputs');
    // await fs.mkdir(outputPath, { recursive: true });
    // console.log(`Outputs directory ensured at: ${outputPath}`);

  } catch (error) {
    console.error(`Error ensuring data directory ${configPath}:`, error);
    // Depending on the importance, you might want to throw the error or handle it
    // For now, just logging, as subsequent operations might still work or fail more specifically
  }
};

// Helper function to read app settings
const readAppSettings = async () => {
  const filePath = getAppSettingsFilePath();
  try {
    await fs.access(filePath); // Check if file exists
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('app-settings.json not found, returning default settings.');
      // Return default settings
      const defaultSettings = {
        queueProcessingEnabled: true,
        lastUpdated: new Date().toISOString()
      };
      await writeAppSettings(defaultSettings); // Create the file with defaults
      return defaultSettings;
    }
    console.error('Error reading app settings:', error);
    throw error;
  }
};

// Helper function to write app settings
const writeAppSettings = async (settings) => {
  const filePath = getAppSettingsFilePath();
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Add lastUpdated timestamp
    const settingsWithTimestamp = {
      ...settings,
      lastUpdated: new Date().toISOString()
    };
    await fs.writeFile(filePath, JSON.stringify(settingsWithTimestamp, null, 2), 'utf-8');
    console.log(`[Settings] App settings updated: queueProcessingEnabled=${settingsWithTimestamp.queueProcessingEnabled}`);
  } catch (error) {
    console.error('Error writing app settings:', error);
    throw error;
  }
};

// Helper function to update specific app setting
const updateAppSetting = async (key, value) => {
  const currentSettings = await readAppSettings();
  currentSettings[key] = value;
  await writeAppSettings(currentSettings);
  return currentSettings;
};

// Helper function to check if queue processing is enabled
const isQueueProcessingEnabled = async () => {
  try {
    const settings = await readAppSettings();
    return settings.queueProcessingEnabled !== false; // Default to true if not set
  } catch (error) {
    console.error('Error checking queue processing status:', error);
    return true; // Default to enabled on error
  }
};

// --- Exports --- 

module.exports = {
  getConfigFilePath,
  readServersConfig,
  writeServersConfig,
  scanModelDirectory,
  getServerByAlias,
  getAxiosConfig,
  initializeDataDirectory,
  readAppSettings,
  writeAppSettings,
  updateAppSetting,
  isQueueProcessingEnabled,
}; 