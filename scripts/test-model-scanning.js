const path = require('path');
const fs = require('fs').promises;
const { scanModelDirectory } = require('../utils/configHelpers');
const modelDB = require('../utils/modelDatabase');

// Test configuration
const TEST_CONFIG = {
    modelPath: process.env.MODEL_PATH || process.env.CHECKPOINT_PATH,
    maxTestModels: 3, // Limit test to first 3 models found
    logLevel: 'verbose' // detailed, verbose, minimal
};

async function runModelScanningTest() {
    console.log('\n🧪 === MODEL SCANNING DEBUG TEST ===\n');
    
    try {
        // Step 1: Show current database state
        await logDatabaseState('BEFORE TEST');
        
        // Step 2: Test file discovery
        await testFileDiscovery();
        
        // Step 3: Test metadata reading
        await testMetadataReading();
        
        // Step 4: Test database operations
        await testDatabaseOperations();
        
        // Step 5: Show final database state
        await logDatabaseState('AFTER TEST');
        
        console.log('\n✅ === TEST COMPLETE ===\n');
        
    } catch (error) {
        console.error('\n❌ === TEST FAILED ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

async function logDatabaseState(phase) {
    console.log(`\n📊 === DATABASE STATE ${phase} ===`);
    const allModels = modelDB.getAllModels();
    console.log(`Total models in database: ${allModels.length}`);
    
    if (allModels.length > 0) {
        console.log('Sample models:');
        allModels.slice(0, 3).forEach((model, i) => {
            console.log(`  ${i+1}. ${model.filename} (ID: ${model.id})`);
            console.log(`     Hash: ${model.hash_autov2 || 'none'}`);
            console.log(`     Metadata: ${model.metadata_source} (${model.metadata_status})`);
        });
    }
}

async function testFileDiscovery() {
    console.log('\n🔍 === TESTING FILE DISCOVERY ===');
    
    if (!TEST_CONFIG.modelPath) {
        throw new Error('MODEL_PATH not configured');
    }
    
    console.log(`Scanning path: ${TEST_CONFIG.modelPath}`);
    
    const MODEL_EXTENSIONS = ['.safetensors', '.pt', '.ckpt'];
    const allModels = await scanModelDirectory(TEST_CONFIG.modelPath, MODEL_EXTENSIONS, TEST_CONFIG.modelPath);
    
    console.log(`Found ${allModels.length} model files`);
    
    // Limit to first few models for testing
    const testModels = allModels.slice(0, TEST_CONFIG.maxTestModels);
    console.log(`Testing with first ${testModels.length} models:`);
    
    testModels.forEach((model, i) => {
        console.log(`  ${i+1}. ${model.filename}`);
        console.log(`     Path: ${model.relativePath || 'root'}`);
        console.log(`     Preview: ${model.previewAvailable ? 'YES' : 'NO'}`);
        console.log(`     Metadata source: ${model._metadata_source || 'none'}`);
    });
    
    return testModels;
}

async function testMetadataReading() {
    console.log('\n📖 === TESTING METADATA READING ===');
    
    const testModels = await testFileDiscovery();
    
    for (const model of testModels) {
        console.log(`\n--- Processing: ${model.filename} ---`);
        
        try {
            // Test the metadata reading function
            const metadata = await readModelMetadata(model);
            
            if (metadata) {
                console.log(`✅ Metadata found from: ${metadata._json_source || 'embedded'}`);
                console.log(`   Complete: ${metadata._complete ? 'YES' : 'NO'}`);
                console.log(`   Key fields: ${Object.keys(metadata).slice(0, 5).join(', ')}...`);
            } else {
                console.log(`❌ No metadata found`);
            }
            
        } catch (error) {
            console.log(`❌ Metadata reading failed: ${error.message}`);
        }
    }
}

async function testDatabaseOperations() {
    console.log('\n💾 === TESTING DATABASE OPERATIONS ===');
    
    const testModels = await testFileDiscovery();
    
    for (const model of testModels) {
        console.log(`\n--- Database test for: ${model.filename} ---`);
        
        // Check if model exists by hash (if available)
        if (model.hash_autov2) {
            const existing = modelDB.findModelsByHash(model.hash_autov2, 'autov2');
            console.log(`Hash lookup (${model.hash_autov2}): ${existing.length > 0 ? 'FOUND' : 'NOT FOUND'}`);
        } else {
            console.log(`No hash available for duplicate detection`);
        }
        
        // Test creating minimal database entry
        try {
            const modelData = {
                name: model.filename,
                filename: model.filename,
                local_path: path.join(TEST_CONFIG.modelPath, model.relativePath || ''),
                type: null // Will be determined later
            };
            
            console.log(`Creating minimal database entry...`);
            const modelId = modelDB.addOrUpdateModel(modelData);
            console.log(`✅ Database entry created with ID: ${modelId}`);
            
        } catch (error) {
            console.log(`❌ Database operation failed: ${error.message}`);
        }
    }
}

// Helper function to read metadata (based on routes/models.js logic)
async function readModelMetadata(model) {
    const { readModelFileMetadata, validateMetadataCompleteness, mergeMetadata } = require('../utils/safetensorsMetadataReader');
    
    try {
        const baseName = model.filename.substring(0, model.filename.lastIndexOf('.'));
        // Correctly construct the full path using relativePath
        const modelDir = path.join(TEST_CONFIG.modelPath, model.relativePath || '');
        const modelFilePath = path.join(modelDir, model.filename);
        
        let jsonMetadata = null;
        let jsonSource = null;
    
        // Try Forge-style JSON first
        const forgeJsonPath = path.join(modelDir, `${baseName}.json`);
        try {
            const jsonData = await fs.readFile(forgeJsonPath, 'utf-8');
            const parsedJson = JSON.parse(jsonData);
            
            if (parsedJson.modelId || parsedJson.model?.id || parsedJson.civitaiVersionId || 
                parsedJson.name || parsedJson.description || parsedJson.baseModel) {
                jsonMetadata = parsedJson;
                jsonSource = 'forge';
            }
        } catch (err) {
            // Forge JSON not found
        }
    
        // Try Civitai-style JSON if no Forge JSON
        if (!jsonMetadata) {
            const civitaiJsonPath = path.join(modelDir, `${baseName}.civitai.json`);
            try {
                const jsonData = await fs.readFile(civitaiJsonPath, 'utf-8');
                const parsedJson = JSON.parse(jsonData);
                
                if (validateMetadataCompleteness(parsedJson)) {
                    jsonMetadata = parsedJson;
                    jsonSource = 'civitai';
                }
            } catch (err) {
                // Civitai JSON not found
            }
        }
        
        // Try embedded metadata
        let embeddedMetadata = null;
        try {
            embeddedMetadata = await readModelFileMetadata(modelFilePath);
        } catch (err) {
            // Embedded metadata not readable
        }
        
        if (jsonMetadata || embeddedMetadata) {
            const mergedMetadata = mergeMetadata(jsonMetadata, embeddedMetadata);
            mergedMetadata._json_source = jsonSource;
            mergedMetadata._has_embedded = !!embeddedMetadata;
            mergedMetadata._complete = validateMetadataCompleteness(mergedMetadata);
            return mergedMetadata;
        }
        
        return null;
        
    } catch (error) {
        console.error(`Error reading metadata for ${model.filename}:`, error);
        return null;
    }
}

// Run the test
if (require.main === module) {
    runModelScanningTest();
}

module.exports = { runModelScanningTest }; 