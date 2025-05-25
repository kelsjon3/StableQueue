/**
 * Database Migration Script
 * 
 * This script updates the database schema to support the Forge extension
 * by adding new columns to the jobs table and creating an api_keys table.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/**
 * Runs the database migration to ensure schema is up to date
 * @param {Object} options - Migration options
 * @param {boolean} options.createBackup - Whether to create a backup before migration
 * @param {boolean} options.verbose - Whether to log detailed information
 * @returns {Object} Migration result with success status and message
 */
function runMigration(options = {}) {
    const { createBackup = true, verbose = false } = options;
    
    const log = verbose ? console.log : () => {};

    // --- Database Setup ---
    // Determine the project's root directory more reliably
    const projectRootDir = path.join(__dirname, '..');
    const dataDir = path.join(projectRootDir, 'data');

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'mobilesd_jobs.sqlite');
    log(`Migrating database at: ${dbPath}`);

    let backupPath = null;
    // Create a backup before migration if requested
    if (createBackup) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupPath = path.join(dataDir, `mobilesd_jobs_backup_${timestamp}.sqlite`);
        log(`Creating backup at: ${backupPath}`);

        // Only backup if the original file exists
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, backupPath);
            log('Backup created successfully');
        } else {
            log('No existing database found, will create a new one');
        }
    }

    // Connect to database
    const db = new Database(dbPath);

    // Function to check if a column exists in a table
    function columnExists(tableName, columnName) {
        const result = db.prepare(`PRAGMA table_info(${tableName})`).all();
        return result.some(col => col.name === columnName);
    }

    // Function to check if a table exists
    function tableExists(tableName) {
        const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
        return !!result;
    }

    // Begin transaction for safety
    db.exec('BEGIN TRANSACTION');

    try {
        log('Starting database migration...');
        
        // Check if jobs table exists
        if (!tableExists('jobs')) {
            log('Jobs table does not exist, creating it...');
            
            // Create the jobs table
            db.exec(`
                CREATE TABLE jobs (
                    mobilesd_job_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
                    creation_timestamp TEXT NOT NULL,
                    last_updated_timestamp TEXT NOT NULL,
                    completion_timestamp TEXT,
                    target_server_alias TEXT NOT NULL,
                    forge_session_hash TEXT,
                    generation_params_json TEXT NOT NULL,
                    result_details_json TEXT,
                    retry_count INTEGER DEFAULT 0,
                    forge_internal_task_id TEXT
                );
                
                CREATE INDEX IF NOT EXISTS idx_jobs_status_creation ON jobs (status, creation_timestamp);
            `);
            log('Jobs table created successfully');
        }
        
        // 1. Add app_type column with default 'forge' for backward compatibility
        if (!columnExists('jobs', 'app_type')) {
            log('Adding app_type column to jobs table...');
            db.exec('ALTER TABLE jobs ADD COLUMN app_type TEXT DEFAULT "forge"');
            log('app_type column added successfully');
        } else {
            log('app_type column already exists, skipping');
        }
        
        // 2. Add source_info column to track where the job came from
        if (!columnExists('jobs', 'source_info')) {
            log('Adding source_info column to jobs table...');
            db.exec('ALTER TABLE jobs ADD COLUMN source_info TEXT');
            log('source_info column added successfully');
        } else {
            log('source_info column already exists, skipping');
        }
        
        // 3. Add api_key_id column to track which API key was used
        if (!columnExists('jobs', 'api_key_id')) {
            log('Adding api_key_id column to jobs table...');
            db.exec('ALTER TABLE jobs ADD COLUMN api_key_id TEXT');
            log('api_key_id column added successfully');
        } else {
            log('api_key_id column already exists, skipping');
        }
        
        // 4. Create api_keys table if it doesn't exist
        if (!tableExists('api_keys')) {
            log('Creating api_keys table...');
            db.exec(`
                CREATE TABLE api_keys (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    key TEXT NOT NULL,
                    secret TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_used TEXT,
                    is_active BOOLEAN DEFAULT 1,
                    permissions TEXT,
                    rate_limit_tier TEXT DEFAULT 'default',
                    custom_rate_limits TEXT
                );
                
                CREATE INDEX idx_api_keys_key ON api_keys (key);
            `);
            log('api_keys table created successfully');
        } else {
            // Add rate limiting columns to the api_keys table if they don't exist
            if (!columnExists('api_keys', 'rate_limit_tier')) {
                log('Adding rate_limit_tier column to api_keys table...');
                db.exec('ALTER TABLE api_keys ADD COLUMN rate_limit_tier TEXT DEFAULT "default"');
                log('rate_limit_tier column added successfully');
            } else {
                log('rate_limit_tier column already exists, skipping');
            }
            
            if (!columnExists('api_keys', 'custom_rate_limits')) {
                log('Adding custom_rate_limits column to api_keys table...');
                db.exec('ALTER TABLE api_keys ADD COLUMN custom_rate_limits TEXT');
                log('custom_rate_limits column added successfully');
            } else {
                log('custom_rate_limits column already exists, skipping');
            }
        }
        
        // 5. Update existing 'ui' jobs with source_info
        log('Updating existing jobs with source_info = "ui"...');
        db.exec(`UPDATE jobs SET source_info = 'ui' WHERE source_info IS NULL`);
        log('Existing jobs updated successfully');
        
        // Commit the transaction
        db.exec('COMMIT');
        log('Database migration completed successfully');
        
        return {
            success: true,
            message: 'Database migration completed successfully',
            backupPath
        };
    } catch (error) {
        // Roll back the transaction in case of error
        db.exec('ROLLBACK');
        console.error('Migration failed:', error);
        
        return {
            success: false,
            message: `Migration failed: ${error.message}`,
            error
        };
    } finally {
        // Close the database connection
        db.close();
    }
}

// Run the migration if script is called directly
if (require.main === module) {
    console.log('Running database migration as standalone script');
    const result = runMigration({ verbose: true });
    console.log(`Database migration ${result.success ? 'completed successfully' : 'failed'}. ${result.message}`);
    if (result.backupPath) {
        console.log(`Backup stored at: ${result.backupPath}`);
    }
}

module.exports = { runMigration }; 