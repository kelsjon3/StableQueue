#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Add the project root to the module path
const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

async function clearLLMModels() {
    console.log('🗑️  Clearing LLM models from database...');
    
    try {
        // Open database directly
        const dataDir = path.join(__dirname, '..', 'data');
        const dbPath = path.join(dataDir, 'mobilesd_models.sqlite');
        const db = new Database(dbPath);
        
        // Get count of LLM models before deletion
        const countResult = db.prepare(`
            SELECT COUNT(*) as count 
            FROM models 
            WHERE local_path LIKE '%/LLM/%'
        `).get();
        
        console.log(`Found ${countResult.count} LLM models to delete`);
        
        if (countResult.count === 0) {
            console.log('No LLM models found in database.');
            return;
        }
        
        // Show which models will be deleted
        const modelsToDelete = db.prepare(`
            SELECT id, name, local_path, hash_autov2, hash_sha256
            FROM models 
            WHERE local_path LIKE '%/LLM/%'
            ORDER BY local_path, name
        `).all();
        
        console.log('\nModels to be deleted:');
        modelsToDelete.forEach(model => {
            console.log(`  ID ${model.id}: ${model.name}`);
            console.log(`    Path: ${model.local_path}`);
            console.log(`    AutoV2: ${model.hash_autov2 || 'null'}`);
            console.log(`    SHA256: ${model.hash_sha256 || 'null'}`);
            console.log('');
        });
        
        // Delete the models
        const deleteResult = db.prepare(`
            DELETE FROM models 
            WHERE local_path LIKE '%/LLM/%'
        `).run();
        
        console.log(`✅ Successfully deleted ${deleteResult.changes} LLM models from database`);
        
        // Verify deletion
        const verifyResult = db.prepare(`
            SELECT COUNT(*) as count 
            FROM models 
            WHERE local_path LIKE '%/LLM/%'
        `).get();
        
        if (verifyResult.count === 0) {
            console.log('✅ Verification: No LLM models remain in database');
        } else {
            console.log(`⚠️  Warning: ${verifyResult.count} LLM models still remain in database`);
        }
        
        db.close();
        
    } catch (error) {
        console.error('❌ Error clearing LLM models:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    clearLLMModels().catch(console.error);
}

module.exports = { clearLLMModels }; 