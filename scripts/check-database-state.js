const modelDB = require('../utils/modelDatabase');

console.log('🔍 === DATABASE STATE CHECK ===\n');

try {
    const allModels = modelDB.getAllModels();
    console.log(`Total models in database: ${allModels.length}`);
    
    if (allModels.length === 0) {
        console.log('❌ No models found in database');
        return;
    }
    
    // Count models with hashes
    const withAutoV2 = allModels.filter(m => m.hash_autov2 && m.hash_autov2.length > 0);
    const withSHA256 = allModels.filter(m => m.hash_sha256 && m.hash_sha256.length > 0);
    const withBothHashes = allModels.filter(m => 
        m.hash_autov2 && m.hash_autov2.length > 0 && 
        m.hash_sha256 && m.hash_sha256.length > 0
    );
    
    console.log(`Models with AutoV2 hash: ${withAutoV2.length}`);
    console.log(`Models with SHA256 hash: ${withSHA256.length}`);
    console.log(`Models with both hashes: ${withBothHashes.length}`);
    
    // Show sample models
    console.log('\n📋 Sample models:');
    allModels.slice(0, 5).forEach((model, i) => {
        console.log(`${i+1}. ${model.filename}`);
        console.log(`   AutoV2: ${model.hash_autov2 || 'NULL'}`);
        console.log(`   SHA256: ${model.hash_sha256 || 'NULL'}`);
        console.log(`   Path: ${model.local_path}`);
        console.log('');
    });
    
    // Show models with AutoV2 hashes if any
    if (withAutoV2.length > 0) {
        console.log('\n✅ Models with AutoV2 hashes:');
        withAutoV2.slice(0, 10).forEach((model, i) => {
            console.log(`${i+1}. ${model.filename}: ${model.hash_autov2}`);
        });
    }
    
} catch (error) {
    console.error('❌ Error checking database:', error.message);
} 