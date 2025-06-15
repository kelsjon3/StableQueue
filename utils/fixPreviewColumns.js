#!/usr/bin/env node

/**
 * Standalone migration script to add preview_path and preview_url columns
 * to existing StableQueue model databases that are missing these columns.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Database path
const projectRootDir = path.join(__dirname, '..');
const dataDir = path.join(projectRootDir, 'data');
const dbPath = path.join(dataDir, 'mobilesd_models.sqlite');

console.log('[Migration] Starting preview columns migration...');
console.log('[Migration] Database path:', dbPath);

// Check if database exists
if (!fs.existsSync(dbPath)) {
    console.error('[Migration] Database file not found:', dbPath);
    process.exit(1);
}

// Open database connection
const db = new Database(dbPath);

try {
    // Check current table structure
    console.log('[Migration] Checking current table structure...');
    const tableInfo = db.prepare("PRAGMA table_info(models)").all();
    const columnNames = tableInfo.map(col => col.name);
    
    console.log('[Migration] Current columns:', columnNames.join(', '));
    
    let migrationsNeeded = [];
    
    // Check if preview_path column exists
    if (!columnNames.includes('preview_path')) {
        migrationsNeeded.push('preview_path');
    } else {
        console.log('[Migration] preview_path column already exists');
    }
    
    // Check if preview_url column exists
    if (!columnNames.includes('preview_url')) {
        migrationsNeeded.push('preview_url');
    } else {
        console.log('[Migration] preview_url column already exists');
    }
    
    if (migrationsNeeded.length === 0) {
        console.log('[Migration] No migrations needed - all columns exist');
        process.exit(0);
    }
    
    console.log('[Migration] Migrations needed:', migrationsNeeded.join(', '));
    
    // Create backup before migration
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(dataDir, `mobilesd_models_backup_${timestamp}.sqlite`);
    
    console.log('[Migration] Creating backup:', backupPath);
    fs.copyFileSync(dbPath, backupPath);
    
    // Run migrations in a transaction
    const transaction = db.transaction(() => {
        for (const column of migrationsNeeded) {
            console.log(`[Migration] Adding column: ${column}`);
            
            if (column === 'preview_path') {
                db.exec('ALTER TABLE models ADD COLUMN preview_path TEXT');
                console.log('[Migration] ✓ Added preview_path column');
            } else if (column === 'preview_url') {
                db.exec('ALTER TABLE models ADD COLUMN preview_url TEXT');
                console.log('[Migration] ✓ Added preview_url column');
            }
        }
    });
    
    // Execute the transaction
    transaction();
    
    // Verify the migration
    console.log('[Migration] Verifying migration...');
    const newTableInfo = db.prepare("PRAGMA table_info(models)").all();
    const newColumnNames = newTableInfo.map(col => col.name);
    
    console.log('[Migration] New columns:', newColumnNames.join(', '));
    
    // Check if all required columns now exist
    const hasPreviewPath = newColumnNames.includes('preview_path');
    const hasPreviewUrl = newColumnNames.includes('preview_url');
    
    if (hasPreviewPath && hasPreviewUrl) {
        console.log('[Migration] ✅ Migration completed successfully!');
        console.log('[Migration] Both preview_path and preview_url columns have been added');
        
        // Get model count for verification
        const modelCount = db.prepare("SELECT COUNT(*) as count FROM models").get();
        console.log(`[Migration] Database contains ${modelCount.count} models`);
        
    } else {
        throw new Error('Migration verification failed - columns not found after migration');
    }
    
} catch (error) {
    console.error('[Migration] Migration failed:', error.message);
    console.error('[Migration] Full error:', error);
    process.exit(1);
} finally {
    db.close();
}

console.log('[Migration] Database connection closed');
console.log('[Migration] Migration script completed'); 