# Model Availability Plan

## Implementation Status

### ✅ **IMPLEMENTED** - Core Model Database System
- [x] **StableQueue maintains a central model database** (`mobilesd_models.sqlite`)
- [x] **Comprehensive model metadata storage** with Civitai integration
- [x] **Hash-based model identification** using AutoV2 and SHA256 hashes
- [x] **Model server availability tracking** via `model_server_availability` table
- [x] **Model aliases system** for cross-platform path compatibility
- [x] **Automated database migrations** with backup system

### 🔄 **PARTIALLY IMPLEMENTED** - Model Availability Features
- [x] **Model specification by hash** (AutoV2 hash primary, SHA256 backup)
- [x] **Central database with server availability tracking**
- [x] **Model information persistence** (models remain in database even if unavailable)
- [ ] **Real-time inventory sync** from Forge servers to StableQueue
- [ ] **UI availability indicators** in job queue interface
- [ ] **Pre-submission availability checking**
- [ ] **Pre-dispatch availability verification**

### ❌ **NOT YET IMPLEMENTED** - Advanced Features
- [ ] **Automatic model download triggers**
- [ ] **Extension inventory sync API endpoints**
- [ ] **Job queue UI model availability indicators**
- [ ] **Automatic model hash generation for unknown models**

## Current Architecture (PRODUCTION)

### Database Schema (Already Implemented)
The model availability system is built on a sophisticated database schema:

```sql
-- Central model registry
CREATE TABLE models (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('checkpoint', 'lora')),
    hash_autov2 TEXT,
    hash_sha256 TEXT,
    civitai_id TEXT,
    civitai_version_id TEXT,
    -- ... additional Civitai metadata fields
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

### Current Capabilities
- **Model Registration**: Models are automatically registered when encountered
- **Hash Identification**: Uses AutoV2 and SHA256 hashes for reliable model identification
- **Civitai Integration**: Automatic metadata enrichment from Civitai API
- **Cross-Platform Paths**: Handles Windows/Linux path differences via aliases
- **Availability Tracking**: Records which servers have which models available

## Remaining Work

### Phase 1: API Endpoints for Inventory Sync
- [ ] `POST /api/v1/servers/{server_id}/models/sync` - Receive model inventory from Forge servers
- [ ] `GET /api/v1/models/{model_hash}/availability` - Check model availability across servers
- [ ] `POST /api/v1/models/register` - Register new models with metadata

### Phase 2: Job Queue Integration  
- [ ] Pre-submission availability checking in job submission endpoints
- [ ] Pre-dispatch availability verification in job dispatcher
- [ ] Job queue UI enhancements to show model availability status

### Phase 3: Advanced Features
- [ ] Automatic model download triggers
- [ ] Model availability notifications
- [ ] Cross-server model copying capabilities

## Answers to Original Clarifying Questions

- [x] **Each Forge server and StableQueue maintain their own model databases.**
    - [x] ✅ **IMPLEMENTED**: StableQueue maintains central database with server availability tracking
    - [ ] ❌ **PENDING**: Extensions need API endpoints for inventory sync

- [x] **Model specification should be by AutoV2 hash, with SHA256 as backup.**
    - [x] ✅ **IMPLEMENTED**: Database schema supports both hash types
    - [ ] ❌ **PENDING**: Automatic hash generation for unknown models

- [ ] **Jobs are always queued, with model availability indicated in the UI.**
    - [x] ✅ **IMPLEMENTED**: Jobs are always queued regardless of model availability
    - [ ] ❌ **PENDING**: UI indicators for model availability status

- [x] **Each server has its own database, and StableQueue maintains a central database.**
    - [x] ✅ **IMPLEMENTED**: Central database with comprehensive model metadata
    - [x] ✅ **IMPLEMENTED**: Server availability tracking maintains information even when models are unavailable

- [ ] **Availability is checked at submission and before dispatch.**
    - [ ] ❌ **PENDING**: Need to implement availability checking in API endpoints and job dispatcher

---

## Next Steps for Full Model Availability

Based on the current implementation, here are the specific steps to complete the model availability system:

### A. Complete API Integration (Priority 1)
- [ ] Implement `POST /api/v1/servers/{server_id}/models/sync` endpoint
- [ ] Add model availability checking to job submission endpoints
- [ ] Create model availability verification in job dispatcher
- [ ] Add model hash resolution for job requirements

### B. UI Enhancements (Priority 2)
- [ ] Add model availability indicators to job queue interface
- [ ] Show which servers have required models available
- [ ] Display model compatibility warnings before job submission
- [ ] Add model management interface for manual overrides

### C. Advanced Features (Priority 3)
- [ ] Implement automatic model download triggers
- [ ] Add cross-server model copying capabilities
- [ ] Create model availability notifications and alerts
- [ ] Develop predictive model availability analytics

### D. Extension Integration (Priority 4)
- [ ] Create Forge extension API endpoints for inventory sync
- [ ] Implement periodic model scanning and sync
- [ ] Add extension-side model availability checking
- [ ] Develop model recommendation system for extensions

**For detailed database schema information, see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)** 