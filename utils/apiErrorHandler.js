/**
 * apiErrorHandler.js
 * Standardized error handling for the MobileSD API
 */

const apiLogger = require('./apiLogger');

/**
 * Error codes and their corresponding messages and HTTP status codes
 */
const ERROR_TYPES = {
    // Authentication errors
    AUTHENTICATION_REQUIRED: {
        code: 'authentication_required',
        message: 'Authentication is required for this endpoint',
        status: 401
    },
    INVALID_API_KEY: {
        code: 'invalid_api_key',
        message: 'The provided API key is invalid or expired',
        status: 401
    },
    API_KEY_RATE_LIMIT: {
        code: 'api_key_rate_limit',
        message: 'Rate limit exceeded for this API key',
        status: 429
    },

    // Request validation errors
    MISSING_REQUIRED_FIELD: {
        code: 'missing_required_field',
        message: 'A required field is missing from the request',
        status: 400
    },
    INVALID_FIELD_VALUE: {
        code: 'invalid_field_value',
        message: 'One or more field values are invalid',
        status: 400
    },
    SERVER_NOT_FOUND: {
        code: 'server_not_found',
        message: 'The specified server was not found',
        status: 404
    },

    // Job-related errors
    JOB_NOT_FOUND: {
        code: 'job_not_found',
        message: 'The specified job was not found',
        status: 404
    },
    JOB_OPERATION_INVALID: {
        code: 'job_operation_invalid',
        message: 'The requested operation cannot be performed on this job in its current state',
        status: 400
    },
    CHECKPOINT_NOT_FOUND: {
        code: 'checkpoint_not_found',
        message: 'The specified checkpoint model was not found',
        status: 404
    },

    // Database errors
    DATABASE_ERROR: {
        code: 'database_error',
        message: 'An error occurred when accessing the database',
        status: 500
    },
    QUEUE_ERROR: {
        code: 'queue_error',
        message: 'An error occurred with the job queue',
        status: 500
    },

    // Server errors
    INTERNAL_SERVER_ERROR: {
        code: 'internal_server_error',
        message: 'An unexpected error occurred on the server',
        status: 500
    },
    SERVER_CONFIG_ERROR: {
        code: 'server_config_error',
        message: 'An error occurred with the server configuration',
        status: 500
    },

    // API key management errors
    API_KEY_CREATE_ERROR: {
        code: 'api_key_create_error',
        message: 'Failed to create API key',
        status: 500
    },
    API_KEY_DELETE_ERROR: {
        code: 'api_key_delete_error',
        message: 'Failed to delete API key',
        status: 500
    },
    API_KEY_UPDATE_ERROR: {
        code: 'api_key_update_error',
        message: 'Failed to update API key',
        status: 500
    },
    API_KEY_NOT_FOUND: {
        code: 'api_key_not_found',
        message: 'The specified API key was not found',
        status: 404
    }
};

/**
 * Creates a standardized error response object
 * @param {string} errorType - The type of error from ERROR_TYPES
 * @param {object} details - Additional details about the error
 * @param {Error} originalError - The original error object (optional)
 * @returns {object} A standardized error response object
 */
function createErrorResponse(errorType, details = {}, originalError = null) {
    if (!ERROR_TYPES[errorType]) {
        console.error(`Unknown error type: ${errorType}`);
        errorType = 'INTERNAL_SERVER_ERROR';
    }

    const error = ERROR_TYPES[errorType];
    
    // Extract message from original error if available
    const errorDetails = originalError 
        ? { ...details, errorMessage: originalError.message }
        : details;

    return {
        success: false,
        error: error.code,
        message: details.customMessage || error.message,
        details: errorDetails
    };
}

/**
 * Handles API errors in a standardized way
 * @param {object} res - Express response object
 * @param {string} errorType - The type of error from ERROR_TYPES
 * @param {object} req - Express request object for logging
 * @param {object} details - Additional details about the error
 * @param {Error} originalError - The original error object (optional)
 */
function handleApiError(res, errorType, req, details = {}, originalError = null) {
    if (!ERROR_TYPES[errorType]) {
        console.error(`Unknown error type: ${errorType}`);
        errorType = 'INTERNAL_SERVER_ERROR';
    }

    const error = ERROR_TYPES[errorType];
    const errorResponse = createErrorResponse(errorType, details, originalError);
    
    // Log the error
    if (req && apiLogger) {
        const requestInfo = apiLogger.getSafeRequestInfo(req);
        apiLogger.logApiError(error.message, {
            request: requestInfo,
            error: error.code,
            details: details,
            originalError: originalError ? originalError.message : null
        });
    } else {
        console.error(`API Error [${error.code}]:`, error.message, details, originalError);
    }
    
    // Send the response
    res.status(error.status).json(errorResponse);
}

module.exports = {
    ERROR_TYPES,
    createErrorResponse,
    handleApiError
}; 