const path = require('path');
const fs = require('fs').promises;
const modelDB = require('../utils/modelDatabase');
const axios = require('axios');

async function testAutoV2HashCalculation() {
    console.log('\n🧪 === AUTOV2 HASH CALCULATION TEST (LIVE SCANNING WORKFLOW) ===\n');
    
    try {
        // Step 1: Get 10 models that currently have AutoV2 hashes
        console.log('📊 Finding models with existing AutoV2 hashes...');
        const allModels = modelDB.getAllModels();
        const modelsWithHashes = allModels.filter(model => 
            model.hash_autov2 && 
            model.hash_autov2.length === 10 && 
            model.local_path && 
            model.filename
        );
        
        if (modelsWithHashes.length === 0) {
            console.log('❌ No models with AutoV2 hashes found in database');
            return;
        }
        
        const testModels = modelsWithHashes.slice(0, 10);
        console.log(`✅ Found ${modelsWithHashes.length} models with hashes, testing first ${testModels.length}`);
        
        // Step 2: Save original hashes and model info
        const testData = [];
        for (const model of testModels) {
            const fullPath = path.join(model.local_path, model.filename);
            testData.push({
                id: model.id,
                filename: model.filename,
                fullPath: fullPath,
                originalHash: model.hash_autov2,
                originalSHA256: model.hash_sha256
            });
            console.log(`  - ${model.filename}: ${model.hash_autov2}`);
        }
        
        // Step 3: Set AutoV2 hashes to null in database
        console.log('\n🗑️ Setting AutoV2 hashes to null...');
        const Database = require('better-sqlite3');
        const dbPath = path.join(__dirname, '..', 'data', 'mobilesd_models.sqlite');
        const db = new Database(dbPath);
        
        const updateStmt = db.prepare('UPDATE models SET hash_autov2 = NULL WHERE id = ?');
        const transaction = db.transaction(() => {
            for (const test of testData) {
                updateStmt.run(test.id);
            }
        });
        transaction();
        
        console.log(`✅ Nullified AutoV2 hashes for ${testData.length} models`);
        
        // Step 4: Use the actual live scanning API to recalculate hashes
        console.log('\n🔄 Triggering live scanning workflow...');
        
        try {
            // Make API call to the live scanning endpoint
            const response = await axios.post('http://localhost:3000/api/v1/models/scan', {
                calculateHashes: true
            }, {
                timeout: 300000 // 5 minute timeout for scanning
            });
            
            if (response.data.success) {
                console.log('✅ Live scanning completed successfully');
                console.log(`   Stats: ${JSON.stringify(response.data.stats, null, 2)}`);
            } else {
                console.log('❌ Live scanning failed:', response.data.message);
                return;
            }
        } catch (scanError) {
            console.error('❌ Error calling live scanning API:', scanError.message);
            if (scanError.response) {
                console.error('   Response:', scanError.response.data);
            }
            return;
        }
        
        // Step 5: Check what hashes were calculated by the live system
        console.log('\n🔍 Checking results from live scanning...');
        const results = [];
        
        for (const test of testData) {
            console.log(`\n--- Checking: ${test.filename} ---`);
            
            try {
                // Get updated model from database
                const updatedModels = modelDB.getAllModels();
                const updatedModel = updatedModels.find(m => m.id === test.id);
                
                if (!updatedModel) {
                    console.log(`  ❌ Model not found in database after scan`);
                    results.push({
                        ...test,
                        newHash: null,
                        matches: false,
                        error: 'Model not found after scan'
                    });
                    continue;
                }
                
                const newHash = updatedModel.hash_autov2;
                const newSHA256 = updatedModel.hash_sha256;
                
                console.log(`  Original AutoV2: ${test.originalHash}`);
                console.log(`  New AutoV2:      ${newHash || 'NULL'}`);
                console.log(`  Match:           ${test.originalHash === newHash ? '✅ YES' : '❌ NO'}`);
                
                if (test.originalSHA256 && newSHA256) {
                    console.log(`  SHA256 Match:    ${test.originalSHA256 === newSHA256 ? '✅ YES' : '❌ NO'}`);
                }
                
                results.push({
                    ...test,
                    newHash: newHash,
                    newSHA256: newSHA256,
                    matches: test.originalHash === newHash,
                    sha256Matches: test.originalSHA256 === newSHA256
                });
                
            } catch (error) {
                console.log(`  ❌ Error checking result: ${error.message}`);
                results.push({
                    ...test,
                    newHash: null,
                    matches: false,
                    error: error.message
                });
            }
        }
        
        // Step 6: Summary
        console.log('\n📊 === TEST RESULTS SUMMARY ===');
        const matches = results.filter(r => r.matches).length;
        const total = results.length;
        const successRate = (matches / total * 100).toFixed(1);
        
        console.log(`Total models tested: ${total}`);
        console.log(`AutoV2 hashes matched: ${matches}`);
        console.log(`Success rate: ${successRate}%`);
        
        if (matches < total) {
            console.log('\n❌ HASH MISMATCHES DETECTED:');
            results.filter(r => !r.matches).forEach(result => {
                console.log(`  - ${result.filename}`);
                console.log(`    Original: ${result.originalHash}`);
                console.log(`    New:      ${result.newHash || 'NULL'}`);
                if (result.error) {
                    console.log(`    Error:    ${result.error}`);
                }
            });
            
            console.log('\n🔍 DEBUGGING INFO:');
            console.log('This indicates the live scanning workflow is producing different AutoV2 hashes');
            console.log('than what was originally stored. Possible causes:');
            console.log('1. Hash calculation algorithm changed');
            console.log('2. File corruption or modification');
            console.log('3. Different hash calculation method being used');
            console.log('4. Bug in the scanning workflow');
        } else {
            console.log('\n✅ ALL HASHES MATCHED - Live scanning workflow is working correctly!');
        }
        
        // Step 7: Restore original hashes
        console.log('\n🔄 Restoring original hashes...');
        const restoreStmt = db.prepare('UPDATE models SET hash_autov2 = ?, hash_sha256 = ? WHERE id = ?');
        const restoreTransaction = db.transaction(() => {
            for (const test of testData) {
                restoreStmt.run(test.originalHash, test.originalSHA256, test.id);
            }
        });
        restoreTransaction();
        
        console.log('✅ Original hashes restored');
        db.close();
        
    } catch (error) {
        console.error('\n❌ === TEST FAILED ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
if (require.main === module) {
    testAutoV2HashCalculation();
}

module.exports = { testAutoV2HashCalculation }; 