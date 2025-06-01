# StableQueue Extension API Documentation

This document provides detailed information for developers creating extensions that interact with StableQueue. It focuses on the v2 API endpoints that are specifically designed for extension support.

## Authentication

All v2 API endpoints require authentication using an API key. You must include the API key in the request headers:

```
Authorization: Bearer YOUR_API_KEY
```

API keys can be created and managed through the StableQueue web interface at the **API Keys** tab. The web interface provides administrative access to create, view, edit, and delete API keys without requiring authentication.

### Getting Your First API Key

1. Navigate to the StableQueue web interface
2. Click on the "API Keys" tab
3. If no API keys exist, you'll see a first-time setup interface
4. Click "Create New Key" and provide a name and description
5. Copy the generated API key immediately (it won't be shown again)
6. Use this key in your extension's API calls

## API Base URL

The base URL for all v2 API endpoints is:

```
http://YOUR_STABLEQUEUE_SERVER:3000/api/v2
```

Replace `YOUR_STABLEQUEUE_SERVER` with the hostname or IP address of your StableQueue server.

## Rate Limiting

API requests are subject to rate limiting to ensure fair usage:

- **Standard Rate Limit**: 60 requests per minute per API key
- **Job Submission**: Additional limits may apply based on system capacity

If you exceed the rate limit, you'll receive a `429 Too Many Requests` response. Your extension should implement appropriate retry logic with exponential backoff.

## Cross-Origin Support (CORS)

StableQueue supports cross-origin requests from:

- `http://localhost:7860` (Default Forge port)
- `http://localhost:8080` 
- `http://localhost:3000`

This allows Forge extensions to communicate directly with StableQueue from the browser interface.

## API Endpoints

### Job Generation

#### POST /generate

Submits a new generation job to the StableQueue queue.

**Request Headers:**
```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

**Request Body:**
```json
{
  "app_type": "forge",
  "target_server_alias": "Main",
  "generation_params": {
    "positive_prompt": "a beautiful landscape",
    "negative_prompt": "ugly, blurry",
    "checkpoint_name": "models/Pony/cyberrealisticPony_v8.safetensors",
    "width": 512,
    "height": 512,
    "steps": 20,
    "cfg_scale": 7,
    "sampler_name": "Euler",
    "restore_faces": false,
    "scheduler_or_quality_preset": "Balanced"
  },
  "source_info": "forge_extension_v1.0.0"
}
```

**Required Fields:**
- `target_server_alias`: The alias of the target server configured in StableQueue
- `generation_params`: Object containing all parameters for image generation

**Optional Fields:**
- `app_type`: Type of application generating the job (default: "forge")
- `source_info`: String identifying the extension and version (default: "extension")

**Response:**
```json
{
  "success": true,
  "stablequeue_job_id": "88615c9d-71ec-4803-88b0-14f5162f6c66",
  "queue_position": 3,
  "app_type": "forge",
  "creation_timestamp": "2023-05-14T02:34:48.985Z",
  "target_server_alias": "Main"
}
```

### Job Status

#### GET /jobs/:jobId/status

Gets the status of a specific job with extension-specific fields.

**Request Headers:**
```
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "success": true,
  "job": {
    "stablequeue_job_id": "88615c9d-71ec-4803-88b0-14f5162f6c66",
    "status": "completed",
    "creation_timestamp": "2023-05-14T02:34:48.985Z",
    "last_updated_timestamp": "2023-05-14T02:40:48.706Z",
    "completion_timestamp": "2023-05-14T02:40:48.706Z",
    "target_server_alias": "Main",
    "forge_session_hash": "a28b22e6-57da-4362-923a-f61c55a37d81",
    "generation_params": {
      "positive_prompt": "a beautiful landscape",
      "negative_prompt": "ugly, blurry",
      "checkpoint_name": "models/Pony/cyberrealisticPony_v8.safetensors",
      "width": 512,
      "height": 512,
      "steps": 20,
      "cfg_scale": 7,
      "sampler_name": "Euler",
      "restore_faces": false,
      "scheduler_or_quality_preset": "Balanced"
    },
    "result_details": {
      "images": ["88615c9d_1747190448393_00028-1806652750.png"],
      "info": "Job completed and images downloaded by StableQueue backend.",
      "generation_info": {
        "prompt": "a beautiful landscape",
        "all_prompts": ["a beautiful landscape"],
        "negative_prompt": "ugly, blurry",
        "all_negative_prompts": ["ugly, blurry"],
        "seed": 1806652750
      }
    },
    "retry_count": 0,
    "app_type": "forge",
    "source_info": "forge_extension_v1.0.0",
    "api_key_id": "c7e9a3b4-d2f1-4e5a-8b7c-9d0e1f2g3h4i",
    "queue_position": null,
    "estimated_time_remaining": null
  }
}
```

**Extension-Specific Fields:**
- `app_type`: The application type associated with the job
- `source_info`: Information about the source of the job
- `queue_position`: Position in queue (only for pending jobs)
- `estimated_time_remaining`: Estimated seconds remaining (only for processing jobs)

### Job Queue Management

#### GET /jobs

Gets all jobs with optional filtering, including by app_type.

**Request Headers:**
```
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `status`: Filter by job status (pending, processing, completed, failed, cancelled)
- `app_type`: Filter by application type (forge, comfyui, etc.)
- `limit`: Maximum number of jobs to return
- `offset`: Number of jobs to skip (for pagination)
- `order`: Sort order, 'asc' or 'desc' (default: 'desc')

**Response:**
```json
{
  "success": true,
  "total": 25,
  "filters": {
    "status": "pending",
    "app_type": "forge",
    "limit": 10,
    "offset": 0,
    "order": "DESC"
  },
  "jobs": [
    {
      "stablequeue_job_id": "067c2def-0b3b-4ef1-8eb8-8ce087f4a3cf",
      "status": "pending",
      "creation_timestamp": "2023-05-14T03:50:01.109Z",
      "last_updated_timestamp": "2023-05-14T03:50:01.109Z",
      "completion_timestamp": null,
      "target_server_alias": "Main",
      "forge_session_hash": null,
      "generation_params": {
        "positive_prompt": "test job for API test",
        "negative_prompt": "bad quality",
        "checkpoint_name": "models/Pony/cyberrealisticPony_v8.safetensors",
        "width": 512,
        "height": 512,
        "steps": 5,
        "sampler_name": "Euler"
      },
      "result_details": null,
      "retry_count": 0,
      "app_type": "forge",
      "source_info": "forge_extension_v1.0.0",
      "api_key_id": "c7e9a3b4-d2f1-4e5a-8b7c-9d0e1f2g3h4i"
    }
    // Additional jobs...
  ]
}
```

#### POST /jobs/:jobId/cancel

Cancels a pending or processing job.

**Request Headers:**
```
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "success": true,
  "message": "Job cancelled successfully",
  "job": {
    "stablequeue_job_id": "067c2def-0b3b-4ef1-8eb8-8ce087f4a3cf",
    "status": "cancelled",
    "completion_timestamp": "2023-05-14T04:15:22.123Z"
  }
}
```

### Server Information

#### GET /servers

Gets available server configurations (requires authentication).

**Request Headers:**
```
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "success": true,
  "servers": [
    {
      "alias": "Main",
      "host": "192.168.1.100",
      "port": 7860,
      "description": "Primary Forge Server"
    }
  ]
}
```

## API Key Management

### For Extension Developers

API keys are managed through the StableQueue web interface. As an extension developer, you should:

1. **Instruct users** to visit the StableQueue web interface to create an API key
2. **Provide configuration** in your extension for users to enter their API key
3. **Store the key securely** in your extension's configuration
4. **Handle authentication errors** gracefully and prompt users to check their API key

### API Key Properties

When an API key is created, it has the following properties:

- **Unique Identifier**: Each key has a unique ID for tracking
- **Name**: Human-readable name set by the user
- **Description**: Optional description of the key's purpose
- **Active Status**: Keys can be enabled or disabled
- **Rate Limiting**: All keys have the same rate limits (no tiers)
- **Usage Tracking**: Usage statistics are tracked per key

## Error Handling

### HTTP Status Codes

- `200 OK`: Request successful
- `400 Bad Request`: Invalid request parameters
- `401 Unauthorized`: Invalid or missing API key
- `403 Forbidden`: API key lacks required permissions
- `404 Not Found`: Resource not found
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

### Error Response Format

```json
{
  "success": false,
  "error": "authentication_failed",
  "message": "Invalid API key provided",
  "details": {
    "code": "INVALID_API_KEY",
    "timestamp": "2023-05-14T10:30:00.000Z"
  }
}
```

### Common Error Scenarios

1. **Invalid API Key**: Ensure the API key is copied correctly from the web interface
2. **Rate Limit Exceeded**: Implement exponential backoff retry logic
3. **Server Not Found**: Check that the target server alias exists in StableQueue
4. **Network Issues**: Handle connection timeouts and network errors gracefully

## Best Practices

### 1. API Key Security

- Store API keys securely in your extension configuration
- Never log API keys in plain text
- Allow users to easily update their API key
- Validate API keys before making requests

### 2. Rate Limiting

- Implement client-side rate limiting to stay within limits
- Use exponential backoff for retry logic
- Queue requests on the client side if necessary
- Monitor rate limit headers in responses

### 3. Error Handling

- Always check the `success` field in responses
- Provide meaningful error messages to users
- Implement proper retry logic for transient errors
- Log errors for debugging but sanitize sensitive information

### 4. Job Management

- Poll job status at reasonable intervals (every 5-10 seconds)
- Implement proper cleanup for cancelled or failed jobs
- Allow users to cancel jobs from your extension interface
- Display progress information when available

### 5. User Experience

- Provide clear setup instructions for API key configuration
- Show meaningful status messages during job processing
- Handle long-running jobs gracefully with progress indicators
- Implement proper error recovery and user guidance

## Example Extension Integration

### Basic Job Submission

```javascript
class StableQueueClient {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }
  
  async submitJob(params) {
    const response = await fetch(`${this.baseUrl}/api/v2/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        app_type: 'forge',
        target_server_alias: 'Main',
        generation_params: params,
        source_info: 'my_extension_v1.0.0'
      })
    });
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message);
    }
    
    return result.stablequeue_job_id;
  }
  
  async getJobStatus(jobId) {
    const response = await fetch(`${this.baseUrl}/api/v2/jobs/${jobId}/status`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
    
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message);
    }
    
    return result.job;
  }
}
```

This documentation provides the foundation for building robust integrations with StableQueue's extension API. 