# Forge Extension Implementation Plan

This document outlines the detailed plan for implementing a Forge extension that will send jobs to the MobileSD queue system.

## 1. Database Preparation

### 1.1 Add `app_type` Field to Jobs Table

Current database schema:
```sql
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
  "mobilesd_job_id": "88615c9d-71ec-4803-88b0-14f5162f6c66",
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
  "mobilesd_job_id": "88615c9d-71ec-4803-88b0-14f5162f6c66",
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
      "preview_url": "http://mobilesd-server:3000/api/v1/images/preview/88615c9d_00001.png",
      "download_url": "http://mobilesd-server:3000/api/v1/images/download/88615c9d_00001.png",
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
mobilesdqueue/
├── scripts/
│   └── mobilesdqueue.py  (Main Python code)
├── javascript/
│   └── mobilesdqueue.js  (Frontend integration)
├── style.css             (Custom styling)
└── install.py            (Installation script)
```

### 4.2 Backend Python Implementation

Key components:
1. API client to communicate with MobileSD
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

class MobileSDQueue(scripts.Script):
    def __init__(self):
        self.mobilesd_url = shared.opts.data.get("mobilesd_url", "http://localhost:3000")
        self.api_key = shared.opts.data.get("mobilesd_api_key", "")
        self.api_secret = shared.opts.data.get("mobilesd_api_secret", "")
    
    # UI integration
    def ui(self, is_img2img):
        with gr.Group():
            with gr.Accordion("MobileSD Queue", open=False):
                with FormRow():
                    queue_btn = gr.Button("Queue in MobileSD", variant="primary")
                    priority = gr.Slider(minimum=1, maximum=10, value=5, step=1, label="Priority")
                
                with FormRow():
                    server_alias = gr.Dropdown(label="Target Server", choices=self.get_server_aliases())
                    status_indicator = gr.HTML("<div>Not connected to MobileSD</div>")
        
        # Event handlers
        queue_btn.click(fn=self.queue_in_mobilesd, inputs=[...])
        
        return [queue_btn, priority, server_alias, status_indicator]
    
    # Send job to MobileSD
    def queue_in_mobilesd(self, *args):
        # Extract parameters from Forge UI
        params = self.extract_parameters(args)
        
        # Send to MobileSD API
        try:
            response = requests.post(
                f"{self.mobilesd_url}/api/v2/generate",
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
                job_id = response.json()["mobilesd_job_id"]
                return f"Job queued successfully. ID: {job_id}"
            else:
                return f"Error: {response.json().get('error', 'Unknown error')}"
        except Exception as e:
            return f"Connection error: {str(e)}"
```

### 4.3 Frontend JavaScript Integration

```javascript
// Add "Queue in MobileSD" button next to the Generate button
onUiLoaded(() => {
    const generateBtn = document.querySelector('#txt2img_generate');
    if (!generateBtn) return;
    
    const queueBtn = document.createElement('button');
    queueBtn.id = 'txt2img_queue_mobilesd';
    queueBtn.className = generateBtn.className;
    queueBtn.innerHTML = 'Queue in MobileSD';
    queueBtn.style.backgroundColor = '#3498db';
    
    generateBtn.parentNode.insertBefore(queueBtn, generateBtn.nextSibling);
    
    queueBtn.addEventListener('click', () => {
        // Open the MobileSD Queue tab in the accordion
        const accordionBtn = document.querySelector('.accordion-button[data-bs-target="#mobilesd-queue-accordion"]');
        if (accordionBtn) accordionBtn.click();
        
        // Trigger the Queue button in the MobileSD interface
        document.querySelector('#mobilesd_queue_btn').click();
    });
});
```

## 5. Implementation Phases

### Phase 1: Database and API Preparation
1. Update database schema with app_type and other fields
2. Create API keys table and management system
3. Implement authentication middleware
4. Create/update API endpoints for job submission and status

### Phase 2: Extension Core Development
1. Create basic extension structure
2. Implement configuration panel
3. Add parameter extraction from Forge UI
4. Implement secure API communication

### Phase 3: UI Integration
1. Add "Queue in MobileSD" button to Forge UI
2. Create job status view in extension
3. Implement queue management features
4. Add error handling and user feedback

### Phase 4: Testing and Refinement
1. Test extension with various parameter combinations
2. Verify proper handling of different checkpoint types
3. Test authentication and security features
4. Ensure graceful error handling

## 6. Testing Plan

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

## 7. Security Considerations

1. **API Authentication**
   - Use secure random generation for API keys and secrets
   - Implement proper validation and error handling
   - Store secrets securely (hashed, not plaintext)

2. **Input Validation**
   - Sanitize all user inputs from the extension
   - Validate parameters before submission
   - Implement proper error handling for invalid inputs

3. **Rate Limiting**
   - Add rate limiting to prevent abuse
   - Track usage by API key
   - Implement progressive backoff for failed requests 