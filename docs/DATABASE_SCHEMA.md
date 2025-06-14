# StableQueue Database Schema

StableQueue uses a dual-database architecture with two SQLite databases to separate concerns and optimize performance.

## Architecture Overview

- **`mobilesd_jobs.sqlite`**: Job queue management, API keys, and job processing
- **`mobilesd_models.sqlite`**: Model metadata, availability tracking, and Civitai integration

Both databases are stored in the `/data` directory and are automatically initialized on first run.

## Database 1: Job Queue (`mobilesd_jobs.sqlite`)

### `jobs` Table
Main job queue for image generation tasks.

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
    forge_internal_task_id TEXT,
    app_type TEXT DEFAULT 'forge',
    source_info TEXT,
    api_key_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_creation ON jobs (status, creation_timestamp);
```

**Field Descriptions:**
- `mobilesd_job_id`: UUID primary key for job identification
- `status`: Current job state (pending, processing, completed, failed, cancelled)
- `creation_timestamp`: ISO timestamp when job was created
- `last_updated_timestamp`: ISO timestamp of last status update
- `completion_timestamp`: ISO timestamp when job finished (success or failure)
- `target_server_alias`: Name of the Forge server to process this job
- `forge_session_hash`: Gradio session identifier for active jobs
- `generation_params_json`: JSON string containing all generation parameters
- `result_details_json`: JSON string containing results, images, and metadata
- `retry_count`: Number of retry attempts for failed jobs
- `forge_internal_task_id`: Internal Forge task tracking ID
- `app_type`: Source application type (forge, browser, api)
- `source_info`: Additional source tracking information
- `api_key_id`: Reference to API key used for job submission

### `api_keys` Table
API key management for external applications.

```sql
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used TEXT,
    is_active BOOLEAN DEFAULT 1,
    permissions TEXT,
    description TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys (key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys (is_active);
```

**Field Descriptions:**
- `id`: UUID primary key
- `name`: Human-readable name for the API key
- `key_prefix`: First part of API key for identification (e.g., "mk_")
- `key_hash`: Hashed version of the full API key
- `secret_hash`: Hashed version of the API secret
- `created_at`: ISO timestamp of key creation
- `last_used`: ISO timestamp of last API usage
- `is_active`: Boolean flag for key activation status
- `permissions`: JSON string for future permission system
- `description`: Optional description of key purpose

## Database 2: Model Management (`mobilesd_models.sqlite`)

### `models` Table
Comprehensive model metadata storage with Civitai integration.

```sql
CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY,
    name TEXT,
    type TEXT CHECK (type IN ('checkpoint', 'lora') OR type IS NULL),
    local_path TEXT NOT NULL,
    filename TEXT NOT NULL,
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
    metadata_status TEXT NOT NULL DEFAULT 'incomplete' CHECK (metadata_status IN ('complete', 'incomplete', 'error')),
    last_used TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_models_type_filename ON models (type, filename);
CREATE INDEX IF NOT EXISTS idx_models_civitai_ids ON models (civitai_id, civitai_version_id);
CREATE INDEX IF NOT EXISTS idx_models_metadata_status ON models (metadata_status);
CREATE INDEX IF NOT EXISTS idx_models_hashes ON models (hash_autov2, hash_sha256);
```

**Field Descriptions:**
- `id`: Auto-increment primary key
- `name`: Display name of the model
- `type`: Model type (checkpoint, lora, or null if unknown)
- `local_path`: Full file system path to model file
- `filename`: Base filename of the model
- `civitai_id`: Civitai model ID for API integration
- `civitai_version_id`: Civitai version ID for specific model version
- `forge_format`: Forge-specific formatting information
- `hash_autov2`: AutoV2 hash for model identification
- `hash_sha256`: SHA256 hash for model verification
- `civitai_model_name`: Model name from Civitai
- `civitai_model_base`: Base model type (SD 1.5, SDXL, etc.)
- `civitai_model_type`: Civitai model category
- `civitai_model_version_name`: Version name from Civitai
- `civitai_model_version_desc`: Version description from Civitai
- `civitai_model_version_date`: Release date from Civitai
- `civitai_download_url`: Direct download URL from Civitai
- `civitai_trained_words`: Trigger words for the model
- `civitai_file_size_kb`: File size in kilobytes
- `metadata_status`: Status of Civitai metadata enrichment
- `metadata_source`: Source of metadata (forge/civitai/embedded/none)
- `has_embedded_metadata`: Boolean flag for embedded metadata presence
- `last_used`: Timestamp of last model usage
- `created_at`: Timestamp of database record creation

### Model Parameters Example

Here's an example of all 24 parameters stored for a LoRA model (`0859 library_v1_pony.safetensors`):

```json
{
  "id": 275,
  "name": "0859 library_v1_pony.safetensors",
  "type": "lora",
  "local_path": "/app/models/loras/Pony",
  "filename": "0859 library_v1_pony.safetensors",
  "civitai_id": "651553.0",
  "civitai_version_id": "728915.0",
  "forge_format": null,
  "hash_autov2": null,
  "hash_sha256": "4FEAADF2925367C7C8C67A43888BAB274C1306672EC82CED8FDD15F196135073",
  "civitai_model_name": null,
  "civitai_model_base": null,
  "civitai_model_type": null,
  "civitai_model_version_name": null,
  "civitai_model_version_desc": null,
  "civitai_model_version_date": null,
  "civitai_download_url": null,
  "civitai_trained_words": "ruanyi0859",
  "civitai_file_size_kb": null,
  "metadata_status": "complete",
  "metadata_source": "forge",
  "has_embedded_metadata": 1,
  "last_used": "2025-06-14 02:56:15",
  "created_at": "2025-06-14 02:56:15"
}
```

### Metadata Source Priority

StableQueue follows a strict hierarchy for metadata extraction:

1. **Forge-style JSON** (`modelname.json`) - **Highest Priority**
2. **Civitai-style JSON** (`modelname.civitai.json`) - **Medium Priority**  
3. **Embedded Metadata** (from safetensors file) - **Lowest Priority**

The system merges data from these sources with JSON taking precedence over embedded metadata. **No inferences are made** - only explicit data from these sources is used.

### Enhanced Features

**Type Extraction**: The `type` field is automatically populated from:
- Explicit `type` field in JSON metadata, OR
- Extracted from `modelspec.architecture` in embedded metadata:
  - `"flux-1-dev/lora"` → `"lora"`
  - `"flux-1-dev/checkpoint"` → `"checkpoint"`

**Enhanced Activation Text**: The `civitai_trained_words` field uses a priority system:
- JSON `trainedWords` or `activation text` fields (highest priority)
- Rich tag frequency data from embedded `ss_tag_frequency` (fallback)
- Combines multiple high-frequency tags intelligently when using embedded data

### `model_aliases` Table
Alternative path mappings for model matching.

```sql
CREATE TABLE IF NOT EXISTS model_aliases (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL,
    alias_path TEXT NOT NULL,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_model_aliases_path ON model_aliases (alias_path);
```

**Field Descriptions:**
- `id`: Auto-increment primary key
- `model_id`: Foreign key reference to models table
- `alias_path`: Alternative path format for model matching

### `model_server_availability` Table
Tracks which models are available on which servers.

```sql
CREATE TABLE IF NOT EXISTS model_server_availability (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL,
    server_id TEXT NOT NULL,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    UNIQUE(model_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_model_server_availability ON model_server_availability (model_id, server_id);
```

**Field Descriptions:**
- `id`: Auto-increment primary key
- `model_id`: Foreign key reference to models table
- `server_id`: Identifier for the Forge server
- `last_seen`: Timestamp when model was last confirmed available

## Migration System

StableQueue includes an automated database migration system to handle schema updates:

### Migration Files
- `utils/dbMigration.js`: Job database migration utilities
- `utils/migrateModelsDb.js`: Model database migration utilities

### Migration Features
- **Automatic Backup**: Creates timestamped backups before migrations
- **Column Detection**: Checks for existing columns before adding new ones
- **Table Detection**: Verifies table existence before creation
- **Transaction Safety**: Uses database transactions for atomic updates
- **Rollback Support**: Automatic rollback on migration failures

### Running Migrations
Migrations run automatically on application startup, but can also be run manually:

```javascript
const { runMigration } = require('./utils/dbMigration');
const { runModelsMigration } = require('./utils/migrateModelsDb');

// Run job database migration
runMigration({ createBackup: true, verbose: true });

// Run model database migration  
runModelsMigration({ createBackup: true, verbose: true });
```

## Database Initialization

Both databases are automatically initialized when the application starts:

```javascript
// Job database initialization
const jobDb = new Database(path.join(dataDir, 'mobilesd_jobs.sqlite'));
jobDb.exec(jobSchema);

// Model database initialization
const modelDb = new Database(path.join(dataDir, 'mobilesd_models.sqlite'));
modelDb.exec(modelSchema);
```

## Performance Considerations

### Indexes
Both databases use strategic indexing for optimal query performance:
- **Job queries**: Indexed on status and creation timestamp
- **Model queries**: Indexed on type, filename, hashes, and Civitai IDs
- **Availability queries**: Indexed on model and server combinations

### Connection Management
- Uses `better-sqlite3` for synchronous, high-performance SQLite operations
- Single connection per database with automatic cleanup
- Transaction support for batch operations

## Backup and Recovery

### Automatic Backups
- Migration system creates timestamped backups before schema changes
- Backup files stored in `/data` directory with format: `{database}_backup_{timestamp}.sqlite`

### Manual Backup
```bash
# Backup job database
cp data/mobilesd_jobs.sqlite data/mobilesd_jobs_backup_$(date +%Y%m%d_%H%M%S).sqlite

# Backup model database
cp data/mobilesd_models.sqlite data/mobilesd_models_backup_$(date +%Y%m%d_%H%M%S).sqlite
```

## Data Volume Mappings

In Docker deployments, ensure proper volume mappings for data persistence:

```yaml
volumes:
  - ./data:/usr/src/app/data  # Contains both SQLite databases
```

This preserves all database data across container restarts and updates. 