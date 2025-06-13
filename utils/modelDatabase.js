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
    civitai_id TEXT,
    civitai_version_id TEXT,
    forge_format TEXT,
    hash_autov2 TEXT,
    hash_sha256 TEXT,
    civitai_model_name TEXT,
    civitai_model_base TEXT,
    civitai_model_type TEXT,
    civitai_model_version_name TEXT,
    civitai_model_version_desc TEXT,
    civitai_model_version_date TEXT,
    civitai_download_url TEXT,
    civitai_trained_words TEXT,
    civitai_file_size_kb INTEGER,
    metadata_status TEXT NOT NULL DEFAULT 'incomplete' CHECK (metadata_status IN ('complete', 'incomplete', 'error')),
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

-- Model server availability tracking
CREATE TABLE IF NOT EXISTS model_server_availability (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL,
    server_id TEXT NOT NULL,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    UNIQUE(model_id, server_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_models_type_filename ON models (type, filename);
CREATE INDEX IF NOT EXISTS idx_models_civitai_ids ON models (civitai_id, civitai_version_id);
CREATE INDEX IF NOT EXISTS idx_model_aliases_path ON model_aliases (alias_path);
CREATE INDEX IF NOT EXISTS idx_models_metadata_status ON models (metadata_status);
CREATE INDEX IF NOT EXISTS idx_models_hashes ON models (hash_autov2, hash_sha256);
CREATE INDEX IF NOT EXISTS idx_model_server_availability ON model_server_availability (model_id, server_id);
`;

// Initialize the database
function initializeDatabase() {
    db.exec(schema);
    console.log("[ModelDB] Database schema initialized");
}

// @deprecated - In-memory cache no longer used with civitai_version_id only matching
// const modelMappingCache = new Map();

/**
 * Add a model to the database
 * @param {Object} model - Model information
 * @param {string} model.name - User-friendly name (often path)
 * @param {string} model.type - Type of model ('checkpoint' or 'lora')
 * @param {string} model.local_path - Directory containing the model
 * @param {string} model.filename - Filename of the model
 * @param {string} [model.hash_autov2] - AUTOV2 hash
 * @param {string} [model.hash_sha256] - SHA256 hash
 * @param {string} [model.civitai_id] - Civitai model ID
 * @param {string} [model.civitai_version_id] - Civitai version ID (REQUIRED for matching)
 * @param {string} [model.forge_format] - Format used by Forge (with hash)
 * @param {string} [model.civitai_model_name] - Civitai model name
 * @param {string} [model.civitai_model_base] - Civitai base model
 * @param {string} [model.civitai_model_type] - Civitai model type
 * @param {string} [model.civitai_model_version_name] - Civitai model version name
 * @param {string} [model.civitai_model_version_desc] - Civitai model version description
 * @param {string} [model.civitai_model_version_date] - Civitai model version creation date
 * @param {string} [model.civitai_download_url] - Civitai download URL
 * @param {string} [model.civitai_trained_words] - Civitai trained words (JSON array)
 * @param {number} [model.civitai_file_size_kb] - Civitai file size in KB
 * @returns {number} ID of the inserted or updated model
 */
function addOrUpdateModel(model) {
    try {
        // Check if model exists by civitai_version_id (primary identifier)
        const existing = model.civitai_version_id ? 
            db.prepare('SELECT id FROM models WHERE civitai_version_id = ?').get(model.civitai_version_id) :
            db.prepare('SELECT id FROM models WHERE filename = ? AND local_path = ?').get(model.filename, model.local_path);
        
        let modelId;
        
        if (existing) {
            // Update existing model
            const updateStmt = db.prepare(`
                UPDATE models SET 
                name = ?, 
                civitai_id = COALESCE(?, civitai_id),
                civitai_version_id = COALESCE(?, civitai_version_id),
                forge_format = COALESCE(?, forge_format),
                hash_autov2 = COALESCE(?, hash_autov2),
                hash_sha256 = COALESCE(?, hash_sha256),
                civitai_model_name = COALESCE(?, civitai_model_name),
                civitai_model_base = COALESCE(?, civitai_model_base),
                civitai_model_type = COALESCE(?, civitai_model_type),
                civitai_model_version_name = COALESCE(?, civitai_model_version_name),
                civitai_model_version_desc = COALESCE(?, civitai_model_version_desc),
                civitai_model_version_date = COALESCE(?, civitai_model_version_date),
                civitai_download_url = COALESCE(?, civitai_download_url),
                civitai_trained_words = COALESCE(?, civitai_trained_words),
                civitai_file_size_kb = COALESCE(?, civitai_file_size_kb),
                last_used = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            updateStmt.run(
                model.name,
                model.civitai_id || null,
                model.civitai_version_id || null,
                model.forge_format || null,
                model.hash_autov2 || null,
                model.hash_sha256 || null,
                model.civitai_model_name || null,
                model.civitai_model_base || null,
                model.civitai_model_type || null,
                model.civitai_model_version_name || null,
                model.civitai_model_version_desc || null,
                model.civitai_model_version_date || null,
                model.civitai_download_url || null,
                model.civitai_trained_words || null,
                model.civitai_file_size_kb || null,
                existing.id
            );
            
            modelId = existing.id;
        } else {
            // Insert new model
            const insertStmt = db.prepare(`
                INSERT INTO models (
                    name, type, local_path, filename, civitai_id, civitai_version_id, forge_format, hash_autov2, hash_sha256, civitai_model_name, civitai_model_base, civitai_model_type, civitai_model_version_name, civitai_model_version_desc, civitai_model_version_date, civitai_download_url, civitai_trained_words, civitai_file_size_kb, last_used
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            
            const info = insertStmt.run(
                model.name,
                model.type,
                model.local_path,
                model.filename,
                model.civitai_id || null,
                model.civitai_version_id || null,
                model.forge_format || null,
                model.hash_autov2 || null,
                model.hash_sha256 || null,
                model.civitai_model_name || null,
                model.civitai_model_base || null,
                model.civitai_model_type || null,
                model.civitai_model_version_name || null,
                model.civitai_model_version_desc || null,
                model.civitai_model_version_date || null,
                model.civitai_download_url || null,
                model.civitai_trained_words || null,
                model.civitai_file_size_kb || null
            );
            
            modelId = info.lastInsertRowid;
        }
        
        return modelId;
    } catch (error) {
        console.error('[ModelDB] Error adding/updating model:', error);
        throw error;
    }
}

/**
 * Find a model using civitai_version_id only
 * @param {string} civitaiVersionId - Civitai version ID to match
 * @param {string} [type] - Optional type filter ('checkpoint' or 'lora')
 * @returns {Object|null} The matched model or null if not found
 */
function findModel(civitaiVersionId, type = null) {
    try {
        if (!civitaiVersionId) {
            return null;
        }

        // Only match by civitai_version_id
        const query = type 
            ? 'SELECT * FROM models WHERE civitai_version_id = ? AND type = ? LIMIT 1'
            : 'SELECT * FROM models WHERE civitai_version_id = ? LIMIT 1';
        
        const params = type ? [civitaiVersionId, type] : [civitaiVersionId];
        const result = db.prepare(query).get(...params);
        
        return result || null;
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
 * @deprecated - No longer needed with simplified civitai_version_id only matching
 */
function populateModelCache() {
    // Keep function for backward compatibility but make it a no-op
    console.log('[ModelDB] populateModelCache() - deprecated, no longer needed with civitai_version_id only matching');
}

/**
 * Find a model using the in-memory cache
 * @deprecated - No longer needed with simplified civitai_version_id only matching
 * @param {string} modelPath - Path to match
 * @returns {Object|null} Always returns null now
 */
function findModelFast(modelPath) {
    console.log('[ModelDB] findModelFast() - deprecated, use findModel() with civitai_version_id instead');
    return null;
}

/**
 * Check if a model is available locally by Civitai version ID
 * @param {string} civitaiVersionId - Civitai version ID
 * @param {string} [type] - Model type filter ('checkpoint' or 'lora')
 * @returns {Object} Availability information
 */
function checkModelAvailability(civitaiVersionId, type = null) {
    try {
        if (!civitaiVersionId) {
            return { available: false, reason: 'No Civitai version ID provided' };
        }

        // Remove URN prefix if present: urn:air:flux1:checkpoint:civitai:618692@691639
        let versionId = civitaiVersionId;
        const urnMatch = civitaiVersionId.match(/urn:air:[^:]+:[^:]+:civitai:\d+@(\d+)/);
        if (urnMatch) {
            versionId = urnMatch[1];
        } else if (!/^\d+$/.test(civitaiVersionId)) {
            return { available: false, reason: 'Invalid Civitai version ID format - must be numeric' };
        }

        // Search by version ID only
        const query = type ? 
                'SELECT * FROM models WHERE civitai_version_id = ? AND type = ? LIMIT 1' :
                'SELECT * FROM models WHERE civitai_version_id = ? LIMIT 1';
        const params = type ? [versionId, type] : [versionId];
        const model = db.prepare(query).get(...params);
            
        if (model) {
                return {
                    available: true,
                model: model,
                match_type: 'civitai_version_id',
                    civitai_version_id: versionId,
                civitai_model_id: model.civitai_id
                };
        }

        return { 
            available: false, 
            reason: 'Model not found in local database',
            civitai_version_id: versionId
        };

    } catch (error) {
        console.error('[ModelDB] Error checking model availability:', error);
        return { 
            available: false, 
            reason: `Database error: ${error.message}`,
            civitai_version_id: versionId
        };
    }
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

/**
 * Extract Civitai version ID from job generation parameters
 * @param {Object} generationParams - Job generation parameters
 * @returns {Object} Object with civitaiVersionId and source field info
 */
function extractCivitaiVersionId(generationParams) {
    if (!generationParams) {
        return { civitaiVersionId: null, source: 'No generation parameters' };
    }

    // 1. Check for direct civitai_version_id field
    if (generationParams.civitai_version_id) {
        return { 
            civitaiVersionId: generationParams.civitai_version_id, 
            source: 'civitai_version_id field' 
        };
    }

    // 2. Check for Civitai URN in fluxMode (raw_generation_info)
    if (generationParams.raw_generation_info) {
        const fluxModeMatch = generationParams.raw_generation_info.match(/fluxMode:\s*([^,\s]+)/);
        if (fluxModeMatch) {
            const fluxValue = fluxModeMatch[1];
            // Check if it's a Civitai URN: urn:air:flux1:checkpoint:civitai:618692@691639
            const urnMatch = fluxValue.match(/urn:air:[^:]+:[^:]+:civitai:\d+@(\d+)/);
            if (urnMatch) {
                return { 
                    civitaiVersionId: urnMatch[1], 
                    source: 'fluxMode URN in raw_generation_info' 
                };
            }
            // Check if it's just a version ID number
            if (/^\d+$/.test(fluxValue)) {
                return { 
                    civitaiVersionId: fluxValue, 
                    source: 'fluxMode version ID in raw_generation_info' 
                };
            }
        }
    }

    // 3. Check for checkpoint/checkpoint_name field that might be a Civitai version ID
    const checkpointFields = ['checkpoint', 'checkpoint_name', 'sd_checkpoint'];
    for (const field of checkpointFields) {
        if (generationParams[field]) {
            const value = generationParams[field];
            // Check if it's a Civitai URN
            const urnMatch = value.match(/urn:air:[^:]+:[^:]+:civitai:\d+@(\d+)/);
            if (urnMatch) {
                return { 
                    civitaiVersionId: urnMatch[1], 
                    source: `${field} field (URN)` 
                };
            }
            // Check if it's just a version ID number
            if (/^\d+$/.test(value)) {
                return { 
                    civitaiVersionId: value, 
                    source: `${field} field (version ID)` 
                };
            }
        }
    }

    return { civitaiVersionId: null, source: 'No Civitai version ID found in any field' };
}

/**
 * Update model server availability
 * @param {number} modelId - ID of the model
 * @param {string} serverId - ID of the server
 * @returns {boolean} Success status
 */
function updateModelServerAvailability(modelId, serverId) {
    try {
        const stmt = db.prepare(`
            INSERT INTO model_server_availability (model_id, server_id, last_seen)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(model_id, server_id) DO UPDATE SET
            last_seen = CURRENT_TIMESTAMP
        `);
        stmt.run(modelId, serverId);
        return true;
    } catch (error) {
        console.error('[ModelDB] Error updating model server availability:', error);
        return false;
    }
}

/**
 * Remove model server availability
 * @param {number} modelId - ID of the model
 * @param {string} serverId - ID of the server
 * @returns {boolean} Success status
 */
function removeModelServerAvailability(modelId, serverId) {
    try {
        const stmt = db.prepare('DELETE FROM model_server_availability WHERE model_id = ? AND server_id = ?');
        stmt.run(modelId, serverId);
        return true;
    } catch (error) {
        console.error('[ModelDB] Error removing model server availability:', error);
        return false;
    }
}

/**
 * Get all servers that have a specific model
 * @param {number} modelId - ID of the model
 * @returns {Array} List of server IDs
 */
function getModelServers(modelId) {
    try {
        const stmt = db.prepare('SELECT server_id, last_seen FROM model_server_availability WHERE model_id = ?');
        return stmt.all(modelId);
    } catch (error) {
        console.error('[ModelDB] Error getting model servers:', error);
        return [];
    }
}

/**
 * Update model metadata status
 * @param {number} modelId - ID of the model
 * @param {string} status - New status ('complete', 'incomplete', 'error')
 * @returns {boolean} Success status
 */
function updateModelMetadataStatus(modelId, status) {
    try {
        const stmt = db.prepare('UPDATE models SET metadata_status = ? WHERE id = ?');
        stmt.run(status, modelId);
        return true;
    } catch (error) {
        console.error('[ModelDB] Error updating model metadata status:', error);
        return false;
    }
}

/**
 * Reset the entire models database (destructive operation)
 * Creates a backup before resetting
 * @returns {boolean} Success status
 */
function resetDatabase() {
    try {
        console.log('[ModelDB] Starting database reset operation');
        
        // Create backup before reset
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(dataDir, `mobilesd_models_backup_reset_${timestamp}.sqlite`);
        
        try {
            const fs = require('fs');
            fs.copyFileSync(dbPath, backupPath);
            console.log(`[ModelDB] Created backup at: ${backupPath}`);
        } catch (backupError) {
            console.warn('[ModelDB] Warning: Could not create backup:', backupError.message);
            // Continue with reset even if backup fails
        }
        
        // Drop all tables
        db.exec('DROP TABLE IF EXISTS model_server_availability');
        db.exec('DROP TABLE IF EXISTS model_aliases');
        db.exec('DROP TABLE IF EXISTS models');
        
        // Drop all indexes (in case they weren't cascade deleted)
        db.exec('DROP INDEX IF EXISTS idx_models_type_filename');
        db.exec('DROP INDEX IF EXISTS idx_models_civitai_ids');
        db.exec('DROP INDEX IF EXISTS idx_model_aliases_path');
        db.exec('DROP INDEX IF EXISTS idx_models_metadata_status');
        db.exec('DROP INDEX IF EXISTS idx_models_hashes');
        db.exec('DROP INDEX IF EXISTS idx_model_server_availability');
        
        // Recreate the schema
        db.exec(schema);
        
        console.log('[ModelDB] Database reset completed - all tables dropped and recreated');
        return true;
    } catch (error) {
        console.error('[ModelDB] Error resetting database:', error);
        return false;
    }
}

/**
 * Find models by hash (AutoV2 or SHA256)
 * @param {string} hash - Hash to search for
 * @param {string} [hashType='autov2'] - Type of hash ('autov2' or 'sha256')
 * @returns {Array} List of matching models
 */
function findModelsByHash(hash, hashType = 'autov2') {
    try {
        const column = hashType === 'autov2' ? 'hash_autov2' : 'hash_sha256';
        const stmt = db.prepare(`SELECT * FROM models WHERE ${column} = ?`);
        return stmt.all(hash);
    } catch (error) {
        console.error('[ModelDB] Error finding models by hash:', error);
        return [];
    }
}

// Initialize the database on module load
initializeDatabase();

module.exports = {
    addOrUpdateModel,
    findModel,
    getAllModels,
    populateModelCache,
    importModelsFromForge,
    checkModelAvailability,
    extractCivitaiVersionId,
    updateModelServerAvailability,
    removeModelServerAvailability,
    getModelServers,
    updateModelMetadataStatus,
    findModelsByHash,
    resetDatabase
}; 