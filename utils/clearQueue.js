/**
 * Utility script to clear all pending and processing jobs in the queue
 * Run with: node utils/clearQueue.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Set up database connection
const projectRootDir = path.join(__dirname, '..');
const dataDir = path.join(projectRootDir, 'data');
const dbPath = path.join(dataDir, 'mobilesd_jobs.sqlite');

if (!fs.existsSync(dbPath)) {
    console.log(`Database file not found at ${dbPath}. No jobs to clear.`);
    process.exit(0);
}

console.log(`Opening database at ${dbPath}`);
const db = new Database(dbPath);

try {
    // First check if the jobs table exists
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
    
    if (!tableExists) {
        console.log("Jobs table doesn't exist in the database. Nothing to clear.");
        process.exit(0);
    }
    
    // Get counts before clearing
    const pendingCount = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get().count;
    const processingCount = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'processing'").get().count;
    
    console.log(`Found ${pendingCount} pending and ${processingCount} processing jobs.`);
    
    if (pendingCount > 0 || processingCount > 0) {
        // Mark all pending and processing jobs as cancelled
        const updateResult = db.prepare("UPDATE jobs SET status = 'cancelled' WHERE status IN ('pending', 'processing')").run();
        
        console.log(`Marked ${updateResult.changes} jobs as cancelled.`);
    } else {
        console.log("No pending or processing jobs to cancel.");
    }
    
    // Optional: List all jobs in the database
    console.log("\nCurrent job statuses in database:");
    const statusCounts = db.prepare("SELECT status, COUNT(*) as count FROM jobs GROUP BY status").all();
    statusCounts.forEach(status => {
        console.log(`${status.status}: ${status.count} jobs`);
    });
    
    console.log("\nQueue clearing complete!");
} catch (error) {
    console.error("Error clearing job queue:", error);
} finally {
    // Close the database connection
    db.close();
} 