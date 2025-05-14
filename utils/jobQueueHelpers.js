const fsPromises = require('fs').promises;
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

const JOB_QUEUE_FILENAME = 'job_queue.json';

// --- Database Setup ---
// Determine the project's root directory more reliably
// Assuming this file is in /utils, so '..' goes up to the project root.
const projectRootDir = path.join(__dirname, '..'); 
const dataDir = path.join(projectRootDir, 'data');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'mobilesd_jobs.sqlite');
const db = new Database(dbPath /*, { verbose: console.log } */); // Uncomment verbose for SQL debugging

// --- Schema Initialization ---
const schema = `
CREATE TABLE IF NOT EXISTS jobs (
    mobilesd_job_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    creation_timestamp TEXT NOT NULL,
    last_updated_timestamp TEXT NOT NULL,
    completion_timestamp TEXT,
    target_server_alias TEXT NOT NULL,
    forge_session_hash TEXT,
    generation_params_json TEXT NOT NULL,
    result_details_json TEXT,
    retry_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_creation ON jobs (status, creation_timestamp);
`;
db.exec(schema);

// --- Helper Functions ---

/**
 * Adds a new job to the queue.
 * @param {object} jobData - Contains target_server_alias and generation_params.
 *                           Example: { target_server_alias: "forge1", generation_params: { prompt: "A cat" } }
 * @returns {object} The full job object as constructed for DB insertion.
 */
function addJob(jobData) {
    const newJobId = uuidv4();
    const now = new Date().toISOString();
    
    const jobRecord = {
        mobilesd_job_id: newJobId,
        status: 'pending',
        creation_timestamp: now,
        last_updated_timestamp: now,
        completion_timestamp: null,
        target_server_alias: jobData.target_server_alias,
        forge_session_hash: null,
        generation_params_json: JSON.stringify(jobData.generation_params || {}),
        result_details_json: null,
        retry_count: 0
    };

    const stmt = db.prepare(
        'INSERT INTO jobs ('
        + 'mobilesd_job_id, status, creation_timestamp, last_updated_timestamp, ' 
        + 'completion_timestamp, target_server_alias, forge_session_hash,'
        + 'generation_params_json, result_details_json, retry_count'
        + ') VALUES ('
        + '@mobilesd_job_id, @status, @creation_timestamp, @last_updated_timestamp,'
        + '@completion_timestamp, @target_server_alias, @forge_session_hash,'
        + '@generation_params_json, @result_details_json, @retry_count'
        + ')'
    );

    try {
        stmt.run(jobRecord);
        return jobRecord;
    } catch (error) {
        console.error("Error adding job to database:", error);
        throw error;
    }
}

/**
 * Retrieves a job by its ID.
 * @param {string} mobilesdJobId
 * @returns {object|null} The job object with parsed JSON fields, or null if not found.
 */
function getJobById(mobilesdJobId) {
    const stmt = db.prepare('SELECT * FROM jobs WHERE mobilesd_job_id = ?');
    const row = stmt.get(mobilesdJobId);

    if (row) {
        return {
            ...row,
            generation_params: JSON.parse(row.generation_params_json || '{}'),
            result_details: row.result_details_json ? JSON.parse(row.result_details_json) : null,
            // Ensure all fields are present, even if null from DB
            mobilesd_job_id: row.mobilesd_job_id,
            status: row.status,
            creation_timestamp: row.creation_timestamp,
            last_updated_timestamp: row.last_updated_timestamp,
            completion_timestamp: row.completion_timestamp,
            target_server_alias: row.target_server_alias,
            forge_session_hash: row.forge_session_hash,
            retry_count: row.retry_count
        };
    }
    return null;
}

/**
 * Updates an existing job.
 * @param {string} mobilesdJobId
 * @param {object} updates - Object containing fields to update.
 * @returns {object|null} The updated job object fetched from DB or null if not found/not updated.
 */
function updateJob(mobilesdJobId, updates) {
    const jobExists = getJobById(mobilesdJobId); // Check if job exists first
    if (!jobExists) {
        console.warn("Attempted to update non-existent job:", mobilesdJobId);
        return null;
    }

    const updateFields = { ...updates };
    updateFields.last_updated_timestamp = new Date().toISOString();

    if (updateFields.hasOwnProperty('generation_params')) {
        updateFields.generation_params_json = JSON.stringify(updateFields.generation_params);
        delete updateFields.generation_params;
    }
    if (updateFields.hasOwnProperty('result_details')) {
        updateFields.result_details_json = JSON.stringify(updateFields.result_details);
        delete updateFields.result_details;
    }
    
    const allowedColumns = [
        'status', 'last_updated_timestamp', 'completion_timestamp', 
        'forge_session_hash', 'generation_params_json', 'result_details_json', 
        'retry_count'
    ];
    
    const setClauses = [];
    const values = {};

    for (const key in updateFields) {
        if (allowedColumns.includes(key) || (key.endsWith('_json') && allowedColumns.includes(key))) {
            setClauses.push(`${key} = @${key}`);
            values[key] = updateFields[key];
        }
    }

    if (setClauses.length === 0) {
        // If only last_updated_timestamp was technically the change, but no other valid fields.
        // Still, we should update last_updated_timestamp if that was the only intended change.
        if (updates.hasOwnProperty('last_updated_timestamp') && Object.keys(updates).length === 1) {
             setClauses.push('last_updated_timestamp = @last_updated_timestamp');
             values.last_updated_timestamp = updateFields.last_updated_timestamp;
        } else {
            console.warn("No valid fields to update for job:", mobilesdJobId, "Updates:", updates);
            return getJobById(mobilesdJobId);
        }
    }

    const sql = `UPDATE jobs SET ${setClauses.join(', ')} WHERE mobilesd_job_id = @mobilesd_job_id`;
    values.mobilesd_job_id = mobilesdJobId;
    
    const stmt = db.prepare(sql);
    
    try {
        const result = stmt.run(values);
        if (result.changes > 0) {
            return getJobById(mobilesdJobId);
        }
        // If changes is 0, but the job exists, it might mean the values were the same.
        // Return the current state of the job.
        return getJobById(mobilesdJobId);
    } catch (error) {
        console.error("Error updating job in database:", error, "SQL:", sql, "Values:", values);
        throw error;
    }
}

/**
 * Finds all pending jobs, oldest first.
 * @returns {Array<object>} Array of pending job objects with parsed JSON.
 */
function findPendingJobs() {
    const stmt = db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY creation_timestamp ASC");
    const rows = stmt.all();
    return rows.map(row => ({
        ...row,
        generation_params: JSON.parse(row.generation_params_json || '{}'),
        result_details: row.result_details_json ? JSON.parse(row.result_details_json) : null
    }));
}

/**
 * Finds all jobs with a specific status, ordered by creation_timestamp.
 * @param {string} status - The status to filter by.
 * @param {'ASC' | 'DESC'} order - Sort order (ASC or DESC).
 * @returns {Array<object>} Array of job objects with parsed JSON.
 */
function getJobsByStatus(status, order = 'ASC') {
    if (!['ASC', 'DESC'].includes(order.toUpperCase())) {
        throw new Error("Invalid order direction. Must be 'ASC' or 'DESC'.");
    }
    const stmt = db.prepare(`SELECT * FROM jobs WHERE status = ? ORDER BY creation_timestamp ${order.toUpperCase()}`);
    const rows = stmt.all(status);
    return rows.map(row => ({
        ...row,
        generation_params: JSON.parse(row.generation_params_json || '{}'),
        result_details: row.result_details_json ? JSON.parse(row.result_details_json) : null
    }));
}

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
        const data = await fsPromises.readFile(filePath, 'utf8');
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
        await fsPromises.writeFile(filePath, data, 'utf8');
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

// Optional: Close the database connection when the application exits
// This is good practice, though Node.js often handles this.
// process.on('exit', () => db.close());
// process.on('SIGINT', () => { db.close(); process.exit(); }); // For Ctrl+C

/**
 * Gets all jobs with optional filtering and pagination.
 * @param {object} options - Options for filtering and pagination
 * @param {string} options.status - Optional filter by status
 * @param {number} options.limit - Optional limit on the number of jobs to return
 * @param {number} options.offset - Optional offset for pagination
 * @param {'DESC'|'ASC'} options.order - Optional sort order, defaults to DESC (newest first)
 * @returns {Array<object>} Array of job objects with parsed JSON fields
 */
function getAllJobs(options = {}) {
    const { status, limit, offset, order = 'DESC' } = options;
    
    let query = 'SELECT * FROM jobs';
    const queryParams = [];
    
    if (status) {
        query += ' WHERE status = ?';
        queryParams.push(status);
    }
    
    query += ` ORDER BY creation_timestamp ${order === 'ASC' ? 'ASC' : 'DESC'}`;
    
    if (limit !== undefined) {
        query += ' LIMIT ?';
        queryParams.push(limit);
        
        if (offset !== undefined) {
            query += ' OFFSET ?';
            queryParams.push(offset);
        }
    }
    
    const stmt = db.prepare(query);
    let rows;
    
    if (queryParams.length > 0) {
        rows = stmt.all(...queryParams);
    } else {
        rows = stmt.all();
    }
    
    return rows.map(row => ({
        ...row,
        generation_params: JSON.parse(row.generation_params_json || '{}'),
        result_details: row.result_details_json ? JSON.parse(row.result_details_json) : null
    }));
}

/**
 * Deletes a job from the database.
 * @param {string} mobilesdJobId - The ID of the job to delete
 * @returns {boolean} True if the job was deleted, false if the job was not found
 */
function deleteJob(mobilesdJobId) {
    const stmt = db.prepare('DELETE FROM jobs WHERE mobilesd_job_id = ?');
    const result = stmt.run(mobilesdJobId);
    return result.changes > 0;
}

/**
 * Marks a job as cancelled.
 * @param {string} mobilesdJobId - The ID of the job to cancel
 * @returns {object|null} The updated job object or null if the job was not found
 */
function cancelJob(mobilesdJobId) {
    return updateJob(mobilesdJobId, {
        status: 'cancelled',
        completion_timestamp: new Date().toISOString(),
        result_details: { cancelled: true, message: 'Job cancelled by user' }
    });
}

module.exports = {
    addJob,
    getJobById,
    updateJob,
    findPendingJobs,
    getJobsByStatus,
    readJobQueue,
    writeJobQueue,
    addJobToQueue,
    getJobQueuePath,
    updateJobInQueue,
    getAllJobs,
    deleteJob,
    cancelJob
}; 