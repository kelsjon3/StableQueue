// migrateModelsDb.js
// Migration script for mobilesd_models.sqlite
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function runModelsMigration(options = {}) {
    const { createBackup = true, verbose = true } = options;
    const log = verbose ? console.log : () => {};

    // --- Database Setup ---
    const projectRootDir = path.join(__dirname, '..');
    const dataDir = path.join(projectRootDir, 'data');
    const dbPath = path.join(dataDir, 'mobilesd_models.sqlite');
    log(`Migrating models database at: ${dbPath}`);

    let backupPath = null;
    if (createBackup && fs.existsSync(dbPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupPath = path.join(dataDir, `mobilesd_models_backup_${timestamp}.sqlite`);
        fs.copyFileSync(dbPath, backupPath);
        log(`Backup created at: ${backupPath}`);
    }

    const db = new Database(dbPath);

    function columnExists(tableName, columnName) {
        const result = db.prepare(`PRAGMA table_info(${tableName})`).all();
        return result.some(col => col.name === columnName);
    }
    function tableExists(tableName) {
        const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
        return !!result;
    }

    db.exec('BEGIN TRANSACTION');
    try {
        // Add metadata_status column if missing
        if (!columnExists('models', 'metadata_status')) {
            log('Adding metadata_status column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN metadata_status TEXT NOT NULL DEFAULT 'incomplete' CHECK (metadata_status IN ('complete', 'incomplete', 'error'))`);
            log('metadata_status column added.');
        } else {
            log('metadata_status column already exists.');
        }
        // Add civitai_file_size_kb column if missing
        if (!columnExists('models', 'civitai_file_size_kb')) {
            log('Adding civitai_file_size_kb column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_file_size_kb INTEGER`);
            log('civitai_file_size_kb column added.');
        } else {
            log('civitai_file_size_kb column already exists.');
        }
        // Add civitai_trained_words column if missing
        if (!columnExists('models', 'civitai_trained_words')) {
            log('Adding civitai_trained_words column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_trained_words TEXT`);
            log('civitai_trained_words column added.');
        } else {
            log('civitai_trained_words column already exists.');
        }
        // Add civitai_download_url column if missing
        if (!columnExists('models', 'civitai_download_url')) {
            log('Adding civitai_download_url column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_download_url TEXT`);
            log('civitai_download_url column added.');
        } else {
            log('civitai_download_url column already exists.');
        }
        // Add civitai_model_version_date column if missing
        if (!columnExists('models', 'civitai_model_version_date')) {
            log('Adding civitai_model_version_date column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_model_version_date TEXT`);
            log('civitai_model_version_date column added.');
        } else {
            log('civitai_model_version_date column already exists.');
        }
        // Add civitai_model_version_desc column if missing
        if (!columnExists('models', 'civitai_model_version_desc')) {
            log('Adding civitai_model_version_desc column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_model_version_desc TEXT`);
            log('civitai_model_version_desc column added.');
        } else {
            log('civitai_model_version_desc column already exists.');
        }
        // Add civitai_model_version_name column if missing
        if (!columnExists('models', 'civitai_model_version_name')) {
            log('Adding civitai_model_version_name column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_model_version_name TEXT`);
            log('civitai_model_version_name column added.');
        } else {
            log('civitai_model_version_name column already exists.');
        }
        // Add civitai_model_type column if missing
        if (!columnExists('models', 'civitai_model_type')) {
            log('Adding civitai_model_type column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_model_type TEXT`);
            log('civitai_model_type column added.');
        } else {
            log('civitai_model_type column already exists.');
        }
        // Add civitai_model_base column if missing
        if (!columnExists('models', 'civitai_model_base')) {
            log('Adding civitai_model_base column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_model_base TEXT`);
            log('civitai_model_base column added.');
        } else {
            log('civitai_model_base column already exists.');
        }
        // Add civitai_model_name column if missing
        if (!columnExists('models', 'civitai_model_name')) {
            log('Adding civitai_model_name column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_model_name TEXT`);
            log('civitai_model_name column added.');
        } else {
            log('civitai_model_name column already exists.');
        }
        // Add hash_sha256 column if missing
        if (!columnExists('models', 'hash_sha256')) {
            log('Adding hash_sha256 column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN hash_sha256 TEXT`);
            log('hash_sha256 column added.');
        } else {
            log('hash_sha256 column already exists.');
        }
        // Add hash_autov2 column if missing
        if (!columnExists('models', 'hash_autov2')) {
            log('Adding hash_autov2 column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN hash_autov2 TEXT`);
            log('hash_autov2 column added.');
        } else {
            log('hash_autov2 column already exists.');
        }
        // Add forge_format column if missing
        if (!columnExists('models', 'forge_format')) {
            log('Adding forge_format column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN forge_format TEXT`);
            log('forge_format column added.');
        } else {
            log('forge_format column already exists.');
        }
        // Add civitai_version_id column if missing
        if (!columnExists('models', 'civitai_version_id')) {
            log('Adding civitai_version_id column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_version_id TEXT`);
            log('civitai_version_id column added.');
        } else {
            log('civitai_version_id column already exists.');
        }
        // Add civitai_id column if missing
        if (!columnExists('models', 'civitai_id')) {
            log('Adding civitai_id column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN civitai_id TEXT`);
            log('civitai_id column added.');
        } else {
            log('civitai_id column already exists.');
        }
        // Add last_used column if missing
        if (!columnExists('models', 'last_used')) {
            log('Adding last_used column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN last_used TIMESTAMP`);
            log('last_used column added.');
        } else {
            log('last_used column already exists.');
        }
        // Add created_at column if missing
        if (!columnExists('models', 'created_at')) {
            log('Adding created_at column to models table...');
            db.exec(`ALTER TABLE models ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
            log('created_at column added.');
        } else {
            log('created_at column already exists.');
        }
        // Create model_server_availability table if missing
        if (!tableExists('model_server_availability')) {
            log('Creating model_server_availability table...');
            db.exec(`CREATE TABLE model_server_availability (
                id INTEGER PRIMARY KEY,
                model_id INTEGER NOT NULL,
                server_id TEXT NOT NULL,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
                UNIQUE(model_id, server_id)
            );`);
            log('model_server_availability table created.');
        } else {
            log('model_server_availability table already exists.');
        }
        db.exec('COMMIT');
        log('Models database migration completed successfully.');
        return { success: true, message: 'Models database migration completed successfully', backupPath };
    } catch (error) {
        db.exec('ROLLBACK');
        console.error('Models migration failed:', error);
        return { success: false, message: `Models migration failed: ${error.message}`, error };
    } finally {
        db.close();
    }
}

if (require.main === module) {
    console.log('Running models database migration as standalone script');
    const result = runModelsMigration({ verbose: true });
    console.log(`Models database migration ${result.success ? 'completed successfully' : 'failed'}. ${result.message}`);
    if (result.backupPath) {
        console.log(`Backup created at: ${result.backupPath}`);
    }
}

module.exports = { runModelsMigration }; 