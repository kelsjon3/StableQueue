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
5.  **Core Generation Endpoints (Using Dynamic Server Configs):** (APIs Implemented)

## III. Frontend UI Updates (HTML, CSS, Vanilla JavaScript) - NEXT PHASE

1.  **General:** All frontend assets served by the Node.js/Express application from the `public/` directory.
2.  **Main Generation Page:**
    *   Server Selection Dropdown (fetch `/api/v1/servers`). *(Implemented: Dynamically populated from backend).*
    *   Input Fields (Prompts, Seed, Width, Height, Steps, CFG, Sampler). *(HTML structure in place).*
    *   LoRA Selection (fetch `/api/v1/loras`, dynamic rows for name/weight). *(Implemented: Fetches LoRAs, allows adding/removing rows, populates dropdowns with subfolder paths, recursive backend scan in place).*
    *   Checkpoint Selection (fetch `/api/v1/checkpoints`). *(Implemented: Populated from backend, displays subfolder paths, recursive backend scan in place).*
    *   "Generate Image" Button (call `POST /api/v1/generate`). *(Pending)*
    *   Progress Display (poll `GET /api/v1/progress`). *(Pending)*
    *   Image Display Area. *(Pending HTML structure / logic)*
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
    *   **Core Generation Logic:** Implement `/api/v1/generate` and `/api/v1/progress`. *(Done)*
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

## VII. Immediate Steps (Current Focus - Start of Phase 3 Frontend)

1.  **Update `docs/PLAN.md` to reflect Phase 1 Backend completion.** (This task is now complete).
2.  **User to handle GitHub synchronization.**
3.  **User to finalize configuration in `deploy-mobilesd-to-unraid.sh`.** (Done, pending verification by user).
4.  **Begin implementation of Phase 3 (Frontend UI Development):**
    *   Structure `public/index.html` for the main generation page.
    *   Set up basic `public/css/style.css`.
    *   Start `public/js/app.js` to fetch initial data (servers, models) from the backend API and populate UI elements. 