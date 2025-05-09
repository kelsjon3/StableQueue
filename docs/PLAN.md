# Project Plan: MobileSD - Stable Diffusion Web UI & API Intermediary (Revised)

*This plan has been significantly updated to reflect a single-container Docker strategy and incorporate advanced features including dynamic server configuration, local resource management (with a phased approach for on-demand model syncing), and Civitai API integration.*

## I. Core Architectural Change: Adopt a Single Docker Container Strategy

*   **Project Packaging:** The project will be packaged into a **single Docker container**.
*   **Node.js/Express Responsibilities:**
    1.  Serve all API endpoints.
    2.  Serve all static frontend assets (HTML, CSS, JavaScript from a designated folder, e.g., `public` or `frontend`).
*   **Implications:**
    *   A separate Nginx frontend service and its configuration are **no longer needed**.
    *   The `Dockerfile` will be for this consolidated Node.js application, including copying and serving frontend assets.
    *   `docker-compose.yml` will define a single service (e.g., `mobilesd`), useful for managing environment variables, ports, and volumes.

## II. Backend Updates (Node.js/Express) - Phase 1 Completed

1.  **Serving Frontend Assets:** (Setup done in app.js)
2.  **Dynamic Server Configuration Management (Forge Instances):** (APIs Implemented)
3.  **Local Resource Management & Model Access Strategy (Phased Approach):** (APIs for scanning master library Implemented)
4.  **Civitai API Integration:** (APIs Implemented)
5.  **Core Generation Endpoints (Using Dynamic Server Configs):** (APIs Implemented, generation successful with caveats)
    *   **Refactor for Forge API (Queue-Based System) - Iteration 2 (Successful Generation):**
        *   The image generation functionality in `routes/generation.js` has been significantly updated to integrate with Stable Diffusion Forge's queue-based API.
        *   **`POST /api/v1/generate` (Initiating Generation):**
            *   **Target Forge Endpoint:** Sends requests to the Forge server's `/queue/join`.
            *   **Payload Structure (Major Update):**
                *   `fn_index`: Now correctly set to `257` (identified from Forge UI HAR analysis for main txt2img).
                *   `trigger_id`: Remains `16`.
                *   `data`: Is now a **very large array (approx. 130+ elements)**, mirroring the structure sent by the Forge UI for `fn_index: 257`. MobileSD maps its UI parameters (prompts, W, H, CFG, steps, seed, sampler name, etc.) to specific indices in this array. Remaining elements use fixed defaults derived from a successful Forge UI generation.
                *   A dynamic `task(...)` ID is generated for the first element.
                *   **Checkpoint Handling:** The payload sends a fixed `"Use same checkpoint"` string. This means MobileSD currently relies on the checkpoint being pre-selected in the Forge UI itself. MobileSD's checkpoint dropdown is currently bypassed for this generation flow.
                *   **Sampler Handling:** MobileSD UI now collects `sampler_name` (text input, e.g., "Euler") which is mapped to the appropriate sampler name index in the `data` array.
                *   **LoRA Handling:** LoRAs are included in the positive prompt string (e.g., `prompt <lora:name:weight>`). Forge appears to process these successfully.
            *   **Response to MobileSD Client:** Unchanged (responds immediately with `session_hash` and `server_alias`).
        *   **`GET /api/v1/progress` (Progress and Results):**
            *   **SSE Proxy & Parsing:** Still acts as an SSE proxy. Frontend (`public/js/app.js`) now has more detailed parsing for observed Forge messages:
                *   `estimation`: Handles queue position and ETA (including `null` ETA).
                *   `process_starts`: Updates UI text.
                *   `heartbeat`: New message type from Forge, now silently acknowledged by frontend to avoid log spam.
                *   `process_generating`: Handles step-by-step progress and can display live preview images if Forge sends them as base64 in `output.data.image`.
                *   `process_completed`: This is now understood to return a complex `output.data` array.
                    *   `output.data[0]`: Contains an array of image result objects.
                    *   Each image result object: `{ image: { path: "...", url: "..." }, caption: null }`.
                    *   **Crucially, Forge returns a URL to the image on its server, not direct base64 data.**
            *   **Current Image Handling:**
                *   **Frontend (`public/js/app.js`):** Updated to extract the `image.url` from the `process_completed` message and use this URL as the `src` for the `<img>` tag, allowing the browser to display the image directly from the Forge server. *Successfully displays the image in MobileSD UI.*
                *   **Backend (MobileSD - `routes/generation.js`):** Image saving to `STABLE_DIFFUSION_SAVE_PATH` is **NOT YET IMPLEMENTED** for this new URL-based response. The image appears in Forge's output folder but is not yet downloaded and saved by MobileSD.
        *   **Workflow Summary (Updated):**
            1.  Client POSTs to `/api/v1/generate` with parameters (now including `sampler_name`).
            2.  MobileSD backend (`routes/generation.js`):
                *   Uses `fn_index: 257`.
                *   Constructs the large `data` array, mapping UI inputs and using fixed defaults.
                *   Queues job with Forge via `/queue/join` and returns `session_hash`.
            3.  Client opens `EventSource` to `/api/v1/progress`.
            4.  MobileSD backend (`/api/v1/progress`) proxies SSE events.
            5.  Client (`public/js/app.js`) parses SSE:
                *   Displays progress, queue status, heartbeats (silently).
                *   On `process_completed`, extracts image URL(s) and displays image(s) by setting `<img> src` to these URLs.
            6.  *(TODO: Backend `/api/v1/progress` needs to intercept `process_completed`, extract image URL(s), download the image(s) from Forge, and save them to `STABLE_DIFFUSION_SAVE_PATH`.)*

## III. Frontend UI Updates (HTML, CSS, Vanilla JavaScript) - NEXT PHASE

1.  **General:** All frontend assets served by the Node.js/Express application from the `public/` directory.
2.  **Main Generation Page:**
    *   Server Selection Dropdown *(Implemented)*.
    *   Input Fields (Prompts, Seed, Width, Height, Steps, CFG, **Sampler Name**). *(Updated: Sampler Index changed to Sampler Name text input, default "Euler"). New Forge-specific inputs added (style preset, etc. with HAR defaults).*
    *   LoRA Selection *(Implemented, LoRAs included in prompt string)*.
    *   Checkpoint Selection *(Implemented, but currently bypassed by Forge API payload which uses "Use same checkpoint". User must pre-select in Forge UI).*
    *   "Generate Image" Button (calls `POST /api/v1/generate`). *(Implemented).*
    *   Progress Display (SSE via `GET /api/v1/progress`). *(Implemented: Handles estimation, start, generating, completion, heartbeat. Displays progress text and bar).*
    *   Image Display Area. *(Implemented: Displays image from URL provided by Forge in `process_completed` SSE message).*
3.  **Server Setup Page/Tab:**
    *   UI for CRUD operations on server configurations (call `/api/v1/servers` endpoints). *(Implemented: Full CRUD functionality with UI for adding, listing, editing, and deleting server configurations. Includes tab navigation).*
4.  **Civitai Integration UI:**
    *   Input for Civitai Image ID & "Fetch" button (call `POST /api/v1/civitai/image-info`).
    *   Populate form fields from response.
    *   Display non-local resources with "Download" button (call `POST /api/v1/civitai/download-model`).
    *   Provide download feedback.
5.  **Overall UI/UX:**
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

1.  **Phase 1: Core MobileSD Application (Assuming Simpler Model Access) - COMPLETED**
    *   **Core Backend & Docker Setup:** Initialize Node.js, Express, static file serving (`public/index.html`), `Dockerfile`, `docker-compose.yml`. *(Done)*
    *   **Dynamic Server Config:** Implement `/api/v1/servers` CRUD APIs. *(Done)*
    *   **Core Generation Logic:** Implement `/api/v1/generate` and `/api/v1/progress`. *(Iteration 2: Successfully generates images with Forge using fn_index 257 and large data array; image displayed in UI via URL. Backend saving pending).*
    *   **Local Resource Listing:** Implement `/api/v1/loras` and `/api/v1/checkpoints`. *(Done)*
    *   **Civitai Integration (Download to Unraid):** Implement `/api/v1/civitai/image-info` and `/api/v1/civitai/download-model`. *(Done)*
    *   **Basic Frontend Placeholder:** Setup `public/index.html` and static serving. *(Done)*
2.  **Phase 2: On-Demand Model Sync & Advanced Features (Future)**
    *   (Details as before: Lightweight API Script, MobileSD Backend/Frontend Updates for Sync)
3.  **Phase 3: UI Refinement & Full Frontend Implementation - CURRENT FOCUS**
    *   Dedicated Server Setup Page/Tab UI. *(Completed: Full CRUD UI for server configurations, including tab navigation).*
    *   Refine main generation page UI, progress display, image display.
        *   Server selection dropdown. *(Completed)*
        *   Checkpoint selection dropdown, including recursive scan and subfolder display. *(Completed)*
        *   LoRA selection UI with dynamic rows, recursive scan, and subfolder display. *(Completed)*
        *   Implement Civitai Helper UI (fetch info, download). *(Pending)*
        *   Implement core generation logic (send request, poll progress, display results). *(Pending)*
    *   Ensure UI is responsive. *(Ongoing)*
    *   *Note: This phase number was shifted; it now represents the full frontend development based on completed Phase 1 backend.*
4.  **Phase 4: Testing, Optimization, and Documentation (Ongoing & Final)**
    *   (Details as before)
5.  **Phase 5 (Future): Cache Management & Extension Exploration**
    *   (Details as before)

## VII. Immediate Steps (Current Focus - Phase 3 Frontend & Backend Image Handling)

1.  **Implement Backend Image Downloading and Saving:** *(New Top Priority)*
    *   In `/api/v1/progress` (`routes/generation.js`), when a `process_completed` SSE message is parsed:
        *   Extract the `image.url`(s) from `jsonData.output.data[0]$.
        *   For each URL, MobileSD backend uses `axios` (or similar) to make a GET request to download the image bytes from the Forge server.
        *   Save the downloaded image buffer to `process.env.STABLE_DIFFUSION_SAVE_PATH` with a unique filename.
        *   Log success/failure of download & save.
        *   Consider if/how to signal the saved filename/path back to the client (e.g., as part of a custom SSE message MobileSD sends, or client assumes save based on successful display).
2.  **Update `docs/PLAN.md` to reflect current status and next steps.** (This task)
3.  **User to handle GitHub synchronization.**
4.  **User to finalize configuration in `deploy-mobilesd-to-unraid.sh`.** (Done, pending verification by user).
5.  **Begin implementation of Phase 3 (Frontend UI Development):**
    *   Structure `public/index.html` for the main generation page.
    *   Set up basic `public/css/style.css`.
    *   Start `public/js/app.js` to fetch initial data (servers, models) from the backend API and populate UI elements. 