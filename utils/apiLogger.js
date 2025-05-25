/**
 * API Logger
 * 
 * Handles logging of API key usage and access attempts for MobileSD API.
 * Logs API key creation, authentication attempts, and API endpoint access.
 */

const fs = require('fs');
const path = require('path');

// --- Configuration ---
const projectRootDir = path.join(__dirname, '..');
const dataDir = path.join(projectRootDir, 'data');
const logsDir = path.join(dataDir, 'logs');
const apiLogFile = path.join(logsDir, 'api_access.log');
const apiErrorLogFile = path.join(logsDir, 'api_errors.log');

// Ensure log directory exists
function ensureLogDirectory() {
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
    } catch (err) {
        console.error('Failed to create log directories:', err);
        throw err; // Re-throw to prevent silent failures
    }
 }

/**
 * Formats a log entry with timestamp and consistent structure
 * @param {string} type - Type of log entry (AUTH, ACCESS, ERROR)
 * @param {string} message - Log message
 * @param {object} details - Additional details to include in the log
 * @returns {string} Formatted log entry
 */
function formatLogEntry(type, message, details = {}) {
    const timestamp = new Date().toISOString();
    const logObject = {
        timestamp,
        type,
        message,
        ...details
    };
    
    return JSON.stringify(logObject);
}

/**
 * Logs an API access event to the API access log file
 * @param {string} message - Log message
 * @param {object} details - Additional details to include in the log
 */
function logApiAccess(message, details = {}) {
    ensureLogDirectory();
    
    const logEntry = formatLogEntry('ACCESS', message, details);
    
    fs.appendFile(apiLogFile, logEntry + '\n', (err) => {
        if (err) {
            console.error('Error writing to API access log:', err);
        }
    });
    
    // Also log to console in development environment
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[API Access] ${message}`, details);
    }
}

/**
 * Logs an API authentication event to the API access log file
 * @param {string} message - Log message
 * @param {object} details - Additional details to include in the log
 */
function logApiAuth(message, details = {}) {
    ensureLogDirectory();
    
    const logEntry = formatLogEntry('AUTH', message, details);
    
    fs.appendFile(apiLogFile, logEntry + '\n', (err) => {
        if (err) {
            console.error('Error writing to API access log:', err);
        }
    });
    
    // Also log to console in development environment
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[API Auth] ${message}`, details);
    }
}

/**
 * Logs an API error event to the API error log file
 * @param {string} message - Log message
 * @param {object} details - Additional details to include in the log
 */
function logApiError(message, details = {}) {
    ensureLogDirectory();
    
    const logEntry = formatLogEntry('ERROR', message, details);
    
    fs.appendFile(apiErrorLogFile, logEntry + '\n', (err) => {
        if (err) {
            console.error('Error writing to API error log:', err);
        }
    });
    
    // Always log errors to console
    console.error(`[API Error] ${message}`, details);
}

/**
 * Gets sensitive data safe request information for logging
 * @param {object} req - Express request object
 * @returns {object} Safe request information for logging
 */
function getSafeRequestInfo(req) {
    // Create a safe version of the request that doesn't include sensitive data
    return {
        method: req.method,
        url: req.url,
        path: req.path,
        query: req.query,
        // Only include specific safe headers
        headers: {
            'user-agent': req.headers['user-agent'],
            'content-type': req.headers['content-type'],
            'accept': req.headers['accept'],
            'referer': req.headers['referer'],
            'origin': req.headers['origin']
        },
        ip: req.ip || req.connection.remoteAddress,
        // Include a boolean indicating if API key was present but don't include the actual key
        hasApiKey: !!req.headers['x-api-key'],
        // Include the actual API key ID from req (if authenticated)
        apiKeyId: req.apiKeyId
    };
}

module.exports = {
    logApiAccess,
    logApiAuth,
    logApiError,
    getSafeRequestInfo
}; 