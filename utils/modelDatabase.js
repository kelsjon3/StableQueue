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
    name TEXT,
    type TEXT CHECK (type IN ('checkpoint', 'lora') OR type IS NULL),
    local_path TEXT NOT NULL,
    filename TEXT NOT NULL,
    preview_path TEXT,
    preview_url TEXT,
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
    civitai_nsfw BOOLEAN DEFAULT FALSE,
    civitai_blurhash TEXT,
    metadata_status TEXT NOT NULL DEFAULT 'incomplete' CHECK (metadata_status IN ('complete', 'partial', 'incomplete', 'none', 'error')),
    metadata_source TEXT DEFAULT 'none' CHECK (metadata_source IN ('forge', 'civitai', 'embedded', 'none')),
    has_embedded_metadata BOOLEAN DEFAULT FALSE,
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
    try {
        // First, create tables if they don't exist
        db.exec(schema);
        console.log("[ModelDB] Database schema initialized");
        
        // Always run migration checks for existing databases
        runMigrations();
        
    } catch (error) {
        console.error("[ModelDB] Database initialization failed:", error);
        throw error;
    }
}

// Run database migrations
function runMigrations() {
    try {
        console.log("[ModelDB] Checking for required database migrations...");
        
        // Check current table structure
        const tableInfo = db.prepare("PRAGMA table_info(models)").all();
        const columnNames = tableInfo.map(col => col.name);
        
        console.log("[ModelDB] Current columns:", columnNames.length, "columns found");
        
        let migrationsRun = 0;
        
        // Migration 1: Add preview_path column
        if (!columnNames.includes('preview_path')) {
            try {
                console.log("[ModelDB] Running migration: Adding preview_path column");
                db.exec('ALTER TABLE models ADD COLUMN preview_path TEXT');
                console.log("[ModelDB] ✓ Added preview_path column");
                migrationsRun++;
            } catch (error) {
                console.error("[ModelDB] ✗ Failed to add preview_path column:", error.message);
            }
        }
        
        // Migration 2: Add preview_url column
        if (!columnNames.includes('preview_url')) {
            try {
                console.log("[ModelDB] Running migration: Adding preview_url column");
                db.exec('ALTER TABLE models ADD COLUMN preview_url TEXT');
                console.log("[ModelDB] ✓ Added preview_url column");
                migrationsRun++;
            } catch (error) {
                console.error("[ModelDB] ✗ Failed to add preview_url column:", error.message);
            }
        }
        
        // Migration 3: Add civitai_nsfw column
        if (!columnNames.includes('civitai_nsfw')) {
            try {
                console.log("[ModelDB] Running migration: Adding civitai_nsfw column");
                db.exec('ALTER TABLE models ADD COLUMN civitai_nsfw BOOLEAN DEFAULT FALSE');
                console.log("[ModelDB] ✓ Added civitai_nsfw column");
                migrationsRun++;
            } catch (error) {
                console.error("[ModelDB] ✗ Failed to add civitai_nsfw column:", error.message);
            }
        }
        
        // Migration 4: Add civitai_blurhash column
        if (!columnNames.includes('civitai_blurhash')) {
            try {
                console.log("[ModelDB] Running migration: Adding civitai_blurhash column");
                db.exec('ALTER TABLE models ADD COLUMN civitai_blurhash TEXT');
                console.log("[ModelDB] ✓ Added civitai_blurhash column");
                migrationsRun++;
            } catch (error) {
                console.error("[ModelDB] ✗ Failed to add civitai_blurhash column:", error.message);
            }
        }
        
        if (migrationsRun > 0) {
            console.log(`[ModelDB] Completed ${migrationsRun} database migrations`);
            
            // Verify migrations
            const newTableInfo = db.prepare("PRAGMA table_info(models)").all();
            const newColumnNames = newTableInfo.map(col => col.name);
            console.log("[ModelDB] Updated schema now has", newColumnNames.length, "columns");
        } else {
            console.log("[ModelDB] No migrations needed - database schema is up to date");
        }
        
    } catch (error) {
        console.error("[ModelDB] Migration check failed:", error);
        // Don't throw here - let the app continue even if migrations fail
    }
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
 * @param {string} [model.preview_path] - Full path to preview image file
 * @param {string} [model.preview_url] - Ready-to-use URL for preview image
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
                preview_path = COALESCE(?, preview_path),
                preview_url = COALESCE(?, preview_url),
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
                civitai_nsfw = COALESCE(?, civitai_nsfw),
                civitai_blurhash = COALESCE(?, civitai_blurhash),
                metadata_status = COALESCE(?, metadata_status),
                metadata_source = COALESCE(?, metadata_source),
                has_embedded_metadata = COALESCE(?, has_embedded_metadata),
                last_used = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            
            // Ensure boolean conversion for has_embedded_metadata
            const hasEmbeddedMetadata = model.has_embedded_metadata === true ? 1 : (model.has_embedded_metadata === false ? 0 : null);
            
            updateStmt.run(
                model.name,
                model.preview_path || null,
                model.preview_url || null,
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
                model.civitai_nsfw ? 1 : 0,
                model.civitai_blurhash || null,
                model.metadata_status || null,
                model.metadata_source || null,
                hasEmbeddedMetadata,
                existing.id
            );
            
            modelId = existing.id;
        } else {
            // Insert new model
            const insertStmt = db.prepare(`
                INSERT INTO models (
                    name, type, local_path, filename, preview_path, preview_url, civitai_id, civitai_version_id, forge_format, hash_autov2, hash_sha256, civitai_model_name, civitai_model_base, civitai_model_type, civitai_model_version_name, civitai_model_version_desc, civitai_model_version_date, civitai_download_url, civitai_trained_words, civitai_file_size_kb, civitai_nsfw, civitai_blurhash, metadata_status, metadata_source, has_embedded_metadata, last_used
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            
            // Ensure boolean conversion for has_embedded_metadata
            const hasEmbeddedMetadata = model.has_embedded_metadata === true ? 1 : 0;
            
            const info = insertStmt.run(
                model.name,
                model.type,
                model.local_path,
                model.filename,
                model.preview_path || null,
                model.preview_url || null,
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
                model.civitai_nsfw ? 1 : 0,
                model.civitai_blurhash || null,
                model.metadata_status || 'incomplete',
                model.metadata_source || 'none',
                hasEmbeddedMetadata
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
 * Find a model using filename and local_path
 * @param {string} filename - Model filename
 * @param {string} localPath - Model local path
 * @returns {Object|null} The matched model or null if not found
 */
function findModelByPath(filename, localPath) {
    try {
        if (!filename || !localPath) {
            return null;
        }

        const query = 'SELECT * FROM models WHERE filename = ? AND local_path = ? LIMIT 1';
        const result = db.prepare(query).get(filename, localPath);
        
        return result || null;
    } catch (error) {
        console.error('[ModelDB] Error finding model by path:', error);
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
 * Check if a model is available locally by hash
 * @param {string} hash - Model hash (AutoV2 or SHA256)
 * @param {string} [type] - Model type filter ('checkpoint' or 'lora')
 * @returns {Object} Availability information
 */
function checkModelAvailability(hash, type = null) {
    try {
        if (!hash) {
            return { available: false, reason: 'No model hash provided' };
        }

        // Clean hash (remove any prefixes or formatting)
        let cleanHash = hash.trim();
        
        // First try AutoV2 hash (10 characters)
        let matches = findModelsByHash(cleanHash, 'autov2');
        let hashType = 'autov2';
        
        // If no AutoV2 match, try SHA256 (64 characters)
        if (matches.length === 0) {
            matches = findModelsByHash(cleanHash, 'sha256');
            hashType = 'sha256';
        }
        
        // Filter by type if specified
        if (type && matches.length > 0) {
            matches = matches.filter(model => model.type === type);
        }
        
        if (matches.length > 0) {
            const model = matches[0]; // Take first match
            return {
                available: true,
                model: model,
                match_type: hashType,
                hash: cleanHash,
                civitai_model_id: model.civitai_id
            };
        }

        return { 
            available: false, 
            reason: 'Model not found in local database (no hash match)',
            hash: cleanHash
        };

    } catch (error) {
        console.error('[ModelDB] Error checking model availability:', error);
        return { 
            available: false, 
            reason: `Database error: ${error.message}`,
            hash: hash
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
 * Extract model hash from job generation parameters
 * @param {Object} generationParams - Job generation parameters
 * @returns {Object} Object with hash and source field info
 */
function extractModelHash(generationParams) {
    if (!generationParams) {
        return { hash: null, source: 'No generation parameters' };
    }

    // Hash fields to check (in priority order)
    const hashFields = [
        'model_hash',      // Direct hash field
        'checkpoint_hash', // Checkpoint-specific hash
        'hash',           // Generic hash field
        'autov2_hash',    // AutoV2 specific
        'sha256_hash'     // SHA256 specific
    ];

    // 1. Check for direct hash fields
    for (const field of hashFields) {
        if (generationParams[field]) {
            const hash = generationParams[field].trim();
            if (hash && isValidHash(hash)) {
                return { 
                    hash: hash, 
                    source: `${field} field` 
                };
            }
        }
    }

    // 2. Check for hash in checkpoint metadata
    if (generationParams.checkpoint && typeof generationParams.checkpoint === 'object' && generationParams.checkpoint.hash) {
        const hash = generationParams.checkpoint.hash.trim();
        if (hash && isValidHash(hash)) {
            return { 
                hash: hash, 
                source: 'checkpoint.hash field' 
            };
        }
    }

    // 3. Check for hash in model info sections
    if (generationParams.model_info && generationParams.model_info.hash) {
        const hash = generationParams.model_info.hash.trim();
        if (hash && isValidHash(hash)) {
            return { 
                hash: hash, 
                source: 'model_info.hash field' 
            };
        }
    }

    // 4. Check raw_generation_info for hash patterns
    if (generationParams.raw_generation_info) {
        // Look for hash patterns in raw info
        const hashMatches = generationParams.raw_generation_info.match(/hash:\s*([a-fA-F0-9]{10,64})/i);
        if (hashMatches) {
            const hash = hashMatches[1].trim();
            if (isValidHash(hash)) {
                return { 
                    hash: hash, 
                    source: 'hash pattern in raw_generation_info' 
                };
            }
        }
    }

    return { hash: null, source: 'No model hash found in any field' };
}

/**
 * Validate if a string looks like a valid model hash
 * @param {string} hash - Hash to validate
 * @returns {boolean} True if valid hash format
 */
function isValidHash(hash) {
    if (!hash || typeof hash !== 'string') {
        return false;
    }
    
    const clean = hash.trim();
    
    // AutoV2 hash: 10 character lowercase alphanumeric
    if (/^[a-f0-9]{10}$/.test(clean)) {
        return true;
    }
    
    // SHA256 hash: 64 character hex
    if (/^[a-fA-F0-9]{64}$/.test(clean)) {
        return true;
    }
    
    return false;
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

/**
 * Delete a model from the database
 * @param {number} modelId - ID of the model to delete
 * @returns {boolean} Success status
 */
function deleteModel(modelId) {
    try {
        const stmt = db.prepare('DELETE FROM models WHERE id = ?');
        const result = stmt.run(modelId);
        console.log(`[ModelDB] Deleted model ID ${modelId} (affected rows: ${result.changes})`);
        return result.changes > 0;
    } catch (error) {
        console.error('[ModelDB] Error deleting model:', error);
        return false;
    }
}

// Initialize the database on module load
initializeDatabase();

module.exports = {
    addOrUpdateModel,
    findModel,
    findModelByPath,
    getAllModels,
    populateModelCache,
    importModelsFromForge,
    checkModelAvailability,
    extractModelHash,
    updateModelServerAvailability,
    removeModelServerAvailability,
    getModelServers,
    updateModelMetadataStatus,
    findModelsByHash,
    resetDatabase,
    runMigrations,
    isValidHash,
    deleteModel
}; 