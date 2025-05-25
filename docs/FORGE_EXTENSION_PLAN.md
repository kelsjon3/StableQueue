# Forge Extension Implementation Plan

This document outlines the detailed plan for implementing a Forge extension that will send jobs to the StableQueue queue system.

## 1. Database Preparation

### 1.1 Add `app_type` Field to Jobs Table

Current database schema:
```sql
CREATE TABLE IF NOT EXISTS jobs (
    stablequeue_job_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    creation_timestamp TEXT NOT NULL,
    last_updated_timestamp TEXT NOT NULL,
    completion_timestamp TEXT,
    target_server_alias TEXT NOT NULL,
    forge_session_hash TEXT,
    generation_params_json TEXT NOT NULL,
    result_details_json TEXT,
    retry_count INTEGER DEFAULT 0,
    forge_internal_task_id TEXT
);
```

Required changes:
```sql
-- Add app_type column with default 'forge' for backward compatibility
ALTER TABLE jobs ADD COLUMN app_type TEXT DEFAULT 'forge';

-- Add source_info column to track where the job came from (UI, extension, API, etc.)
ALTER TABLE jobs ADD COLUMN source_info TEXT;

-- Add api_key_id column to track which API key was used (if applicable)
ALTER TABLE jobs ADD COLUMN api_key_id TEXT;
```

### 1.2 Create API Keys Table

```sql
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT NOT NULL,
    secret TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used TEXT,
    is_active BOOLEAN DEFAULT 1,
    permissions TEXT
);
```

## 2. API Authentication System

### 2.1 API Key Generation and Management

1. Implement API key generation with UUID for key ID and secure random strings for key and secret
2. Create endpoints for managing API keys:
   - `GET /api/v1/api-keys` - List all API keys
   - `POST /api/v1/api-keys` - Create a new API key
   - `DELETE /api/v1/api-keys/:id` - Delete an API key
   - `PUT /api/v1/api-keys/:id` - Update an API key (enable/disable, change permissions)

### 2.2 Authentication Middleware

```javascript
// Sample middleware for API key authentication
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const apiSecret = req.headers['x-api-secret'];
  
  if (!apiKey || !apiSecret) {
    return res.status(401).json({ error: 'API key and secret are required' });
  }
  
  // Validate against database
  const keyRecord = validateApiKey(apiKey, apiSecret);
  if (!keyRecord) {
    return res.status(401).json({ error: 'Invalid API credentials' });
  }
  
  // Add API key info to request object for later use
  req.apiKeyId = keyRecord.id;
  
  // Update last used timestamp
  updateApiKeyLastUsed(keyRecord.id);
  
  next();
}
```

## 3. API Endpoints for Extension

### 3.1 Standardized Job Submission Endpoint

Create a new endpoint:
```
POST /api/v2/generate
```

Request body:
```json
{
  "app_type": "forge",
  "target_server_alias": "MyForgeServer",
  "priority": 1,
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
  },
  "source_info": "forge_extension"
}
```

Response:
```json
{
  "success": true,
  "stablequeue_job_id": "88615c9d-71ec-4803-88b0-14f5162f6c66",
  "queue_position": 1,
  "estimated_start_time": "2024-07-01T15:32:45.000Z"
}
```

### 3.2 Job Status Endpoint

Use the existing endpoint with enhancements:
```
GET /api/v1/queue/jobs/:jobId/status
```

Enhanced response to include more details for the extension:
```json
{
  "stablequeue_job_id": "88615c9d-71ec-4803-88b0-14f5162f6c66",
  "app_type": "forge",
  "status": "processing",
  "progress": 45,
  "creation_timestamp": "2024-07-01T15:30:45.000Z",
  "last_updated_timestamp": "2024-07-01T15:31:48.000Z",
  "estimated_completion_time": "2024-07-01T15:33:45.000Z",
  "target_server_alias": "MyForgeServer",
  "generation_params": {
    "positive_prompt": "a beautiful landscape",
    "negative_prompt": "ugly, blurry",
    "checkpoint_name": "Pony/cyberrealisticPony_v8.safetensors",
    "width": 512,
    "height": 512,
    "steps": 20,
    "cfg_scale": 7,
    "sampler_name": "Euler"
  },
  "images": [
    {
      "preview_url": "http://stablequeue-server:3000/api/v1/images/preview/88615c9d_00001.png",
      "download_url": "http://stablequeue-server:3000/api/v1/images/download/88615c9d_00001.png",
      "width": 512,
      "height": 512
    }
  ]
}
```

### 3.3 Queue Management Endpoints

Enhance existing endpoints:
```
GET /api/v1/queue/jobs?app_type=forge
POST /api/v1/queue/jobs/:jobId/cancel
DELETE /api/v1/queue/jobs/:jobId
```

## 4. Forge Extension Structure

### 4.1 Directory Structure

```
stablequeue/
├── scripts/
│   └── stablequeue.py  (Main Python code)
├── javascript/
│   └── stablequeue.js  (Frontend integration)
├── style.css             (Custom styling)
└── install.py            (Installation script)
```

### 4.2 Backend Python Implementation

Key components:
1. API client to communicate with StableQueue
2. Parameter extraction from Forge UI
3. Configuration management
4. UI component registration

```python
# Example Python structure
import json
import modules.scripts as scripts
import gradio as gr
import requests
from modules import shared
from modules.ui_components import FormRow

class StableQueue(scripts.Script):
    def __init__(self):
        self.stablequeue_url = shared.opts.data.get("stablequeue_url", "http://localhost:3000")
        self.api_key = shared.opts.data.get("stablequeue_api_key", "")
        self.api_secret = shared.opts.data.get("stablequeue_api_secret", "")
    
    # UI integration
    def ui(self, is_img2img):
        with gr.Group():
            with gr.Accordion("StableQueue Queue", open=False):
                with FormRow():
                    queue_btn = gr.Button("Queue in StableQueue", variant="primary")
                    priority = gr.Slider(minimum=1, maximum=10, value=5, step=1, label="Priority")
                
                with FormRow():
                    server_alias = gr.Dropdown(label="Target Server", choices=self.get_server_aliases())
                    status_indicator = gr.HTML("<div>Not connected to StableQueue</div>")
        
        # Event handlers
        queue_btn.click(fn=self.queue_in_stablequeue, inputs=[...])
        
        return [queue_btn, priority, server_alias, status_indicator]
    
    # Send job to StableQueue
    def queue_in_stablequeue(self, *args):
        # Extract parameters from Forge UI
        params = self.extract_parameters(args)
        
        # Send to StableQueue API
        try:
            response = requests.post(
                f"{self.stablequeue_url}/api/v2/generate",
                json={
                    "app_type": "forge",
                    "target_server_alias": params["server_alias"],
                    "priority": params["priority"],
                    "generation_params": params["generation_params"],
                    "source_info": "forge_extension"
                },
                headers={
                    "Content-Type": "application/json",
                    "X-API-Key": self.api_key,
                    "X-API-Secret": self.api_secret
                }
            )
            
            if response.status_code == 200:
                job_id = response.json()["stablequeue_job_id"]
                return f"Job queued successfully. ID: {job_id}"
            else:
                return f"Error: {response.json().get('error', 'Unknown error')}"
        except Exception as e:
            return f"Connection error: {str(e)}"
```

### 4.3 Frontend JavaScript Integration

```javascript
// Add "Queue in StableQueue" button next to the Generate button
onUiLoaded(() => {
    const generateBtn = document.querySelector('#txt2img_generate');
    if (!generateBtn) return;
    
    const queueBtn = document.createElement('button');
    queueBtn.id = 'txt2img_queue_stablequeue';
    queueBtn.className = generateBtn.className;
    queueBtn.innerHTML = 'Queue in StableQueue';
    queueBtn.style.backgroundColor = '#3498db';
    
    generateBtn.parentNode.insertBefore(queueBtn, generateBtn.nextSibling);
    
    queueBtn.addEventListener('click', () => {
        // Open the StableQueue Queue tab in the accordion
        const accordionBtn = document.querySelector('.accordion-button[data-bs-target="#stablequeue-queue-accordion"]');
        if (accordionBtn) accordionBtn.click();
        
        // Trigger the Queue button in the StableQueue interface
        document.querySelector('#stablequeue_queue_btn').click();
    });
});
```

## 5. Bulk Job Submission Feature

### 5.1 Overview

Instead of implementing a true "Generate Forever" option, which would be impractical and could overload the queue, the extension will provide two context menu options in Forge:

1. **Send to StableQueue** - Sends the current generation settings as a single job
2. **Send bulk job to StableQueue** - Sends multiple jobs with the same parameters but different seeds

This approach gives users the benefit of queuing multiple jobs without keeping their browser open, while maintaining control over system resources.

### 5.2 StableQueue Tab in Forge Settings

A new "StableQueue" tab will be added to the Forge settings panel with the following options:

```python
with gr.Tab("StableQueue"):
    with FormRow():
        stablequeue_url = gr.Textbox(label="StableQueue Server URL", value="http://localhost:3000")
        connection_status = gr.HTML("<div>Not connected</div>")
        test_connection_btn = gr.Button("Test Connection")
    
    with FormRow():
        api_key = gr.Textbox(label="API Key", value="")
        api_secret = gr.Textbox(label="API Secret", value="", type="password")
        create_key_btn = gr.Button("Create New Key")
    
    with FormRow():
        bulk_job_quantity = gr.Slider(minimum=2, maximum=100, value=10, step=1, label="Bulk Job Quantity")
        seed_variation = gr.Radio(choices=["Random", "Incremental"], value="Random", label="Seed Variation Method")
        job_delay = gr.Slider(minimum=0, maximum=30, value=5, step=1, label="Delay Between Jobs (seconds)")
```

### 5.3 Context Menu Integration

The extension will register two new options in the Forge context menu:

```python
def on_ui_settings():
    section = ('stablequeue', "StableQueue Integration")
    shared.opts.add_option("enable_stablequeue_context_menu", shared.OptionInfo(
        True, "Add StableQueue options to generation context menu", section=section
    ))

# Register context menu items
def context_menu_entries():
    return [
        {"label": "Send to StableQueue", "action": "stablequeue_send_single", "tooltip": "Send current generation to StableQueue queue"},
        {"label": "Send bulk job to StableQueue", "action": "stablequeue_send_bulk", "tooltip": "Send multiple jobs with current settings to StableQueue queue"}
    ]

# Register JavaScript callbacks
js_callbacks = [
    """
    function(params) {
        // Send single job
        fetch('/stablequeue/send_single', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        }).then(response => response.json())
          .then(data => {
              // Show notification
              params.notification = { text: `Job sent to StableQueue: ${data.stablequeue_job_id}` };
              return params;
          });
    }
    """,
    """
    function(params) {
        // Send bulk job
        fetch('/stablequeue/send_bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        }).then(response => response.json())
          .then(data => {
              // Show notification
              params.notification = { text: `Bulk job sent to StableQueue: ${data.count} jobs queued` };
              return params;
          });
    }
    """
]
```

### 5.4 API Enhancements for Bulk Jobs

#### 5.4.1 Bulk Job Submission Endpoint

Create a new endpoint in the StableQueue API to handle bulk job submissions:

```
POST /api/v2/generate/bulk
```

Request body:
```json
{
  "app_type": "forge",
  "target_server_alias": "MyForgeServer",
  "source_info": "forge_extension_bulk",
  "bulk_quantity": 10,
  "seed_variation": "random", // or "incremental"
  "base_seed": -1, // -1 for random, or specific seed to start from
  "job_delay": 5, // seconds between jobs
  "generation_params": {
    "positive_prompt": "a beautiful landscape",
    "negative_prompt": "ugly, blurry",
    "checkpoint_name": "Pony/cyberrealisticPony_v8.safetensors",
    "width": 512,
    "height": 512,
    "steps": 20,
    "cfg_scale": 7,
    "sampler_name": "Euler",
    "restore_faces": false
  }
}
```

Response:
```json
{
  "success": true,
  "bulk_job_id": "bulk_2a7b8901",
  "jobs": [
    {"stablequeue_job_id": "88615c9d-71ec-4803-88b0-14f5162f6c66", "queue_position": 1},
    {"stablequeue_job_id": "99726d0e-82fd-5914-99c1-25f6273f7d77", "queue_position": 2},
    // ... additional jobs
  ],
  "total_jobs": 10
}
```

#### 5.4.2 Bulk Job Tracking

Add a new field to the jobs table:
```sql
ALTER TABLE jobs ADD COLUMN bulk_job_id TEXT;
```

Add a new endpoint to track bulk job status:
```
GET /api/v2/generate/bulk/:bulkJobId
```

Response:
```json
{
  "bulk_job_id": "bulk_2a7b8901",
  "total_jobs": 10,
  "completed_jobs": 3,
  "processing_jobs": 1,
  "pending_jobs": 6,
  "failed_jobs": 0,
  "progress_percentage": 35,
  "jobs": [
    {
      "stablequeue_job_id": "88615c9d-71ec-4803-88b0-14f5162f6c66",
      "status": "completed",
      "preview_url": "http://stablequeue-server:3000/api/v1/images/preview/88615c9d_00001.png"
    },
    // ... other jobs
  ]
}
```

#### 5.4.3 Bulk Job Cancellation

Add an endpoint to cancel remaining jobs in a bulk submission:
```
POST /api/v2/generate/bulk/:bulkJobId/cancel
```

Response:
```json
{
  "success": true,
  "bulk_job_id": "bulk_2a7b8901",
  "cancelled_jobs": 6,
  "message": "Remaining jobs in bulk submission have been cancelled"
}
```

### 5.5 Backend Implementation

The extension will handle bulk job submission by:

1. Capturing the current generation parameters from the Forge UI
2. Creating multiple variations with different seeds
3. Submitting the jobs as a batch with a shared bulk_job_id
4. Tracking the progress of all jobs in the batch
5. Providing a UI to monitor and potentially cancel remaining jobs

```python
def send_bulk_job(self, params):
     bulk_quantity = shared.opts.data.get("stablequeue_bulk_quantity", 10)
    # Validate bulk quantity limits
    if bulk_quantity < 1 or bulk_quantity > 100:
        return {"success": False, "message": "Bulk quantity must be between 1 and 100"}
    
     seed_variation = shared.opts.data.get("stablequeue_seed_variation", "random")
     job_delay = shared.opts.data.get("stablequeue_job_delay", 5)
    # Limit job delay to prevent abuse
    job_delay = max(0, min(job_delay, 30))
    base_seed = params.get("seed", -1)
    
    # Prepare bulk job request
    bulk_request = {
        "app_type": "forge",
        "target_server_alias": params.get("server_alias", "default"),
        "source_info": "forge_extension_bulk",
        "bulk_quantity": bulk_quantity,
        "seed_variation": seed_variation,
        "base_seed": base_seed,
        "job_delay": job_delay,
        "generation_params": self.extract_parameters(params)
    }
    
    # Send to StableQueue API
    try:
        response = requests.post(
            f"{self.stablequeue_url}/api/v2/generate/bulk",
            json=bulk_request,
            headers={
                "Content-Type": "application/json",
                "X-API-Key": self.api_key,
                "X-API-Secret": self.api_secret
            }
        )
        
        if response.status_code == 202:
            data = response.json()
            return {
                "success": True,
                "bulk_job_id": data["bulk_job_id"],
                "total_jobs": data["total_jobs"],
                "message": f"Successfully queued {data['total_jobs']} jobs in StableQueue"
            }
        else:
            return {
                "success": False,
                "message": f"Failed to queue bulk job: {response.text}"
            }
    except Exception as e:
        return {
            "success": False,
            "message": f"Error connecting to StableQueue: {str(e)}"
        }
```

### 5.6 UI Monitoring Component

Add a monitoring panel to track bulk job progress:

```python
def create_bulk_monitor_ui():
    with gr.Box():
        gr.HTML("<h3>Bulk Job Monitor</h3>")
        with gr.Row():
            bulk_job_id = gr.Textbox(label="Bulk Job ID")
            refresh_btn = gr.Button("Refresh Status")
            cancel_btn = gr.Button("Cancel Remaining Jobs", variant="stop")
        
        progress_bar = gr.Slider(minimum=0, maximum=100, value=0, label="Progress", interactive=False)
        status_html = gr.HTML("<div>No active bulk job</div>")
        
        thumbnail_gallery = gr.Gallery(label="Completed Images", show_label=True)
        
    refresh_btn.click(fn=refresh_bulk_status, inputs=[bulk_job_id], outputs=[progress_bar, status_html, thumbnail_gallery])
    cancel_btn.click(fn=cancel_bulk_job, inputs=[bulk_job_id], outputs=[status_html])
    
    return bulk_job_id, progress_bar, status_html, thumbnail_gallery
```

## 6. Implementation Plan and Timeline

1. **Database and API Enhancements** (1-2 days)
   - Add bulk_job_id field to jobs table
   - Create bulk job submission endpoint
   - Implement bulk job tracking and cancellation APIs

2. **Forge Extension UI Components** (2-3 days)
   - Create StableQueue settings tab
   - Implement context menu options
   - Build bulk job monitoring panel

3. **Backend Implementation** (2-3 days)
   - Implement bulk job parameter handling
   - Add seed variation logic
   - Create bulk job submission and tracking logic

4. **Testing and Refinement** (1-2 days)
   - Test different quantity settings
   - Verify seed variation works correctly
   - Ensure progress tracking is accurate
   - Test cancellation functionality

5. **Documentation and Release** (1 day)
   - Update user documentation
   - Create usage examples
   - Package for distribution

## 7. Testing Plan

1. **Unit Tests**
   - API authentication validation
   - Parameter extraction from Forge UI
   - Job submission formatting

2. **Integration Tests**
   - End-to-end job submission flow
   - Queue management operations
   - Authentication flow

3. **Edge Cases**
   - Large prompts and parameters
   - Server disconnection handling
   - Rate limiting and error responses

## 8. Security Considerations

 1. **API Authentication**
    - Use secure random generation for API keys and secrets
    - Implement proper validation and error handling
    - Store secrets securely (hashed, not plaintext)

2. **Bulk Job Security**
   - Implement per-user limits on bulk job quantities
   - Add rate limiting for bulk job submissions
   - Validate job_delay parameters to prevent system abuse
   - Monitor and alert on unusual bulk job patterns

3. **Input Validation**
   - Sanitize all user inputs from the extension
   - Validate parameters before submission
   - Implement proper error handling for invalid inputs

3. **Rate Limiting**
   - Add rate limiting to prevent abuse
   - Track usage by API key
   - Implement progressive backoff for failed requests 