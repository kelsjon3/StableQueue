# Project Plan: StableQueue - Stable Diffusion Job Queue System

*StableQueue is a robust, straightforward job queuing system for Stable Diffusion that works immediately upon startup. No complex setup flows or special initialization required - just start the application and begin using it.*

## Core Application Philosophy

StableQueue follows a simple, predictable flow:

1. **Application starts** - Works immediately, no setup required
2. **Add servers** - Connect to your Stable Diffusion instances as needed  
3. **Generate API keys** - Create them when needed for external applications
4. **Manage jobs** - Queue, monitor, and view results
5. **View images** - See generated content in the frontend gallery

**Key Principle**: Creating the 1st API key works exactly like creating the 100th API key. No special "first-time setup" behavior.

## I. Core Architectural Change: Adopt a Single Docker Container Strategy

*   **Project Packaging:** The project will be packaged into a **single Docker container**.
*   **Node.js/Express Responsibilities:**
    1.  Serve all API endpoints.
    2.  Serve all static frontend assets (HTML, CSS, JavaScript from a designated folder, e.g., `public` or `frontend`).
*   **Implications:**
    *   A separate Nginx frontend service and its configuration are **no longer needed**.
    *   The `Dockerfile` will be for this consolidated Node.js application, including copying and serving frontend assets.
    *   `docker-compose.yml` will define a single service (e.g., `mobilesd`), useful for managing environment variables, ports, and volumes.

## II. Backend Updates (Node.js/Express) - Phase 1 Completed, Phase 2 In Progress

1.  **Serving Frontend Assets:** (Setup done in app.js)
2.  **Dynamic Server Configuration Management (Forge Instances):** (APIs Implemented)
3.  **Local Resource Management & Model Access Strategy (Phased Approach):** (APIs for scanning master library Implemented)
4.  **Civitai API Integration:** (APIs Implemented)
    * **Enhanced Civitai Integration:**
        * **Current State:** APIs for image info, model downloads, and metadata management are implemented.
        * **Metadata Compatibility:** ✅ IMPLEMENTED: Model metadata is now stored in Forge-compatible format, enabling compatibility with existing Forge extensions.
        * **Automated Model Identification:** ✅ IMPLEMENTED: Improved matching logic between local models and Civitai database using both names and hash identifiers.
        * **Preview Image Handling:** ✅ IMPLEMENTED: Preview images are saved in multiple formats (both modelname.jpg and modelname.preview.png) for better compatibility.
        * **Rate Limiting:** ✅ IMPLEMENTED: Added proper rate limiting for Civitai API requests to prevent excessive requests.
        * **On-Demand Model Download Framework:** Build infrastructure for automatic detection of missing models and triggering downloads during job processing.
5.  **Core Generation Endpoints (Refactoring for Phase 2):**
    *   **Phase 1 Implementation (Now Deprecated but present in `routes/generation.js`):**
        *   `POST /api/v1/generate` directly communicated with Forge's `/queue/join` using `fn_index: 257`.
        *   It constructed the large payload array, mapping UI inputs.
        *   **Checkpoint Handling (Phase 1):** Sent `"Use same checkpoint"`, relying on the checkpoint pre-selected in the Forge UI. This mechanism caused issues when the MobileSD UI tried to specify a different checkpoint.
        *   Returned Forge's `session_hash` directly to the client.
        *   `GET /api/v1/progress` acted as a direct SSE proxy for the client to monitor Forge.
        *   Image saving logic in the backend (`/api/v1/progress`) was attempted but relied on the client staying connected and is superseded by the Phase 2 monitor.
    *   **Phase 2 Implementation (COMPLETED):**
        *   Transitioned to the robust job queue system described in `II.bis`.
        *   Updated `routes/generation.js` to add jobs to the queue and return MobileSD job IDs.
        *   Implemented checkpoint handling using path normalization (converting forward slashes to backslashes).
        *   Created model database system for efficient checkpoint lookup and path normalization.
        *   Fixed payload template to properly map positive_prompt instead of using hardcoded defaults.
        *   **Enhanced Civitai Integration:** *(Phase 2 Tasks)*
            *   **Metadata Compatibility:** ✅ COMPLETED: Updated the download process to maintain metadata format compatibility with Forge extensions, storing data in the same location and format.
            *   **Model Identification System:** ✅ COMPLETED: Enhanced model scanning to extract and use Civitai IDs from existing metadata files and match with appropriate data.
            *   **Preview Image Compatibility:** ✅ COMPLETED: Implemented support for identifying and using preview images in multiple formats, prioritizing JPG files for better compatibility.
            *   **Civitai API Rate Limiting:** ✅ COMPLETED: Added safeguards against excessive API requests with configurable delays between requests.
            *   **On-Demand Download Logic:** Implement system to detect missing models during job processing and trigger downloads. *(Not Started)*
            *   **Download Queue Manager:** Create service to handle multiple concurrent model downloads with prioritization. *(Not Started)*

## II.bis. Core Backend: Persistent Job Queuing & Dispatcher System (IMPLEMENTED)

*This phase focuses on making MobileSD a robust, browser-independent queuing system for managing multiple image generation jobs.*

1.  **MobileSD Internal Job Queue (Persistence):**
    *   **Storage:** Implemented persistent storage using SQLite.
    *   **Job Schema:** Defined structure to store job details:
        *   `mobilesd_job_id`: Unique ID generated by MobileSD.
        *   `status`: (`pending`, `processing`, `completed`, `failed`, `cancelled`).
        *   `creation_timestamp`, `completion_timestamp`.
        *   `target_server_alias`: Alias of the Forge server to use.
        *   `forge_session_hash`: Stored once the job is sent to Forge.
        *   `generation_params`: Object containing all parameters needed for generation (prompts, dimensions, sampler, seed, LoRAs, **`checkpoint_name`**, etc.).
        *   `result_details`: Saved image filenames, error messages.
2.  **Job Submission Logic (`POST /api/v1/generate` Rework):**
    *   **Status: COMPLETED**
    *   Endpoint receives generation requests (including `checkpoint_name` from the UI).
    *   Creates job objects based on the defined schema.
    *   Adds jobs to the persistent queue with `pending` status.
    *   Immediately responds to the client with the `mobilesd_job_id`.
3.  **Backend Job Dispatcher Service:**
    *   **Status: COMPLETED**
    *   Implemented as a background service started in `app.js`.
    *   **Job Selection:** Periodically queries the persistent queue for `pending` jobs.
    *   **Checkpoint Handling:**
        *   **Path Normalization:** Converts forward slashes to backslashes for Windows-based Forge servers.
        *   **Setting Strategy:** Uses `/sdapi/v1/options` endpoint to set the checkpoint before generation.
        *   **Redundant Approaches:** Includes checkpoint in both the Gradio generation template and override_settings.
    *   **Forge Submission:**
        *   Retrieves job details (including `target_server_alias` and all `generation_params`).
        *   Sends a request to set the checkpoint using `/sdapi/v1/options`.
        *   Submits the generation request to Forge's `/queue/join` using `fn_index: 257`.
        *   Also attempts a direct txt2img API call as a fallback/parallel approach.
        *   Updates job status to `processing` and stores the Forge `session_hash`.
    *   **Concurrency Control:** Implements basic logic (e.g., one job per Forge server at a time).
4.  **Backend Forge Job Monitoring Service (Per-Active-Job):**
    *   **Status: COMPLETED**
    *   For each job marked `processing`:
        *   Maintains a dedicated backend SSE connection to Forge's `/queue/data?session_hash=...`.
        *   Parses SSE messages (`estimation`, `process_starts`, `process_generating`, `heartbeat`, `process_completed`).
        *   Downloads and saves images to `STABLE_DIFFUSION_SAVE_PATH` on completion.
        *   Updates job status to `completed` or `failed` accordingly.
    *   **Enhanced Monitoring with Polling:**
        *   **Status: IMPLEMENTED ✅**
        *   **Dual Approach:** Uses both SSE events and direct polling to ensure reliable progress updates.
        *   **Polling Mechanism:** Periodically queries Forge's `/internal/progress` endpoint for more accurate progress data.
        *   **Preview Image Extraction:** Actively retrieves preview images from both SSE events and polling responses.
        *   **Improved Progress Reporting:** Provides smoother progress updates to the UI by combining data from both sources.
        *   **Fallback Strategy:** Continues functioning even when SSE connection has issues or doesn't provide adequate updates.
        *   **State Tracking:** Intelligently manages state to avoid duplicate processing of images or events.
    *   **Robustness Considerations:**
        *   **Status: IMPLEMENTED ✅**
        *   Added utility scripts for queue management (clearing, reset).
        *   Implemented timestamp filtering to avoid processing stale jobs on restart.
        *   Created error handling and logging for better debugging.
        *   **Improved Logging System:**
            *   **Status: IMPLEMENTED ✅**
            *   Enhanced logging with specific prefixes to track communication flow:
                *   `[FORGE→SERVER]`: Events and data coming from Forge to MobileSD
                *   `[SERVER→CLIENT]`: Updates sent from MobileSD to browser clients
                *   `[POLL]`: Information about the polling operations
                *   `[ARTIFICIAL]`: Artificial progress updates when real progress is delayed
            *   Better error handling with detailed context information
            *   Consolidated job status tracking to prevent issues with duplicated status updates
        *   **Duplicate Image Prevention:**
            *   **Status: IMPLEMENTED ✅**
            *   Added state tracking with a `hasCompletedProcessing` flag to prevent duplicate processing
            *   Implemented image de-duplication using a set of unique image paths
            *   Fixed race conditions that caused multiple copies of the same image
        *   **Database Constraint Error Handling:**
            *   **Status: IMPLEMENTED ✅**
            *   Fixed "CHECK constraint failed: status IN..." errors by removing custom status fields
            *   Implemented using the result_details JSON field to track job state instead
        *   **Database Schema Compatibility:**
            *   **Status: IMPLEMENTED ✅**
            *   Added backward compatibility for schema changes
            *   Dynamically detects column presence and implements fallback mechanisms
            *   Stores data in JSON fields when columns don't exist
        *   **Task ID Management:**
            *   **Status: IMPLEMENTED ✅**
            *   Improved handling of Forge's task ID with format standardization
            *   Implemented multiple storage locations (dedicated column, JSON fields, and in-memory state)
5.  **Robustness Considerations:**
    *   **Status: PARTIALLY IMPLEMENTED**
    *   Added utility scripts for queue management (clearing, reset).
    *   Implemented timestamp filtering to avoid processing stale jobs on restart.
    *   Created error handling and logging for better debugging.
    *   **Improved Logging System:**
        *   **Status: IMPLEMENTED**
        *   Enhanced logging with specific prefixes to track communication flow:
            *   `[FORGE→SERVER]`: Events and data coming from Forge to MobileSD
            *   `[SERVER→CLIENT]`: Updates sent from MobileSD to browser clients
            *   `[POLL]`: Information about the polling operations
            *   `[ARTIFICIAL]`: Artificial progress updates when real progress is delayed
        *   Better error handling with detailed context information
        *   Consolidated job status tracking to prevent issues with duplicated status updates

## II.ter. Model Database System (NEW IMPLEMENTATION)

*This new phase addresses the cross-platform compatibility issues with checkpoint paths.*

1.  **Model Database Schema:**
    *   **Storage:** Implemented using SQLite with tables for models and aliases.
    *   **Key Fields:** ID, name, path, normalized_path, hash, title, and creation timestamp.
2.  **Path Normalization:**
    *   **Forwardslash to Backslash:** Converts `/` to `\` for Windows-based Forge servers.
    *   **Alias Storage:** Maintains multiple path variants for each model for better matching.
3.  **In-Memory Cache:**
    *   **Performance:** Implements an in-memory cache of models for faster lookups.
    *   **Initialization:** Populates the cache on application startup.
4.  **Fallback Strategies:**
    *   **Path Format Matching:** Tries both forward and backslash variants when searching.
    *   **Basename Matching:** Falls back to matching just the filename if path matching fails.
    *   **Levenshtein Distance:** Uses fuzzy matching as a last resort for similar model names.
5.  **Debugging Endpoints:**
    *   **Verification:** Implemented `/api/v1/debug/verify-checkpoint` for testing model lookup.
    *   **Cache Inspection:** Added `/api/v1/debug/models-cache` to view the current state of the model database.

## III. Frontend UI Updates (HTML, CSS, Vanilla JavaScript) - Phase 3 (Dependent on Backend Phase 2)

1.  **General:** All frontend assets served by the Node.js/Express application from the `public/` directory.
2.  **Main Generation Page:**
    *   Server Selection Dropdown *(Implemented)*.
    *   Input Fields (Prompts, Seed, Width, Height, Steps, CFG, **Sampler Name**). *(Updated: Sampler Index changed to Sampler Name text input, default "Euler"). New Forge-specific inputs added (style preset, etc. with HAR defaults).*
    *   LoRA Selection *(Implemented, LoRAs included in prompt string)*.
    *   Checkpoint Selection: *(Frontend sends `checkpoint_name` correctly. Backend has been updated to properly process and normalize the paths. Parameter renaming clarified - using "positive_prompt" instead of just "prompt").*
    *   **Enhanced Model Selection UI:**
        *   Display Civitai metadata (when available) for checkpoints and LoRAs including thumbnail previews.
        *   Add indicator for model status (local/downloadable).
        *   Implement option to download models directly from selection UI.
    *   "Generate Image" Button: **Needs update** to become "Add to Queue". It calls `POST /api/v1/generate`.
    *   Progress Display: **Needs significant update.** Instead of directly connecting to `/api/v1/progress` with a Forge `session_hash`, the UI will need to:
        *   Receive the `mobilesd_job_id` from the `POST /api/v1/generate` response.
        *   Periodically poll a new backend endpoint (e.g., `GET /api/v1/queue/jobs/:mobilesd_job_id/status`) to get the current status (`pending`, `processing`, `completed`, `failed`) and progress details stored by the backend monitor. SSE from the backend *to* the frontend for real-time updates is a possible enhancement but polling is simpler initially.
        *   On `completed` status, retrieve image details (e.g., filenames or paths) to display results (likely fetched via the Gallery API).
3.  **Server Setup Page/Tab:** *(Implemented)*
4.  **Civitai Integration UI:**
    *   **Enhanced Browsing:** Create a dedicated Civitai browser interface for exploring and searching models.
    *   **Model Details:** Display comprehensive information about models including versions, download statistics, and community ratings.
    *   **Download Management:** Provide controls for downloading models with progress tracking and prioritization.
    *   **Model Updates:** Alert users about available updates for installed models and offer one-click updating.
5.  **NEW: Queue Tab (MobileSD UI):** (Implementation part of Phase 3)
    *   **View:** Displays jobs from MobileSD's internal queue (pending, processing, completed, failed).
        *   Show Job ID, key parameters, status, timestamps.
        *   For `processing_on_forge` jobs, could show basic progress if the backend Job Monitor exposes this.
        *   Add display for model download status when jobs are waiting for resources.
    *   **Actions:**
        *   Reorder pending jobs.
        *   Cancel/delete pending or processing jobs (would require backend to attempt to stop Forge job if possible, or just mark as cancelled in MobileSD queue).
        *   Clear/remove completed/failed jobs from view.
    *   **Backend API:** Requires new endpoints like:
        *   `GET /api/v1/queue/jobs` (list jobs, with filtering options for status).
        *   `POST /api/v1/queue/jobs/:job_id/cancel`
        *   `DELETE /api/v1/queue/jobs/:job_id` (to remove from list)
6.  **NEW: Gallery Tab (MobileSD UI):** (Implementation part of Phase 3)
    *   **View:** Displays images successfully downloaded and saved by MobileSD to `STABLE_DIFFUSION_SAVE_PATH`.
        *   Show thumbnails, allow clicking to view larger image.
        *   Display basic metadata if saved alongside (e.g., prompt, seed - could be part of filename or a companion .json).
    *   **Actions:**
        *   Sort/filter images.
        *   Delete images (with confirmation, deletes from `STABLE_DIFFUSION_SAVE_PATH`).
    *   **Backend API:** Requires new endpoints like:
        *   `GET /api/v1/gallery/images` (list image files and potentially metadata).
        *   `DELETE /api/v1/gallery/images/:filename`.
        *   A way to serve the actual image files (e.g., if save path is not directly under `public`, a route like `GET /gallery_files/:filename`).
7.  **Overall UI/UX:**
    *   Clear feedback/error messaging.
    *   Responsive design.

## IV. Docker Setup (Single Container) - Phase 1 Completed

*   (`Dockerfile` and `docker-compose.yml` created and tested).
*   **Required Environment Variables for MobileSD container (on Unraid):**
    *   `PORT`: Internal port for Node.js app.
    *   `CONFIG_DATA_PATH`: Path inside MobileSD container for `servers.json` (maps to Unraid appdata).
    *   `STABLE_DIFFUSION_SAVE_PATH`: Path inside MobileSD container for image saves (maps to Unraid, ideally a shared location accessible by other means if needed).
    *   `LORA_PATH`: Path inside MobileSD container to the Unraid master LoRA model library share.
    *   `CHECKPOINT_PATH`: Path inside MobileSD container to the Unraid master Checkpoint model library share.

## V. General Requirements - Integrated during Phase 1

*   (Error Handling, Logging, Code Structure, Security addressed in initial implementations).

## VI. Overall Development Workflow (Phased Approach)

1.  **Phase 1: Core MobileSD Application & Direct Forge Interaction - COMPLETED**
    *   **Core Backend & Docker Setup:** Initialize Node.js, Express, static file serving (`public/index.html`), `Dockerfile`, `docker-compose.yml`. *(Done)*
    *   **Dynamic Server Config:** Implement `/api/v1/servers` CRUD APIs. *(Done)*
    *   **Direct Forge Generation Logic:** Implement `/api/v1/generate` and `/api/v1/progress` that directly interact with Forge for a single job, with client-side SSE handling. *(Iteration 2: Successfully generates images with Forge using fn_index 257 and large data array; image displayed in UI via URL. Backend saving logic for this direct flow is the immediate next micro-step to test).*
    *   **Local Resource Listing:** Implement `/api/v1/loras` and `/api/v1/checkpoints`. *(Done)*
    *   **Civitai Integration (Download to Unraid):** Implement `/api/v1/civitai/image-info` and `/api/v1/civitai/download-model`. *(Done)*
    *   **Basic Frontend Structure:** Setup `public/index.html` and static serving. *(Done)*
    *   *Note: The direct Forge interaction logic in `routes/generation.js` is now considered legacy and needs replacement by Phase 2 components.*

2.  **Phase 2: Backend - Persistent Job Queuing & Dispatcher System (COMPLETED)**
    *   **Define & Implement Job Queue Persistence:** (Chosen SQLite for implementation). *(Done)*
    *   **Refactor `POST /api/v1/generate`:** Adapted to add jobs to the internal queue and return `mobilesd_job_id`. *(Done)*
    *   **Develop Backend Job Dispatcher:** Implemented service to pick pending jobs and submit them to Forge, including correct checkpoint handling. *(Done)*
    *   **Develop Backend Forge Job Monitor:** Implemented service to track Forge jobs via backend SSE, download/save images, update job status. *(Done)*
    *   **Implement Backend APIs for Queue Management:** Created `GET /api/v1/queue/jobs`, `GET /api/v1/queue/jobs/:job_id/status`, etc. *(Done)*
    *   **Implement Backend APIs for Gallery:** Create `GET /api/v1/gallery/images`, image serving, etc. *(In Progress)*
    *   **Enhanced Model Database System (NEW COMPLETED TASK):**
        *   **Schema Design:** Created SQLite tables for models and aliases with appropriate fields. *(Done)*
        *   **Path Normalization:** Implemented algorithms to handle different path formats across platforms. *(Done)*
        *   **In-Memory Cache:** Created system to load and cache model information for faster lookup. *(Done)*
        *   **Multiple Matching Strategies:** Implemented fallback approaches for more reliable model resolution. *(Done)*
    *   **Enhanced Civitai Integration:** *(New Phase 2 Task)*
        *   **Metadata Compatibility:** Update the download process to maintain metadata format compatibility with Forge extensions. *(Task: Not Started)*
        *   **Model Identification System:** Enhance model scanning to extract and use Civitai IDs from existing metadata files. *(Task: Not Started)*
        *   **On-Demand Download Logic:** Implement system to detect missing models during job processing and trigger downloads. *(Task: Not Started)*
        *   **Download Queue Manager:** Create service to handle multiple concurrent model downloads with prioritization. *(Task: Not Started)*

3.  **Phase 3: Frontend - Queue Management & Gallery UI (NEXT MAJOR PHASE - Blocked by Phase 2)**
    *   Develop the "Queue Tab" UI.
    *   Develop the "Gallery Tab" UI.
    *   Adapt the main "Generator" page UI (button text, progress display mechanism).
    *   **Enhanced Civitai Browser UI:** Create dedicated interface for exploring and downloading Civitai models. *(New Phase 3 Task)*
    *   **Enhanced Model Selection UI:** Update checkpoints and LoRAs dropdowns to display Civitai metadata and previews. *(New Phase 3 Task)*
    *   Refine overall UI/UX.

4.  **Phase 4: Advanced Model Management (Future)**
    *   **Automatic Updates:** Implement checking for model updates on Civitai.
    *   **Smart Caching:** Develop system to manage model storage based on usage patterns.
    *   **Model Analytics:** Track model usage statistics and quality of results.
    *   **Custom Collections:** Enable users to organize models into personalized collections.

5.  **Phase 5: Testing, Optimization, and Documentation (Ongoing & Final)**
    *   (Previously Phase 4)

6.  **Phase 6 (Future): Advanced Features & Extension Integration**
    *   **Extension Support:** Investigate integration with popular Forge extensions.
    *   **Advanced Generation Options:** Support for additional generation methods (img2img, inpainting, etc.).
    *   **Workflow Automation:** Enable creation of multi-step generation pipelines.

## VII. Immediate Steps (Revised - Focusing on Phase 3 Frontend Development)

1.  **Continue Gallery API Implementation:**
    *   Complete the endpoints for listing and serving images.
    *   Implement image metadata association with original generation jobs.
    *   Add support for sorting and filtering.
2.  **Update Frontend to Use Job Queue System:**
    *   ✅ COMPLETED: Modified the "Generate" button to add jobs to the queue
    *   ✅ COMPLETED: Implemented smooth progress reporting from 0-100%
    *   ✅ COMPLETED: Created UI elements to display job progress and completion
3.  **Develop Queue Management UI:**
    *   Create a dedicated tab to view and manage the job queue.
    *   Implement functionality to cancel or delete jobs.
    *   Add job reordering and prioritization features.
4.  **Further Enhance Civitai Integration:**
    *   ✅ COMPLETED: Metadata compatibility with Forge extensions
    *   ✅ COMPLETED: Rate limiting for API requests
    *   ✅ COMPLETED: Preview image handling in multiple formats
    *   ✅ COMPLETED: Display of Civitai ID and URLs in model details UI
    *   Implement automatic model detection and download during job processing.
    *   Create a user-friendly UI for browsing and managing Civitai models.
5.  **Improve Error Handling and Robustness:**
    *   ✅ COMPLETED: Added better error reporting in the UI
    *   ✅ COMPLETED: Implemented more extensive logging for debugging
    *   ✅ COMPLETED: Added enhanced progress tracking and duplicate prevention
    *   Add automatic recovery mechanisms for database corruption or server disconnections.
6.  **Documentation and Testing:**
    *   ✅ COMPLETED: Updated project plan documentation
    *   Create comprehensive testing procedures for different scenarios.
    *   Document common issues and solutions.

## VIII. Lessons Learned (NEW SECTION)

1.  **Cross-Platform Path Handling:**
    *   **Windows vs. Unix:** Windows-based Forge servers expect backslashes (`\`) while the frontend typically uses forward slashes (`/`). Path normalization is essential for compatibility.
    *   **Multiple Path Variants:** It's important to store and check multiple path formats for the same model to ensure reliable matching.
    *   **Fuzzy Matching:** When exact matching fails, implementing fallback strategies like basename matching or Levenshtein distance can improve resilience.
2.  **Prompt Parameter Naming:**
    *   **Consistent Naming:** The parameter must be named `positive_prompt` (not just `prompt`) throughout the system to prevent confusion.
    *   **Template Defaults:** Hard-coded values in payload templates can override user inputs if parameter mapping isn't careful.
3.  **Job Processing:**
    *   **Multiple Approaches:** Using both the Gradio API and direct txt2img API provides better reliability.
    *   **Queue Clearing:** Having a mechanism to easily reset the job queue is essential for debugging and recovery.
    *   **Timestamp Filtering:** Filtering out old jobs on restart prevents unintentional processing of stale requests.
4.  **Database Management:**
    *   **In-Memory Caching:** Balancing database queries with in-memory caching significantly improves performance.
    *   **Atomic Updates:** Ensuring that database updates are atomic prevents corrupting the job queue state.
    *   **Backup Mechanisms:** Implementing database backup before destructive operations provides safety nets.
5.  **Progress Tracking:**
    *   **Dual Sources:** Combining SSE events with active polling provides more reliable progress updates.
    *   **Incremental Updates:** A properly implemented progress bar should show smooth incremental updates from 0-100%.
    *   **State Management:** A `hasCompletedProcessing` flag helps prevent duplicate processing of completed jobs.
6.  **Deployment Considerations:**
    *   **Cross-Platform Compatibility:** Ensure file paths work correctly across different operating systems.
    *   **Database Migrations:** Have a strategy for schema changes that maintains backward compatibility.
    *   **Logging Directionality:** Adding direction indicators ([FORGE→SERVER], [SERVER→CLIENT], [POLL]) helps with debugging.

## IX. Models Tab Implementation Plan

### Overview
Add a new "Models" tab to display both checkpoints and LoRAs with their preview images, Civitai links, and critical metadata including base model information.

### Backend Requirements

1. **New API Endpoints:**
   - `GET /api/v1/models` - List all models (checkpoints & LoRAs) with metadata
   - `GET /api/v1/models/:id/preview` - Get preview image for a model
   - `GET /api/v1/models/:id/info` - Get detailed model info including Civitai metadata

2. **Data Processing:**
   - Parse model metadata files (JSON/YAML) for:
     - Civitai IDs
     - Base model information (SDXL, Pony, Flux.1 D, etc.)
     - Other technical specifications
   - Extract and serve preview images from model folders
   - Cache results to improve performance

### Frontend Implementation

1. **UI Components:**
   - Add "Models" tab in main navigation
   - Create card-based grid layout for model display
   - Implement filters for:
     - Model types (checkpoints/LoRAs)
     - Base models (SDXL, Pony, Flux.1 D, etc.)
   - Add search functionality by name/tags

2. **Model Card Design:**
   - Preview image (with placeholder for missing previews)
   - Model name
   - Type badge (checkpoint/LoRA)
   - **Base Model** label (SDXL, Pony, Flux.1 D, etc.)
   - Civitai link (if available)
   - Basic info (resolution, version, etc.)

### Implementation Steps

1. **Backend Development:**
   - Create model scanning utilities to build metadata database
   - Extract base model information from metadata files
   - Implement API endpoints for model listing and filtering
   - Add preview image handling

2. **Frontend Development:**
   - Add tab to navigation
   - Create models page layout with grid view
   - Implement model cards with base model information
   - Add filtering by base model type
   - Add loading states and error handling

3. **Integration:**
   - Connect frontend to new API endpoints
   - Implement caching strategy for faster loads
   - Add refresh functionality

### Timeline Estimate
- Backend API endpoints: 2-3 days
- Frontend UI implementation: 2-3 days
- Testing and refinement: 1-2 days

### Future Enhancements
- Model management (delete, rename)
- Direct model download from Civitai
- Model usage statistics
- Favorites/collection organization
- Base model compatibility warnings when selecting models

*Note: The following "MobileSD Development Plan" section, with its own Phases I-VI and "VII. Immediate Steps", describes an earlier or alternative implementation path focusing on a synchronous interaction with Forge's FastAPI endpoints (e.g., `/sdapi/v1/txt2img`) via a `services/dispatcher.js`. While parts of this may have been partially implemented, the **primary and current development focus for achieving a robust, browser-independent job queuing and processing system is detailed in Section II.bis: Core Backend: Persistent Job Queuing & Dispatcher System and its corresponding VII. Immediate Steps (Revised - Focusing on Phase 3 Frontend Development).** The Section II.bis approach utilizes Forge's asynchronous Gradio API (`/queue/join` and `/queue/data`) for enhanced resilience and background processing.*

**Overall Goal:** Create a mobile-friendly web UI to interact with a remote Stable Diffusion Forge server. It must be a robust, browser-independent queuing system for managing multiple image generation jobs.

---

### Phase 1: Server Setup UI (Completed)

*   **Goal:** Allow users to configure connection details for one or more Forge servers.
*   **Status:** **Completed**
*   **Details:**
    *   Frontend page (`Server Setup` view) with form for Alias, API URL, Auth.
    *   Backend API endpoints (`/api/v1/servers`) for CRUD operations on server configs.
    *   Server configurations stored in `data/servers.json`.
    *   Functionality: Add, List, Edit (including alias change), Delete servers.
    *   Helper functions in `utils/configHelpers.js`.
    *   Server list populates dropdown on Generator page.

---

### Phase 2: Generator Page - Resource Loading (Completed)

*   **Goal:** Load available Checkpoints and LoRAs from the Forge server into the UI.
*   **Status:** **Completed**
*   **Details:**
    *   Backend API endpoints (`/api/v1/checkpoints`, `/api/v1/loras`) using recursive `scanModelDirectory` from `utils/configHelpers.js`.
    *   Endpoints return `filename` and `relativePath`.
    *   Frontend (`public/js/app.js`) fetches and populates Checkpoint dropdown (displaying `relativePath/filename`).
    *   Frontend (`public/js/app.js`) fetches LoRAs, implements dynamic adding/removing of LoRA rows with dropdowns and weight inputs.

---

### Phase 3: Documentation & Git Sync (Completed)

*   **Goal:** Update documentation and sync with Git repository.
*   **Status:** **Completed**
*   **Details:**
    *   Updated `docs/PLAN.md` and `docs/FILES.MD`.
    *   Performed `git add .`, `git commit`, `git push`.

---

### Phase 4: Generator Page - Main Action (Partially Completed)

*   **Goal:** Implement the "Generate Image" button click, send parameters to the backend, have the backend interact with the Forge server to generate the image using the selected parameters (including checkpoint and LoRAs), and update the job status.
*   **Status:** **Partially Completed**
*   **Details:**
    *   Frontend (`public/js/app.js`):
        *   Gathers input parameters (prompts, dimensions, steps, CFG, seed, LoRAs, etc.) and selected server/checkpoint.
        *   Constructs request body: `{ target_server_alias: "...", generation_params: { ... } }`.
        *   Sends request to `POST /api/v1/generate`.
    *   Backend (`routes/generation.js`):
        *   `POST /api/v1/generate` receives request.
        *   Correctly extracts `target_server_alias` and the nested `generation_params` object.
        *   Creates a job object with a unique ID and status 'pending'.
        *   Stores the *flat* `generation_params` object within the job.
        *   Adds job to the queue using `utils/jobQueueHelpers.js`.
        *   Responds `202 Accepted` with `{ mobilesd_job_id: "..." }`.
    *   Backend (`services/dispatcher.js`):
        *   Periodically checks queue for pending jobs.
        *   For a pending job:
            *   Retrieves server config (URL, auth).
            *   **Checkpoint Verification:** If `checkpoint_name` is specified, calls `verifyCheckpointExists` helper.
                *   `verifyCheckpointExists` calls Forge API `GET /sdapi/v1/sd-models`.
                *   Compares requested checkpoint name (normalizing slashes `/` vs `\`) against Forge's reported model titles.
                *   Returns the *exact matching title string* (e.g., `Pony\cyberrealisticPony_v8.safetensors [hash]`) if found, otherwise `null`.
                *   If verification fails (returns `null`), job is marked 'failed' and generation is skipped.
            *   **Resource Auto-Download:** *(Future Enhancement)*
                *   When a checkpoint/LoRA is not found, query Civitai API to identify and locate the model.
                *   Trigger download and notify user of progress.
                *   Resume job processing when download completes.
            *   **Payload Construction:**
                *   Converts `seed` and `subseed` (from `job.generation_params`) to integer `-1` if empty or non-numeric.
                *   Constructs payload for `POST /sdapi/v1/txt2img`.
                *   If checkpoint verification passed, adds `override_settings: { sd_model_checkpoint: "EXACT_FORGE_TITLE_STRING" }`.
                *   Currently sets `send_images: false`, `save_images: true` (telling Forge to save locally).
            *   **API Call:** Sends synchronous request to Forge `/sdapi/v1/txt2img`.
            *   **Response Handling:** Processes success/error response from Forge.
            *   Updates job status (`completed` or `failed`) and `result_details` (currently includes Forge response info) in the queue using `utils/jobQueueHelpers.js`.
    *   Backend (`utils/jobQueueHelpers.js`):
        *   Added `getJobById` function.
*   **Current State:** Successfully generates image using the selected checkpoint by overriding the model via the API. Image is currently saved on the Forge server itself, not sent back to MobileSD. Frontend does not yet poll for status or display results.

---

### Phase 5: Generator Page - Progress & Output Handling (Not Started)

*   **Goal:** Implement frontend polling for job status, display progress (basic status first), and show the final generated image(s) in the UI.
*   **Status:** **Not Started**
*   **Tasks:**
    *   **Frontend Polling:** Modify `public/js/app.js` (`handleGenerateImageClick` success path) to periodically call `GET /api/v1/queue/jobs/:jobId/status` after submitting a job.
    *   **Status Display:** Update UI elements (e.g., `progressText`) based on the `status` field received from the polling endpoint (`pending`, `processing`, `completed`, `failed`). Show error details if status is `failed`.
    *   **Image Display:** Modify `public/js/app.js` to retrieve the saved image filenames from the `result_details` in the job status response (once polling and server-side saving are implemented) and construct URLs to display the images in the `outputImageContainer`.
    *   **Resource Download Status:** Add handling for a new status type (`downloading_resources`) to show progress of model downloads if needed for the job.
    *   **(Future):** Investigate more detailed progress (percentage, live preview) possibly by reverting to Forge's async queue/SSE approach if the synchronous method proves too limiting for UX.

---

### Phase VI: Next Features / Refinements (Enhanced)

*   **Enhanced Civitai Integration:**
    *   Compatibility with existing Forge metadata format and structures.
    *   Automatic model identification and matching with Civitai database.
    *   On-demand downloading of missing models/LoRAs during job processing.
    *   Model update checking and notification system.
*   LoRA Handling in Prompt (Currently appends, consider refining based on Forge capabilities).
*   Error Handling & User Feedback (More robust messages, UI indicators).
*   Civitai Browsing Interface (Search, filter, and download models/LoRAs directly).
*   Image Browser/History Page with enhanced filtering options.
*   Refactor/Code Cleanup.
*   More Generation Parameters (UI and backend support).
*   User Authentication for MobileSD UI itself.

---

### VII. Immediate Steps

*Note: These steps relate to the FastAPI-based dispatcher described in "Phase 4: Generator Page - Main Action" above. For the primary development path focusing on the asynchronous Gradio API and robust background processing, please refer to **"VII. Immediate Steps (Revised - Focusing on Phase 3 Frontend Development)"** earlier in this document.*

1.  **Modify Dispatcher for Image Saving:**
    *   **File:** `services/dispatcher.js`
    *   **Action:** Change payload to `send_images: true`, `save_images: false`.
    *   **Action:** In the success handler after the `axios.post` to `/sdapi/v1/txt2img`, process the `response.data.images` array (contains base64 image strings).
    *   **Action:** For each base64 string, use the existing `saveImageData` helper function to decode and save the image to the MobileSD server's configured output path (`STABLE_DIFFUSION_SAVE_PATH`).
    *   **Action:** Modify the `updateJobInQueue` call for completed jobs to store the *filenames* of the saved images in `result_details` (e.g., `{ images: ["filename1.png", "filename2.png"], info: { ...parsedInfo... } }`).
2.  **Frontend Polling & Status:**
    *   **File:** `public/js/app.js`
    *   **Action:** In `handleGenerateImageClick`, after receiving the `202 Accepted` response with the `mobilesd_job_id`, start a `setInterval` to call `GET /api/v1/queue/jobs/:jobId/status`.
    *   **Action:** Update the `progressText` element based on the `status` returned by the poll.
    *   **Action:** Stop the interval when the status is `completed` or `failed`.
    *   **Action:** Display error details from `result_details.error` if status is `failed`.
    *   **Action:** Re-enable the Generate button only after the job is fully completed or failed.
3.  **Frontend Image Display:**
    *   **File:** `public/js/app.js`
    *   **Action:** When the polling status indicates `completed`, retrieve the image filenames from `result_details.images`.
    *   **Action:** Construct image URLs (e.g., `/outputs/[filename]`, assuming Express serves the output directory) and create `<img>` elements within `outputImageContainer` to display them. 
4.  **Update Civitai Model Download Process:**
    *   **File:** `routes/civitai.js`
    *   **Action:** Modify the metadata creation logic to use the format matching Forge extension (`description`, `sd version`, etc.).
    *   **Action:** Add logic to check for and preserve existing metadata when downloading new models.
    *   **Action:** Ensure consistent naming for preview images compatible with Forge UI. 

## X. Unified Queue System: Multi-Application Support (NEW)

### Overview
The MobileSD application will evolve from a Forge-specific queue system to a unified queue that can manage jobs from multiple AI applications including Forge, ComfyUI, and potentially others. This approach will prevent GPU overload by orchestrating all jobs through a single resource-aware queue manager.

### Architecture Changes

1. **Unified Job Schema Extension:**
   - Add `app_type` field to job records (e.g., "forge", "comfyui")
   - Implement application-specific parameter schemas within the `generation_params` object
   - Standardize common fields like priority, resource requirements, and timestamps

2. **Modular Dispatcher System:**
   - Create a dispatcher registry to manage multiple application dispatchers
   - Implement application-specific dispatchers that handle the unique API requirements of each platform
   - Add dispatcher selection logic based on job's `app_type`
   - Retain all monitoring and progress tracking functionality

3. **Extensions Development:**
   - Create Forge extension:
     - Add "Queue in MobileSD" button to Forge UI
     - Capture complete generation parameters
     - Send parameters to MobileSD API
   - Create ComfyUI extension:
     - Add "Queue in MobileSD" option to workflow execution
     - Serialize workflow and parameters
     - Send to MobileSD API
   - Define consistent API contract for all extensions

4. **Queue Manager Enhancements:**
   - Implement resource monitoring for more intelligent job dispatching
   - Add GPU memory requirement estimation
   - Develop priority system that balances job importance with resource availability
   - Build application-specific adapters that normalize progress reporting

### Implementation Plan

1. **Phase 1: Core Architecture**
   - Extend job database schema to include `app_type` field
   - Create dispatcher registry and selection logic
   - Implement standardized job submission API endpoint
   - Update UI to display application type in queue view

2. **Phase 2: Forge Extension**
   - Create basic extension structure (Python backend, JS frontend)
   - Add UI elements to Forge interface
   - Implement parameter capture from Forge UI
   - Create secure communication with MobileSD API

3. **Phase 3: Forge Dispatcher Refinement**
   - Update existing dispatcher to work with modular system
   - Enhance monitoring to maintain consistent progress reporting
   - Implement resource usage tracking specific to Forge

4. **Phase 4: ComfyUI Support**
   - Research ComfyUI API and workflow structure
   - Develop ComfyUI extension
   - Create ComfyUI-specific dispatcher
   - Implement progress monitoring for ComfyUI jobs

5. **Phase 5: Resource Management**
   - Implement GPU memory monitoring
   - Develop intelligent job scheduling based on resource requirements
   - Add priority system that considers both user preference and resource availability
   - Create resource reservation system to prevent conflicts

### Extension Technical Requirements

#### Forge Extension

1. **Structure:**
   ```
   mobilesdqueue/
   ├── scripts/
   │   └── mobilesdqueue.py  (Main Python code)
   ├── javascript/
   │   └── mobilesdqueue.js  (Frontend integration)
   └── install.py            (Installation script)
   ```

2. **Features:**
   - Add "Queue in MobileSD" button next to "Generate" button
   - Capture all generation parameters, including:
     - Model selection (checkpoint, VAE, etc.)
     - Prompt and negative prompt
     - Sampling parameters (steps, CFG, method)
     - Size and batch settings
     - LoRA configurations
     - Other extension configurations when possible
   - Configuration panel for MobileSD server URL and authentication
   - Optional priority setting
   - Job status display for queued jobs

#### ComfyUI Extension

1. **Structure:**
   ```
   mobilesdqueue-comfyui/
   ├── web/
   │   └── js/
   │       └── mobilesdqueue.js  (UI integration)
   └── __init__.py               (Python initialization)
   ```

2. **Features:**
   - Add "Queue in MobileSD" option to workflow context menu
   - Serialize complete workflow including node configurations
   - Extract key parameters for queue display (model, size, steps)
   - Allow priority setting
   - Provide feedback on queue position and status

### API Endpoints

1. **Enhanced Job Submission:**
   ```
   POST /api/v2/generate
   {
     "app_type": "forge|comfyui",
     "target_server_alias": "server1",
     "priority": 1,
     "generation_params": {
       // Application-specific parameters
     },
     "metadata": {
       // Additional information for display/tracking
     }
   }
   ```

2. **Application-Specific Status Reporting:**
   ```
   GET /api/v2/queue/jobs/:jobId/status
   {
     "mobilesd_job_id": "...",
     "app_type": "forge|comfyui",
     "status": "pending|processing|completed|failed",
     "progress": 45,
     "application_specific_data": {
       // Fields that vary by application type
     },
     // Standard fields...
   }
   ```

### Timeline and Milestones

1. **Research & Planning (2 weeks)**
   - Analysis of ComfyUI API and workflow structure
   - Design of extended database schema
   - Architecture document for modular dispatcher system

2. **Core Implementation (3 weeks)**
   - Database schema extension
   - Dispatcher registry and selection logic
   - API endpoint updates
   - UI modifications for multi-application support

3. **Forge Extension Development (2 weeks)**
   - Basic extension structure
   - UI integration
   - Parameter capture and submission
   - Testing and refinement

4. **ComfyUI Support (3 weeks)**
   - Extension development
   - Dispatcher implementation
   - Progress monitoring
   - Testing with various workflow types

5. **Resource Management (2 weeks)**
   - GPU monitoring implementation
   - Intelligent scheduling
   - Priority system refinement
   - Testing under load conditions

### Future Extensions

Beyond Forge and ComfyUI, the system can be extended to support other AI applications:

1. **Potential Additional Applications:**
   - Automatic1111 Web UI (original)
   - InvokeAI
   - Kohya_ss (for training)
   - RunwayML
   - Kandinsky

2. **Advanced Features:**
   - Cross-application workflows (pipeline jobs through multiple AI tools)
   - Resource forecasting based on job history
   - Machine learning for optimal job scheduling
   - Remote execution on networked GPUs
   - Distributed processing across multiple machines 