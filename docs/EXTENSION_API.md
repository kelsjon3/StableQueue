# StableQueue Extension API Documentation

This document provides detailed information for developers creating extensions that interact with StableQueue. It focuses on the v2 API endpoints that are specifically designed for extension support.

## Authentication

All v2 API endpoints require authentication using an API key. You must include the API key in the request headers:

```
Authorization: Bearer YOUR_API_KEY
```

API keys can be created and managed through the StableQueue API key management endpoints.

## API Base URL

The base URL for all v2 API endpoints is:

```
http://YOUR_STABLEQUEUE_SERVER:3000/api/v2
```

Replace `YOUR_STABLEQUEUE_SERVER` with the hostname or IP address of your StableQueue server.

## Rate Limiting

API requests are subject to rate limiting based on the tier associated with your API key. The current rate limits are:

- Standard tier: 60 requests per minute
- Premium tier: 300 requests per minute

Job submission endpoints (`/generate`) have separate rate limits based on the number of jobs that can be submitted within a time period.

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
      "source_info": "forge_extension_v1.0.0"
    }
    // Additional jobs...
  ]
}
```

#### POST /jobs/:jobId/cancel

Cancels a job that is either pending or in progress.

**Request Headers:**
```
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "success": true,
  "message": "Job cancelled successfully.",
  "job": {
    "stablequeue_job_id": "3e5128a1-456a-49d8-82f1-7c7351e8600a",
    "status": "cancelled",
    "creation_timestamp": "2023-05-14T03:53:01.109Z",
    "last_updated_timestamp": "2023-05-14T03:53:13.841Z",
    "completion_timestamp": "2023-05-14T03:53:13.841Z",
    "target_server_alias": "Main",
    "forge_session_hash": "b7a86201-6956-43bb-9fc5-03aa3048eb58",
    "generation_params": {
      "positive_prompt": "another test job for cancellation API test",
      "negative_prompt": "low quality",
      "checkpoint_name": "models/Pony/cyberrealisticPony_v8.safetensors",
      "width": 512,
      "height": 512,
      "steps": 30,
      "sampler_name": "Euler"
    },
    "result_details": {
      "cancelled": true,
      "message": "Job cancelled by user"
    },
    "retry_count": 0,
    "app_type": "forge",
    "source_info": "forge_extension_v1.0.0"
  }
}
```

## Error Handling

All API endpoints return a standard error response format when an error occurs:

```json
{
  "success": false,
  "error": "Error message describing what went wrong",
  "message": "Additional details about the error (if available)"
}
```

Common error codes:
- 400: Bad Request (missing or invalid parameters)
- 401: Unauthorized (missing or invalid API key)
- 404: Not Found (server alias or job ID not found)
- 429: Too Many Requests (rate limit exceeded)
- 500: Internal Server Error

## Best Practices for Extension Developers

1. **Proper Authentication**: Always secure your API key and don't expose it in client-side code.

2. **Error Handling**: Implement robust error handling to manage API failures gracefully.

3. **Rate Limiting**: Respect rate limits and implement exponential backoff for retries.

4. **Identification**: Set meaningful `source_info` values to help identify your extension in logs and when troubleshooting.

5. **Polling Strategy**: When checking job status, implement a progressive polling strategy:
   - Start with short intervals (1-2 seconds) for pending jobs
   - Switch to longer intervals (5-10 seconds) when job is processing
   - Use exponential backoff if the API returns errors

6. **Bulk Job Management**: For bulk job submissions, maintain a client-side record of all jobs in a batch to enable cancellation or status tracking.

7. **Job Cancellation**: Allow users to cancel jobs that are pending or in progress.

8. **User Feedback**: Provide meaningful feedback to users about job progress, queue position, and estimated time.

## Implementation Examples

### Job Submission Example (JavaScript)

```javascript
async function submitJob(apiKey, jobData) {
  try {
    const response = await fetch('http://your-server:3000/api/v2/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(jobData)
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to submit job');
    }
    
    return data;
  } catch (error) {
    console.error('Error submitting job:', error);
    throw error;
  }
}
```

### Job Status Polling Example (JavaScript)

```javascript
async function pollJobStatus(apiKey, jobId, onStatusUpdate) {
  let pollInterval = 2000; // Start with 2 seconds
  let maxInterval = 10000; // Max 10 seconds
  
  const checkStatus = async () => {
    try {
      const response = await fetch(`http://your-server:3000/api/v2/jobs/${jobId}/status`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to get job status');
      }
      
      onStatusUpdate(data.job);
      
      // Adjust polling interval based on job status
      if (data.job.status === 'pending') {
        pollInterval = Math.min(pollInterval * 1.2, maxInterval); // Gradually increase interval
      } else if (data.job.status === 'processing') {
        pollInterval = 5000; // 5 seconds for processing jobs
      } else {
        // Job is completed, failed, or cancelled
        return; // Stop polling
      }
      
      // Schedule next poll
      setTimeout(checkStatus, pollInterval);
    } catch (error) {
      console.error('Error polling job status:', error);
      // Implement backoff for errors
      pollInterval = Math.min(pollInterval * 2, 30000); // Max 30 seconds on error
      setTimeout(checkStatus, pollInterval);
    }
  };
  
  // Start polling
  checkStatus();
}
```

## Frequently Asked Questions

### How can I batch submit multiple jobs?

Currently, you need to submit each job individually. You can track related jobs by including a custom identifier in the `generation_params` or by using a structured `source_info` field.

### How can I tell if a server is available?

The `/generate` endpoint will return an error if the specified `target_server_alias` is not found. It's recommended to handle this gracefully in your extension.

### Are there any size limits for generation parameters?

Yes, very large prompts or parameter objects may be rejected. Keep prompts reasonable (under 2000 characters) and don't include unnecessary parameters.

### How are images made available to the extension?

The `result_details.images` array contains the filenames of generated images. These are stored in the StableQueue server's configured output directory. Your extension would need to implement a way to retrieve these files or generate URLs to access them.

### How should I handle API keys in my extension?

Store API keys securely. For desktop applications, use a secure local storage option. Never include API keys in publicly accessible code repositories.

### What fields should I set for my extension?

At minimum, set:
- `app_type`: Should match your application (usually "forge")
- `source_info`: A string identifying your extension name and version 