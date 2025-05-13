const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// TODO: Consider making this path configurable, e.g., via an environment variable
// For now, place it alongside servers.json if CONFIG_DATA_PATH is used, or in a default 'data' dir.
const DATA_DIR = process.env.CONFIG_DATA_PATH || path.join(__dirname, '..', 'data');
const JOBS_FILE_PATH = path.join(DATA_DIR, 'jobs.json');

/**
 * Ensures the data directory and the jobs.json file exist.
 * If jobs.json doesn't exist, it creates an empty one.
 */
async function initializeQueue() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.access(JOBS_FILE_PATH);
        console.log('Job queue file already exists:', JOBS_FILE_PATH);
    } catch (error) {
        // File doesn't exist, create it with an empty array
        console.log('Job queue file not found, creating one:', JOBS_FILE_PATH);
        await fs.writeFile(JOBS_FILE_PATH, JSON.stringify([], null, 2));
    }
}

/**
 * Reads all jobs from jobs.json.
 * @returns {Promise<Array>}
A promise that resolves to an array of job objects.
 * Returns an empty array if the file doesn't exist or an error occurs.
 */
async function readJobs() {
    try {
        await fs.access(JOBS_FILE_PATH); // Check if file exists first
        const data = await fs.readFile(JOBS_FILE_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading jobs file, or file does not exist yet:', error.message);
        // If file doesn't exist or is invalid, return empty array to allow starting fresh
        // InitializeQueue should handle creation on startup if it's missing.
        return [];
    }
}

/**
 * Writes an array of jobs to jobs.json.
 * @param {Array} jobsArray - The array of job objects to write.
 * @returns {Promise<void>}
 */
async function writeJobs(jobsArray) {
    try {
        await fs.writeFile(JOBS_FILE_PATH, JSON.stringify(jobsArray, null, 2));
    } catch (error) {
        console.error('Error writing jobs file:', error);
        throw error; // Re-throw to indicate failure to the caller
    }
}

/**
 * Adds a new job to the queue.
 * @param {Object} jobParams - The parameters for the new job, typically from req.body.
 *                               Should include target_server_alias and generation_params.
 * @returns {Promise<Object>} The newly created job object.
 */
async function addJob(jobParams) {
    const jobs = await readJobs();
    const newJob = {
        mobilesd_job_id: crypto.randomUUID(),
        status: 'pending', // Initial status
        creation_timestamp: new Date().toISOString(),
        completion_timestamp: null,
        target_server_alias: jobParams.server_alias, // Assuming server_alias is passed in jobParams
        forge_session_hash: null,
        generation_params: { ...jobParams }, // Store all incoming params under generation_params
        result_details: {
            saved_filenames: [],
            error_message: null,
        },
    };
    delete newJob.generation_params.server_alias; // Avoid duplication

    jobs.push(newJob);
    await writeJobs(jobs);
    return newJob;
}

/**
 * Retrieves a job by its MobileSD Job ID.
 * @param {string} mobilesdJobId - The ID of the job to retrieve.
 * @returns {Promise<Object|null>} The job object if found, otherwise null.
 */
async function getJobById(mobilesdJobId) {
    const jobs = await readJobs();
    return jobs.find(job => job.mobilesd_job_id === mobilesdJobId) || null;
}

/**
 * Updates an existing job in the queue.
 * @param {string} mobilesdJobId - The ID of the job to update.
 * @param {Object} updates - An object containing the fields to update.
 * @returns {Promise<Object|null>} The updated job object, or null if not found.
 */
async function updateJob(mobilesdJobId, updates) {
    const jobs = await readJobs();
    const jobIndex = jobs.findIndex(job => job.mobilesd_job_id === mobilesdJobId);
    if (jobIndex === -1) {
        return null; // Job not found
    }

    // Merge updates into the existing job
    // Special handling for result_details to merge its sub-properties if provided
    if (updates.result_details) {
        jobs[jobIndex].result_details = {
            ...jobs[jobIndex].result_details,
            ...updates.result_details
        };
        delete updates.result_details; // Remove from updates to avoid overwriting the merge
    }

    jobs[jobIndex] = { ...jobs[jobIndex], ...updates };
    
    // If status is completed or failed, set completion_timestamp
    if ((updates.status === 'completed' || updates.status === 'failed') && !jobs[jobIndex].completion_timestamp) {
        jobs[jobIndex].completion_timestamp = new Date().toISOString();
    }

    await writeJobs(jobs);
    return jobs[jobIndex];
}

/**
 * Retrieves all jobs with a 'pending' status.
 * @returns {Promise<Array>} An array of pending job objects.
 */
async function getPendingJobs() {
    const jobs = await readJobs();
    return jobs.filter(job => job.status === 'pending');
}

// Initialize the queue when this module is loaded
// (async () => await initializeQueue())(); 
// Re-evaluating the above: initializeQueue should be called explicitly from app.js on startup.

module.exports = {
    initializeQueue,
    readJobs,
    writeJobs,
    addJob,
    getJobById,
    updateJob,
    getPendingJobs
}; 