/**
 * Model Database - SQLite schema and functions for model management
 * Handles storing, querying, and matching checkpoint and LoRA models
 */

const path = require('path');
const fsPromises = require('fs').promises;
const fs = require('fs');
const Database = require('better-sqlite3');

// --- Database Setup ---
// Use the same data directory as the job queue
const projectRootDir = path.join(__dirname, '..'); 
const dataDir = path.join(projectRootDir, 'data');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'mobilesd_models.sqlite');
const db = new Database(dbPath);

// --- Schema Initialization ---
const schema = `
-- Models table for storing checkpoint and LoRA information
CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('checkpoint', 'lora')),
    local_path TEXT NOT NULL,
    filename TEXT NOT NULL,
    hash TEXT,
    civitai_id TEXT,
    civitai_version_id TEXT,
    forge_format TEXT,
    last_used TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Model aliases for alternative paths and matching
CREATE TABLE IF NOT EXISTS model_aliases (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL,
    alias_path TEXT NOT NULL,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_models_type_filename ON models (type, filename);
CREATE INDEX IF NOT EXISTS idx_models_civitai_ids ON models (civitai_id, civitai_version_id);
CREATE INDEX IF NOT EXISTS idx_model_aliases_path ON model_aliases (alias_path);
`;

// Initialize the database
function initializeDatabase() {
    db.exec(schema);
    console.log("[ModelDB] Database schema initialized");
}

// In-memory cache for fast lookups
const modelMappingCache = new Map();

/**
 * Add a model to the database
 * @param {Object} model - Model information
 * @param {string} model.name - User-friendly name (often path)
 * @param {string} model.type - Type of model ('checkpoint' or 'lora')
 * @param {string} model.local_path - Directory containing the model
 * @param {string} model.filename - Filename of the model
 * @param {string} [model.hash] - Optional hash for the model
 * @param {string} [model.civitai_id] - Optional Civitai model ID
 * @param {string} [model.civitai_version_id] - Optional Civitai version ID
 * @param {string} [model.forge_format] - Format used by Forge (with hash)
 * @returns {number} ID of the inserted or updated model
 */
function addOrUpdateModel(model) {
    try {
        // Check if model exists by filename and path
        const existing = db.prepare('SELECT id FROM models WHERE filename = ? AND local_path = ?')
            .get(model.filename, model.local_path);
        
        let modelId;
        
        if (existing) {
            // Update existing model
            const updateStmt = db.prepare(`
                UPDATE models SET 
                name = ?, 
                hash = COALESCE(?, hash), 
                civitai_id = COALESCE(?, civitai_id),
                civitai_version_id = COALESCE(?, civitai_version_id),
                forge_format = COALESCE(?, forge_format),
                last_used = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            updateStmt.run(
                model.name,
                model.hash || null,
                model.civitai_id || null,
                model.civitai_version_id || null,
                model.forge_format || null,
                existing.id
            );
            
            modelId = existing.id;
            
            // Clear existing aliases
            db.prepare('DELETE FROM model_aliases WHERE model_id = ?').run(modelId);
        } else {
            // Insert new model
            const insertStmt = db.prepare(`
                INSERT INTO models (
                    name, type, local_path, filename, hash, 
                    civitai_id, civitai_version_id, forge_format, last_used
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            
            const info = insertStmt.run(
                model.name,
                model.type,
                model.local_path,
                model.filename,
                model.hash || null,
                model.civitai_id || null,
                model.civitai_version_id || null,
                model.forge_format || null
            );
            
            modelId = info.lastInsertRowid;
        }
        
        // Add standard aliases
        const aliasStmt = db.prepare('INSERT INTO model_aliases (model_id, alias_path) VALUES (?, ?)');
        
        // Original name/path
        aliasStmt.run(modelId, model.name);
        
        // Forward slashes version
        aliasStmt.run(modelId, model.name.replace(/\\/g, '/'));
        
        // Backslashes version
        aliasStmt.run(modelId, model.name.replace(/\//g, '\\'));
        
        // Filename only
        aliasStmt.run(modelId, model.filename);
        
        // Full path variations
        const fullPath = path.join(model.local_path, model.filename);
        aliasStmt.run(modelId, fullPath);
        aliasStmt.run(modelId, fullPath.replace(/\\/g, '/'));
        aliasStmt.run(modelId, fullPath.replace(/\//g, '\\'));
        
        return modelId;
    } catch (error) {
        console.error('[ModelDB] Error adding/updating model:', error);
        throw error;
    }
}

/**
 * Find a model using various matching strategies
 * @param {string} modelPath - Path or name to match
 * @param {string} [type] - Optional type filter ('checkpoint' or 'lora')
 * @returns {Object|null} The matched model or null if not found
 */
function findModel(modelPath, type = null) {
    try {
        // Try exact matches first (using aliases)
        const aliasQuery = type 
            ? 'SELECT m.* FROM models m JOIN model_aliases a ON m.id = a.model_id WHERE a.alias_path = ? AND m.type = ?'
            : 'SELECT m.* FROM models m JOIN model_aliases a ON m.id = a.model_id WHERE a.alias_path = ?';
        
        const aliasParams = type ? [modelPath, type] : [modelPath];
        const byAlias = db.prepare(aliasQuery).get(...aliasParams);
        
        if (byAlias) return byAlias;
        
        // Try basename matching if no alias match
        const filename = path.basename(modelPath);
        const filenameQuery = type
            ? 'SELECT * FROM models WHERE filename = ? AND type = ? ORDER BY last_used DESC LIMIT 1'
            : 'SELECT * FROM models WHERE filename = ? ORDER BY last_used DESC LIMIT 1';
        
        const filenameParams = type ? [filename, type] : [filename];
        const byFilename = db.prepare(filenameQuery).get(...filenameParams);
        
        if (byFilename) return byFilename;
        
        // No matches found
        return null;
    } catch (error) {
        console.error('[ModelDB] Error finding model:', error);
        return null;
    }
}

/**
 * Get all models from the database
 * @param {string} [type] - Optional type filter ('checkpoint' or 'lora')
 * @returns {Array} List of models
 */
function getAllModels(type = null) {
    try {
        const query = type
            ? 'SELECT * FROM models WHERE type = ? ORDER BY name'
            : 'SELECT * FROM models ORDER BY type, name';
        
        const params = type ? [type] : [];
        return db.prepare(query).all(...params);
    } catch (error) {
        console.error('[ModelDB] Error getting all models:', error);
        return [];
    }
}

/**
 * Populate the model cache from database for fast lookups
 */
function populateModelCache() {
    try {
        const models = db.prepare(`
            SELECT m.id, m.name, m.local_path, m.filename, m.forge_format, a.alias_path 
            FROM models m 
            JOIN model_aliases a ON m.id = a.model_id
        `).all();
        
        modelMappingCache.clear();
        
        for (const model of models) {
            const forgeTitle = model.forge_format || path.join(model.local_path, model.filename);
            modelMappingCache.set(model.alias_path, { 
                id: model.id, 
                name: model.name, 
                forgeTitle: forgeTitle
            });
        }
        
        console.log(`[ModelDB] Populated model cache with ${modelMappingCache.size} entries`);
    } catch (error) {
        console.error('[ModelDB] Error populating model cache:', error);
    }
}

/**
 * Find a model using the in-memory cache
 * @param {string} modelPath - Path to match
 * @returns {Object|null} The matched model or null if not found
 */
function findModelFast(modelPath) {
    // Try exact match
    if (modelMappingCache.has(modelPath)) {
        return modelMappingCache.get(modelPath);
    }
    
    // Try forward slashes
    const forwardSlash = modelPath.replace(/\\/g, '/');
    if (modelMappingCache.has(forwardSlash)) {
        return modelMappingCache.get(forwardSlash);
    }
    
    // Try backslashes
    const backSlash = modelPath.replace(/\//g, '\\');
    if (modelMappingCache.has(backSlash)) {
        return modelMappingCache.get(backSlash);
    }
    
    // Try just the filename
    const filename = path.basename(modelPath);
    if (modelMappingCache.has(filename)) {
        return modelMappingCache.get(filename);
    }
    
    return null;
}

/**
 * Import models from Forge server response
 * @param {Array} forgeModels - Array of models from Forge API
 * @param {string} type - Model type ('checkpoint' or 'lora')
 */
function importModelsFromForge(forgeModels, type = 'checkpoint') {
    try {
        const transaction = db.transaction(() => {
            for (const model of forgeModels) {
                if (!model.title) continue;
                
                // Extract the name part and hash
                const titleParts = model.title.split(' [');
                const namePart = titleParts[0];
                const hash = titleParts.length > 1 ? titleParts[1].replace(']', '') : null;
                
                const filename = path.basename(namePart);
                const localPath = path.dirname(namePart);
                
                // Add or update the model
                addOrUpdateModel({
                    name: namePart,
                    type: type,
                    local_path: localPath,
                    filename: filename,
                    hash: hash,
                    forge_format: model.title
                });
            }
        });
        
        transaction();
        console.log(`[ModelDB] Imported ${forgeModels.length} ${type} models from Forge`);
        
        // Refresh the cache
        populateModelCache();
    } catch (error) {
        console.error('[ModelDB] Error importing models from Forge:', error);
    }
}

// Initialize the database on module load
initializeDatabase();

module.exports = {
    addOrUpdateModel,
    findModel,
    findModelFast,
    getAllModels,
    populateModelCache,
    importModelsFromForge
}; 