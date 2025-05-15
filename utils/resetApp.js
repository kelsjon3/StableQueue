/**
 * Emergency reset script to completely clear all app state and restart cleanly
 * Run with: node utils/resetApp.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Set up paths
const projectRootDir = path.join(__dirname, '..');
const dataDir = path.join(projectRootDir, 'data');
const dbPath = path.join(dataDir, 'mobilesd_jobs.sqlite');
const jobsBackupPath = path.join(dataDir, 'mobilesd_jobs.sqlite.bak');

console.log('===== EMERGENCY APP RESET =====');

// 1. Check if database file exists
if (fs.existsSync(dbPath)) {
    console.log(`Database file found at ${dbPath}`);
    
    try {
        // Backup the database file
        fs.copyFileSync(dbPath, jobsBackupPath);
        console.log(`Created backup at ${jobsBackupPath}`);
        
        // Delete the database file
        fs.unlinkSync(dbPath);
        console.log('Deleted existing database file');
    } catch (error) {
        console.error('Error handling database file:', error);
        process.exit(1);
    }
} else {
    console.log('No database file found, creating fresh database');
}

// 2. Create a fresh empty database with schema
try {
    console.log('Creating new database with clean schema...');
    const db = new Database(dbPath);
    
    // Define schema
    const schema = `
    CREATE TABLE IF NOT EXISTS jobs (
        mobilesd_job_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
        creation_timestamp TEXT NOT NULL,
        last_updated_timestamp TEXT NOT NULL,
        completion_timestamp TEXT,
        target_server_alias TEXT NOT NULL,
        forge_session_hash TEXT,
        generation_params_json TEXT NOT NULL,
        result_details_json TEXT,
        retry_count INTEGER DEFAULT 0
    );
    
    CREATE INDEX IF NOT EXISTS idx_jobs_status_creation ON jobs (status, creation_timestamp);
    `;
    
    db.exec(schema);
    console.log('Database recreated with empty tables');
    
    // Close the database connection
    db.close();
    
    console.log('Database reset completed successfully.');
} catch (error) {
    console.error('Error creating new database:', error);
    process.exit(1);
}

console.log('===== RESET COMPLETED =====');
console.log('Restart the application for changes to take effect.');

// Optional: restart the server automatically if running in production
if (process.env.NODE_ENV === 'production') {
    try {
        console.log('Attempting to restart the application automatically...');
        process.exit(0); // Exit with success code, container should restart if configured properly
    } catch (error) {
        console.error('Error restarting server:', error);
    }
} 