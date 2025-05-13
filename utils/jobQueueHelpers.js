const fs = require('fs').promises;
const path = require('path');

const JOB_QUEUE_FILENAME = 'job_queue.json';

function getJobQueuePath() {
    const configDir = process.env.CONFIG_DATA_PATH || path.join(__dirname, '..', 'data');
    // Ensure the directory exists (important for the first run or if volume isn't mounted correctly)
    // Use synchronous check here for simplicity during initialization phase,
    // but async operations will handle actual file I/O.
    // Consider moving this check to app startup if it causes issues.
    const fsSync = require('fs');
    if (!fsSync.existsSync(configDir)) {
        console.warn(`Job queue directory ${configDir} does not exist. Attempting to create.`);
        try {
            fsSync.mkdirSync(configDir, { recursive: true });
            console.log(`Created job queue directory: ${configDir}`);
        } catch (err) {
            console.error(`Fatal: Could not create job queue directory ${configDir}:`, err);
            // Depending on desired behavior, you might want to exit or throw an error here.
            // For now, we'll proceed and let subsequent file operations fail if needed.
        }
    }
    return path.join(configDir, JOB_QUEUE_FILENAME);
}

async function readJobQueue() {
    const filePath = getJobQueuePath();
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, return empty queue
            return [];
        }
        console.error(`Error reading job queue file (${filePath}):`, error);
        throw error; // Re-throw error to be handled by caller
    }
}

async function writeJobQueue(queue) {
    const filePath = getJobQueuePath();
    try {
        const data = JSON.stringify(queue, null, 2); // Pretty print JSON
        await fs.writeFile(filePath, data, 'utf8');
    } catch (error) {
        console.error(`Error writing job queue file (${filePath}):`, error);
        throw error; // Re-throw error to be handled by caller
    }
}

async function addJobToQueue(jobData) {
     const queue = await readJobQueue();
     queue.push(jobData);
     await writeJobQueue(queue);
     return jobData; // Return the added job data (which includes the ID)
}

async function updateJobInQueue(jobId, updates) {
    const queue = await readJobQueue();
    const jobIndex = queue.findIndex(job => job.mobilesd_job_id === jobId);
    if (jobIndex === -1) {
        console.error(`Error updating job: Job with ID ${jobId} not found.`);
        throw new Error(`Job with ID ${jobId} not found.`);
    }

    // Merge updates into the existing job object
    queue[jobIndex] = { ...queue[jobIndex], ...updates };

    await writeJobQueue(queue);
    return queue[jobIndex]; // Return the updated job
}

async function getJobById(jobId) {
    const queue = await readJobQueue();
    const job = queue.find(job => job.mobilesd_job_id === jobId);
    // Return the job object or undefined if not found
    // The caller (dispatcher) should handle the case where the job is not found
    return job; 
}

module.exports = {
    readJobQueue,
    writeJobQueue,
    addJobToQueue,
    getJobQueuePath,
    updateJobInQueue,
    getJobById
}; 