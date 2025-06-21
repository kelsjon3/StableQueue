const Database = require('better-sqlite3');
const path = require('path');

// Connect to the database
const dbPath = './data/mobilesd_models.sqlite';
const db = new Database(dbPath);

console.log('=== CHECKING DATABASE PATHS ===');
console.log('Sample records from models table:');

// Get a few sample records to see path formats
const sampleModels = db.prepare('SELECT id, filename, local_path FROM models LIMIT 10').all();

sampleModels.forEach(model => {
    console.log(`ID: ${model.id}`);
    console.log(`  filename: "${model.filename}"`);  
    console.log(`  local_path: "${model.local_path}"`);
    console.log('');
});

console.log('=== CHECKING SPECIFIC MODELS ===');

// Check for some specific models we saw in the logs
const testFiles = [
    'diffusion_pytorch_model-00001-of-00003.safetensors',
    'film_net_fp16.pt', 
    'ltx-video-2b-v0.9.safetensors',
    'MeinaMix.safetensors'
];

testFiles.forEach(filename => {
    const matches = db.prepare('SELECT id, filename, local_path FROM models WHERE filename = ?').all(filename);
    console.log(`Looking for "${filename}":`);
    if (matches.length > 0) {
        matches.forEach(match => {
            console.log(`  FOUND: id=${match.id}, local_path="${match.local_path}"`);
        });
    } else {
        console.log(`  NOT FOUND`);
    }
    console.log('');
});

db.close(); 