# Model Availability Plan

## Implementation Status

### ✅ **IMPLEMENTED** - Core Model Database System
- [x] **StableQueue maintains a central model database** (`mobilesd_models.sqlite`)
- [x] **Comprehensive model metadata storage** with Civitai integration
- [x] **Hash-based model identification** using AutoV2 and SHA256 hashes
- [x] **Model server availability tracking** via `model_server_availability` table
- [x] **Model aliases system** for cross-platform path compatibility
- [x] **Automated database migrations** with backup system
- [x] **Database reset functionality** with backup creation

### ✅ **IMPLEMENTED** - Enhanced Metadata System
- [x] **Embedded metadata reading** from safetensors files using custom reader
- [x] **Metadata source hierarchy** (Forge JSON > Civitai JSON > Embedded)
- [x] **Metadata completeness validation** and quality assessment
- [x] **Comprehensive model scanning** with recursive directory support
- [x] **Automatic hash calculation** during model scanning operations
- [x] **Preview image management** with multiple format support
- [x] **Comprehensive debug logging** for model scanning operations
- [x] **Enhanced field-by-field comparison** for existing model updates

### ✅ **IMPLEMENTED** - Model Availability API
- [x] **Model specification by hash** (AutoV2 hash primary, SHA256 backup)
- [x] **Central database with server availability tracking**
- [x] **Model information persistence** (models remain in database even if unavailable)
- [x] **Model availability API endpoints** for server sync operations
- [x] **Individual model availability checking** by Civitai version ID
- [x] **Model availability data in job status** responses (v1 and v2 APIs)

### 🔄 **PARTIALLY IMPLEMENTED** - Job Integration Features
- [x] **Model availability in job responses** (shows availability status in job data)
- [x] **Civitai version ID extraction** from job parameters  
- [x] **Model availability checking** during job status requests
- [ ] **Pre-submission availability checking** in job submission endpoints
- [ ] **Pre-dispatch availability verification** in job dispatcher
- [ ] **UI availability indicators** in job queue interface

### ❌ **NOT YET IMPLEMENTED** - Advanced Features
- [ ] **Simplified configuration** - migrate from CHECKPOINT_PATH/LORA_PATH to single MODEL_PATH
- [ ] **Remove metadata status complexity** - use simple null column checking instead
- [ ] **Hash-only duplicate detection** - remove filename+path fallback matching
- [ ] **Automatic model download triggers**
- [ ] **Server inventory sync API endpoints** (for Forge extensions)
- [ ] **Job queue UI model availability indicators**
- [ ] **Cross-server model copying capabilities**

## 🎯 **REVISED MODEL SCANNING WORKFLOW (Hash Required)**

### **Complete Processing Flow for Each Model File:**

```javascript
1. Scan for file

2. Create database entry for new file (`.safetensors`, `.pt`, `.ckpt`, `.gguf`, `.sft`, `.pth`) if filename OR local_path is unique. Populate filename and local_path columns in database. Report duplicates including filename and local_path in summary at end of scan

3. Extract metadata (Forge JSON > Civitai JSON > Embedded)
   If no hash found in metadata:
   → Calculate AutoV2 hash (mandatory)
   → Calculate SHA256 hash (for verification)
   → If 2 database entries with the same hash exist, delete the entry giving priority to entry with both hashes present

4. Check database for hash

5. If hash matches existing entry:
   → Same path: Update null fields with new metadata
   → Different path: Skip as duplicate, log for report
   
6. If no duplicate or new model:
   → Check for missing Civitai fields  
   → Call Civitai API using AutoV2 hash if any of the Civitai fields have a null value
   → If Civitai api call returns a 404, change all civitai fields with a null value to none
   
7. Check for local preview image named {modelname}.preview.jpeg
   → If preview image exists, do not make civitai api call for preview image

8. If no preview:
   → Download from Civitai using AutoV2 hash
   → Save as modelname.preview.jpeg

9. Write/update database record
```

 **Key Principles:**
- **Hash is mandatory** - every model must have an AutoV2 hash before proceeding
- **Database lookup by hash** - most reliable duplicate detection method
- **Path verification** - same hash + different path = duplicate (skip)
- **Metadata preservation** - only update null fields, maintain data quality
- **Civitai integration** - use AutoV2 hash for all API lookups
- **Preview consistency** - only `*.preview.jpeg` format supported

**Performance Considerations:**
- Hash calculation can be time-intensive but is essential for system reliability
- Progress reporting shows estimated completion times
- Batch processing with status updates every 10 models
- Hash caching for unchanged files (same size + modification time)

This workflow ensures bulletproof duplicate detection and complete Civitai integration at the cost of thorough initial processing time.

---

## Current Architecture (PRODUCTION)

### Database Schema (Fully Implemented)
The model availability system is built on a sophisticated database schema with 24 parameters per model:

```sql
-- Central model registry with comprehensive metadata
CREATE TABLE models (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT CHECK (type IN ('checkpoint', 'lora')),
    local_path TEXT,
    filename TEXT,
    civitai_id TEXT,
    civitai_version_id TEXT,
    forge_format TEXT,
    hash_autov2 TEXT,
    hash_sha256 TEXT,
    civitai_model_name TEXT,
    civitai_model_base TEXT,
    civitai_model_type TEXT,
    civitai_model_version_name TEXT,
    civitai_model_version_desc TEXT,
    civitai_model_version_date TEXT,
    civitai_download_url TEXT,
    civitai_trained_words TEXT,
    civitai_file_size_kb INTEGER,
    metadata_status TEXT CHECK (metadata_status IN ('none', 'partial', 'complete')),
    metadata_source TEXT CHECK (metadata_source IN ('forge', 'civitai', 'embedded', 'none')),
    has_embedded_metadata BOOLEAN DEFAULT 0,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Server availability tracking  
CREATE TABLE model_server_availability (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL,
    server_id TEXT NOT NULL,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    UNIQUE(model_id, server_id)
);

-- Cross-platform path matching
CREATE TABLE model_aliases (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL,
    alias_path TEXT NOT NULL,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);
```

### Current Capabilities (PRODUCTION)
- **Enhanced Model Registration**: Models are automatically registered with comprehensive metadata
- **Multi-Source Metadata**: Forge JSON > Civitai JSON > Embedded metadata hierarchy
- **Hash Identification**: Uses AutoV2 and SHA256 hashes for reliable model identification
- **Embedded Metadata Reader**: Custom safetensors metadata parser for embedded information
- **Civitai Integration**: Automatic metadata enrichment from Civitai API with rate limiting
- **Cross-Platform Paths**: Handles Windows/Linux path differences via aliases
- **Server Availability Tracking**: Records which servers have which models available
- **Job Integration**: Model availability data included in all job status responses

### Implemented API Endpoints

#### Model Management
- `GET /api/v1/models` - List all models with metadata and availability
- `GET /api/v1/models/:id/info` - Detailed model information
- `POST /api/v1/models/scan` - Comprehensive model directory scanning
- `POST /api/v1/models/:id/refresh-metadata` - Refresh metadata from Civitai
- `POST /api/v1/models/:id/calculate-hash` - Calculate model file hashes
- `POST /api/v1/models/reset-database` - Reset database with backup

#### Model Availability (NEW)
- `POST /api/v1/models/:id/availability` - Update model availability on server
- `DELETE /api/v1/models/:id/availability` - Remove model availability from server  
- `GET /api/v1/models/:id/availability` - Get servers that have this model

#### Job Integration
- `GET /api/v1/queue/jobs/:jobId/status` - Includes model availability data
- `GET /api/v2/jobs/:jobId/status` - Enhanced availability checking
- `POST /api/v1/checkpoint-verify` - Test Civitai version ID matching

## Remaining Work

### Phase 1: Job Queue Enhancement (Priority 1)
- [ ] **Pre-submission availability checking** in job submission endpoints
- [ ] **Pre-dispatch availability verification** in job dispatcher  
- [ ] **Enhanced error handling** for unavailable models
- [ ] **Job retry logic** based on model availability

### Phase 2: Extension Integration (Priority 2)
- [ ] `POST /api/v1/servers/{server_id}/models/sync` - Bulk server inventory sync
- [ ] **Forge extension inventory sync** endpoints
- [ ] **Periodic model scanning** and sync from extensions
- [ ] **Model recommendation system** for extensions

### Phase 3: UI Enhancements (Priority 3)
- [ ] **Model availability indicators** in job queue interface
- [ ] **Server-specific model availability** display
- [ ] **Model compatibility warnings** before job submission
- [ ] **Model management interface** with manual overrides

### Phase 4: Advanced Features (Priority 4)
- [ ] **Automatic model download triggers**
- [ ] **Cross-server model copying** capabilities
- [ ] **Model availability notifications** and alerts
- [ ] **Predictive model availability** analytics

## Current Capabilities Assessment

### ✅ **FULLY OPERATIONAL**
- **Model Database**: Complete 24-parameter model registry with automatic metadata enrichment
- **Metadata Processing**: Sophisticated hierarchy with embedded metadata reading from safetensors
- **Availability Tracking**: Server availability system with API endpoints for updates
- **Job Integration**: All job responses include model availability information
- **Hash-Based Identification**: Reliable model matching using AutoV2/SHA256 hashes
- **Civitai Integration**: Automatic metadata fetch with rate limiting and error handling

### 🔄 **OPERATIONAL WITH GAPS**
- **Job Submission**: Models are checked during status requests but not at submission time
- **Job Dispatch**: No pre-dispatch availability verification yet implemented
- **UI Integration**: Model availability data available via API but not shown in UI

### ❌ **NOT YET IMPLEMENTED**
- **Extension Sync**: No bulk inventory sync endpoints for Forge extensions
- **Auto-Download**: No automatic model downloading when unavailable
- **Cross-Server Copying**: No model distribution between servers

## Technical Implementation Notes

### Metadata Source Priority (IMPLEMENTED)
StableQueue follows a strict hierarchy for metadata extraction:

1. **Forge-style JSON** (`modelname.json`) - **Highest Priority**
2. **Civitai-style JSON** (`modelname.civitai.json`) - **Medium Priority**  
3. **Embedded Metadata** (from safetensors file) - **Lowest Priority**

### Model Availability Integration (IMPLEMENTED)
- **Job Status Responses**: All job status endpoints include `model_availability` object
- **Civitai Version ID Matching**: Automatic extraction from job parameters  
- **Server Tracking**: Individual servers can update model availability via API
- **Database Persistence**: Model information retained even when temporarily unavailable

### Recent Enhancements (2024)
- **Enhanced Metadata Reader**: Custom safetensors parser for embedded metadata
- **Database Reset Feature**: Safe database reset with automatic backup creation
- **Comprehensive Scanning**: Recursive model directory scanning with hash calculation
- **API Standardization**: Consistent model availability endpoints across API versions

---

## Next Steps for Full Model Availability

Based on the current implementation, here are the specific steps to complete the model availability system:

### A. Complete Job Integration (Priority 1)
- [ ] Add model availability checking to job submission endpoints (`POST /api/v1/queue/jobs`)
- [ ] Implement pre-dispatch availability verification in job dispatcher
- [ ] Add model hash resolution for job requirements matching
- [ ] Create availability-based job retry logic

### B. Extension Integration (Priority 2)
- [ ] Implement `POST /api/v1/servers/{server_id}/models/sync` for bulk inventory updates
- [ ] Create Forge extension API endpoints for periodic model sync
- [ ] Add extension-side model availability checking capabilities
- [ ] Develop automatic model discovery and registration

### C. UI Enhancements (Priority 3)
- [ ] Add model availability indicators to job queue interface
- [ ] Show which servers have required models available
- [ ] Display model compatibility warnings before job submission
- [ ] Create comprehensive model management interface

### D. Advanced Features (Priority 4)
- [ ] Implement automatic model download triggers when unavailable
- [ ] Add cross-server model copying and distribution capabilities
- [ ] Create model availability notifications and alert system
- [ ] Develop predictive model availability analytics and reporting

**For detailed database schema information, see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)**

## What Happens When the User Clicks 'Scan for New Models'

The model scanning functionality discovers and catalogs all AI models in the configured directories using a simplified, reliable approach. This section details the streamlined workflow from user action to database update.

### 🎯 User Interface Flow

#### **1. User Action**
- User navigates to the **Models** tab in the StableQueue web interface
- Clicks the **"Scan for New Models"** button
- **Optional**: Checks "Calculate Hashes" checkbox for hash computation

#### **2. Frontend Response**
- Button becomes disabled and text changes to:
  - `"Scanning..."` (metadata only)
  - `"Scanning + Calculating Hashes..."` (with hash calculation)
- Makes `POST /api/v1/models/scan` API call with options

#### **3. Results Display**
- Shows success message with detailed statistics
- Refreshes the models display to show newly discovered models
- Re-enables the scan button

### 🧠 Backend Processing Workflow

**Goal:**  
Scan `MODEL_PATH` for model files and related metadata. Ensure every discovered model has a database entry. Then fill in any missing fields using prioritized metadata sources.

---

#### ✅ Processing Rules

#### **Phase 1: File Discovery**
Scan `MODEL_PATH` recursively for:
- **Model files**: `.safetensors`, `.pt`, `.ckpt`, `.gguf`, `.sft`, `.pth`
- **JSON metadata files**: All `*.json` files (regardless of naming convention)
- **Preview images**: Files matching **exactly** `*.preview.jpeg` (ignore all other preview formats)

#### **Phase 2: Model Detection & Initialization**
For **every model file found**:
- **Always** create a database entry if one doesn't already exist
- **Never** infer metadata from filename or file path
- Populate minimum required fields:
  - `filename`: Base filename of the model
  - `local_path`: Full directory path containing the model
- All metadata fields can remain `null` at this stage

#### **Phase 3: Duplicate Detection (Hash-Only)**
**Critical**: Duplicates are detected **ONLY** by hash comparison:
```javascript
// Check for existing model by hash only (most reliable)
if (modelData.hash_autov2) {
    existingModel = modelDB.findModelsByHash(modelData.hash_autov2, 'autov2')[0];
} else if (modelData.hash_sha256) {
    existingModel = modelDB.findModelsByHash(modelData.hash_sha256, 'sha256')[0];
}
// If no hash available yet → treat as new model until hash can be calculated
```

**No fallback to filename/path matching** - hash comparison is the only reliable duplicate detection method.

#### **Phase 4: Metadata Population (Priority Order)**
**Only populate database fields that are currently `null`** - never overwrite existing values.

1. **🥇 Forge JSON Metadata** (Highest Priority)
   - Scan all `*.json` files in the model directory
   - If JSON contents match Forge format → apply Forge metadata to `null` fields

2. **🥈 Civitai JSON Metadata** (Medium Priority)  
   - If JSON contents match Civitai format → apply to remaining `null` fields

3. **🥉 Embedded File Metadata** (Low Priority)
   - Extract metadata from model file headers (e.g., `safetensors` metadata)
   - Apply to remaining `null` fields

4. **🔄 Civitai API Lookup** (Fallback)
   - Query Civitai API for any unresolved values
   - Populate remaining `null` fields if possible

#### **Phase 5: Preview Image Handling**
- Check for local `*.preview.jpeg` file
- If missing and Civitai metadata available:
  - Download and store preview image from Civitai API

#### **Phase 6: Hash Generation (Optional)**
**If user enabled "Calculate Hashes"**:
- If `hash_autov2` is `null` → generate and store AutoV2 hash
- If `hash_sha256` is `null` → generate and store SHA256 hash
- Apply file size limits and time estimates for large files

#### **Phase 7: Database Operations**
- **For new models**: Insert complete database record
- **For existing models** (identified by hash): Update only `null` fields with new metadata
- **Idempotent process**: Safe to re-run without side effects

---

### 🔁 Key Principles

- **Never** infer meaning from filenames or paths
- **Always** prefer actual file contents for determining metadata format
- **Only update `null` fields** - preserve existing data
- **Hash-only duplicate detection** - no filename/path fallback
- **Idempotent operation** - safe to re-run multiple times
- **Content-based metadata detection** - examine JSON contents to determine format

### 📊 Statistics & Reporting

**Simplified tracking metrics**:
```javascript
stats = {
    total: allModels.length,           // Total model files discovered
    added: 0,                          // New database entries created
    updated: 0,                        // Existing entries with new metadata
    hashesCalculated: 0,               // Hash generation count
    hashesSkipped: 0,                  // Files too large for hashing
    errors: 0                          // Processing failures
};
```

**Example success message**:
```
Scan complete! Found 247 model files
- Added: 12 new models to database
- Updated: 8 models with new metadata  
- Calculated: 5 hashes
```

### 🔧 Configuration Requirements

#### **Environment Variables**
- `MODEL_PATH`: Single root directory to scan recursively
- `CONFIG_DATA_PATH`: Database storage location
- `CIVITAI_API_KEY`: Optional API key for metadata enrichment

#### **File System Requirements**
- **Read access**: Model directories and files
- **Write access**: Database updates and preview image downloads
- **Directory structure**: Any organization supported (recursive scanning)

### 🐛 Troubleshooting & Debugging

**Expected scan behaviors**:
- **"Added new models"**: Model files without existing database entries
- **"Updated models"**: Existing models (by hash) with new metadata discovered
- **"Hash calculation skipped"**: Files exceeding size limits (>15GB default)
- **"No models found"**: Check `MODEL_PATH` configuration and file permissions

**Important Notes**:
- **Duplicate detection is hash-only** - same content = same hash, regardless of filename/location
- **No false positives** from filename collisions in different directories
- **No missed duplicates** when models are moved or renamed

This simplified scanning process ensures reliable model discovery and metadata population while maintaining data integrity through idempotent operations and hash-based duplicate detection. 