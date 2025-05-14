# MobileSD API Documentation

This document provides details on the API endpoints available in the MobileSD application.

## Job Generation API

### POST /api/v1/generate

Adds a new job to the queue for image generation.

**Important Notes:**
- The prompt parameter must be named `positive_prompt` (not just `prompt`) to ensure proper handling
- Checkpoint paths can use either forward slashes or backslashes - the system will normalize them
- The API supports both relative paths (e.g., "Pony/cyberrealisticPony_v8.safetensors") and absolute paths

**Request:**
```json
{
  "target_server_alias": "Laptop",
  "generation_params": {
    "positive_prompt": "a beautiful landscape",
    "negative_prompt": "ugly, blurry",
    "checkpoint_name": "Pony/cyberrealisticPony_v8.safetensors",
    "width": 512,
    "height": 512,
    "steps": 20,
    "cfg_scale": 7,
    "sampler_name": "Euler",
    "restore_faces": false,
    "scheduler_or_quality_preset": "Balanced"
  }
}
```

**Response:**
```json
{
  "mobilesd_job_id": "88615c9d-71ec-4803-88b0-14f5162f6c66"
}
```

## Job Queue Management APIs

### GET /api/v1/queue/jobs/:jobId/status

Gets the status of a specific job.

**Response:**
```json
{
  "mobilesd_job_id": "88615c9d-71ec-4803-88b0-14f5162f6c66",
  "status": "completed",
  "creation_timestamp": "2025-05-14T02:34:48.985Z",
  "last_updated_timestamp": "2025-05-14T02:40:48.706Z",
  "completion_timestamp": "2025-05-14T02:40:48.706Z",
  "target_server_alias": "Laptop",
  "forge_session_hash": "a28b22e6-57da-4362-923a-f61c55a37d81",
  "generation_params": {
    "positive_prompt": "a pretty girl",
    "negative_prompt": "ugly",
    "checkpoint_name": "Pony/cyberrealisticPony_v85.safetensors",
    "style_preset": "simple",
    "sampling_category": "Both",
    "enable_hires_fix": false,
    "upscaler_model": "None",
    "refiner_model": "None",
    "num_images": 1,
    "seed": "",
    "subseed": "",
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
    "info": "Job completed and images downloaded by MobileSD backend.",
    "generation_info": {
      "prompt": "a pretty girl",
      "all_prompts": ["a pretty girl"],
      "negative_prompt": "ugly",
      "all_negative_prompts": ["ugly"],
      "seed": 1806652750
      // Additional generation details...
    }
  },
  "retry_count": 0
}
```

### GET /api/v1/queue/jobs

Gets all jobs in the queue with optional filtering and pagination.

**Query Parameters:**
- `status` (optional): Filter jobs by status (pending, processing, completed, failed, cancelled)
- `limit` (optional): Maximum number of jobs to return
- `offset` (optional): Number of jobs to skip (for pagination)
- `order` (optional): Sort order, 'asc' or 'desc' (default: 'desc')

**Response:**
```json
{
  "total": 25,
  "jobs": [
    {
      "mobilesd_job_id": "067c2def-0b3b-4ef1-8eb8-8ce087f4a3cf",
      "status": "pending",
      "creation_timestamp": "2025-05-14T03:50:01.109Z",
      "last_updated_timestamp": "2025-05-14T03:50:01.109Z",
      "completion_timestamp": null,
      "target_server_alias": "Laptop",
      "forge_session_hash": null,
      "generation_params": {
        "positive_prompt": "test job for API test",
        "negative_prompt": "bad quality",
        "checkpoint_name": "Pony/cyberrealisticPony_v8.safetensors",
        "width": 512,
        "height": 512,
        "steps": 5,
        "sampler_name": "Euler"
      },
      "result_details": null,
      "retry_count": 0
    },
    // Additional jobs...
  ]
}
```

### POST /api/v1/queue/jobs/:jobId/cancel

Cancels a job in the queue.

**Response:**
```json
{
  "message": "Job cancelled successfully.",
  "job": {
    "mobilesd_job_id": "3e5128a1-456a-49d8-82f1-7c7351e8600a",
    "status": "cancelled",
    "creation_timestamp": "2025-05-14T03:53:01.109Z",
    "last_updated_timestamp": "2025-05-14T03:53:13.841Z",
    "completion_timestamp": "2025-05-14T03:53:13.841Z",
    "target_server_alias": "Laptop",
    "forge_session_hash": "b7a86201-6956-43bb-9fc5-03aa3048eb58",
    "generation_params": {
      "positive_prompt": "another test job for cancellation API test",
      "negative_prompt": "low quality",
      "checkpoint_name": "Pony/cyberrealisticPony_v8.safetensors",
      "width": 512,
      "height": 512,
      "steps": 30,
      "sampler_name": "Euler"
    },
    "result_details": {
      "cancelled": true,
      "message": "Job cancelled by user"
    },
    "retry_count": 0
  }
}
```

### DELETE /api/v1/queue/jobs/:jobId

Deletes a job from the queue.

**Response:**
```json
{
  "message": "Job 3e5128a1-456a-49d8-82f1-7c7351e8600a deleted successfully."
}
```

## Server Configuration APIs

### GET /api/v1/servers

Gets all configured Stable Diffusion servers.

### POST /api/v1/servers

Adds a new Stable Diffusion server configuration.

### PUT /api/v1/servers/:alias

Updates an existing Stable Diffusion server configuration.

### DELETE /api/v1/servers/:alias

Deletes a Stable Diffusion server configuration.

## Resource APIs

### GET /api/v1/checkpoints

Gets a list of available model checkpoints.

### GET /api/v1/loras

Gets a list of available LoRA models.

## Civitai APIs

### GET /api/v1/civitai/image-info

Gets information about an image from Civitai.

### POST /api/v1/civitai/download-model

Downloads a model from Civitai to the server.

## Debugging APIs

### GET /api/v1/debug/verify-checkpoint

Verifies if a checkpoint exists on a Forge server and tests the path normalization process.

**Query Parameters:**
- `checkpoint_path` (required): The checkpoint path to verify (e.g., "Pony/cyberrealisticPony_v8.safetensors")
- `server_alias` (required): The alias of the server to check against

**Response:**
```json
{
  "success": true,
  "original_path": "Pony/cyberrealisticPony_v8.safetensors",
  "normalized_path": "Pony\\cyberrealisticPony_v8.safetensors",
  "matched_model": "Pony\\cyberrealisticPony_v8.safetensors [9f90c59f3a]",
  "available_models": [
    // List of all available models on the server
  ]
}
```

### GET /api/v1/debug/models-cache

Retrieves the current state of the model database cache.

**Response:**
```json
{
  "cache_size": 24,
  "models": [
    {
      "id": 1,
      "name": "cyberrealisticPony_v8",
      "path": "Pony/cyberrealisticPony_v8.safetensors",
      "normalized_path": "Pony\\cyberrealisticPony_v8.safetensors",
      "hash": "9f90c59f3a",
      "title": "Pony\\cyberrealisticPony_v8.safetensors [9f90c59f3a]",
      "aliases": [
        "Pony/cyberrealisticPony_v8.safetensors",
        "Pony\\cyberrealisticPony_v8.safetensors"
      ]
    },
    // Additional models...
  ]
}
``` 