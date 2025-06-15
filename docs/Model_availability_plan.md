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

The model scanning functionality is a comprehensive process that discovers, analyzes, and catalogs all AI models in the configured directories. This section details the complete workflow from user action to database update.

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

### 🔍 Backend Processing Workflow

#### **Phase 1: Directory Discovery**
```javascript
// Configuration - single MODEL_PATH only
const modelPath = process.env.MODEL_PATH;

// Recursive scanning of all subdirectories
const allModels = await scanModelDirectory(modelPath, MODEL_EXTENSIONS, modelPath);
```

**What happens**:
- Scans the configured `MODEL_PATH` recursively
- Discovers all files with extensions: `.safetensors`, `.pt`, `.ckpt`
- Builds file inventory with relative paths from root directory
- Detects associated preview images (`{modelname}.preview.jpeg`)

#### **Phase 2: Metadata Extraction Hierarchy**

**For each discovered model file, follows strict priority order**:

1. **🥇 Forge-style JSON** (`{modelname}.json`) - **HIGHEST PRIORITY**
   ```javascript
   // Must contain actual model metadata
   if (parsedJson.modelId || parsedJson.model?.id || parsedJson.name || parsedJson.description) {
       jsonMetadata = parsedJson;
       jsonSource = 'forge';
   }
   ```

2. **🥈 Civitai-style JSON** (`{modelname}.civitai.json`) - **MEDIUM PRIORITY**
   ```javascript
   if (validateMetadataCompleteness(parsedJson)) {
       jsonMetadata = parsedJson;
       jsonSource = 'civitai';
   }
   ```

3. **🥉 Embedded Metadata** (from safetensors file) - **LOWEST PRIORITY**
   ```javascript
   embeddedMetadata = await readModelFileMetadata(modelFilePath);
   // Uses custom safetensors parser for embedded data
   ```

#### **Phase 3: Data Processing & Enrichment**

**Creates comprehensive model data object**:
- **26+ database fields** populated from metadata sources
- **Model type detection** from metadata or architecture patterns
- **Hash extraction** from existing metadata (AutoV2, SHA256)
- **Complex value conversion** to SQLite-safe strings

**Example field mapping**:
```javascript
modelData = {
    name: model.filename,
    type: extractedType, // 'checkpoint', 'lora', or null
    hash_autov2: metadata.hash_autov2 || metadata.AutoV2,
    civitai_id: metadata.modelId || metadata.model?.id,
    civitai_trained_words: getEnhancedActivationText(metadata),
    metadata_source: jsonSource || 'embedded' || 'none',
    has_embedded_metadata: !!embeddedMetadata
    // ... 20+ additional fields
};
```

#### **Phase 4: Duplicate Detection & Resolution**

**Hash-only matching strategy**:
```javascript
// Check for existing model by hash only (most reliable)
if (modelData.hash_autov2) {
    existingModel = modelDB.findModelsByHash(modelData.hash_autov2, 'autov2')[0];
} else if (modelData.hash_sha256) {
    existingModel = modelDB.findModelsByHash(modelData.hash_sha256, 'sha256')[0];
}
```

#### **Phase 5: Hash Calculation (Optional)**

**If "Calculate Hashes" is enabled**:
```javascript
// Calculate AutoV2 and/or SHA256 hash if either column is null
if (calculateHashes && (!modelData.hash_autov2 || !modelData.hash_sha256)) {
    const sizeCheck = checkFileSizeForHashing(fileStats.size);
    if (sizeCheck.isAllowed) {
        const calculatedHash = await calculateFileHash(fullModelPath);
        modelData.hash_autov2 = calculatedHash.autov2;
        modelData.hash_sha256 = calculatedHash.sha256;
    }
}
```

**Safety mechanisms**:
- **File size limits** to prevent system overload
- **Time estimates** shown to user for large files
- **Error handling** for corrupted or inaccessible files
- **Statistics tracking**: calculated, skipped, errors

#### **Phase 6: Database Operations**

##### **For Existing Models**:
**Enhanced field-by-field comparison**:
```javascript
const allFieldsToCheck = [
    'name', 'type', 'hash_autov2', 'hash_sha256',
    'civitai_id', 'civitai_version_id', 'civitai_model_name', // ... 24+ fields
];

for (const field of allFieldsToCheck) {
    const isExistingNull = (existingValue === null || existingValue === undefined || existingValue === '');
    const hasNewValue = (newValue !== null && newValue !== undefined && newValue !== '');
    
    if (isExistingNull && hasNewValue) {
        hasNewInfo = true;
        fieldsWithNewInfo.push(field);
    }
}
```

**Update criteria**:
- ✅ **Only factual data** from metadata sources
- ✅ **No inferring or guessing** of values
- ✅ **Null field population** with actual metadata
- ✅ **Simple null checking** - no complex status management

##### **For New Models**:
- **Complete database record** creation with all available metadata
- **Server availability tracking** update
- **Model type classification** (checkpoint/lora)

### 📊 Statistics & Reporting

**Tracks comprehensive metrics**:
```javascript
stats = {
    total: allModels.length,           // Total files discovered
    added: 0,                          // New models added
    updated: 0,                        // Existing models updated
    skipped: 0,                        // No new information
    errors: 0,                         // Processing failures
    checkpoints: 0,                    // Checkpoint models found
    loras: 0,                          // LoRA models found
    hashesCalculated: 0,               // Hashes computed
    hashesSkipped: 0,                  // Files too large for hashing
    hashErrors: 0                      // Hash calculation failures
};
```

**Example success message**:
```
Scan complete! Found 847 models (623 checkpoints, 224 LoRAs)
- Added: 12 new models
- Updated: 45 models with new metadata
- Calculated: 8 hashes
```

### 🔧 Configuration Requirements

#### **Environment Variables**
- `MODEL_PATH`: Single root directory to scan recursively
- `CONFIG_DATA_PATH`: Database storage location

#### **File System Requirements**
- **Read access**: Model directories and files
- **Write access**: Database updates and preview downloads
- **Directory structure**: Any organization supported (recursive scanning)

#### **Optional Integrations**
- `CIVITAI_API_KEY`: For future metadata enrichment features
- Preview image storage: For gallery display

### 🐛 Troubleshooting & Debugging

**Common scan results**:
- **"Models skipped"**: Existing models with no new metadata to add
- **"Hash calculation skipped"**: Files exceeding size limits (>15GB default)
- **"Metadata errors"**: Corrupted or invalid JSON/safetensors files
- **"No models found"**: Check `MODEL_PATH` configuration and permissions

**Enhanced debugging** (current implementation includes comprehensive logging):
```
[ModelScan] ======= COMPREHENSIVE DEBUG FOR model.safetensors =======
[ModelScan] EXISTING MODEL KEY FIELDS:
  type: "lora"
  hash_autov2: "abc123def4"
  metadata_source: "embedded"
[ModelScan] NEW MODEL DATA KEY FIELDS:
  type: "lora"
  hash_autov2: "abc123def4"
  metadata_source: "civitai"
[ModelScan] FIELD-BY-FIELD COMPARISON:
  civitai_trained_words: existing="null" → new="anime, portrait" (hasNew=true)
[ModelScan] ✓ Updated model: model.safetensors (1 fields updated)
```

This comprehensive scanning process ensures that StableQueue maintains an accurate, up-to-date inventory of all available AI models with rich metadata for optimal job matching and availability tracking. 