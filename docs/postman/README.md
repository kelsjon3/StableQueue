# StableQueue API Postman Collection

This directory contains a Postman collection for testing and exploring the StableQueue API endpoints. The collection includes both authentication endpoints and the v2 API endpoints for extension support.

## What is this collection?

The Postman collection is a JSON file that contains pre-configured API requests for all StableQueue API endpoints. It can be:

1. Imported into Postman for interactive testing
2. Used as reference documentation for API structure
3. Shared with developers who need to integrate with the StableQueue API

## Using the Collection without Postman

You don't need to install Postman to use this collection. The JSON file serves as a reference for:

- API endpoints and their structure
- Required headers and authentication format
- Request body formats with example values
- Available query parameters for filtering

You can use this information with any HTTP client or programming language.

## Importing into Postman (Optional)

If you want to use Postman for interactive testing:

1. Install Postman from [getpostman.com](https://www.getpostman.com/downloads/)
2. Open Postman and click "Import" in the top left
3. Select the `stablequeue_api_collection.json` file
4. Create an environment with the following variables:
   - `baseUrl`: Your StableQueue server URL (e.g., `http://localhost:3000`)
   - `apiKey`: A valid API key from your StableQueue server
   - `apiKeyId`: The ID of your API key (for management endpoints)
   - `serverAlias`: The alias of your target Stable Diffusion server
   - `jobId`: A job ID to use for status and cancel operations

## API Request Groups

The collection is organized into two main folders:

### Authentication

Endpoints for managing API keys:
- Create API Key
- List API Keys
- Get API Key
- Update API Key
- Delete API Key

### v2 API

Endpoints specifically designed for extension support:
- Submit Job - Create a new generation job
- Get Job Status - Check status with extension-specific fields
- List All Jobs - Get all jobs
- List Jobs with Filtering - Filter jobs by app_type and other criteria
- Cancel Job - Cancel a pending or processing job

## Using with curl

You can also use the examples as a reference for curl commands. For example:

```bash
# Submit a job
curl -X POST "http://localhost:3000/api/v2/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key_here" \
  -d '{
    "app_type": "forge",
    "target_server_alias": "Main",
    "generation_params": {
      "positive_prompt": "a beautiful landscape",
      "negative_prompt": "ugly, blurry",
      "checkpoint_name": "models/v1-5-pruned-emaonly.safetensors",
      "width": 512,
      "height": 512,
      "steps": 20,
      "cfg_scale": 7,
      "sampler_name": "Euler",
      "restore_faces": false,
      "scheduler_or_quality_preset": "Balanced"
    },
    "source_info": "postman_testing_v1.0.0"
  }'

# Get job status
curl -X GET "http://localhost:3000/api/v2/jobs/your_job_id_here/status" \
  -H "Authorization: Bearer your_api_key_here"
``` 