const path = require('path');
const fs = require('fs').promises;

async function debugMetadataExtraction() {
    console.log('🔍 Testing metadata extraction...');
    
    try {
        const { readModelFileMetadata, validateMetadataCompleteness, mergeMetadata } = require('../utils/safetensorsMetadataReader');
        
        // Test a specific model file
        const testFile = '/app/models/ControlNet/control_depth-fp16.safetensors';
        console.log(`\n📁 Testing file: ${testFile}`);
        
        // Check if file exists
        try {
            const stats = await fs.stat(testFile);
            console.log(`✅ File exists (${Math.round(stats.size / 1024 / 1024)}MB)`);
        } catch (err) {
            console.log(`❌ File not found: ${err.message}`);
            return;
        }
        
        // Test embedded metadata reading
        console.log('\n🔍 Testing embedded metadata reading...');
        try {
            const embeddedMetadata = await readModelFileMetadata(testFile);
            if (embeddedMetadata) {
                console.log(`✅ Embedded metadata found!`);
                console.log(`   Keys: ${Object.keys(embeddedMetadata).length}`);
                console.log(`   Sample keys: ${Object.keys(embeddedMetadata).slice(0, 5).join(', ')}`);
                
                // Check for hashes
                const hasAutoV2 = embeddedMetadata.hash_autov2 || embeddedMetadata.AutoV2;
                const hasSHA256 = embeddedMetadata.hash_sha256 || embeddedMetadata.SHA256 || embeddedMetadata.sha256;
                console.log(`   AutoV2 hash: ${hasAutoV2 ? 'YES' : 'NO'}`);
                console.log(`   SHA256 hash: ${hasSHA256 ? 'YES' : 'NO'}`);
                
                // Check metadata completeness
                const isComplete = validateMetadataCompleteness(embeddedMetadata);
                console.log(`   Complete: ${isComplete ? 'YES' : 'NO'}`);
            } else {
                console.log(`❌ No embedded metadata found`);
            }
        } catch (err) {
            console.log(`❌ Embedded metadata error: ${err.message}`);
        }
        
        // Test JSON metadata reading
        console.log('\n🔍 Testing JSON metadata files...');
        const baseName = path.basename(testFile, path.extname(testFile));
        const modelDir = path.dirname(testFile);
        
        // Test Forge JSON
        const forgeJsonPath = path.join(modelDir, `${baseName}.json`);
        try {
            const jsonData = await fs.readFile(forgeJsonPath, 'utf-8');
            console.log(`✅ Forge JSON found: ${forgeJsonPath}`);
            const parsedJson = JSON.parse(jsonData);
            console.log(`   Keys: ${Object.keys(parsedJson).length}`);
            console.log(`   Content: ${JSON.stringify(parsedJson, null, 2)}`);
            
            // Test the new validation logic
            const modelFields = ['modelId', 'civitaiVersionId', 'name', 'description', 'baseModel', 
                               'sd version', 'activation text', 'preferred weight', 'notes', 'type',
                               'hash_autov2', 'AutoV2', 'hash_sha256', 'SHA256'];
            const hasModelField = modelFields.some(field => 
                parsedJson.hasOwnProperty(field) || parsedJson.model?.hasOwnProperty(field)
            );
            console.log(`   Passes validation: ${hasModelField ? 'YES' : 'NO'}`);
        } catch (err) {
            console.log(`❌ No Forge JSON: ${forgeJsonPath}`);
        }
        
        // Test Civitai JSON
        const civitaiJsonPath = path.join(modelDir, `${baseName}.civitai.json`);
        try {
            const jsonData = await fs.readFile(civitaiJsonPath, 'utf-8');
            console.log(`✅ Civitai JSON found: ${civitaiJsonPath}`);
            const parsedJson = JSON.parse(jsonData);
            console.log(`   Keys: ${Object.keys(parsedJson).length}`);
        } catch (err) {
            console.log(`❌ No Civitai JSON: ${civitaiJsonPath}`);
        }
        
    } catch (error) {
        console.error('🚨 Debug failed:', error.message);
    }
}

debugMetadataExtraction().catch(console.error); 