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

// --- Model Scanning Helpers --- 

const VALID_MODEL_EXTENSIONS = ['.safetensors', '.pt', '.ckpt']; // Add other relevant extensions if needed
const METADATA_EXT = '.civitai.json';

// Helper function to scan a directory for models and their metadata
const scanModelDirectory = async (directoryPath) => {
  if (!directoryPath) {
    console.warn('WARN: Model directory path environment variable not set.');
    return []; // Return empty if the path isn't configured
  }

  try {
    // Check if directory exists
    await fs.access(directoryPath);

    const dirents = await fs.readdir(directoryPath, { withFileTypes: true });
    const modelFiles = dirents
      .filter(dirent => dirent.isFile() && VALID_MODEL_EXTENSIONS.includes(path.extname(dirent.name).toLowerCase()))
      .map(dirent => dirent.name);

    const results = [];
    for (const modelFile of modelFiles) {
      const baseName = path.basename(modelFile, path.extname(modelFile));
      const metadataPath = path.join(directoryPath, baseName + METADATA_EXT);
      let metadata = {};

      try {
        await fs.access(metadataPath);
        const metadataContent = await fs.readFile(metadataPath, 'utf-8');
        const parsedJson = JSON.parse(metadataContent);
        metadata.civitaiModelId = parsedJson?.modelId?.toString() || null;
        metadata.civitaiModelVersionId = parsedJson?.id?.toString() || parsedJson?.modelVersionId?.toString() || null;
      } catch (metaError) {
        if (metaError.code !== 'ENOENT') {
          console.warn(`WARN: Could not read or parse metadata for ${modelFile}:`, metaError.message);
        }
        metadata.civitaiModelId = null;
        metadata.civitaiModelVersionId = null;
      }

      results.push({
        name: modelFile,
        ...metadata
      });
    }
    
    results.sort((a, b) => a.name.localeCompare(b.name));
    
    return results;

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`WARN: Model directory not found: ${directoryPath}`);
      return [];
    } else if (error.code === 'EACCES') {
       console.error(`ERROR: Permission denied reading directory: ${directoryPath}`);
       throw new Error(`Permission denied accessing model directory: ${directoryPath}`);
    }
    console.error(`Error scanning model directory ${directoryPath}:`, error);
    throw error;
  }
};

// --- Exports --- 

module.exports = {
  getConfigFilePath,
  readServersConfig,
  writeServersConfig,
  scanModelDirectory,
}; 