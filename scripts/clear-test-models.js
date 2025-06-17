const modelDB = require('../utils/modelDatabase');

async function clearTestModels(count = 3) {
    console.log(`🗑️  Clearing ${count} models from database for testing...`);
    
    const allModels = modelDB.getAllModels();
    console.log(`Current database has ${allModels.length} models`);
    
    if (allModels.length === 0) {
        console.log('Database is already empty');
        return [];
    }
    
    // Remove the first few models for testing
    const modelsToRemove = allModels.slice(0, count);
    const removedModels = [];
    
    for (const model of modelsToRemove) {
        try {
            const success = modelDB.deleteModel(model.id);
            if (success) {
                console.log(`✅ Removed: ${model.filename} (ID: ${model.id})`);
                removedModels.push({
                    id: model.id,
                    filename: model.filename,
                    hash_autov2: model.hash_autov2
                });
            } else {
                console.log(`❌ Failed to remove: ${model.filename} (ID: ${model.id})`);
            }
        } catch (error) {
            console.error(`❌ Error removing model ${model.id}:`, error.message);
        }
    }
    
    console.log(`✅ Cleared ${removedModels.length} models for testing`);
    console.log('Removed models info:', removedModels.map(m => `${m.filename} (${m.hash_autov2 || 'no hash'})`));
    
    return removedModels;
}

if (require.main === module) {
    clearTestModels().then(() => {
        console.log('Clear test models completed');
        process.exit(0);
    }).catch(error => {
        console.error('Clear test models failed:', error);
        process.exit(1);
    });
}

module.exports = { clearTestModels }; 